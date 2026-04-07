"""
shapes.py — 基礎幾何形狀類別庫
提供: inheritance edge（Shape → Circle, Rectangle, Triangle）
"""

import math


# ── 基礎抽象類別 ───────────────────────────────────────────────────────────────

class Shape:
    """所有形狀的基礎類別。"""

    DEFAULT_COLOR = "white"

    def __init__(self, color: str = "white"):
        self.color = color
        self._visible = True

    def area(self) -> float:
        raise NotImplementedError

    def perimeter(self) -> float:
        raise NotImplementedError

    def describe(self) -> str:
        return f"{self.__class__.__name__} area={self.area():.2f} color={self.color}"

    def hide(self):
        self._visible = False

    def show(self):
        self._visible = True

    def is_visible(self) -> bool:
        return self._visible


# ── 第二層繼承（Single inheritance）─────────────────────────────────────────

class Circle(Shape):
    """圓形，繼承 Shape。"""

    def __init__(self, radius: float, color: str = "red"):
        super().__init__(color)
        self.radius = radius

    def area(self) -> float:
        return math.pi * self.radius ** 2

    def perimeter(self) -> float:
        return 2 * math.pi * self.radius

    def scale(self, factor: float) -> "Circle":
        return Circle(self.radius * factor, self.color)


class Rectangle(Shape):
    """矩形，繼承 Shape。"""

    def __init__(self, width: float, height: float, color: str = "blue"):
        super().__init__(color)
        self.width = width
        self.height = height

    def area(self) -> float:
        return self.width * self.height

    def perimeter(self) -> float:
        return 2 * (self.width + self.height)

    def is_square(self) -> bool:
        return self.width == self.height


class Triangle(Shape):
    """三角形，繼承 Shape。"""

    def __init__(self, a: float, b: float, c: float, color: str = "green"):
        super().__init__(color)
        self.a = a
        self.b = b
        self.c = c

    def area(self) -> float:
        s = self.perimeter() / 2
        return math.sqrt(s * (s - self.a) * (s - self.b) * (s - self.c))

    def perimeter(self) -> float:
        return self.a + self.b + self.c

    def is_equilateral(self) -> bool:
        return self.a == self.b == self.c


# ── 第三層繼承（Multi-level inheritance）────────────────────────────────────

class Square(Rectangle):
    """正方形，繼承 Rectangle（Rectangle 繼承 Shape）。"""

    def __init__(self, side: float, color: str = "yellow"):
        super().__init__(side, side, color)
        self.side = side

    def scale(self, factor: float) -> "Square":
        return Square(self.side * factor, self.color)

    def describe(self) -> str:
        base = super().describe()
        return f"{base} [square side={self.side}]"


# ── 多重繼承 ──────────────────────────────────────────────────────────────────

class Colorable:
    """Mixin：提供顏色相關操作。"""

    PALETTE = ["red", "green", "blue", "yellow", "white", "black"]

    def set_color(self, color: str):
        if color in self.PALETTE:
            self.color = color

    def is_valid_color(self) -> bool:
        return self.color in self.PALETTE


class BorderedShape(Shape, Colorable):
    """多重繼承：Shape + Colorable。"""

    def __init__(self, inner: Shape, border_width: float = 1.0):
        super().__init__(inner.color)
        self.inner = inner
        self.border_width = border_width

    def area(self) -> float:
        return self.inner.area()

    def perimeter(self) -> float:
        return self.inner.perimeter()

    def border_area(self) -> float:
        bw = self.border_width
        scaled = self.inner.area() + self.inner.perimeter() * bw + math.pi * bw ** 2
        return scaled - self.inner.area()


# ── 獨立工具函式 ───────────────────────────────────────────────────────────────

def make_unit_circle() -> Circle:
    """建立半徑為 1 的標準圓。"""
    return Circle(1.0)


def make_unit_square() -> Square:
    """建立邊長為 1 的標準正方形。"""
    return Square(1.0)


def largest_shape(shapes: list) -> Shape:
    """回傳面積最大的形狀。"""
    if not shapes:
        raise ValueError("Empty shape list")
    return max(shapes, key=lambda s: s.area())


def total_area(shapes: list) -> float:
    """計算所有形狀的總面積。"""
    return sum(s.area() for s in shapes)
