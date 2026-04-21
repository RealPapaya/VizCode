"""
ai/ui_tools.py — Canvas-driving tools for VizBridge.

These tools let the LLM navigate and highlight the web visualizer canvas.
They do NOT read any data; each call returns a small action descriptor
that VizBridge forwards to the browser as an SSE `ui_action` event.
The frontend (static/viz_chat.js) dispatches the action onto the existing
global nav functions in viz_graph.js / viz_toolbar.js.

These tools are VizBridge-only — they are NOT exported through mcp_server.py,
because non-web MCP clients have no canvas to drive.

Return contract (consumed by ai/vizbridge.py):
    {
        "action":  "goto_l1",                       # verb (str)
        "args":    {"module": "parsers"},           # payload (dict)
        "message": "Navigated to module 'parsers'." # tool_result text fed back to the LLM
    }

The `message` should be short and descriptive so the model understands the
navigation succeeded without re-calling the same tool.
"""

from __future__ import annotations


# ─── Tool schemas (MCP inputSchema style, same as mcp_server.TOOLS) ──────────

UI_TOOL_SCHEMAS: list[dict] = [
    {
        "name": "vizcode_ui_goto_l0",
        "description": (
            "Switch the canvas to the L0 module-overview view (top-level module groups). "
            "Use this when the user asks to 'see the overview' / 'go back to the top' / "
            "'show all modules'. No parameters."
        ),
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "vizcode_ui_goto_l1",
        "description": (
            "Drill the canvas into a specific module's L1 file-dependency view. "
            "Use this when the user wants to look at one module in detail, e.g. "
            "'show me the parsers module', '切到 static 模組'. "
            "Module name must match vizcode_l0() output; use '.' for root-level files."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "module": {
                    "type": "string",
                    "description": "Module name (top-level directory). '.' for root.",
                },
            },
            "required": ["module"],
        },
    },
    {
        "name": "vizcode_ui_goto_l2",
        "description": (
            "Open the L2 function call-flow view for a single file. "
            "Use this when the user wants to see a file's internal call graph, e.g. "
            "'open analyze_viz.py', '看 bios_parser 的函式關係'. "
            "Use paths as shown by vizcode_l1()."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "file": {
                    "type": "string",
                    "description": "File path as shown in vizcode_l1, e.g. 'parsers/python_parser.py'.",
                },
            },
            "required": ["file"],
        },
    },
    {
        "name": "vizcode_ui_highlight_node",
        "description": (
            "Highlight a specific node on the current canvas (module, file, or function). "
            "Use this when the user references a specific thing and it helps to point at it. "
            "node_id should match a file path or function label visible in the current view."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "node_id": {
                    "type": "string",
                    "description": "Node identifier (file path or function label).",
                },
            },
            "required": ["node_id"],
        },
    },
    {
        "name": "vizcode_ui_highlight_path",
        "description": (
            "Highlight the dependency/call path between two files on the L0 or L1 canvas. "
            "Use this when the user asks 'how does A reach B?' / '從 X 怎麼呼叫到 Y'. "
            "Both endpoints must be file paths visible in the current view."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "description": "Source file path."},
                "target": {"type": "string", "description": "Target file path."},
            },
            "required": ["source", "target"],
        },
    },
    {
        "name": "vizcode_ui_emit_badge",
        "description": (
            "Register a clickable badge for a file/function name you are about to mention. "
            "Call this BEFORE writing the label in text; the frontend will wrap the first "
            "matching occurrence of `label` as a clickable span that highlights the node on hover "
            "and focuses it on click. Use for EVERY file/function you reference that exists in the project."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "node_id": {
                    "type": "string",
                    "description": "Exact canvas node id (file path e.g. 'ai/vizbridge.py', or 'path::func' for L2 funcs).",
                },
                "label": {
                    "type": "string",
                    "description": "The text that will appear in chat. First occurrence after this call becomes a badge.",
                },
            },
            "required": ["node_id", "label"],
        },
    },
    {
        "name": "vizcode_ui_highlight_nodes",
        "description": (
            "Highlight multiple nodes on the current canvas at once. "
            "Use this when discussing a group of files that share a property "
            "(e.g. 'these three files are tightly coupled'). Fades everything else."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "node_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of canvas node ids (file paths) to highlight simultaneously.",
                },
            },
            "required": ["node_ids"],
        },
    },
    {
        "name": "vizcode_ui_tour_step",
        "description": (
            "Pan the camera to one node and show a one-line subtitle card beside it. "
            "Use this to guide the user through code AS YOU NARRATE — write a sentence "
            "about a node, then call tour_step, then write the next sentence. "
            "Do NOT batch all tour steps at the end; the rhythm matters."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "node_id": {"type": "string", "description": "Canvas node id to focus."},
                "caption": {
                    "type": "string",
                    "description": "One-line subtitle shown beside the node. Keep it short (~80 chars).",
                },
            },
            "required": ["node_id"],
        },
    },
]

