"""
pipeline.py — 形狀處理管線
import edge → shapes.py、renderer.py、metrics.py
call edge → 貫穿三個模組的呼叫鏈

這個檔案刻意引用並呼叫其他所有模組的函式，
讓 L1 file graph 出現 3 條 import edge，
同時讓 symbol graph 出現跨檔案的 call edge。
"""

import json
from shapes import Shape, Circle, Rectangle, Triangle, Square, make_unit_circle
from renderer import RenderManager, AsciiRenderer, JsonRenderer, build_demo_scene
from metrics import MetricsReport, ShapeClassifier, compute_report, print_report


# ── 管線步驟基礎類別 ───────────────────────────────────────────────────────────

class PipelineStep:
    """單一處理步驟的抽象介面。"""

    def __init__(self, name: str):
        self.name = name
        self._enabled = True

    def run(self, context: dict) -> dict:
        raise NotImplementedError

    def enable(self):
        self._enabled = True

    def disable(self):
        self._enabled = False

    def is_enabled(self) -> bool:
        return self._enabled


class FilterStep(PipelineStep):
    """過濾步驟，移除不符合條件的形狀。"""

    def __init__(self, min_area: float = 0.0):
        super().__init__("filter")
        self.min_area = min_area

    def run(self, context: dict) -> dict:
        shapes = context.get("shapes", [])
        filtered = [s for s in shapes if s.area() >= self.min_area]
        context["shapes"] = filtered
        context["filtered_count"] = len(shapes) - len(filtered)
        return context


class MetricsStep(PipelineStep):
    """指標計算步驟，呼叫 metrics.py 的函式。"""

    def __init__(self):
        super().__init__("metrics")

    def run(self, context: dict) -> dict:
        shapes = context.get("shapes", [])
        report = compute_report(shapes)       # call → metrics.compute_report
        context["metrics"] = report
        return context


class RenderStep(PipelineStep):
    """渲染步驟，呼叫 renderer.py 的類別。"""

    def __init__(self, fmt: str = "ascii"):
        super().__init__("render")
        self.fmt = fmt

    def run(self, context: dict) -> dict:
        shapes = context.get("shapes", [])
        mgr = RenderManager()                 # call → renderer.RenderManager
        for s in shapes:
            mgr.add_shape(s)
        mgr.render_all()
        if self.fmt == "json":
            context["output"] = mgr.get_json()
        elif self.fmt == "svg":
            context["output"] = mgr.get_svg()
        else:
            context["output"] = mgr.get_ascii()
        return context


class ClassifyStep(PipelineStep):
    """分類步驟，呼叫 metrics.py 的 ShapeClassifier。"""

    def __init__(self):
        super().__init__("classify")

    def run(self, context: dict) -> dict:
        shapes = context.get("shapes", [])
        clf = ShapeClassifier(shapes)          # call → metrics.ShapeClassifier
        context["classification"] = clf.report()
        return context


# ── 管線執行器 ────────────────────────────────────────────────────────────────

class Pipeline:
    """串接多個 PipelineStep 依序執行。"""

    def __init__(self):
        self._steps = []
        self._results = []

    def add_step(self, step: PipelineStep):
        self._steps.append(step)

    def remove_step(self, name: str):
        self._steps = [s for s in self._steps if s.name != name]

    def run(self, shapes: list) -> dict:
        ctx = {"shapes": list(shapes)}
        for step in self._steps:
            if step.is_enabled():
                ctx = step.run(ctx)
                self._results.append({
                    "step":    step.name,
                    "enabled": True,
                })
            else:
                self._results.append({
                    "step":    step.name,
                    "enabled": False,
                })
        return ctx

    def step_log(self) -> list:
        return list(self._results)


# ── 管線工廠函式 ──────────────────────────────────────────────────────────────

def build_default_pipeline(min_area: float = 0.1, fmt: str = "ascii") -> Pipeline:
    """建立預設管線：Filter → Metrics → Classify → Render。"""
    p = Pipeline()
    p.add_step(FilterStep(min_area=min_area))
    p.add_step(MetricsStep())
    p.add_step(ClassifyStep())
    p.add_step(RenderStep(fmt=fmt))
    return p


def run_full_pipeline(shapes: list, fmt: str = "json") -> dict:
    """執行完整管線並回傳結果。"""
    p = build_default_pipeline(fmt=fmt)
    result = p.run(shapes)
    return result


def demo_pipeline():
    """展示用：建立場景 → 跑管線 → 印報告。"""
    scene = build_demo_scene()         # call → renderer.build_demo_scene
    shapes = scene._shapes

    result = run_full_pipeline(shapes, fmt="json")
    print_report(shapes)               # call → metrics.print_report
    return result


def _collect_shapes_from_scene(scene: RenderManager) -> list:
    """私有：從 RenderManager 取出形狀列表。"""
    return list(scene._shapes)
