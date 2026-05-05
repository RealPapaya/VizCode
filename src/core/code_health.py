#!/usr/bin/env python3
"""
core/code_health.py — VIZCODE Code Health Score

A weighted 0–10 composite of five quality signals computed during analysis.
Weights and sub-score formulas live here so they can be tuned independently
without touching the analysis pipeline or the dashboard rendering code.

Sub-scores (10 = excellent):

    complexity   30%   10 - clamp(avg_complexity / 10, 0, 10)
    coupling     20%   10 - clamp((circular_deps + god_files) * 1.5, 0, 10)
    dead_code    20%   10 * (1 - dead_funcs / max(total_funcs, 1))
    duplication  15%   10 * (1 - duplication_percent)
    cohesion     15%   10 * graph_modularity   (Louvain Q)

Comment density was deliberately dropped: it varies wildly between languages
(Go discourages explanatory comments, Python uses docstrings, JS varies by
team) and isn't a fair cross-language signal.

Calibration: psf/requests should land >= 7, a debt-heavy legacy repo < 5,
VizCode itself somewhere around 6-7.5. The Coupling sub-score is the most
likely formula to need tuning per project size — see the plan file for
fallback options.
"""

# ─── Weights ──────────────────────────────────────────────────────────────────
WEIGHTS = {
    'complexity':  0.30,
    'coupling':    0.20,
    'dead_code':   0.20,
    'duplication': 0.15,
    'cohesion':    0.15,
}


def _clamp(value: float, lo: float, hi: float) -> float:
    if value < lo:
        return lo
    if value > hi:
        return hi
    return value


def _score_complexity(avg_complexity: float) -> float:
    """Penalty grows linearly with avg cyclomatic; capped at 10."""
    return 10.0 - _clamp(float(avg_complexity) / 10.0, 0.0, 10.0)


def _score_coupling(circular_deps: int, god_files: int) -> float:
    return 10.0 - _clamp((int(circular_deps) + int(god_files)) * 1.5, 0.0, 10.0)


def _score_dead_code(dead_funcs: int, total_funcs: int) -> float:
    denom = max(int(total_funcs), 1)
    return 10.0 * (1.0 - (int(dead_funcs) / denom))


def _score_duplication(duplication_percent: float) -> float:
    return 10.0 * (1.0 - _clamp(float(duplication_percent), 0.0, 1.0))


def _score_cohesion(graph_modularity: float) -> float:
    """Modularity Q is in [-0.5, 1.0]; we clamp to [0, 1] and scale."""
    return 10.0 * _clamp(float(graph_modularity), 0.0, 1.0)


def compute_code_health(*,
                        avg_complexity: float,
                        circular_deps: int,
                        god_files: int,
                        dead_funcs: int,
                        total_funcs: int,
                        duplication_percent: float,
                        graph_modularity: float) -> dict:
    """Return ``{score, breakdown, weights}`` for the dashboard.

    All inputs are required keyword arguments so the call site at
    :func:`analyze_viz.build_graph` documents which signals feed the score.
    """
    breakdown = {
        'complexity':  round(_score_complexity(avg_complexity), 2),
        'coupling':    round(_score_coupling(circular_deps, god_files), 2),
        'dead_code':   round(_score_dead_code(dead_funcs, total_funcs), 2),
        'duplication': round(_score_duplication(duplication_percent), 2),
        'cohesion':    round(_score_cohesion(graph_modularity), 2),
    }

    score = sum(breakdown[k] * WEIGHTS[k] for k in WEIGHTS)
    return {
        'score':     round(score, 1),
        'breakdown': breakdown,
        'weights':   dict(WEIGHTS),
    }
