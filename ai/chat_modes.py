"""
ai/chat_modes.py - conversation mode registry for VizBridge.

DEPTH controls reply thoroughness: general / deep / quick.
OUTPUT optionally constrains response format:
mermaid_flow / file_tour / health_report / remediation_prompt.
"""

from __future__ import annotations


DEPTH_MODES: dict[str, dict] = {
    "general": {
        "label": "General",
        "system_addendum": "",
        "tool_whitelist": None,
        "max_tokens": 1536,
        "max_tool_rounds": 4,
        "cacheable": True,
    },
    "deep": {
        "label": "Deep Analysis",
        "system_addendum": (
            "\n\nDEPTH: DEEP ANALYSIS.\n"
            "- Always start with `vizcode_l0()` for any structural question.\n"
            "- Before concluding anything about a file, call `vizcode_l1` or `vizcode_l2` to verify.\n"
            "- Attach an exact node_id (file path or `path::func`) to every claim.\n"
            "- Prefer `vizcode_ui_tour_step` over static highlights; walk the user through findings.\n"
        ),
        "tool_whitelist": None,
        "max_tokens": 4096,
        "max_tool_rounds": 6,
        "cacheable": False,
    },
    "quick": {
        "label": "Quick Lookup",
        "system_addendum": (
            "\n\nDEPTH: QUICK LOOKUP.\n"
            "- Answer in one or two sentences; be concise.\n"
            "- Prefer `vizcode_query` or `vizcode_explain` over hierarchical drilldown.\n"
            "- Do NOT call `vizcode_l0` unless the user explicitly asks for the big picture.\n"
            "- Do NOT generate Mermaid flowcharts.\n"
            "- Do NOT launch guided tours (`vizcode_ui_tour_step`).\n"
            "- Do NOT run health checks or produce health reports.\n"
            "- If the user asks for a complex output, reply briefly that they should switch to General or Deep mode.\n"
        ),
        "tool_whitelist": {
            "vizcode_query", "vizcode_explain", "vizcode_report",
            "vizcode_ui_emit_badge", "vizcode_ui_highlight_node",
        },
        "max_tokens": 768,
        "max_tool_rounds": 2,
        "cacheable": True,
    },
}


OUTPUT_MODES: dict[str, dict] = {
    "mermaid_flow": {
        "label": "Flowchart",
        "system_addendum": (
            "\n\nOUTPUT: FLOWCHART.\n"
            "- Your response MUST include a Mermaid diagram fenced in ```mermaid.\n"
            "- Do not produce a tour, do not call tour_step.\n"
            "- If you need context, call `vizcode_l0()` once to orient first.\n"
            "- If you cannot determine a meaningful flow from available tools, say what is missing; do NOT fabricate.\n"
        ),
        "tool_whitelist": {
            "vizcode_l0", "vizcode_l1", "vizcode_l2",
            "vizcode_query", "vizcode_explain",
        },
        "max_tokens": 2048,
        "max_tool_rounds": 3,
        "cacheable": False,
    },
    "file_tour": {
        "label": "Tour",
        "system_addendum": (
            "\n\nOUTPUT: GUIDED TOUR.\n"
            "- You MUST call `vizcode_ui_tour_step` at least 3 times, interleaved with narration.\n"
            "- Rhythm: one sentence, tour_step, next sentence, tour_step.\n"
            "- Do not emit Mermaid diagrams.\n"
        ),
        "tool_whitelist": None,
        "max_tokens": 2048,
        "max_tool_rounds": 5,
        "cacheable": False,
    },
    "health_report": {
        "label": "Health Report",
        "system_addendum": (
            "\n\nOUTPUT: HEALTH REPORT.\n"
            "- Your FIRST tool call must be `vizcode_health`.\n"
            "- Output format: three H3 sections: ### Dead code / ### God files / ### Circular imports.\n"
            "- Each section should be a bullet list with up to 5 items and exact paths.\n"
            "- Do not produce a tour, do not emit Mermaid.\n"
        ),
        "tool_whitelist": {
            "vizcode_health", "vizcode_report",
            "vizcode_ui_emit_badge", "vizcode_ui_highlight_nodes",
        },
        "max_tokens": 1536,
        "max_tool_rounds": 3,
        "cacheable": True,
    },
    "remediation_prompt": {
        "label": "Remediation Prompt",
        "system_addendum": (
            "\n\nOUTPUT: REMEDIATION PROMPT.\n"
            "- Verify only the referenced dashboard findings; do not perform a broad audit.\n"
            "- Prefer `vizcode_l2` / `vizcode_l3` for referenced files and `vizcode_query` for targeted relationships.\n"
            "- Do not call canvas UI tools.\n"
            "- Keep the verification summary concise and then produce the requested agent prompt.\n"
        ),
        "tool_whitelist": {
            "vizcode_query", "vizcode_explain", "vizcode_report",
            "vizcode_l1", "vizcode_l2", "vizcode_l3", "vizcode_health",
        },
        "max_tokens": 1800,
        "max_tool_rounds": 3,
        "cacheable": True,
    },
}


def resolve(depth: str | None, output: str | None) -> tuple[set[str] | None, str]:
    """Backward-compatible resolver returning only tool whitelist and addendum."""
    spec = resolve_spec(depth, output)
    return spec["tool_whitelist"], spec["system_addendum"]


def resolve_spec(depth: str | None, output: str | None) -> dict:
    """Resolve mode prompt additions, tools, output budget, and cache policy."""
    d = DEPTH_MODES.get(depth or "general") or DEPTH_MODES["general"]

    if depth == "quick" or not output:
        o: dict = {}
        o_addendum = ""
        o_wl: set[str] | None = None
    else:
        o = OUTPUT_MODES.get(output) or {}
        o_addendum = o.get("system_addendum", "")
        o_wl_raw = o.get("tool_whitelist")
        o_wl = set(o_wl_raw) if o_wl_raw else None

    d_wl: set[str] | None = set(d["tool_whitelist"]) if d["tool_whitelist"] else None

    if d_wl is None and o_wl is None:
        whitelist = None
    elif d_wl is None:
        whitelist = o_wl
    elif o_wl is None:
        whitelist = d_wl
    else:
        whitelist = d_wl & o_wl

    d_tokens = int(d.get("max_tokens") or 1536)
    o_tokens = int(o.get("max_tokens") or d_tokens)
    d_rounds = int(d.get("max_tool_rounds") or 4)
    o_rounds = int(o.get("max_tool_rounds") or d_rounds)

    return {
        "tool_whitelist": whitelist,
        "system_addendum": d["system_addendum"] + o_addendum,
        "max_tokens": min(d_tokens, o_tokens),
        "max_tool_rounds": min(d_rounds, o_rounds),
        "cacheable": bool(d.get("cacheable", True) and o.get("cacheable", True)),
    }
