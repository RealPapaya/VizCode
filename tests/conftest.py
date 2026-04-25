"""pytest shared fixtures for VizCode test suite."""
import sys
import os
from pathlib import Path

# ─── Add src/ and src/core/ so all modules are importable ────────────────────
PROJECT_ROOT = Path(__file__).parent.parent
SRC_DIR      = PROJECT_ROOT / 'src'
CORE_DIR     = SRC_DIR / 'core'
for _p in (str(CORE_DIR), str(SRC_DIR), str(PROJECT_ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import pytest

# ─── Fixtures: minimal sample source code per language ────────────────────────

@pytest.fixture
def py_src():
    return '''\
import os
import re
from pathlib import Path
from collections import defaultdict

class Greeter:
    def __init__(self, name: str):
        self.name = name

    def greet(self) -> str:
        return f"Hello, {self.name}"

class FancyGreeter(Greeter):
    def greet(self) -> str:
        base = super().greet()
        return base + "!"

def main():
    g = FancyGreeter("World")
    print(g.greet())
'''

@pytest.fixture
def js_src():
    return '''\
import { readFile } from "fs";
import path from "path";

class Animal {
    constructor(name) {
        this.name = name;
    }
    speak() {
        return `${this.name} makes a sound.`;
    }
}

class Dog extends Animal {
    speak() {
        return `${this.name} barks.`;
    }
}

function main() {
    const d = new Dog("Rex");
    console.log(d.speak());
}

export { Animal, Dog, main };
'''

@pytest.fixture
def go_src():
    return '''\
package main

import (
    "fmt"
    "strings"
)

type Animal struct {
    Name string
}

func (a Animal) Speak() string {
    return fmt.Sprintf("%s makes a sound", a.Name)
}

type Dog struct {
    Animal
}

func (d Dog) Bark() string {
    return strings.ToUpper(d.Name) + " barks!"
}

func main() {
    d := Dog{Animal{"Rex"}}
    fmt.Println(d.Bark())
}
'''

@pytest.fixture
def c_src():
    return '''\
#include <stdio.h>
#include <stdlib.h>
#include "myheader.h"

typedef struct {
    int x;
    int y;
} Point;

int add(int a, int b) {
    return a + b;
}

void print_point(Point p) {
    printf("(%d, %d)\\n", p.x, p.y);
}

int main(void) {
    Point p = {1, 2};
    printf("%d\\n", add(p.x, p.y));
    print_point(p);
    return 0;
}
'''

@pytest.fixture(scope='module')
def testproject_path():
    """Return the path to the testproject directory."""
    p = PROJECT_ROOT / 'testproject' / 'testproject'
    if not p.exists():
        pytest.skip(f'testproject not found at {p}')
    return str(p)
