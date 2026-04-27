"""
ai/chat_cli.py — VizBridge terminal chat REPL.

Entry point: run_chat(project_root)

Usage (via vizcode.py):
    python vizcode.py <path> --chat

Features:
  - Streaming AI output (word-by-word)
  - Inline tool call notifications
  - Multi-turn conversation history
  - Ctrl+C to quit gracefully
  - Works without a running server (calls VizBridge directly)
"""

from __future__ import annotations

import sys
import os
from pathlib import Path
_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
for _import_dir in (_ROOT, _ROOT / "src", _ROOT / "src" / "server", _ROOT / "src" / "core"):
    _import_dir_str = str(_import_dir)
    if _import_dir_str not in sys.path:
        sys.path.insert(0, _import_dir_str)

# ─── ANSI helpers (reuse vizcode.py palette) ─────────────────────────────────

IS_WIN = sys.platform == "win32"

def _enable_ansi() -> bool:
    if not IS_WIN:
        return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()
    try:
        import ctypes
        ctypes.windll.kernel32.SetConsoleMode(
            ctypes.windll.kernel32.GetStdHandle(-11), 7)
        return True
    except Exception:
        return False

_USE_COLOR = _enable_ansi()

def _c(t: str, code: str) -> str:
    return f"\033[{code}m{t}\033[0m" if _USE_COLOR else t

def _orange(t: str) -> str:  return _c(t, "38;5;214")
def _cyan(t: str)   -> str:  return _c(t, "38;5;51")
def _green(t: str)  -> str:  return _c(t, "38;5;84")
def _dim(t: str)    -> str:  return _c(t, "2")
def _bold(t: str)   -> str:  return _c(t, "1")
def _red(t: str)    -> str:  return _c(t, "38;5;203")
def _yellow(t: str) -> str:  return _c(t, "38;5;226")

# ─── Pretty-printer ───────────────────────────────────────────────────────────

def _hr(char: str = "─", width: int = 56) -> str:
    return _dim(char * width)


def _print_header(project_root: str, cfg: dict) -> None:
    """Print the one-time session header."""
    from ai.vizbridge import ContextInjector, _load_json
    root_name = Path(project_root).name or project_root
    scan_path = str(Path(project_root) / ".local" / "scan_cache.json")
    scan = _load_json(scan_path)
    entries = scan.get("entries", {})
    n_files = len(entries)
    n_funcs = sum(
        len((e.get("payload") or {}).get("funcdefs") or [])
        for e in entries.values()
    )
    provider = cfg.get("provider", "anthropic")
    model = cfg.get(f"{provider}_model", "")

    print()
    print(_orange("  ✦ VizCode AI"))
    print(_dim(f"  {provider}  ·  {model or '(default model)'}"))
    print(_dim(f"  Project: {root_name}  ·  {n_files} files  ·  {n_funcs} functions"))
    print()
    print(_dim("  Type your question and press Enter."))
    print(_dim("  Commands: /clear  /quit  /help"))
    print("  " + _hr())
    print()


def _print_tool_call(name: str, tool_input: dict) -> None:
    """Single-line tool-call notification."""
    args_str = ""
    if tool_input:
        first_val = next(iter(tool_input.values()), "")
        if isinstance(first_val, str) and first_val:
            args_str = f"({_dim(first_val[:40])})"
    print(f"  {_cyan('🔍')} {_dim(name + args_str)}", flush=True)


def _print_ui_action(action: str, args: dict) -> None:
    """Canvas-action notification (no canvas in CLI, but log the intent)."""
    if args:
        first = next(iter(args.values()), "")
        tail = f" {first}" if isinstance(first, str) else ""
    else:
        tail = ""
    print(f"  {_green('→')} {_dim('canvas:')} {_green(action + tail)}", flush=True)


def _stream_response(vb, messages: list) -> str:
    """
    Drive one VizBridge turn, printing events to stdout.
    Returns the full assistant text for history.
    """
    full_text = ""
    in_stream = False

    for ev in vb.stream_response(messages):
        ev_type = ev.get("type", "")

        if ev_type == "delta":
            if not in_stream:
                # Print the "VizCode AI:" label on first delta
                print(f"\n  {_orange('VizCode AI:')} ", end="", flush=True)
                in_stream = True
            text = ev.get("text", "")
            full_text += text
            print(text, end="", flush=True)

        elif ev_type == "tool_call":
            _print_tool_call(ev.get("name", ""), ev.get("input", {}))

        elif ev_type == "ui_action":
            _print_ui_action(ev.get("action", ""), ev.get("args", {}))

        elif ev_type == "error":
            msg = ev.get("message", "unknown error")
            print(f"\n  {_red('✗')} {_red(msg)}", flush=True)
            return ""

        elif ev_type == "done":
            break

    if in_stream:
        print()   # trailing newline after streamed text
    print()
    return full_text


