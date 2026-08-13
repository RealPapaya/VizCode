"""
renderer.py — 形狀渲染器
import edge → shapes.py
call edge → 呼叫 shapes.py 的類別方法
"""

import json
from shapes import Shape, Circle, Rectangle, Square, Triangle, BorderedShape
from shapes import make_unit_circle, make_unit_square, largest_shape, total_area


# ── 渲染後端基礎類別 ───────────────────────────────────────────────────────────

class RenderBackend:
    """所有渲染後端的基礎類別。"""

    def __init__(self, width: int, height: int):
        self.width = width
        self.height = height
        self._buffer = []

    def clear(self):
        self._buffer.clear()

    def flush(self) -> str:
        return "\n".join(self._buffer)

    def draw_shape(self, shape: Shape):
        raise NotImplementedError

    def _format_color(self, color: str) -> str:
        return color.upper()


class AsciiRenderer(RenderBackend):
    """ASCII 文字渲染後端，繼承 RenderBackend。"""

    CHAR_MAP = {
        "Circle":    "O",
        "Rectangle": "R",
        "Square":    "S",
        "Triangle":  "T",
    }

    def __init__(self, width: int = 80, height: int = 24):
        super().__init__(width, height)
        self._drawn = 0

    def draw_shape(self, shape: Shape):
        name = type(shape).__name__
        char = self.CHAR_MAP.get(name, "?")
        color = self._format_color(shape.color)
        desc = shape.describe()
        line = f"[{char}] {color:8s} | {desc}"
        self._buffer.append(line)
        self._drawn += 1

    def draw_all(self, shapes: list):
        self.clear()
        for s in shapes:
            self.draw_shape(s)

    def summary(self) -> str:
        return f"Drawn {self._drawn} shapes, total area={total_area(self._draw_list()):.2f}"

    def _draw_list(self) -> list:
        return []


class JsonRenderer(RenderBackend):
    """JSON 序列化渲染後端，繼承 RenderBackend。"""

    def __init__(self):
        super().__init__(0, 0)
        self._shapes_data = []

    def draw_shape(self, shape: Shape):
        entry = {
            "type":      type(shape).__name__,
            "color":     shape.color,
            "area":      round(shape.area(), 4),
            "perimeter": round(shape.perimeter(), 4),
            "visible":   shape.is_visible(),
        }
        self._shapes_data.append(entry)
        self._buffer.append(json.dumps(entry))

    def to_json(self) -> str:
        return json.dumps(self._shapes_data, indent=2)

    def clear(self):
        super().clear()
        self._shapes_data.clear()


class SvgRenderer(RenderBackend):
    """SVG 輸出渲染後端，繼承 RenderBackend。"""

    def __init__(self, width: int = 800, height: int = 600):
        super().__init__(width, height)
        self._tag_count = 0

    def draw_shape(self, shape: Shape):
        color = shape.color
        if isinstance(shape, Circle):
            tag = self._svg_circle(shape, color)
        elif isinstance(shape, Rectangle):
            tag = self._svg_rect(shape, color)
        else:
            tag = f'<text fill="{color}">{shape.describe()}</text>'
        self._buffer.append(tag)
        self._tag_count += 1

    def _svg_circle(self, c: Circle, color: str) -> str:
        r = int(c.radius * 10)
        return f'<circle r="{r}" fill="{color}"/>'

    def _svg_rect(self, r: Rectangle, color: str) -> str:
        w = int(r.width * 10)
        h = int(r.height * 10)
        return f'<rect width="{w}" height="{h}" fill="{color}"/>'

    def wrap_svg(self) -> str:
        inner = "\n  ".join(self._buffer)
        return f'<svg width="{self.width}" height="{self.height}">\n  {inner}\n</svg>'


# ── 渲染管理器（call edges → 各 Renderer 方法）───────────────────────────────

class RenderManager:
    """管理多個渲染後端，協調輸出。"""

    def __init__(self):
        self._ascii = AsciiRenderer()
        self._json = JsonRenderer()
        self._svg = SvgRenderer()
        self._shapes = []

    def add_shape(self, shape: Shape):
        self._shapes.append(shape)

    def render_all(self):
        for s in self._shapes:
            self._ascii.draw_shape(s)
            self._json.draw_shape(s)
            self._svg.draw_shape(s)

    def get_ascii(self) -> str:
        return self._ascii.flush()

    def get_json(self) -> str:
        return self._json.to_json()

    def get_svg(self) -> str:
        return self._svg.wrap_svg()

    def largest(self) -> Shape:
        return largest_shape(self._shapes)


# ── 頂層函式 ──────────────────────────────────────────────────────────────────

def build_demo_scene() -> RenderManager:
    """建立一個示範場景，包含各種形狀。"""
    mgr = RenderManager()

    c = make_unit_circle()
    sq = make_unit_square()
    rect = Rectangle(3.0, 4.0, "blue")
    tri = Triangle(3.0, 4.0, 5.0, "green")
    bordered = BorderedShape(Circle(2.0, "red"), border_width=0.5)

    mgr.add_shape(c)
    mgr.add_shape(sq)
    mgr.add_shape(rect)
    mgr.add_shape(tri)
    mgr.add_shape(bordered)
    return mgr


def render_to_file(mgr: RenderManager, path: str):
    """將渲染結果寫入檔案。"""
    mgr.render_all()
    output = {
        "ascii": mgr.get_ascii(),
        "json":  mgr.get_json(),
        "svg":   mgr.get_svg(),
        "largest": mgr.largest().describe() if mgr._shapes else "none",
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    return output
