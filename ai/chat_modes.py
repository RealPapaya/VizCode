"""
ai/chat_modes.py — Mode + forced-task registry for VizBridge.

Two layers of behaviour control live here:

* **Persistent modes** (`MODES`) — dropdown-driven tone shift that persists
  across turns. Each mode contributes a `system_addendum` appended to the
  base system prompt, and an optional `tool_whitelist` that filters which
  tools the provider sees.

* **Forced tasks** (`FORCED_TASKS`) — one-shot button-driven directives
  that override behaviour for a single turn. They inject a seed user
  message, layer on their own prompt addendum, and may further narrow the
  tool whitelist (intersected with the persistent mode).

`resolve(mode, force_task)` is the single entry point used by `VizBridge`.
"""

from __future__ import annotations


# ─── Persistent modes (dropdown) ─────────────────────────────────────────────

MODES: dict[str, dict] = {
    "chat": {
        "label": "一般對話",
        "system_addendum": "",        # default behaviour — no override
        "tool_whitelist": None,        # None = all tools available
    },
    "deep": {
        "label": "深度分析",
        "system_addendum": (
            "\n\nMODE: DEEP ANALYSIS.\n"
            "- Always start with `vizcode_l0()` for any structural question.\n"
            "- Before concluding anything about a file, call `vizcode_l1` or `vizcode_l2` to verify.\n"
            "- Attach an exact node_id (file path or `path::func`) to every claim.\n"
            "- Prefer `vizcode_ui_tour_step` over static highlights — walk the user through findings.\n"
        ),
        "tool_whitelist": None,
    },
    "fast": {
        "label": "快速查詢",
        "system_addendum": (
            "\n\nMODE: FAST LOOKUP.\n"
            "- Answer in ONE or TWO sentences.\n"
            "- Prefer `vizcode_query` over hierarchical drilldown.\n"
            "- Do NOT call `vizcode_l0` unless explicitly asked for the big picture.\n"
            "- Do NOT launch tours.\n"
        ),
        "tool_whitelist": {
            "vizcode_query", "vizcode_explain", "vizcode_report",
            "vizcode_ui_emit_badge", "vizcode_ui_highlight_node",
        },
    },
}


# ─── Forced tasks (one-shot buttons) ──────────────────────────────────────────

FORCED_TASKS: dict[str, dict] = {
    "mermaid_flow": {
        "label": "產生流程圖",
        "seed_user_message": (
            "Produce a Mermaid flowchart for the CURRENT canvas view. "
            "If you are unsure what is currently shown, call `vizcode_l0()` once to orient, "
            "then commit. Output ```mermaid ... ``` fenced — no narrative before the diagram."
        ),
        "system_addendum": (
            "\n\nFORCED TASK: mermaid_flow. You MUST output a Mermaid diagram fenced in "
            "```mermaid. Do not produce a tour, do not call tour_step. If you cannot "
            "determine a meaningful flow from available tools, emit a short apology "
            "explaining what is missing — DO NOT fabricate."
        ),
        "tool_whitelist": {
            "vizcode_l0", "vizcode_l1", "vizcode_l2",
            "vizcode_query", "vizcode_explain",
        },
    },
    "file_tour": {
        "label": "導覽檔案關係",
        "seed_user_message": (
            "Give me a guided tour of 3-5 key nodes in the current view. "
            "Use `vizcode_ui_tour_step` with pacing: one sentence of narration, then "
            "one tour_step, then the next sentence. End with a one-line summary."
        ),
        "system_addendum": (
            "\n\nFORCED TASK: file_tour. You MUST call `vizcode_ui_tour_step` at least 3 "
            "times, interleaved with short narration. Do not emit mermaid."
        ),
        "tool_whitelist": None,   # full access — tour needs l1/l2 + ui tools
    },
    "health_report": {
        "label": "健康報告",
        "seed_user_message": (
            "Run `vizcode_health()` and give me a bulleted summary: dead code, god files, "
            "circular imports. For each category list up to 5 items with exact file paths. "
            "If the health data is empty, say so plainly."
        ),
        "system_addendum": (
            "\n\nFORCED TASK: health_report. Your FIRST tool call must be `vizcode_health`. "
            "Output format: three H3 sections (### Dead code / ### God files / ### Circular "
            "imports), each a bullet list. No tour, no mermaid."
        ),
        "tool_whitelist": {
            "vizcode_health", "vizcode_report",
            "vizcode_ui_emit_badge", "vizcode_ui_highlight_nodes",
        },
    },
}


# ─── Resolver ────────────────────────────────────────────────────────────────

def resolve(
    mode: str | None,
    force_task: str | None,
) -> tuple[set[str] | None, str, str | None]:
    """
    Resolve the effective (whitelist, addendum, seed_user_message) for a turn.

    Behaviour:
    - Unknown mode → falls back to "chat" silently (no errors bubble to the user).
    - Unknown force_task → ignored silently; behaves as pure persistent-mode turn.
    - If both mode and force_task provide a whitelist, the result is their
      intersection; if only one provides one, that one wins; if neither, None
      (all tools allowed).

    Returns:
        whitelist:   set[str] of allowed tool names, or None for "all".
        addendum:    extra text to append to the base system prompt.
        seed:        user-role message to insert before the latest turn, or None.
    """
    m  = MODES.get(mode or "chat") or MODES["chat"]
    addendum_parts: list[str] = [m["system_addendum"]]
    whitelist: set[str] | None = set(m["tool_whitelist"]) if m["tool_whitelist"] else None

    seed: str | None = None
    if force_task:
        ft = FORCED_TASKS.get(force_task)
        if ft:
            addendum_parts.append(ft["system_addendum"])
            seed = ft["seed_user_message"]
            if ft["tool_whitelist"]:
                ft_wl = set(ft["tool_whitelist"])
                whitelist = ft_wl if whitelist is None else (whitelist & ft_wl)

    return whitelist, "".join(addendum_parts), seed
