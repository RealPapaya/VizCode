"""
metrics.py — 形狀統計與指標計算
import edge → shapes.py
call edge → 呼叫 shapes.py 工具函式
"""

import math
import json
from shapes import Shape, Circle, Rectangle, Triangle, Square
from shapes import total_area, largest_shape


# ── 統計結果資料類別 ───────────────────────────────────────────────────────────

class ShapeStats:
    """單一形狀的統計資料。"""

    def __init__(self, shape: Shape):
        self.name = type(shape).__name__
        self.area = shape.area()
        self.perimeter = shape.perimeter()
        self.ratio = self._circularity(shape)

    def _circularity(self, shape: Shape) -> float:
        """圓度指標（= 4π × area / perimeter²），圓形=1.0。"""
        p = shape.perimeter()
        if p == 0:
            return 0.0
        return 4 * math.pi * shape.area() / (p ** 2)

    def to_dict(self) -> dict:
        return {
            "name":       self.name,
            "area":       round(self.area, 4),
            "perimeter":  round(self.perimeter, 4),
            "circularity": round(self.ratio, 4),
        }


class MetricsReport:
    """一組形狀的彙整報告。"""

    def __init__(self, shapes: list):
        self._shapes = shapes
        self._stats = [ShapeStats(s) for s in shapes]

    def mean_area(self) -> float:
        if not self._stats:
            return 0.0
        return total_area(self._shapes) / len(self._shapes)

    def max_area(self) -> float:
        if not self._shapes:
            return 0.0
        return largest_shape(self._shapes).area()

    def area_variance(self) -> float:
        areas = [s.area for s in self._stats]
        if len(areas) < 2:
            return 0.0
        mean = sum(areas) / len(areas)
        return sum((a - mean) ** 2 for a in areas) / len(areas)

    def area_stddev(self) -> float:
        return math.sqrt(self.area_variance())

    def most_circular(self) -> ShapeStats:
        return max(self._stats, key=lambda s: s.ratio)

    def summary(self) -> dict:
        return {
            "count":        len(self._shapes),
            "total_area":   round(total_area(self._shapes), 4),
            "mean_area":    round(self.mean_area(), 4),
            "max_area":     round(self.max_area(), 4),
            "stddev":       round(self.area_stddev(), 4),
            "most_circular": self.most_circular().name if self._stats else None,
        }

    def all_stats(self) -> list:
        return [s.to_dict() for s in self._stats]


# ── 分類統計 ──────────────────────────────────────────────────────────────────

class ShapeClassifier:
    """依種類分組並統計。"""

    def __init__(self, shapes: list):
        self._groups = {}
        for s in shapes:
            key = type(s).__name__
            self._groups.setdefault(key, []).append(s)

    def group_areas(self) -> dict:
        return {
            name: round(total_area(group), 4)
            for name, group in self._groups.items()
        }

    def largest_per_group(self) -> dict:
        result = {}
        for name, group in self._groups.items():
            big = largest_shape(group)
            result[name] = round(big.area(), 4)
        return result

    def report(self) -> dict:
        return {
            "groups":         list(self._groups.keys()),
            "group_areas":    self.group_areas(),
            "largest_each":   self.largest_per_group(),
        }


# ── 獨立函式 ──────────────────────────────────────────────────────────────────

def compute_report(shapes: list) -> dict:
    """計算並回傳完整報告字典。"""
    rpt = MetricsReport(shapes)
    clf = ShapeClassifier(shapes)
    return {
        "summary":    rpt.summary(),
        "all_stats":  rpt.all_stats(),
        "classifier": clf.report(),
    }


def print_report(shapes: list):
    """列印完整報告到 stdout。"""
    data = compute_report(shapes)
    print(json.dumps(data, indent=2, ensure_ascii=False))


def _filter_circles(shapes: list) -> list:
    """私有輔助：過濾出 Circle 類型。"""
    return [s for s in shapes if isinstance(s, Circle)]


def _filter_rectangles(shapes: list) -> list:
    """私有輔助：過濾出 Rectangle（含 Square）類型。"""
    return [s for s in shapes if isinstance(s, (Rectangle, Square))]
