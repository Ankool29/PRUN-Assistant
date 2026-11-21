"""Collecte bornée des bougies quotidiennes de FIO, indépendamment de M0."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import time

from .collect import MIN_INTERVAL, atomic_write, fetch_json
from .normalize import InvalidData, number, rows, text

DAY_MS = 86_400_000
WINDOW_DAYS = 30
PAIRS_PER_EXCHANGE = 4
PAIR_CODE = re.compile(r"[A-Z0-9]+")


def select_pairs(snapshot, now_ms, per_exchange=PAIRS_PER_EXCHANGE):
    """Privilégie les cotations récentes et une profondeur observée des deux côtés."""
    candidates = []
    for item in snapshot["markets"]:
        codes = (item["ticker"], item["exchange"])
        if not all(PAIR_CODE.fullmatch(code) for code in codes):
            continue
        traded = item["lastTradeAtMs"]
        if not traded or not 0 <= now_ms - traded < 7 * DAY_MS:
            continue
        if item["observedAt"] is None:
            continue
        observed = datetime.fromisoformat(item["observedAt"]).timestamp() * 1000
        if not -300_000 <= now_ms - observed <= 3 * 3600_000:
            continue
        if not item["bid"] or not item["ask"]:
            continue
        depth = min(sum(x["quantity"] or 0 for x in item[side]) for side in ("buys", "sells"))
        if depth > 0:
            candidates.append((depth, traded, *codes))

    selected = Counter()
    for _, _, ticker, exchange in sorted(candidates, reverse=True):
        if selected[exchange] < per_exchange:
            selected[exchange] += 1
            yield ticker, exchange


def daily_points(payload, first_day_ms, last_day_ms):
    points = {}
    for item in rows(payload, "CXPC"):
        if text(item, "Interval") != "DAY_ONE":
            continue
        date = number(item, "DateEpochMs", integer=True)
        if date % DAY_MS != 0:
            raise InvalidData("Date quotidienne hors minuit UTC")
        if not first_day_ms <= date <= last_day_ms:
            continue
        prices = {key: number(item, key, nullable=True) for key in ("Open", "Close", "High", "Low")}
        traded = number(item, "Traded", integer=True)
        volume = number(item, "Volume")
        if date in points:
            raise InvalidData("Bougie quotidienne en double")
        if traded and (not all(prices.values()) or
                       not prices["Low"] <= min(prices["Open"], prices["Close"]) <=
                       max(prices["Open"], prices["Close"]) <= prices["High"]):
            raise InvalidData("Bougie quotidienne incohérente")
        points[date] = {"dayMs": date, "close": prices["Close"] if traded else None,
                        "units": traded, "turnover": volume}
    return [points[day] for day in sorted(points)]


def collect_history(snapshot, output, *, fetch=fetch_json, sleep=time.sleep, now=None):
    if snapshot["source"] != "fio":
        raise InvalidData("Instantané FIO attendu")
    now = now or datetime.now(timezone.utc)
    now_ms = int(now.timestamp() * 1000)
    today_ms = now_ms // DAY_MS * DAY_MS
    first_day = today_ms - WINDOW_DAYS * DAY_MS
    series = []
    errors = []
    for index, (ticker, exchange) in enumerate(select_pairs(snapshot, now_ms)):
        if index:
            sleep(MIN_INTERVAL)
        pair = f"{ticker}.{exchange}"
        try:
            points = daily_points(fetch(f"/exchange/cxpc/{pair}/{first_day - 1}"),
                                  first_day, today_ms - DAY_MS)
        except InvalidData as error:
            errors.append(pair)
            print(f"{pair} : {error}", file=sys.stderr)
            continue
        series.append({"ticker": ticker, "exchange": exchange, "points": points})
    atomic_write(output, {
        "schemaVersion": 1, "source": "fio", "collectedAt": now.isoformat(timespec="seconds"),
        "marketCollectedAt": snapshot["collectedAt"], "windowDays": WINDOW_DAYS, "failed": errors,
        "series": series,
    })
    print(f"Historique : {len(series)} séries publiées, {len(errors)} en échec")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, default=Path("public/data/fio.json"))
    parser.add_argument("--output", type=Path, default=Path("public/data/history.json"))
    args = parser.parse_args()
    try:
        with args.snapshot.open(encoding="utf-8") as stream:
            collect_history(json.load(stream), args.output)
    except (InvalidData, OSError, KeyError) as error:
        print(f"Échec historique : {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
