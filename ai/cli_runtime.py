"""Local CLI runtime for VizBridge.

This module adapts command-line AI agents into the provider event contract used
by :mod:`ai.vizbridge`.  CLI agents receive a single prompt, may request tools
with strict protocol lines, and are respawned by VizBridge after tool results.
"""

from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


_TOOL_PREFIX = "VIZCODE_TOOL"
_UI_PREFIX = "VIZCODE_UI"
_ERROR_PREFIX = "VIZCODE_ERROR"
_DEFAULT_TIMEOUT_SECONDS = 300
_HEARTBEAT_SECONDS = 15


@dataclass(frozen=True)
class CliDefinition:
    key: str
    label: str
    binary: str
    config_path_key: str
    env_path_keys: tuple[str, ...]
    version_args: tuple[str, ...] = ("--version",)
    prompt_transport: str = "stdin"  # "stdin" or "arg"

    def launch_args(self, model: str = "", reasoning: str = "") -> list[str]:
        model = (model or "").strip()
        if self.key == "claude":
            args = ["--print"]
            if model:
                args += ["--model", model]
            return args
        if self.key == "codex":
            # read-only sandbox: this is a Q&A chat, codex must never edit the repo.
            # A low default reasoning effort keeps replies responsive (the vizcode_*
            # tools do the heavy analysis; codex only routes calls + phrases the answer).
            args = ["exec", "--sandbox", "read-only"]
            if model:
                args += ["--model", model]
            effort = (reasoning or "").strip()
            if effort:
                args += ["-c", f'model_reasoning_effort="{effort}"']
            return args
        if self.key == "gemini":
            args = []
            if model:
                args += ["--model", model]
            args += ["-p"]
            return args
        return []


CLI_DEFINITIONS: dict[str, CliDefinition] = {
    "claude": CliDefinition(
        key="claude",
        label="Claude Code",
        binary="claude",
        config_path_key="claude_cli_path",
        env_path_keys=("VIZCODE_CLAUDE_PATH", "VIZCODE_CLI_CLAUDE_PATH", "CLAUDE_CODE_PATH"),
    ),
    "codex": CliDefinition(
        key="codex",
        label="Codex CLI",
        binary="codex",
        config_path_key="codex_cli_path",
        env_path_keys=("VIZCODE_CODEX_PATH", "VIZCODE_CLI_CODEX_PATH", "CODEX_PATH"),
    ),
    "gemini": CliDefinition(
        key="gemini",
        label="Gemini CLI",
        binary="gemini",
        config_path_key="gemini_cli_path",
        env_path_keys=("VIZCODE_GEMINI_PATH", "VIZCODE_CLI_GEMINI_PATH", "GEMINI_CLI_PATH"),
        prompt_transport="arg",
    ),
}


def _path_variants(raw: str) -> list[str]:
    raw = (raw or "").strip().strip('"')
    if not raw:
        return []
    p = Path(os.path.expanduser(os.path.expandvars(raw)))
    variants = [str(p)]
    if sys.platform.startswith("win") and p.suffix.lower() not in (".exe", ".cmd", ".bat"):
        variants.extend(str(p.with_suffix(s)) for s in (".exe", ".cmd", ".bat"))
    return variants


def _resolve_explicit_path(raw: str) -> str:
    for candidate in _path_variants(raw):
        path = Path(candidate)
        if path.is_file():
            return str(path)
    found = shutil.which(raw)
    return found or ""


def _common_install_candidates(binary: str) -> list[str]:
    home = Path.home()
    candidates: list[Path] = [
        home / ".local" / "bin" / binary,
        home / "bin" / binary,
        home / ".npm-global" / "bin" / binary,
    ]
    appdata = os.environ.get("APPDATA")
    localappdata = os.environ.get("LOCALAPPDATA")
    if appdata:
        candidates.append(Path(appdata) / "npm" / binary)
    if localappdata:
        candidates.extend([
            Path(localappdata) / "Programs" / binary / binary,
            Path(localappdata) / "Microsoft" / "WindowsApps" / binary,
        ])

    out: list[str] = []
    for p in candidates:
        out.extend(_path_variants(str(p)))
    return out


