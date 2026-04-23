"""
broken_syntax.py — Intentionally broken Python for Feature 7 testing.
This file has a real syntax error that makes ast.parse() fail, forcing the
regex fallback path and triggering the parse_error flag on all its symbols.
"""

class BrokenHost:
    """A container class that parses via regex fallback only."""

    def good_method(self, name: str) -> str:
        return f"hello {name}"

    def broken_method(self
        # Missing closing paren on the def line — ast.parse() rejects the file.
        return "syntax error"


class SiblingClass:
    """Sibling that still shows up via regex fallback."""

    def another_method(self):
        return 42
