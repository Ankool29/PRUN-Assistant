import json
from pathlib import Path
import unittest

from collector.navigation import build_graph, normalize_navigation, shortest
from collector.normalize import InvalidData


class NavigationTests(unittest.TestCase):
    def test_published_sfc_paths_reproduce_parsecs_and_jump_counts(self):
        data = json.loads((Path(__file__).parent / "fixtures/m1-navigation.json").read_text())
        _, edges = build_graph(data["stars"], data["parsecLength"])
        for reference in data["references"]:
            paths = shortest(edges, data["origin"], reference["strategy"] == "distance")
            path, distance = paths[data["destination"]]
            self.assertEqual(len(path) - 1, reference["jumps"])
            self.assertEqual(round(distance), reference["distancePc"])

    def test_invalid_or_unconnected_routes(self):
        def star(identity, x, *destinations):
            return dict(SystemId=identity, NaturalId=identity, PositionX=x, PositionY=0, PositionZ=0,
                        Connections=[{"ConnectingId": destination} for destination in destinations])
        with self.assertRaises(InvalidData):
            build_graph([star("A", 0, "B")], 1)
        with self.assertRaises(InvalidData):
            build_graph([star("A", 0)], 0)
        result = normalize_navigation([star("A", 0, "B"), star("B", 9), star("C", 18)],
                                      [{"ComexCode": code, "SystemId": system, "NaturalId": code}
                                       for code, system in [("CX1", "A"), ("CX2", "B"), ("CX3", "C")]],
                                      {"ParsecLength": 3})
        self.assertEqual(result["stations"][0]["position"], (0, 0, 0))
        self.assertEqual([(row["from"], row["to"], row["distancePc"]) for row in result["routes"]],
                         [("CX1", "CX2", 3), ("CX1", "CX2", 3)])


if __name__ == "__main__":
    unittest.main()
