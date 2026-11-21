from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from collector.history import DAY_MS, collect_history, daily_points, select_pairs
from collector.normalize import InvalidData


TODAY = 1795219200000
NOW = datetime.fromtimestamp((TODAY + 3600_000) / 1000, timezone.utc)


def candle(day, **fields):
    return {"Interval": "DAY_ONE", "DateEpochMs": day, "Open": 13, "Close": 14,
            "High": 16, "Low": 12, "Volume": 140, "Traded": 10, **fields}


def pair(ticker, exchange, quantity):
    return {"ticker": ticker, "exchange": exchange, "lastTradeAtMs": TODAY, "bid": 9,
            "ask": 10, "buys": [{"quantity": quantity}], "sells": [{"quantity": quantity}],
            "observedAt": NOW.isoformat()}


class HistoryTests(unittest.TestCase):
    def test_daily_parser_filters_partial_days_and_preserves_zero_volume(self):
        day = TODAY - DAY_MS
        data = [
            candle(TODAY, Close=99), candle(day, Interval="HOUR_ONE"),
            candle(day, Traded=0, Volume=0, Close=None), candle(day - DAY_MS),
        ]
        self.assertEqual(daily_points(data, day - DAY_MS, day), [
            {"dayMs": day - DAY_MS, "close": 14, "units": 10, "turnover": 140},
            {"dayMs": day, "close": None, "units": 0, "turnover": 0},
        ])

    def test_daily_parser_rejects_bad_ohlc_and_duplicate_days(self):
        day = TODAY - DAY_MS
        for data in ([candle(day, High=13)], [candle(day), candle(day)], [candle(day, Traded=-1)]):
            with self.subTest(data=data), self.assertRaises(InvalidData):
                daily_points(data, day, day)

    def test_selection_has_quota_and_prefers_liquid_recent_pairs(self):
        snapshot = {"markets": [
            pair("AL", "CI1", 4), pair("PE", "CI1", 9), pair("H2O", "CI2", 6),
            dict(pair("SF", "CI1", 500), observedAt="2025-01-01T00:00:00Z"),
            pair("../", "CI2", 500), pair("COF", "CI2", None),
        ]}
        self.assertEqual(list(select_pairs(snapshot, int(NOW.timestamp() * 1000), per_exchange=1)),
                         [("PE", "CI1"), ("H2O", "CI2")])

    def test_partial_failure_is_not_published_as_a_successful_series(self):
        snapshot = {"source": "fio", "collectedAt": NOW.isoformat(), "markets": [
            pair("PE", "CI1", 9), pair("H2O", "CI2", 6),
        ]}
        fetch = Mock(side_effect=[[candle(TODAY - DAY_MS)], InvalidData("HTTP 503")])
        sleep = Mock()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "history.json"
            collect_history(snapshot, output, fetch=fetch, sleep=sleep, now=NOW)
            data = json.loads(output.read_text())
        self.assertEqual(data["failed"], ["H2O.CI2"])
        self.assertEqual([row["ticker"] for row in data["series"]], ["PE"])
        self.assertEqual(data["marketCollectedAt"], NOW.isoformat())
        self.assertEqual(fetch.call_args_list[0].args[0], f"/exchange/cxpc/PE.CI1/{TODAY - 30 * DAY_MS - 1}")
        sleep.assert_called_once_with(1)


if __name__ == "__main__":
    unittest.main()
