"""
main.py — Edge Demo 入口點
import edge → shapes.py、renderer.py、metrics.py、pipeline.py

這是最頂層的協調者：
  - L1 圖: 4 條 import edge（指向 shapes / renderer / metrics / pipeline）
  - symbol graph: call edge 從這裡串接到所有下層模組
"""

import json
from shapes import (
    Circle, Rectangle, Triangle, Square, Shape,
    make_unit_circle, make_unit_square, total_area, largest_shape,
)
from renderer import build_demo_scene, render_to_file, RenderManager
from metrics import compute_report, print_report, MetricsReport
from pipeline import run_full_pipeline, demo_pipeline, build_default_pipeline


# ── 場景建構函式 ───────────────────────────────────────────────────────────────

def create_basic_shapes() -> list:
    """建立基本測試形狀集合。"""
    return [
        Circle(1.0, "red"),
        Circle(3.0, "blue"),
        Rectangle(2.0, 5.0, "green"),
        Rectangle(4.0, 4.0, "yellow"),
        Square(3.0, "purple"),
        Triangle(3.0, 4.0, 5.0, "orange"),
        Triangle(5.0, 5.0, 5.0, "cyan"),
    ]


def create_nested_shapes() -> list:
    """建立包含 Square（繼承 Rectangle）的形狀集合。"""
    shapes = []
    for i in range(1, 4):
        shapes.append(Square(float(i)))
        shapes.append(Circle(float(i)))
    return shapes


# ── 場景分析函式 ───────────────────────────────────────────────────────────────

def analyse_scene(shapes: list) -> dict:
    """對一組形狀進行完整分析。"""
    rpt = MetricsReport(shapes)             # call → metrics.MetricsReport
    summary = rpt.summary()
    biggest = largest_shape(shapes)         # call → shapes.largest_shape
    total = total_area(shapes)              # call → shapes.total_area
    return {
        "summary":  summary,
        "biggest":  biggest.describe(),
        "total_area": round(total, 4),
    }


def compare_scenes(scene_a: list, scene_b: list) -> dict:
    """比較兩個場景的指標差異。"""
    report_a = compute_report(scene_a)      # call → metrics.compute_report
    report_b = compute_report(scene_b)      # call → metrics.compute_report
    return {
        "scene_a": report_a["summary"],
        "scene_b": report_b["summary"],
        "delta_total": round(
            total_area(scene_b) - total_area(scene_a), 4
        ),
    }


# ── 渲染協調函式 ───────────────────────────────────────────────────────────────

def render_scene(shapes: list, fmt: str = "ascii") -> str:
    """使用 RenderManager 渲染形狀。"""
    mgr = RenderManager()               # call → renderer.RenderManager
    for s in shapes:
        mgr.add_shape(s)
    mgr.render_all()
    if fmt == "json":
        return mgr.get_json()
    if fmt == "svg":
        return mgr.get_svg()
    return mgr.get_ascii()


# ── 管線協調函式 ───────────────────────────────────────────────────────────────

def run_demo(fmt: str = "json") -> dict:
    """執行完整示範。"""
    basic = create_basic_shapes()
    nested = create_nested_shapes()
    all_shapes = basic + nested

    pipeline_result = run_full_pipeline(all_shapes, fmt=fmt)  # call → pipeline
    analysis = analyse_scene(all_shapes)
    comparison = compare_scenes(basic, nested)

    return {
        "pipeline":   pipeline_result.get("output", ""),
        "analysis":   analysis,
        "comparison": comparison,
    }


def run_demo_scene():
    """使用 build_demo_scene 跑整個示範。"""
    scene = build_demo_scene()          # call → renderer.build_demo_scene
    return render_to_file(scene, "/tmp/edge_demo_output.json")  # call → renderer.render_to_file


def _print_result(result: dict):
    """私有：列印最終結果。"""
    print(json.dumps(result, indent=2, ensure_ascii=False))


# ── 入口 ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    result = run_demo(fmt="json")
    _print_result(result)
    demo_pipeline()                     # call → pipeline.demo_pipeline
