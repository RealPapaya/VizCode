"""
ai/chat_modes.py — Two-dimensional conversation mode registry for VizBridge.

DEPTH controls reply thoroughness: general / deep / quick.
OUTPUT optionally constrains response format: mermaid_flow / file_tour / health_report.

Quick depth is incompatible with any output modifier — the UI enforces this,
and resolve() enforces it on the backend as well.

`resolve(depth, output)` is the single entry point used by VizBridge.
"""

from __future__ import annotations


# ─── Depth modes ─────────────────────────────────────────────────────────────

DEPTH_MODES: dict[str, dict] = {
    "general": {
        "label": "General",
        "system_addendum": "",    # default — no override
        "tool_whitelist": None,   # all tools available
    },
    "deep": {
        "label": "Deep Analysis",
        "system_addendum": (
            "\n\nDEPTH: DEEP ANALYSIS.\n"
            "- Always start with `vizcode_l0()` for any structural question.\n"
            "- Before concluding anything about a file, call `vizcode_l1` or `vizcode_l2` to verify.\n"
            "- Attach an exact node_id (file path or `path::func`) to every claim.\n"
            "- Prefer `vizcode_ui_tour_step` over static highlights — walk the user through findings.\n"
        ),
        "tool_whitelist": None,
    },
    "quick": {
        "label": "Quick Lookup",
        "system_addendum": (
            "\n\nDEPTH: QUICK LOOKUP.\n"
            "- Answer in ONE or TWO sentences — be concise.\n"
            "- Prefer `vizcode_query` or `vizcode_explain` over hierarchical drilldown.\n"
            "- Do NOT call `vizcode_l0` unless the user explicitly asks for the big picture.\n"
            "- Do NOT generate Mermaid flowcharts.\n"
            "- Do NOT launch guided tours (`vizcode_ui_tour_step`).\n"
            "- Do NOT run health checks or produce health reports.\n"
            "- If the user asks for a complex output (flowchart, tour, health report),\n"
            "  reply in one sentence that they should switch to General or Deep mode for that.\n"
        ),
        "tool_whitelist": {
            "vizcode_query", "vizcode_explain", "vizcode_report",
            "vizcode_ui_emit_badge", "vizcode_ui_highlight_node",
        },
    },
}


# ─── Output modes ─────────────────────────────────────────────────────────────

OUTPUT_MODES: dict[str, dict] = {
    "mermaid_flow": {
        "label": "Flowchart",
        "system_addendum": (
            "\n\nOUTPUT: FLOWCHART.\n"
            "- Your response MUST include a Mermaid diagram fenced in ```mermaid.\n"
            "- Do not produce a tour, do not call tour_step.\n"
            "- If you need context, call `vizcode_l0()` once to orient first.\n"
            "- If you cannot determine a meaningful flow from available tools, emit a short\n"
            "  apology explaining what is missing — DO NOT fabricate.\n"
        ),
        "tool_whitelist": {
            "vizcode_l0", "vizcode_l1", "vizcode_l2",
            "vizcode_query", "vizcode_explain",
        },
    },
    "file_tour": {
        "label": "Tour",
        "system_addendum": (
            "\n\nOUTPUT: GUIDED TOUR.\n"
            "- You MUST call `vizcode_ui_tour_step` at least 3 times, interleaved with narration.\n"
            "- Rhythm: one sentence → tour_step → next sentence → tour_step.\n"
            "- Do not emit Mermaid diagrams.\n"
        ),
        "tool_whitelist": None,
    },
    "health_report": {
        "label": "Health Report",
        "system_addendum": (
            "\n\nOUTPUT: HEALTH REPORT.\n"
            "- Your FIRST tool call must be `vizcode_health`.\n"
            "- Output format: three H3 sections — ### Dead code / ### God files /\n"
            "  ### Circular imports — each as a bullet list (up to 5 items with exact paths).\n"
            "- Do not produce a tour, do not emit Mermaid.\n"
        ),
        "tool_whitelist": {
            "vizcode_health", "vizcode_report",
            "vizcode_ui_emit_badge", "vizcode_ui_highlight_nodes",
        },
    },
}


# ─── Resolver ────────────────────────────────────────────────────────────────

def resolve(depth: str | None, output: str | None) -> tuple[set[str] | None, str]:
    """
    Resolve the effective (whitelist, addendum) for a conversation turn.

    Quick depth ignores any output modifier (backend enforcement of the UI rule).
    Unknown depth/output fall back to general/none silently.

    Returns:
        whitelist:  set[str] of allowed tool names, or None for "all tools".
        addendum:   extra text appended to the base system prompt.
    """
    d = DEPTH_MODES.get(depth or "general") or DEPTH_MODES["general"]

    # Quick depth: output modifiers are incompatible — discard silently
    if depth == "quick" or not output:
        o_addendum = ""
        o_wl: set[str] | None = None
    else:
        o = OUTPUT_MODES.get(output) or {}
        o_addendum = o.get("system_addendum", "")
        o_wl_raw   = o.get("tool_whitelist")
        o_wl       = set(o_wl_raw) if o_wl_raw else None

    addendum = d["system_addendum"] + o_addendum

    d_wl: set[str] | None = set(d["tool_whitelist"]) if d["tool_whitelist"] else None

    if d_wl is None and o_wl is None:
        whitelist = None
    elif d_wl is None:
        whitelist = o_wl
    elif o_wl is None:
        whitelist = d_wl
    else:
        whitelist = d_wl & o_wl

    return whitelist, addendum