# ─── REPL helpers ─────────────────────────────────────────────────────────────

def _print_help() -> None:
    print()
    print(f"  {_bold(_cyan('VizCode AI — Available commands'))}")
    print()
    print(f"  {_yellow('/clear')}   Clear conversation history (start fresh)")
    print(f"  {_yellow('/quit')}    Exit chat  (also Ctrl+C)")
    print(f"  {_yellow('/help')}    Show this help")
    print()
    print(f"  {_bold('Suggested questions:')}")
    print(f"  {_dim('  What modules are in this project?')}")
    print(f"  {_dim('  Explain the architecture of server.py')}")
    print(f"  {_dim('  Show the call flow from vizcode_l0 to build_graph')}")
    print(f"  {_dim('  Which files have the most functions?')}")
    print()


def _get_user_input(prompt: str) -> str | None:
    """Read one line from stdin.  Returns None on EOF / Ctrl+C."""
    try:
        sys.stdout.write(prompt)
        sys.stdout.flush()
        line = sys.stdin.readline()
        if not line:        # EOF
            return None
        return line.rstrip("\n")
    except (KeyboardInterrupt, EOFError):
        return None


# ─── Main entry point ──────────────────────────────────────────────────────────

def _check_api_key(cfg: dict) -> bool:
    """Return True if a key for the selected provider is configured.
    Prints a red error on stderr and returns False otherwise."""
    provider = cfg.get("provider", "anthropic")
    if provider == "ollama":
        return True
    key_field = f"{provider}_api_key"
    if cfg.get(key_field):
        return True
    print(file=sys.stderr)
    print(_red(f"  ✗ No API key configured for provider '{provider}'."), file=sys.stderr)
    print(_dim(f"  Set {key_field.upper()} environment variable,"), file=sys.stderr)
    print(_dim("  or run: python vizcode.py <path> (then use Web Chat → ⚙ settings)"), file=sys.stderr)
    print(file=sys.stderr)
    return False


def run_chat(project_root: str) -> None:
    """
    Start the interactive terminal chat REPL.
    Blocks until the user quits (Ctrl+C or /quit).
    """
    root = str(Path(project_root).resolve())

    # Load config first so we can surface missing key errors early
    try:
        from ai.vizbridge import load_config, VizBridge
    except ImportError as e:
        print(_red(f"Error: VizBridge not available — {e}"), file=sys.stderr)
        sys.exit(1)

    cfg = load_config()
    if not _check_api_key(cfg):
        sys.exit(1)

    _print_header(root, cfg)

    vb = VizBridge(root)
    history: list[dict] = []

    PROMPT = f"  {_orange('You:')} "

    while True:
        user_input = _get_user_input(PROMPT)

        # EOF or Ctrl+C
        if user_input is None:
            print(f"\n  {_dim('Goodbye!')}\n")
            break

        text = user_input.strip()

        # Empty line
        if not text:
            continue

        # Built-in commands
        if text.lower() in ("/quit", "/exit", "quit", "exit"):
            print(f"\n  {_dim('Goodbye!')}\n")
            break

        if text.lower() in ("/clear", "/reset"):
            history.clear()
            print(f"  {_green('✓')} Conversation cleared.\n")
            continue

        if text.lower() in ("/help", "help", "/?"):
            _print_help()
            continue

        # Append user turn to history
        history.append({"role": "user", "content": text})

        # Stream AI response
        assistant_text = _stream_response(vb, list(history))

        # Append assistant turn to history (only if we got text)
        if assistant_text:
            history.append({"role": "assistant", "content": assistant_text})


# ─── One-shot query mode ─────────────────────────────────────────────────────

def run_oneshot(project_root: str, question: str) -> int:
    """
    Ask VizCode AI a single question and print the answer.
    Returns a process exit code (0 = ok, 1 = error / no key).

    Usage (from vizcode.py):
        python vizcode.py <path> --ai "找出最複雜的模組"
    """
    root = str(Path(project_root).resolve())
    q    = (question or "").strip()
    if not q:
        print(_red("Error: empty question"), file=sys.stderr)
        return 1

    try:
        from ai.vizbridge import load_config, VizBridge
    except ImportError as e:
        print(_red(f"Error: VizBridge not available — {e}"), file=sys.stderr)
        return 1

    cfg = load_config()
    if not _check_api_key(cfg):
        return 1

    vb  = VizBridge(root)
    out = _stream_response(vb, [{"role": "user", "content": q}])
    return 0 if out else 1
