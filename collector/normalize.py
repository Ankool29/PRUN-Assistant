"""Adaptateurs FIO REST vers le contrat public M0."""
from datetime import datetime
from math import isfinite


class InvalidData(ValueError):
    pass


def rows(value, label, *, nonempty=False):
    if not isinstance(value, list) or (nonempty and not value):
        raise InvalidData(f"{label} : tableau attendu")
    if any(not isinstance(row, dict) for row in value):
        raise InvalidData(f"{label} : objets attendus")
    return value


def text(row, key):
    value = row.get(key)
    if not isinstance(value, str) or not value.strip():
        raise InvalidData(f"{key} : texte attendu")
    return value


def number(row, key, *, nullable=False, integer=False):
    if key not in row:
        raise InvalidData(f"{key} : champ absent")
    value = row[key]
    if nullable and value is None:
        return None
    if type(value) not in (int, float) or not 0 <= value <= 2**53 - 1 or not isfinite(value):
        raise InvalidData(f"{key} : nombre positif ou nul attendu")
    if integer and type(value) is not int:
        raise InvalidData(f"{key} : entier attendu")
    return value


def timestamp(row, key):
    value = text(row, key)
    try:
        date = datetime.fromisoformat(value)
        if date.utcoffset() is None:
            raise ValueError
    except ValueError:
        raise InvalidData(f"{key} : date avec fuseau attendue") from None
    return date.isoformat(timespec="milliseconds")


def amounts(row, key, ticker_key="Ticker"):
    return [
        {"ticker": text(item, ticker_key), "quantity": number(item, "Amount", integer=True)}
        for item in rows(row.get(key), key)
    ]


def material(row):
    return {
        "ticker": text(row, "Ticker"), "name": text(row, "Name"),
        "category": text(row, "CategoryName"),
        "weight": number(row, "Weight"), "volume": number(row, "Volume"),
    }


def exchange(row):
    return {
        "code": text(row, "ComexCode"), "name": text(row, "ComexName"),
        "station": text(row, "Name"), "currency": text(row, "CurrencyCode"),
        "decimals": number(row, "CurrencyDecimals", integer=True),
    }


def building(row):
    expertise = row.get("Expertise")
    if expertise is not None:
        expertise = text(row, "Expertise")
    return {
        "ticker": text(row, "Ticker"), "name": text(row, "Name"),
        "expertise": expertise, "area": number(row, "AreaCost"),
        "workforce": {
            key.lower(): number(row, key, integer=True)
            for key in ("Pioneers", "Settlers", "Technicians", "Engineers", "Scientists")
        },
        "construction": amounts(row, "BuildingCosts", "CommodityTicker"),
    }


def recipe(row):
    duration = number(row, "TimeMs", integer=True)
    if not duration:
        raise InvalidData("TimeMs : durée strictement positive attendue")
    return {
        "id": text(row, "StandardRecipeName"), "name": text(row, "RecipeName"),
        "building": text(row, "BuildingTicker"), "durationMs": duration,
        "inputs": amounts(row, "Inputs"), "outputs": amounts(row, "Outputs"),
    }


def orders(row, key, *, descending=False):
    values = [
        {"price": number(item, "ItemCost"), "quantity": number(item, "ItemCount", nullable=True, integer=True)}
        for item in rows(row.get(key), key)
    ]
    return sorted(values, key=lambda item: item["price"], reverse=descending)


def market(row):
    return {
        "ticker": text(row, "MaterialTicker"), "exchange": text(row, "ExchangeCode"),
        "currency": text(row, "Currency"), "observedAt": timestamp(row, "Timestamp"),
        "lastTradeAtMs": number(row, "PriceTimeEpochMs", nullable=True, integer=True),
        "last": number(row, "Price", nullable=True), "average": number(row, "PriceAverage", nullable=True),
        "bid": number(row, "Bid", nullable=True), "ask": number(row, "Ask", nullable=True),
        "marketMakerBuy": number(row, "MMBuy", nullable=True), "marketMakerSell": number(row, "MMSell", nullable=True),
        "supply": number(row, "Supply", integer=True), "demand": number(row, "Demand", integer=True),
        "buys": orders(row, "BuyingOrders", descending=True), "sells": orders(row, "SellingOrders"),
    }


ADAPTERS = {
    "materials": ("/material/allmaterials", material, ("ticker",)),
    "exchanges": ("/exchange/station", exchange, ("code",)),
    "buildings": ("/building/allbuildings", building, ("ticker",)),
    "recipes": ("/recipes/allrecipes", recipe, ("id",)),
    "markets": ("/exchange/full", market, ("exchange", "ticker")),
}


def normalize(section, payload):
    path, adapter, keys = ADAPTERS[section]
    result = []
    seen = set()
    for index, row in enumerate(rows(payload, path, nonempty=True)):
        try:
            item = adapter(row)
            identity = tuple(item[key] for key in keys)
            if identity in seen:
                raise InvalidData(f"identifiant en double {identity}")
        except InvalidData as exc:
            raise InvalidData(f"{path}[{index}] : {exc}") from exc
        seen.add(identity)
        result.append((identity, item))
    return [item for _, item in sorted(result)]


def validate_references(data):
    tickers = {item["ticker"] for item in data["materials"]}
    buildings = {item["ticker"] for item in data["buildings"]}
    currencies = {item["code"]: item["currency"] for item in data["exchanges"]}
    for item in data["markets"]:
        if item["ticker"] not in tickers or currencies.get(item["exchange"]) != item["currency"]:
            raise InvalidData(f"Cotation sans matériau ou bourse cohérente : {item['ticker']}.{item['exchange']}")
    for item in data["recipes"]:
        if item["building"] not in buildings:
            raise InvalidData(f"Bâtiment absent pour {item['id']}")
        if any(part["ticker"] not in tickers for part in item["inputs"] + item["outputs"]):
            raise InvalidData(f"Matériau absent pour {item['id']}")
    for item in data["buildings"]:
        if any(part["ticker"] not in tickers for part in item["construction"]):
            raise InvalidData(f"Matériau de construction absent pour {item['ticker']}")