def detect_cli(defn: CliDefinition, cfg: dict | None = None) -> dict:
    """Detect one CLI, honoring config path, env path, PATH, then common dirs."""
    cfg = cfg or {}
    sources: list[tuple[str, str]] = []
    configured = str(cfg.get(defn.config_path_key) or "").strip()
    if configured:
        sources.append(("config", configured))
    for env_key in defn.env_path_keys:
        env_val = os.environ.get(env_key, "").strip()
        if env_val:
            sources.append((f"env:{env_key}", env_val))
    sources.append(("path", defn.binary))
    for candidate in _common_install_candidates(defn.binary):
        sources.append(("common", candidate))

    seen: set[str] = set()
    chosen = ""
    source = ""
    for src, raw in sources:
        if not raw or raw in seen:
            continue
        seen.add(raw)
        found = _resolve_explicit_path(raw) if src != "path" else (shutil.which(raw) or "")
        if found:
            chosen, source = found, src
            break

    version = probe_version(chosen, defn.version_args) if chosen else ""
    return {
        "key": defn.key,
        "label": defn.label,
        "binary": defn.binary,
        "path": chosen,
        "source": source,
        "available": bool(chosen),
        "version": version,
        "config_path_key": defn.config_path_key,
        "configured_path": configured,
    }


def detect_all(cfg: dict | None = None) -> list[dict]:
    return [detect_cli(defn, cfg) for defn in CLI_DEFINITIONS.values()]


def probe_version(path: str, args: tuple[str, ...] = ("--version",)) -> str:
    if not path:
        return ""
    try:
        proc = subprocess.run(
            [path, *args],
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5,
            shell=False,
        )
    except Exception:
        return ""
    text = (proc.stdout or proc.stderr or "").strip()
    return text.splitlines()[0][:160] if text else ""


def availability_report(cfg: dict | None = None) -> dict:
    cfg = cfg or {}
    selected = str(cfg.get("cli_agent") or "claude").lower()
    if selected not in CLI_DEFINITIONS:
        selected = "claude"
    return {
        "agents": detect_all(cfg),
        "selected": selected,
        "model": cfg.get("cli_model", ""),
        "ai_mode": cfg.get("ai_mode", "api"),
    }


_PROTOCOL_MARKER_RE = re.compile(r'^(?:[-*>]\s+|\d+[.)]\s+)+')


def _normalize_protocol_candidate(line: str) -> str:
    """Strip Markdown wrappers codex sometimes adds around a protocol line.

    Tolerates surrounding inline-code backticks and leading bullet / blockquote /
    list markers so e.g. '`VIZCODE_TOOL {...}`' or '- VIZCODE_TOOL {...}' still parse
    as protocol lines instead of leaking to the user as prose.
    """
    s = line.strip()
    if len(s) >= 2 and s.startswith("`") and s.endswith("`"):
        s = s.strip("`").strip()
    s = _PROTOCOL_MARKER_RE.sub("", s)
    return s


def parse_protocol_line(line: str, tool_id: str) -> dict | None:
    """Parse a strict CLI protocol line into a provider event."""
    stripped = _normalize_protocol_candidate(line)
    event_kind = ""
    payload = ""
    if stripped.startswith(_TOOL_PREFIX):
        event_kind = "tool"
        payload = stripped[len(_TOOL_PREFIX):].strip()
    elif stripped.startswith(_UI_PREFIX):
        event_kind = "ui"
        payload = stripped[len(_UI_PREFIX):].strip()
    elif stripped.startswith(_ERROR_PREFIX):
        payload = stripped[len(_ERROR_PREFIX):].strip()
        return {"type": "error", "message": payload or "CLI reported an error."}
    else:
        return None

    if payload.startswith(":"):
        payload = payload[1:].strip()
    data = json.loads(payload or "{}")
    if not isinstance(data, dict):
        raise ValueError("protocol payload must be a JSON object")
    name = str(data.get("name") or data.get("tool") or data.get("action") or "").strip()
    if event_kind == "ui" and name and not name.startswith("vizcode_ui_"):
        name = "vizcode_ui_" + name
    if not name:
        raise ValueError("protocol payload missing tool name")
    args = data.get("input")
    if args is None:
        args = data.get("args")
    if args is None:
        args = {}
    if not isinstance(args, dict):
        raise ValueError("protocol input/args must be a JSON object")
    return {
        "type": "tool_use",
        "id": str(data.get("id") or tool_id),
        "name": name,
        "input": args,
        "synthetic": True,
        "source_text": line,
    }


