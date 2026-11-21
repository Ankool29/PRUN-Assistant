from email.message import Message
from io import BytesIO
import json
from pathlib import Path
import tempfile
from urllib.error import HTTPError, URLError
import unittest
from unittest.mock import Mock

from collector.collect import collect, fetch_json
from collector.normalize import InvalidData, normalize, orders


def response(body, content_type="application/json"):
    stream = BytesIO(body)
    stream.headers = Message()
    stream.headers["Content-Type"] = content_type
    return stream


def http_error(status, retry_after=None):
    headers = Message()
    if retry_after is not None:
        headers["Retry-After"] = retry_after
    return HTTPError("https://rest.fnar.net/exchange/full", status, "test", headers, BytesIO())


class CollectorTests(unittest.TestCase):
    def test_retries_network_and_rate_limiting(self):
        opener = Mock(side_effect=[URLError("timeout"), http_error(429, "8"), response(b"[]")])
        delay = Mock()
        self.assertEqual(fetch_json("/exchange/full", open_url=opener, sleep=delay), [])
        self.assertEqual([call.args[0] for call in delay.call_args_list], [2, 8])
        self.assertEqual(opener.call_count, 3)
        request = opener.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertIsNone(request.get_header("Authorization"))

    def test_permanent_and_exhausted_errors(self):
        for status, expected_calls in ((404, 1), (302, 1), (503, 3)):
            with self.subTest(status=status):
                opener = Mock(side_effect=[http_error(status) for _ in range(expected_calls)])
                with self.assertRaisesRegex(InvalidData, f"HTTP {status}"):
                    fetch_json("/exchange/full", open_url=opener, sleep=Mock())
                self.assertEqual(opener.call_count, expected_calls)

    def test_retry_after_longer_than_budget_stops(self):
        opener = Mock(side_effect=http_error(429, "120"))
        sleep = Mock()
        with self.assertRaises(InvalidData):
            fetch_json("/exchange/full", open_url=opener, sleep=sleep)
        sleep.assert_not_called()

    def test_invalid_json_and_html_are_rejected(self):
        for content, mime in ((b"not JSON", "application/json"), (b"[]", "text/html")):
            with self.subTest(mime=mime):
                with self.assertRaises(InvalidData):
                    fetch_json("/exchange/full", open_url=Mock(return_value=response(content, mime)))

    def test_nullable_order_quantity_and_sort(self):
        row = {"BuyingOrders": [{"ItemCost": 3, "ItemCount": None}, {"ItemCost": 9, "ItemCount": 15}]}
        self.assertEqual(orders(row, "BuyingOrders", descending=True),
                         [{"price": 9, "quantity": 15}, {"price": 3, "quantity": None}])
        with self.assertRaises(InvalidData):
            orders({"BuyingOrders": [{"ItemCost": 3}]}, "BuyingOrders")

    def test_schema_identity_and_types(self):
        material = {"Ticker": "AL", "Name": "aluminium", "CategoryName": "metals", "Volume": 0, "Weight": 1}
        for payload in ([], {}, [material, material], [dict(material, Weight=True)], [dict(material, Weight=float("nan"))]):
            with self.subTest(payload=payload):
                with self.assertRaises(InvalidData):
                    normalize("materials", payload)

    def test_aborted_collection_preserves_existing_output(self):
        material = {"Ticker": "AL", "Name": "aluminium", "CategoryName": "metals", "Volume": 0, "Weight": 1}
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "fio.json"
            output.write_text(json.dumps({"source": "fio", "collectedAt": "précédente collecte"}))
            previous = output.read_bytes()
            delay = Mock()
            fetch = Mock(side_effect=[[material], InvalidData("HTTP 503")])
            with self.assertRaises(InvalidData):
                collect(output, fetch=fetch, sleep=delay)
            self.assertEqual(output.read_bytes(), previous)
            delay.assert_called_once_with(1.0)


if __name__ == "__main__":
    unittest.main()
