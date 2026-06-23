"""Tests for the three-state edge trust labels (P3).

EXTRACTED / INFERRED / AMBIGUOUS mapping in analytics_helpers, the report
surfacing, and parity with the stdlib-only mirror in mcp_server.
"""
import sys
from pathlib import Path

import analytics_helpers as ah

# mcp_server lives under src/server, which conftest does not add to the path.
_SERVER_DIR = Path(__file__).parent.parent / "src" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))
import mcp_server as mcp  # noqa: E402


# ─── confidence_label mapping ─────────────────────────────────────────────────

def test_static_import_is_extracted():
    assert ah.confidence_label("import", 1.0) == "EXTRACTED"
    assert ah.confidence_label("import", None) == "EXTRACTED"
    assert ah.confidence_label("include", None) == "EXTRACTED"


def test_inferred_high_confidence():
    assert ah.confidence_label("inferred", 0.9) == "INFERRED"
    assert ah.confidence_label("inferred", 0.5) == "INFERRED"


def test_inferred_low_confidence_is_ambiguous():
    assert ah.confidence_label("inferred", 0.4) == "AMBIGUOUS"
    assert ah.confidence_label("inferred", 0.0) == "AMBIGUOUS"
    assert ah.confidence_label("inferred", None) == "AMBIGUOUS"


def test_static_hint_with_reduced_confidence_degrades():
    # A parser hint that is an import-kind edge but only 0.7 confident is
    # trust-wise inferred, and below 0.5 it is ambiguous.
    assert ah.confidence_label("import", 0.7) == "INFERRED"
    assert ah.confidence_label("import", 0.3) == "AMBIGUOUS"


def test_unknown_confidence_string_is_safe():
    assert ah.confidence_label("import", "n/a") == "EXTRACTED"
    assert ah.confidence_label("inferred", "n/a") == "AMBIGUOUS"


# ─── mcp_server mirror parity ─────────────────────────────────────────────────

def test_mcp_mirror_matches_canonical():
    cases = [
        ("import", 1.0), ("import", None), ("import", 0.7), ("import", 0.3),
        ("inferred", 0.9), ("inferred", 0.5), ("inferred", 0.4), ("inferred", 0.0),
        ("notice", 0.0), ("semantic", 0.6), ("call", None),
    ]
    for kind, conf in cases:
        assert mcp._confidence_label(kind, conf) == ah.confidence_label(kind, conf), \
            f"mismatch for {(kind, conf)}"


# ─── edge_trust_summary ───────────────────────────────────────────────────────

def test_edge_trust_summary_counts():
    data = {
        "file_edges_by_module": {
            "mod_a": [
                {"s": 1, "t": 2, "type": "import"},            # EXTRACTED
                {"s": 1, "t": 3, "type": "include"},           # EXTRACTED
                {"s": 2, "t": 4, "type": "inferred", "confidence": 0.8},  # INFERRED
                {"s": 2, "t": 5, "type": "inferred", "confidence": 0.2},  # AMBIGUOUS
            ],
            "mod_b": [
                {"s": 6, "t": 7, "type": "import", "confidence": 0.7},    # INFERRED
            ],
        }
    }
    counts = ah.edge_trust_summary(data)
    assert counts == {"EXTRACTED": 2, "INFERRED": 2, "AMBIGUOUS": 1}


def test_edge_trust_summary_empty():
    assert ah.edge_trust_summary({}) == {
        "EXTRACTED": 0, "INFERRED": 0, "AMBIGUOUS": 0}


# ─── mcp _build_index attaches label ──────────────────────────────────────────

def test_build_index_labels_edges():
    # Entry names are used directly as module names; the import target must
    # match an entry name for the static edge to resolve.
    scan = {"entries": {
        "a": {"payload": {"imports": ["b"], "funcdefs": [], "funccalls": [],
                          "func_calls_by_func": [], "symdefs": [], "extras": {}}},
        "b": {"payload": {"imports": [], "funcdefs": [], "funccalls": [],
                          "func_calls_by_func": [], "symdefs": [], "extras": {}}},
    }}
    _modules, edges, _adj = mcp._build_index(scan, {})
    import_edges = [e for e in edges if e["kind"] == "import"]
    assert import_edges, "expected at least one static import edge"
    assert all(e["label"] == "EXTRACTED" for e in import_edges)