class CliRuntime:
    """Provider-compatible adapter for local AI CLIs."""

    def __init__(self, cfg: dict):
        self._cfg = cfg
        key = str(cfg.get("cli_agent") or "claude").lower()
        self._defn = CLI_DEFINITIONS.get(key) or CLI_DEFINITIONS["claude"]
        self._model = str(cfg.get("cli_model") or "").strip()
        self._reasoning = str(cfg.get("codex_reasoning_effort") or "low").strip()
        self._timeout = int(cfg.get("cli_timeout_seconds") or _DEFAULT_TIMEOUT_SECONDS)

    @property
    def provider_name(self) -> str:
        return f"cli:{self._defn.key}"

    def stream_chat(
        self,
        messages: list[dict],
        tools: list[dict],
        system: str,
        max_tokens: int | None = None,
    ) -> Iterator[dict]:
        detected = detect_cli(self._defn, self._cfg)
        if not detected.get("available"):
            yield {
                "type": "error",
                "message": (
                    f"{self._defn.label} is not available. Configure "
                    f"{self._defn.config_path_key} or install `{self._defn.binary}` on PATH."
                ),
            }
            return

        prompt = build_cli_prompt(system, messages, tools)
        cmd = [detected["path"], *self._defn.launch_args(self._model, self._reasoning)]
        stdin_text = prompt
        if self._defn.prompt_transport == "arg":
            cmd.append(prompt)
            stdin_text = ""

        yield from self._run_process(cmd, stdin_text)

    def _run_process(self, cmd: list[str], stdin_text: str) -> Iterator[dict]:
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                shell=False,
            )
        except Exception as exc:
            yield {"type": "error", "message": f"Failed to launch {self._defn.label}: {exc}"}
            return

        if proc.stdin:
            try:
                proc.stdin.write(stdin_text)
                proc.stdin.close()
            except Exception:
                pass

        q: queue.Queue[tuple[str, str | None]] = queue.Queue()

        def reader(name: str, stream) -> None:
            try:
                for line in iter(stream.readline, ""):
                    q.put((name, line))
            finally:
                q.put((name, None))

        threads = [
            threading.Thread(target=reader, args=("stdout", proc.stdout), daemon=True),
            threading.Thread(target=reader, args=("stderr", proc.stderr), daemon=True),
        ]
        for t in threads:
            t.start()

        ended = set()
        stderr_tail: list[str] = []
        tool_counter = 0
        deadline = time.time() + self._timeout
        process_exit_seen_at: float | None = None
        next_heartbeat = time.time() + _HEARTBEAT_SECONDS

        while len(ended) < 2:
            if time.time() > deadline:
                try:
                    proc.kill()
                except Exception:
                    pass
                yield {"type": "error", "message": f"{self._defn.label} timed out after {self._timeout}s."}
                return
            try:
                name, line = q.get(timeout=0.1)
            except queue.Empty:
                if proc.poll() is not None:
                    if process_exit_seen_at is None:
                        process_exit_seen_at = time.time()
                    elif time.time() - process_exit_seen_at > 0.25:
                        break
                else:
                    process_exit_seen_at = None
                    if time.time() >= next_heartbeat:
                        remaining = max(0, int(deadline - time.time()))
                        yield {
                            "type": "status",
                            "message": f"{self._defn.label} is still running.",
                            "remaining_seconds": remaining,
                        }
                        next_heartbeat = time.time() + _HEARTBEAT_SECONDS
                continue
            process_exit_seen_at = None
            if line is None:
                ended.add(name)
                continue
            next_heartbeat = time.time() + _HEARTBEAT_SECONDS
            if name == "stderr":
                stripped = line.strip()
                if stripped.startswith(_ERROR_PREFIX):
                    yield {"type": "error", "message": stripped[len(_ERROR_PREFIX):].strip() or "CLI reported an error."}
                    return
                if stripped:
                    stderr_tail.append(stripped)
                    stderr_tail = stderr_tail[-8:]
                continue

            try:
                parsed = parse_protocol_line(line, f"cli_tool_{tool_counter}")
            except Exception as exc:
                # A single malformed protocol line must not kill the turn — note it and
                # keep reading so codex's surrounding prose still reaches the user.
                yield {"type": "status", "message": f"Ignored malformed tool request ({exc})."}
                continue
            if parsed:
                if parsed["type"] == "tool_use":
                    tool_counter += 1
                yield parsed
            else:
                yield {"type": "delta", "text": line}

        rc = proc.wait(timeout=1)
        if rc != 0:
            detail = "\n".join(stderr_tail).strip()
            msg = f"{self._defn.label} exited with code {rc}."
            if detail:
                msg += f" stderr: {detail}"
            yield {"type": "error", "message": msg}
            return
        yield {"type": "done"}