UI_TOOL_NAMES: frozenset = frozenset(s["name"] for s in UI_TOOL_SCHEMAS)


# ─── Dispatch ────────────────────────────────────────────────────────────────

def dispatch(name: str, args: dict) -> dict:
    """
    Execute a UI tool call.  Returns a dict with `action`, `args`, `message`.

    Unknown tools yield a graceful error descriptor rather than raising, so the
    LLM can recover by picking a different tool.
    """
    args = args or {}

    if name == "vizcode_ui_goto_l0":
        return {
            "action":  "goto_l0",
            "args":    {},
            "message": "Canvas switched to L0 module overview.",
        }

    if name == "vizcode_ui_goto_l1":
        module = (args.get("module") or "").strip() or "."
        return {
            "action":  "goto_l1",
            "args":    {"module": module},
            "message": f"Canvas drilled into module {module!r} (L1 view).",
        }

    if name == "vizcode_ui_goto_l2":
        f = (args.get("file") or "").strip()
        if not f:
            return _err(name, "missing required arg 'file'")
        return {
            "action":  "goto_l2",
            "args":    {"file": f},
            "message": f"Canvas opened function call-flow for {f!r} (L2 view).",
        }

    if name == "vizcode_ui_highlight_node":
        node_id = (args.get("node_id") or "").strip()
        if not node_id:
            return _err(name, "missing required arg 'node_id'")
        return {
            "action":  "highlight_node",
            "args":    {"node_id": node_id},
            "message": f"Node {node_id!r} highlighted on canvas.",
        }

    if name == "vizcode_ui_highlight_path":
        src = (args.get("source") or "").strip()
        tgt = (args.get("target") or "").strip()
        if not src or not tgt:
            return _err(name, "both 'source' and 'target' are required")
        return {
            "action":  "highlight_path",
            "args":    {"source": src, "target": tgt},
            "message": f"Highlighted path {src!r} -> {tgt!r} on canvas.",
        }

    if name == "vizcode_ui_emit_badge":
        node_id = (args.get("node_id") or "").strip()
        label   = (args.get("label") or "").strip()
        if not node_id or not label:
            return _err(name, "both 'node_id' and 'label' are required")
        return {
            "action":  "emit_badge",
            "args":    {"node_id": node_id, "label": label},
            "message": f"Badge registered: {label!r} -> {node_id!r}.",
        }

    if name == "vizcode_ui_highlight_nodes":
        ids = args.get("node_ids") or []
        if not isinstance(ids, list):
            return _err(name, "'node_ids' must be a list of strings")
        ids = [str(x).strip() for x in ids if str(x).strip()]
        if not ids:
            return _err(name, "'node_ids' must contain at least one id")
        return {
            "action":  "highlight_nodes",
            "args":    {"node_ids": ids},
            "message": f"Highlighted {len(ids)} nodes on canvas.",
        }

    if name == "vizcode_ui_tour_step":
        node_id = (args.get("node_id") or "").strip()
        if not node_id:
            return _err(name, "missing required arg 'node_id'")
        caption = (args.get("caption") or "").strip()
        return {
            "action":  "tour_step",
            "args":    {"node_id": node_id, "caption": caption},
            "message": f"Tour step: focused {node_id!r}" + (f" ({caption!r})" if caption else "") + ".",
        }

    return _err(name, "unknown UI tool")


def _err(name: str, reason: str) -> dict:
    """Graceful failure — no-op action, error message returned to LLM."""
    return {
        "action":  "noop",
        "args":    {},
        "message": f"UI tool {name!r} failed: {reason}.",
    }
