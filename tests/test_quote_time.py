import unittest

from collector.normalize import market, quote_timestamp


class QuoteTimeTests(unittest.TestCase):
    def test_normalizes_real_fio_fraction_and_offsets(self):
        for value in ("2026-11-21T19:31:22.922765Z",
                      "2026-11-21T20:31:22.922+01:00",
                      "2026-11-21T14:31:22.922-0500"):
            self.assertEqual(quote_timestamp(value), "2026-11-21T19:31:22.922+00:00")

    def test_keeps_missing_or_invalid_quote_time_unknown(self):
        row = dict(MaterialTicker="AL", ExchangeCode="CI2", Currency="CIS",
                   PriceTimeEpochMs=1795282900000, Price=None, PriceAverage=None,
                   Bid=100, Ask=110, MMBuy=None, MMSell=None, Supply=1, Demand=1,
                   BuyingOrders=[], SellingOrders=[])
        self.assertIsNone(market(row)["observedAt"])
        for timestamp in (None, 1795282900000, "2026-11-21", "2026-11-21T19:31:22",
                          "2026-02-29T00:00:00Z", "2026-11-21T19:31:22+10:60"):
            normalized = market({**row, "Timestamp": timestamp})
            self.assertIsNone(normalized["observedAt"])
            self.assertEqual(normalized["lastTradeAtMs"], row["PriceTimeEpochMs"])