def _compact_tool_for_prompt(tool: dict) -> dict:
    schema = tool.get("inputSchema", {}) or {}
    props = schema.get("properties", {}) if isinstance(schema, dict) else {}
    args = []
    if isinstance(props, dict):
        for name, spec in props.items():
            arg: dict = {"name": name}
            if isinstance(spec, dict):
                typ = spec.get("type")
                if typ:
                    arg["type"] = typ
                desc = str(spec.get("description") or "")
                if desc:
                    arg["description"] = desc[:120]
            args.append(arg)
    return {
        "name": tool.get("name", ""),
        "description": str(tool.get("description", ""))[:220],
        "required": schema.get("required", []) if isinstance(schema, dict) else [],
        "args": args,
    }


def build_cli_prompt(system: str, messages: list[dict], tools: list[dict]) -> str:
    tool_list = [_compact_tool_for_prompt(t) for t in tools]
    parts = [
        system,
        "",
        "LOCAL CLI TOOL PROTOCOL:",
        "When you need a VizCode analysis tool, output exactly one line:",
        'VIZCODE_TOOL {"name":"vizcode_l0","input":{}}',
        "When you need to move or annotate the canvas, output exactly one line:",
        'VIZCODE_UI {"name":"vizcode_ui_goto_l1","input":{"module":"ai"}}',
        "After a VIZCODE_TOOL or VIZCODE_UI line, stop. VizCode will execute it and call you again with the result.",
        "Do not wrap protocol lines in Markdown fences. Do not invent tool results.",
        "",
        "AVAILABLE TOOLS:",
        json.dumps(tool_list, ensure_ascii=False, indent=2),
        "",
        "CONVERSATION:",
    ]
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role == "assistant" and isinstance(content, list):
            text = "\n".join(
                str(item.get("text", ""))
                for item in content
                if isinstance(item, dict) and item.get("type") == "text"
            ).strip()
            tool_uses = [
                f"{item.get('name')}({json.dumps(item.get('input') or {}, ensure_ascii=False)})"
                for item in content
                if isinstance(item, dict) and item.get("type") == "tool_use"
            ]
            content = text
            if tool_uses:
                content = (content + "\n" if content else "") + "Requested tools: " + ", ".join(tool_uses)
        elif role == "tool":
            content = (
                f"Tool result for {msg.get('tool_name', '')} "
                f"(id {msg.get('tool_use_id', '')}):\n{msg.get('content', '')}"
            )
        parts.append(f"{role.upper()}:\n{content}")
    parts.append("ASSISTANT:")
    return "\n".join(parts)
