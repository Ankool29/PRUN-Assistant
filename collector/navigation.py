"""Carte publique FIO et chemins FTL entre bourses."""
import argparse
from datetime import datetime, timezone
from heapq import heappop, heappush
from math import dist, isfinite
from pathlib import Path
import sys
import time

from .collect import MIN_INTERVAL, atomic_write, fetch_json
from .normalize import InvalidData, number, rows, text


def build_graph(stars, parsec):
    if not parsec:
        raise InvalidData("ParsecLength doit être positif")
    nodes = {}
    for star in rows(stars, "systemstars", nonempty=True):
        identity = text(star, "SystemId")
        xyz = tuple(star.get(f"Position{axis}") for axis in "XYZ")
        if identity in nodes or any(type(value) not in (float, int) or not isfinite(value) for value in xyz):
            raise InvalidData("Système dupliqué ou coordonnées invalides")
        links = [text(link, "ConnectingId") for link in rows(star.get("Connections"), "Connections")]
        nodes[identity] = (text(star, "NaturalId"), xyz, links)
    edges = {identity: {} for identity in nodes}
    for identity, (_, xyz, links) in nodes.items():
        for neighbour in links:
            if neighbour not in nodes or neighbour == identity:
                raise InvalidData("Liaison stellaire invalide")
            # FIO expose les liaisons sortantes. Ne pas ajouter de liaisons absentes.
            length = dist(xyz, nodes[neighbour][1]) / parsec
            if not isfinite(length) or length <= 0:
                raise InvalidData("Longueur de liaison invalide")
            edges[identity][neighbour] = length
    return nodes, edges


def shortest(edges, origin, by_distance):
    best = {}
    queue = [(0, 0, (origin,), 0)]
    while queue:
        _, _, path, length = heappop(queue)
        node = path[-1]
        if node in best:
            continue
        best[node] = (path, length)
        for target, step in sorted(edges[node].items()):
            if target in best:
                continue
            distance = length + step
            jumps = len(path)
            primary, secondary = (distance, jumps) if by_distance else (jumps, distance)
            heappush(queue, (primary, secondary, path + (target,), distance))
    return best


def normalize_navigation(stars, stations, simulation):
    if not isinstance(simulation, dict):
        raise InvalidData("Paramètres de simulation invalides")
    nodes, edges = build_graph(stars, number(simulation, "ParsecLength"))
    markets = {}
    for row in rows(stations, "station", nonempty=True):
        code = text(row, "ComexCode")
        system = text(row, "SystemId")
        if system not in nodes or code in markets:
            raise InvalidData("Système de bourse absent ou bourse dupliquée")
        markets[code] = (system, text(row, "NaturalId"))
    routes = []
    for origin, (start, _) in sorted(markets.items()):
        for strategy in ("jumps", "distance"):
            paths = shortest(edges, start, strategy == "distance")
            for dest, (end, _) in sorted(markets.items()):
                if origin == dest or end not in paths:
                    continue
                path, distance = paths[end]
                routes.append({"from": origin, "to": dest, "strategy": strategy,
                               "systems": [nodes[node][0] for node in path], "distancePc": distance})
    return {
        "stations": [{"exchange": code, "station": station, "system": nodes[system][0],
                      "position": nodes[system][1]} for code, (system, station) in sorted(markets.items())],
        "routes": routes,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("public/data/navigation.json"))
    args = parser.parse_args()
    try:
        stars = fetch_json("/systemstars")
        time.sleep(MIN_INTERVAL)
        stations = fetch_json("/exchange/station")
        time.sleep(MIN_INTERVAL)
        simulation = fetch_json("/global/simulationdata")
        navigation = normalize_navigation(stars, stations, simulation)
        navigation.update(source="fio", schemaVersion=1,
                          collectedAt=datetime.now(timezone.utc).isoformat(timespec="seconds"))
        atomic_write(args.output, navigation)
    except (InvalidData, OSError) as error:
        print(f"Navigation : {error}", file=sys.stderr)
        return 1
    print(f"Navigation : {len(navigation['stations'])} bourses, {len(navigation['routes'])} chemins")
    return 0


if __name__ == "__main__":
    sys.exit(main())
