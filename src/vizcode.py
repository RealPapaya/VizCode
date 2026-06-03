#!/usr/bin/env python3
"""
vizcode.py — VIZCODE Interactive CLI Launcher
Zero pip dependencies — pure Python stdlib only.
Compatible: Python 3.6+, Windows cp950/UTF-8, Mac, Linux

TUI Architecture
────────────────
  Row 1-11  : FIXED HEADER  (printed once at startup, never touched again)
              blank / banner×6 / subtitle / blank / server-badge / blank
  Row 12+   : CONTENT ZONE  (cleared & repainted per screen)

Screen transitions only erase/rewrite rows 12 onward.
The banner is NEVER reprinted.
Animation loop: 30 fps — HTTP poll every 5 frames (~6 Hz).
Progress bar: time-driven (1 %/s, snaps to 100 % on completion).
Phase display: SCAN counter → indexed counter → node/edge stats.
"""

import sys, os, json, time, socket, subprocess, webbrowser, threading
import urllib.request, urllib.error
from pathlib import Path
from typing import Optional, List, Dict

# ─── Force UTF-8 output on Windows ───────────────────────────────────────────
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    os.system("chcp 65001 >nul 2>&1")

# ─── Config ───────────────────────────────────────────────────────────────────
SCRIPT_DIR     = Path(__file__).resolve().parent
ROOT_DIR       = SCRIPT_DIR.parent
LOCAL_DATA_DIR = ROOT_DIR / ".vizcode"
LOCAL_DATA_DIR.mkdir(exist_ok=True)
SERVER_PY    = SCRIPT_DIR / "server" / "server.py"
HISTORY_FILE = LOCAL_DATA_DIR / "vizcode_history.json"
SERVER_LOG   = LOCAL_DATA_DIR / "vizcode_server.log"
DEFAULT_PORT = 7777
PORT         = DEFAULT_PORT
BASE_URL     = f"http://localhost:{PORT}"

# ─── Ensure project modules are importable from any launch location ────────────
_IMPORT_DIRS = (
    str(ROOT_DIR),
    str(SCRIPT_DIR / "core"),
    str(SCRIPT_DIR),
)
for _import_dir in _IMPORT_DIRS:
    if _import_dir not in sys.path:
        sys.path.insert(0, _import_dir)
_SERVER_IMPORT_DIR = str(SCRIPT_DIR / "server")
if _SERVER_IMPORT_DIR not in sys.path:
    sys.path.append(_SERVER_IMPORT_DIR)

# ─── ANSI ─────────────────────────────────────────────────────────────────────
IS_WIN = sys.platform == "win32"

def _enable_win_ansi() -> bool:
    try:
        import ctypes
        ctypes.windll.kernel32.SetConsoleMode(
            ctypes.windll.kernel32.GetStdHandle(-11), 7)
        return True
    except Exception:
        return False

USE_COLOR = _enable_win_ansi() if IS_WIN else (
    hasattr(sys.stdout, "isatty") and sys.stdout.isatty()
)

def _c(t, code): return f"\033[{code}m{t}\033[0m" if USE_COLOR else t
def orange(t): return _c(t, "38;5;214")
def cyan(t):   return _c(t, "38;5;51")
def yellow(t): return _c(t, "38;5;226")
def green(t):  return _c(t, "38;5;84")
def dim(t):    return _c(t, "2")
def bold(t):   return _c(t, "1")
def red(t):    return _c(t, "38;5;203")

HIDE_C = "\033[?25l" if USE_COLOR else ""
SHOW_C = "\033[?25h" if USE_COLOR else ""

def _goto(row: int, col: int = 1) -> str:
    return f"\033[{row};{col}H" if USE_COLOR else ""

def _erase_line() -> str:
    return "\033[2K" if USE_COLOR else ""

def _clear_screen_and_scrollback() -> str:
    """
    \\033[3J  erase scrollback buffer  (Windows Terminal, xterm, iTerm2)
    \\033[2J  erase visible screen
    \\033[H   cursor to top-left
    """
    return "\033[3J\033[2J\033[H" if USE_COLOR else ""

# ─── Animation ────────────────────────────────────────────────────────────────
# Braille spinner on POSIX; ASCII fallback on Windows
SPINNER_FRAMES = ["|", "/", "-", "\\"] if IS_WIN else \
                 ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]

ANALYSIS_STAGES = [
    ('scan',     'Scan source files'),
    ('detect',   'Detect project type'),
    ('analysis', 'Analyze source files'),
    ('node',     'Build nodes and indexes'),
    ('edge',     'Resolve dependencies and calls'),
    ('finalize', 'Finalize output'),
    ('report',   'Generate AI report'),
]
ANALYSIS_STAGE_INDEX = {k: i for i, (k, _) in enumerate(ANALYSIS_STAGES)}

FPS        = 30           # animation frame rate
POLL_EVERY = 5            # HTTP poll every N frames  →  ~6 Hz
FRAME_SEC  = 1.0 / FPS   # 0.0333 s per frame

# ─── Fixed header row map (1-indexed terminal rows) ──────────────────────────
# Row  1 : blank
# Row  2 : banner[0]   ─┐
# Row  3 : banner[1]    │
# Row  4 : banner[2]    │  printed once, never touched again
# Row  5 : banner[3]    │
# Row  6 : banner[4]    │
# Row  7 : banner[5]   ─┘
# Row  8 : subtitle
# Row  9 : blank
# Row 10 : server badge  ← only dynamic row in header
# Row 11 : blank
# Row 12+: CONTENT ZONE  ← all screens live here
BADGE_ROW     = 10
CONTENT_START = 12

# ─── Keypress ─────────────────────────────────────────────────────────────────
if IS_WIN:
    import msvcrt
    def _getch() -> str:
        ch = msvcrt.getwch()
        if ch in ('\x00', '\xe0'):
            return {'H':'UP','P':'DOWN','M':'RIGHT','K':'LEFT'}.get(msvcrt.getwch(),'OTHER')
        if ch == '\r':   return 'ENTER'
        if ch == '\x03': raise KeyboardInterrupt
        if ch == '\x1b': return 'ESC'
        return ch
else:
    import tty, termios
    def _getch() -> str:
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setraw(fd)
            ch = sys.stdin.read(1)
            if ch == '\x1b':
                rest = sys.stdin.read(2)
                return {'[A':'UP','[B':'DOWN','[C':'RIGHT','[D':'LEFT'}.get(rest,'ESC')
            if ch in ('\r','\n'): return 'ENTER'
            if ch == '\x03':      raise KeyboardInterrupt
            return ch
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)

# ─── Banner ───────────────────────────────────────────────────────────────────
BANNER_LINES = [
    r" ██╗   ██╗██╗███████╗ ██████╗ ██████╗ ██████╗ ███████╗",
    r" ██║   ██║██║╚══███╔╝██╔════╝██╔═══██╗██╔══██╗██╔════╝",
    r" ██║   ██║██║  ███╔╝ ██║     ██║   ██║██║  ██║█████╗  ",
    r" ╚██╗ ██╔╝██║ ███╔╝  ██║     ██║   ██║██║  ██║██╔══╝  ",
    r"  ╚████╔╝ ██║███████╗╚██████╗╚██████╔╝██████╔╝███████╗",
    r"   ╚═══╝  ╚═╝╚══════╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝",
]

# ─── Utilities ────────────────────────────────────────────────────────────────
def _fmt(v) -> str:
    try:   return f"{int(v):,}"
    except: return "0"

def _progress_bar(pct: int, width: int = 36) -> str:
    pct    = max(0, min(100, int(pct or 0)))
    filled = int(width * pct / 100)
    bar    = orange("█" * filled) + dim("░" * (width - filled))
    return f"[{bar}] {pct:>3}%"

# ═══════════════════════════════════════════════════════════════════════════════
# TUI — single global renderer
# ═══════════════════════════════════════════════════════════════════════════════
class TUI:
    """
    Fixed-header TUI.
      startup()      one-time: clear scrollback + draw header
      show_menu()    draw menu in content zone
      show_analysis()  draw analysis skeleton in content zone
      show_text()    draw arbitrary lines in content zone
      upd_*()        overwrite individual dynamic rows in-place
      flush()        park cursor + flush stdout
    """

    def __init__(self):
        self._bottom: int        = CONTENT_START
        self._named:  Dict[str, int] = {}
        self._irows:  Dict[int, int] = {}
        self._mitems: List[str]      = []

    # ── primitives ─────────────────────────────────────────────────────────

    def _w(self, *parts):
        sys.stdout.write("".join(str(p) for p in parts))

    def _at(self, row: int, text: str):
        self._w(_goto(row), _erase_line(), text)

    def flush(self):
        self._w(_goto(self._bottom))
        sys.stdout.flush()

    # ── one-time startup ───────────────────────────────────────────────────

    def startup(self):
        """Clear screen + scrollback, draw fixed header. Called once."""
        self._w(
            _clear_screen_and_scrollback(),
            HIDE_C,
            "\n",                                           # row 1
        )
        for line in BANNER_LINES:
            self._w(orange(line), "\n")                    # rows 2-7
        self._w(
            dim(f"  Universal Code Visualizer  v4.0  |  {BASE_URL}"), "\n",  # row 8
            "\n",                                           # row 9
            f"  {dim('○')} Server not started\n",          # row 10 badge
            "\n",                                           # row 11
        )
        sys.stdout.flush()

    # ── server badge (header row 10, always visible) ───────────────────────

    def update_badge(self, state: str):
        """state: 'none' | 'starting' | 'ready'"""
        if state == 'ready':
            t = f"  {green('●')} Server running  {dim(BASE_URL)}"
        elif state == 'starting':
            t = f"  {yellow('◌')} Starting server…  {dim(BASE_URL)}"
        else:
            t = f"  {dim('○')} Server not started"
        self._at(BADGE_ROW, t)

    # ── content zone helpers ───────────────────────────────────────────────

    def _clear_zone(self):
        for r in range(CONTENT_START, self._bottom + 3):
            self._w(_goto(r), _erase_line())
        self._named.clear()
        self._irows.clear()

    def _reg(self, key: str, row: int, text: str):
        self._named[key] = row
        self._at(row, text)

    def _set(self, key: str, text: str):
        r = self._named.get(key)
        if r is not None:
            self._at(r, text)

    # ══════════════════════════════════════════════════════════════════════
    # MENU SCREEN
    # ══════════════════════════════════════════════════════════════════════

    def show_menu(self, title: str, items: List[str], hint: str, sel: int):
        self._clear_zone()
        self._mitems = items
        r = CONTENT_START
        self._at(r, f"  {bold(title)}");  r += 1
        self._at(r, f"  {dim(hint)}");    r += 1
        self._at(r, "");                   r += 1
        for i, label in enumerate(items):
            self._irows[i] = r
            self._at(r, self._item_txt(i, i == sel))
            r += 1
        self._at(r, ""); r += 1
        self._bottom = r
        self.flush()

    def _item_txt(self, idx: int, sel: bool) -> str:
        label = self._mitems[idx]
        if label.startswith("-"):   return f"  {dim(label)}"
        if sel: return f"  {orange('▶')} {orange(bold(label))}"
        return f"    {label}"

    def move_menu(self, old: int, new: int):
        """Repaint only the two changed rows — no zone clear."""
        self._at(self._irows[old], self._item_txt(old, False))
        self._at(self._irows[new], self._item_txt(new, True))
        self.flush()

    # ══════════════════════════════════════════════════════════════════════
    # ANALYSIS SCREEN
    # ══════════════════════════════════════════════════════════════════════

    def show_analysis(self, path: str, skip_report: bool = True):
        self._clear_zone()
        r = CONTENT_START
        self._reg('title',        r, f"  {cyan(SPINNER_FRAMES[0])} {bold('Initializing…')}"); r += 1
        short = path if len(path) <= 72 else "…" + path[-70:]
        self._at(r, f"  {dim(short)}");           r += 1   # static path
        self._at(r, "");                           r += 1
        self._reg('progress',     r, f"  {_progress_bar(0)}  {dim('Waiting…')}"); r += 1
        self._reg('msg',          r, f"  {dim('Queued…')}"); r += 1
        self._reg('project_type', r, f"  Project Type: {dim('Detecting…')}"); r += 1
        self._at(r, "");                           r += 1
        self._at(r, f"  {bold('Stages')}");        r += 1
        for i, (stage_key, label) in enumerate(ANALYSIS_STAGES):
            if skip_report and stage_key == 'report':
                self._named[f'stage_{i}'] = None  # mark as hidden
                continue
            self._reg(f'stage_{i}', r, f"  {dim('○')} {dim(label)}"); r += 1
        self._at(r, "");                           r += 1
        self._reg('error', r, "");                 r += 1
        self._bottom = r
        self.flush()

    def upd_title(self, fi: int, label: str, done=False, error=False):
        f    = SPINNER_FRAMES[fi % len(SPINNER_FRAMES)]
        lead = green('✓') if done else red('✗') if error else cyan(f)
        self._set('title', f"  {lead} {bold(label)}")

    def upd_progress(self, pct: int, stage_label: str):
        self._set('progress', f"  {_progress_bar(pct)}  {bold(stage_label)}")

    def upd_phase_info(self, vphase: str, virt_scan: int, project_total: int,
                       virt_analyzed: int, source_total: int,
                       virt_nodes: int, virt_edges: int):
        """Visual-phase-aware info row (vphase is independent of backend stage).

        'scan'  →  SCAN  247 / 1,000
        'index' →  247 / 1,000  source files indexed
        'build' →  Building graph…  1,234 nodes  |  5,678 edges
        """
        if vphase == 'scan':
            if project_total:
                t = (f"  {cyan('SCAN')}  "
                     f"{cyan(_fmt(virt_scan))} {dim('/')} {dim(_fmt(project_total))}")
            else:
                t = f"  {cyan('SCAN')}  {cyan(_fmt(virt_scan))} {dim('files discovered…')}"
        elif vphase == 'index':
            denom = source_total or project_total
            if denom:
                t = (f"  {cyan(_fmt(virt_analyzed))} {dim('/')} {dim(_fmt(denom))}"
                     f"  {dim('source files indexed')}")
            else:
                t = f"  {dim('Indexing…')}  {cyan(_fmt(virt_analyzed))} {dim('files')}"
        else:  # build
            parts = []
            if virt_nodes:
                parts.append(f"{cyan(_fmt(virt_nodes))} {dim('nodes')}")
            if virt_edges:
                parts.append(f"{cyan(_fmt(virt_edges))} {dim('edges')}")
            if parts:
                t = f"  {dim('Building graph…')}  " + f"  {dim('|')}  ".join(parts)
            else:
                t = f"  {dim('Finalizing…')}"
        self._set('msg', t)

    def upd_project_type(self, project: dict):
        if project and project.get('name'):
            t = f"  Project Type: {project.get('emoji','')} {bold(project.get('name',''))}"
        else:
            t = f"  Project Type: {dim('Detecting…')}"
        self._set('project_type', t)

    def upd_stages(self, cur: int, done: bool, error: bool, fi: int, skip_report=True):
        f = SPINNER_FRAMES[fi % len(SPINNER_FRAMES)]
        for i, (stage_key, label) in enumerate(ANALYSIS_STAGES):
            # Completely hide report stage if skip_report=True
            if skip_report and stage_key == 'report':
                continue  # Skip rendering this stage entirely
            elif done or i < cur:      
                marker, text = green('✓'), label
            elif i == cur:           
                marker = red('✗') if error else cyan(f); text = bold(label)
            else:                    
                marker, text = dim('○'), dim(label)
            self._set(f'stage_{i}', f"  {marker} {text}")

    def upd_error(self, err: Optional[str]):
        self._set('error', f"  {red('✗')} {red(str(err)[:100])}" if err else "")

    # ══════════════════════════════════════════════════════════════════════
    # GENERIC TEXT SCREEN  (help / inline messages)
    # ══════════════════════════════════════════════════════════════════════

    def show_text(self, lines: List[str]):
        self._clear_zone()
        r = CONTENT_START
        for line in lines:
            self._at(r, line); r += 1
        self._at(r, ""); r += 1
        self._bottom = r
        self.flush()

    # ── restore cursor after TUI session ──────────────────────────────────

    def restore(self):
        self._w(_goto(self._bottom), SHOW_C)
        sys.stdout.flush()


# ─── module-level TUI singleton ───────────────────────────────────────────────
_tui = TUI()

# ─── Server ───────────────────────────────────────────────────────────────────
_server_proc = None

def _probe_server(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1.0) as r:
            body = r.read(4096).decode("utf-8", errors="replace")
        return any(k in body for k in ("VIZCODE", "launcher-app", "Universal Code Visualizer"))
    except Exception:
        return False

def _port_free(port: int) -> bool:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:    s.bind(("127.0.0.1", port)); return True
        finally: s.close()
    except OSError: return False

def _select_port() -> int:
    global PORT, BASE_URL
    for c in range(DEFAULT_PORT, DEFAULT_PORT + 100):
        if _probe_server(c) or _port_free(c):
            PORT = c; BASE_URL = f"http://localhost:{c}"; return c
    raise RuntimeError(f"No available port in range {DEFAULT_PORT}–{DEFAULT_PORT+99}.")

def is_server_running() -> bool:
    return _probe_server(PORT)

def _summarize_server_start_failure(details: str) -> str:
    text = (details or "").strip()
    if not text:
        return ""

    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    if not lines:
        return ""

    filtered: List[str] = []
    last_is_traceback = False
    for line in lines:
        if line == "Traceback (most recent call last):":
            if last_is_traceback:
                continue
            last_is_traceback = True
        else:
            last_is_traceback = False
        filtered.append(line)

    joined = "\n".join(filtered)
    marker = "VIZCODE server could not import Python's stdlib module 'http.server'."
    if marker in joined:
        return (
            "The selected Python runtime cannot load stdlib module 'http.server'.\n"
            "Check that VizCode is using a normal Python 3 installation and that no local file shadows stdlib modules.\n"
            + "\n".join(filtered[-4:])
        )

    if "requires Python 3.6 or newer" in joined:
        return "\n".join(filtered[-2:])

    if "could not bind to 127.0.0.1:" in joined:
        return "\n".join(filtered[-2:])

    return "\n".join(filtered[-8:])

def start_server(tui: TUI):
    global _server_proc
    port = _select_port()
    if is_server_running():
        tui.update_badge('ready'); tui.flush(); return

    try: SERVER_LOG.write_text("", encoding="utf-8")
    except: pass
    log_fp = open(str(SERVER_LOG), "a", encoding="utf-8", errors="replace")

    def _close():
        try: log_fp.flush(); log_fp.close()
        except: pass

    kw: dict = dict(cwd=str(ROOT_DIR), stdout=log_fp, stderr=log_fp)
    if IS_WIN:
        cnw = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        if cnw: kw["creationflags"] = cnw
    _server_proc = subprocess.Popen([sys.executable, str(SERVER_PY), str(port)], **kw)

    tui.update_badge('starting')
    for attempt in range(60):
        tui.upd_title(attempt, "Starting server…")
        tui.flush()
        if is_server_running():
            _close(); tui.update_badge('ready'); tui.flush(); return
        if _server_proc.poll() is not None: break
        time.sleep(0.1)

    _close()
    if not is_server_running():
        details = ""
        try:    details = SERVER_LOG.read_text(encoding="utf-8", errors="replace").strip()
        except: pass
        summary = _summarize_server_start_failure(details)
        raise RuntimeError(
            f"Server failed to start on port {port}."
            + (("\n" + summary) if summary else "")
        )

def stop_server():
    global _server_proc
    if _server_proc:
        _server_proc.terminate()
        try: _server_proc.wait(timeout=3)
        except: pass
        _server_proc = None

def _kill_port(port: int) -> bool:
    """Kill whichever process is listening on *port* (cross-platform best-effort)."""
    try:
        import subprocess as _sp
        if IS_WIN:
            r = _sp.run(['netstat', '-ano'], capture_output=True, text=True, timeout=5)
            import re as _re
            for line in r.stdout.splitlines():
                m = _re.search(rf'[:\s]{port}\s.*LISTENING\s+(\d+)', line)
                if m:
                    _sp.run(['taskkill', '/F', '/PID', m.group(1)],
                            capture_output=True, timeout=5)
                    return True
        else:
            r = _sp.run(['lsof', '-ti', f'TCP:{port}'], capture_output=True, text=True, timeout=5)
            for pid in r.stdout.split():
                _sp.run(['kill', '-9', pid.strip()], capture_output=True, timeout=5)
            return bool(r.stdout.strip())
    except Exception:
        pass
    return False

def restart_server(tui: TUI):
    global _server_proc
    # 1. Stop our own child process if we have one
    stop_server()
    # 2. Kill any external process still holding the port
    _kill_port(PORT)
    # 3. Wait until port is free (up to 3 s)
    for _ in range(30):
        if _port_free(PORT): break
        time.sleep(0.1)
    # 4. Start fresh
    start_server(tui)

# ─── Analysis ─────────────────────────────────────────────────────────────────
def trigger_analysis(path: str, generate_report: bool = False) -> Optional[str]:
    try:
        payload = json.dumps({"path": path, "generate_report": generate_report}).encode()
        req = urllib.request.Request(
            f"{BASE_URL}/analyze", data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())["job_id"]
    except Exception:
        return None

def trigger_git(url: str) -> Optional[str]:
    try:
        payload = json.dumps({"url": url}).encode()
        req = urllib.request.Request(
            f"{BASE_URL}/analyze-git", data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())["job_id"]
    except Exception:
        return None

def trigger_zip(filepath: str) -> Optional[str]:
    try:
        data = Path(filepath).read_bytes()
        req = urllib.request.Request(
            f"{BASE_URL}/upload-zip", data=data,
            headers={"Content-Type": "application/octet-stream"},
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())["job_id"]
    except Exception:
        return None

def trigger_npm(package: str) -> Optional[str]:
    try:
        payload = json.dumps({"package": package}).encode()
        req = urllib.request.Request(
            f"{BASE_URL}/analyze-npm", data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())["job_id"]
    except Exception:
        return None

def poll_job(job_id: str) -> dict:
    try:
        with urllib.request.urlopen(
                f"{BASE_URL}/progress?job={job_id}", timeout=5) as r:
            return json.loads(r.read())
    except: return {}

def _run_analysis(label: str, trigger_fn, save_fn=None, skip_report_stage=True):
    """Shared core: start server → call trigger_fn() → run animation loop."""
    tui = _tui
    tui.show_analysis(label, skip_report=skip_report_stage)

    try:
        start_server(tui)
    except Exception as e:
        tui.upd_error(str(e)); tui.restore()
        r = tui._bottom + 1
        tui._at(r, red(f"  ✗ {e}"))
        tui._bottom = r
        tui.flush()
        return

    # Start job in background so the spinner keeps running while the server
    # registers the job (non-blocking).
    job_id_holder = [None]
    job_ready = __import__("threading").Event()

    def _kick_job():
        job_id_holder[0] = trigger_fn()
        job_ready.set()

    __import__("threading").Thread(target=_kick_job, daemon=True).start()

    frame_idx = 0
    tui.upd_title(frame_idx, "Analyzing Project"); tui.flush()
    while not job_ready.is_set():
        frame_idx += 1
        tui.upd_title(frame_idx, "Analyzing Project")
        tui.flush()
        time.sleep(1.0 / FPS)

    job_id = job_id_holder[0]

    if not job_id:
        tui.upd_error("Failed to start analysis job."); tui.restore(); return
    if save_fn:
        save_fn()

    _run_progress_loop(job_id, skip_report_stage=skip_report_stage)

def run_analysis_with_progress(path: str, generate_report=False):
    _run_analysis(path, trigger_fn=lambda: trigger_analysis(path, generate_report=generate_report),
                  save_fn=lambda: save_history(path),
                  skip_report_stage=not generate_report)

def _run_progress_loop(job_id: str, skip_report_stage=True):
    """Animation + polling loop for any in-progress job."""
    tui = _tui

    job: dict = {
        'pct': 0, 'msg': 'Queued…', 'done': False, 'error': None,
        'stage': 'scan', 'stage_label': 'Scan source files',
        'project_type': None, 'total_files': 0, 'analyzed_files': 0,
        'project_total_files': 0, 'project_processed_files': 0,
        'source_files_total': 0,
        'module_count': 0, 'function_count': 0, 'node_count': 0,
        'file_edge_count': 0, 'func_edge_count': 0, 'edge_count': 0,
        'other_files': 0,
    }

    frame_idx   = 0
    stage_floor = 0  # always start from stage 0 (scan)

    # Background poll thread
    # HTTP poll runs in a daemon thread so the 30-fps loop is never blocked.
    _poll_lock    = __import__("threading").Lock()
    _latest_poll  = {}
    _poll_stop    = __import__("threading").Event()

    def _poll_worker():
        while not _poll_stop.is_set():
            result = poll_job(job_id)
            if result:
                with _poll_lock:
                    _latest_poll.update(result)
            for _ in range(17):          # ~6 Hz, short sleeps stay responsive
                if _poll_stop.is_set(): return
                time.sleep(0.01)

    import threading as _th
    _poll_thread = _th.Thread(target=_poll_worker, daemon=True)
    _poll_thread.start()

    # ── Time-based progress bar ───────────────────────────────────────────────
    # Ticks 1 %/s (100 s baseline). When done=True, ease-out cubic toward 100 %
    # over ~1.2 s so the bar glides in rather than snapping.
    analysis_start_t: float = time.monotonic()
    done_signal_t:    float = 0.0   # set once when done=True first seen
    virt_pct:         float = 0.0

    # ── Visual phase constants ─────────────────────────────────────────────────
    # Progress bar allocation (both modes):
    #   SCAN  0 →  5 %  (time-based, fast)
    #   INDEX 5 → 89 %  (counter-driven: virt_analyzed / source_total)
    #   BUILD 89 → 99 % (time-based)  [→ 90-100% reserved for report if enabled]
    # When report is disabled the backend reaches 100% directly so the ease-out
    # animation fills the last percent smoothly either way.
    REPORT_END_PCT = 0.0
    SCAN_END_PCT  = 5.0
    INDEX_END_PCT = 89.0
    BUILD_END_PCT = 99.0

    SCAN_MIN_S  = 1.5     # minimum visual time for SCAN phase
    INDEX_MIN_S = 2.0     # minimum visual time for INDEX phase
    BUILD_MIN_S = 2.0     # minimum visual time for BUILD phase
    SCAN_FLOOR_PCT = SCAN_END_PCT  # bar must reach SCAN_END_PCT before phase exits

    # Dynamic phase durations.
    # scan_phase_s: fixed at SCAN_MIN_S (backend scan is near-instant).
    # index_phase_s: estimated from first-batch timing — updated once we see
    #   real_analyzed > 0 and know source_total, so velocity stays realistic.
    scan_phase_s:    float = SCAN_MIN_S
    index_phase_s:   float = INDEX_MIN_S
    index_start_t:   float = 0.0   # monotonic time when INDEX phase began
    index_timed:     bool  = False  # True once we've calibrated from first batch

    vphase:         str   = 'scan'
    vphase_entered: float = time.monotonic()

    # ── Animated counters (all floats → smooth sub-integer ticks) ────────────
    virt_scan:          float = 0.0   # SCAN phase: file discovery counter
    real_project_total: int   = 0

    virt_analyzed:   float = 0.0  # INDEX phase: smooth time-driven counter
    real_analyzed:   int   = 0    # last batch value from backend
    real_source_total: int = 0    # source files only (denominator for INDEX ratio)
    # INDEX velocity: files/frame — set once source total is known, then constant.
    # Drives virt_analyzed at uniform speed; backend batches act as ceiling only.
    index_vel:       float = 0.0  # files per frame (computed from source_total)

    virt_nodes:     float = 0.0   # BUILD phase: node count
    virt_edges:     float = 0.0   # BUILD phase: edge count

    while True:
        # Consume latest poll (non-blocking lock snapshot)
        with _poll_lock:
            if _latest_poll:
                job.update(_latest_poll)
                _latest_poll.clear()

        now   = time.monotonic()
        done  = bool(job.get('done')) and not job.get('error')
        error = job.get('error')
        cur_backend_stage  = job.get('stage') or 'scan'
        backend_stage_idx  = ANALYSIS_STAGE_INDEX.get(cur_backend_stage, 0)
        vphase_elapsed     = now - vphase_entered   # needed by progress bar + phase gate

        # ── Progress bar ────────────────────────────────────────────────────────
        # SCAN  :  0 →  5 %  (time-based, fast)
        # INDEX :  5 → 89 %  (counter-driven: virt_analyzed / source_total)
        # BUILD : 89 → 99 %  (time-based)
        # REPORT: 90 → 99 %  (backend-driven, when generate_report=True)
        # Done  :    → 100 % (cubic ease-out)
        if error:
            virt_pct = float(max(0, min(100, int(job.get('pct', 0) or 0))))
        elif done:
            if not done_signal_t:
                done_signal_t = now
            ease_elapsed = now - done_signal_t
            t_norm   = min(ease_elapsed / 2.0, 1.0)
            ease_fac = 1.0 - (1.0 - t_norm) ** 3
            target   = virt_pct + (100.0 - virt_pct) * ease_fac * 0.14
            virt_pct = virt_pct + min(target - virt_pct, 2.0)
            if virt_pct >= 99.8:
                virt_pct = 100.0
        elif cur_backend_stage == 'report':
            # Report phase: follow backend pct directly (already scaled to 90-99)
            backend_pct = float(max(0, min(99, int(job.get('pct', 90) or 90))))
            if backend_pct > virt_pct:
                virt_pct = backend_pct
        else:
            if vphase == 'scan':
                scan_frac  = min(vphase_elapsed / scan_phase_s, 1.0)
                target_pct = REPORT_END_PCT + scan_frac * (SCAN_END_PCT - REPORT_END_PCT)
            elif vphase == 'index':
                denom = real_source_total or real_project_total
                if denom > 0:
                    ratio = min(virt_analyzed / denom, 1.0)
                else:
                    ratio = min(vphase_elapsed / index_phase_s, 1.0)
                target_pct = SCAN_END_PCT + ratio * (INDEX_END_PCT - SCAN_END_PCT)
            else:  # build
                build_frac = min(vphase_elapsed / BUILD_MIN_S, 1.0)
                target_pct = INDEX_END_PCT + build_frac * (BUILD_END_PCT - INDEX_END_PCT)
            # Bar only moves forward; ≤ 1.5 %/frame
            delta    = max(target_pct - virt_pct, 0.0)
            virt_pct = virt_pct + min(delta, 1.5)

        # ── Advance visual phase ──────────────────────────────────────────────
        min_scan  = 0.5 if done else scan_phase_s
        min_index = 0.5 if done else index_phase_s

        if vphase == 'scan':
            backend_at_analysis = backend_stage_idx >= ANALYSIS_STAGE_INDEX.get('analysis', 2)
            if vphase_elapsed >= min_scan and (backend_at_analysis or done) \
                    and virt_pct >= SCAN_FLOOR_PCT:
                vphase = 'index'
                vphase_entered = now
                index_start_t  = now
        elif vphase == 'index':
            backend_at_node = backend_stage_idx >= ANALYSIS_STAGE_INDEX.get('node', 3)
            # If backend has surged past analysis (e.g. parallel parsing finished
            # in a burst), don't wait the full calibrated min_index — otherwise
            # the bar lags while stages already say "Finalize output".
            backend_far_ahead = backend_stage_idx >= ANALYSIS_STAGE_INDEX.get('edge', 4)
            if (backend_at_node or done) and (vphase_elapsed >= min_index or backend_far_ahead):
                vphase = 'build'
                vphase_entered = now
        # 'build' stays until the loop exits

        # ── SCAN counter ──────────────────────────────────────────────────────
        # Paced evenly across the full phase window so the counter always moves.
        # After the real total is reached the counter keeps ticking at 12 % of
        # its normal rate ("fake momentum") so numbers never freeze mid-phase.
        # Display is capped at real_project_total so "523 / 500" never appears.
        new_pt = int(job.get('project_total_files') or 0)
        if new_pt > real_project_total:
            real_project_total = new_pt

        if vphase == 'scan':
            if real_project_total > 0:
                phase_frames   = max(1.0, scan_phase_s * FPS)
                step_per_frame = max(real_project_total / phase_frames, 1.0)
                if virt_scan < real_project_total:
                    virt_scan = min(virt_scan + step_per_frame, float(real_project_total))
                else:
                    # Fake momentum: keep ticking slowly after plateau
                    virt_scan += step_per_frame * 0.12
            else:
                virt_scan += 1.0      # total not yet known — rising discovery counter
        elif real_project_total > 0 and virt_scan < real_project_total:
            # Past scan phase — quick catch-up
            frames_left = max(1.0, 0.25 * FPS)
            virt_scan = min(
                virt_scan + max((real_project_total - virt_scan) / frames_left, 1.0),
                float(real_project_total),
            )

        # ── INDEX counter: uniform-velocity, calibrated from first batch ─────────
        # index_vel (files/frame) is set once we know source_total AND see the
        # first batch arrive. At that point we know: N files took T seconds,
        # so total_time ≈ source_total / N * T → velocity = source_total / total_frames.
        # After calibration the counter runs at constant speed; backend batches
        # act only as a ceiling (virt_analyzed ≤ real_analyzed + 1 batch)
        # to prevent the visual counter from running ahead of confirmed work.
        new_analyzed = int(
            job.get('project_processed_files') or job.get('analyzed_files') or 0)
        if new_analyzed > real_analyzed:
            real_analyzed = new_analyzed

        new_src_total = int(job.get('source_files_total') or job.get('total_files') or 0)
        if new_src_total > real_source_total:
            real_source_total = new_src_total

        # Calibrate velocity once: first batch arrived + index phase already started.
        if (not index_timed and real_analyzed > 0 and real_source_total > 0
                and index_start_t > 0):
            elapsed_so_far = max(now - index_start_t, 0.1)
            # Extrapolate: if real_analyzed files took elapsed_so_far seconds,
            # total will take source_total / real_analyzed * elapsed_so_far.
            estimated_total_s = (real_source_total / real_analyzed) * elapsed_so_far
            index_phase_s  = max(INDEX_MIN_S, estimated_total_s)
            index_vel      = real_source_total / (index_phase_s * FPS)
            index_timed    = True

        if done:
            virt_analyzed = float(real_source_total or real_analyzed or 1)
        elif vphase == 'index':
            if index_vel > 0:
                # Uniform advance; ceiling = real_analyzed + one batch ahead.
                batch_size    = max(20.0, real_source_total * 0.02)
                ceiling       = float(min(real_analyzed + batch_size,
                                          real_source_total or real_analyzed or 1))
                virt_analyzed = min(virt_analyzed + index_vel, ceiling)
            elif real_analyzed > virt_analyzed:
                # Not yet calibrated — follow batches directly.
                virt_analyzed = float(real_analyzed)

        # ── BUILD counters: even spread + fake momentum ───────────────────────
        # Paced across the full build phase window (same principle as SCAN).
        # After reaching real values the counter keeps ticking slowly so the
        # display never freezes while the phase is still active.
        r_nodes = int(job.get('node_count') or 0)
        r_edges = int(
            (job.get('file_edge_count') or 0) + (job.get('func_edge_count') or 0)
            or job.get('edge_count') or 0
        )

        build_phase_frames = max(1.0, BUILD_MIN_S * FPS)

        if r_nodes > 0:
            step_n = max(r_nodes / build_phase_frames, 1.0)
            if virt_nodes < r_nodes:
                virt_nodes = min(virt_nodes + step_n, float(r_nodes))
            elif vphase == 'build' and not done:
                virt_nodes += step_n * 0.08               # fake momentum
        elif done:
            virt_nodes = float(r_nodes)

        if r_edges > 0:
            step_e = max(r_edges / build_phase_frames, 1.0)
            if virt_edges < r_edges:
                virt_edges = min(virt_edges + step_e, float(r_edges))
            elif vphase == 'build' and not done:
                virt_edges += step_e * 0.08               # fake momentum
        elif done:
            virt_edges = float(r_edges)

        # ── Resolve stage label for progress bar ──────────────────────────────
        stage_floor = max(stage_floor, backend_stage_idx)
        raw_idx     = backend_stage_idx
        current_idx = min(max(stage_floor, raw_idx), len(ANALYSIS_STAGES) - 1)
        _, default_label = ANALYSIS_STAGES[current_idx]
        stage_label = (
            job.get('stage_label')
            if raw_idx == current_idx and job.get('stage_label')
            else default_label
        )

        # ── Batch render ──────────────────────────────────────────────────────
        if cur_backend_stage == 'report':
            title_label = "Generating AI Report"
        else:
            title_label = "Analyzing Project"
        tui.upd_title(frame_idx, title_label, done=done, error=bool(error))
        tui.upd_progress(int(round(virt_pct)), stage_label)
        tui.upd_phase_info(
            vphase        = vphase,
            virt_scan     = min(int(virt_scan), real_project_total) if real_project_total else int(virt_scan),
            project_total = real_project_total,
            virt_analyzed = int(virt_analyzed),
            source_total  = real_source_total,
            virt_nodes    = int(virt_nodes),
            virt_edges    = int(virt_edges),
        )
        tui.upd_project_type(job.get('project_type') or {})
        tui.upd_stages(current_idx, done, bool(error), frame_idx, skip_report=skip_report_stage)
        tui.upd_error(error)
        tui.flush()

        # Keep looping after done until the ease-out animation finishes
        if error or (done and virt_pct >= 100.0):
            break

        frame_idx += 1
        time.sleep(FRAME_SEC)   # 30 fps, never blocked by network

    _poll_stop.set()
    _poll_thread.join(timeout=1.0)

    tui.restore()

    if not job.get('error'):
        result_url = f"{BASE_URL}/result?job={job_id}"
        r = tui._bottom + 1
        tui._at(r, f"  {green('✓')} Done!  Opening browser…"); r += 1
        tui._at(r, f"  {dim(result_url)}"); r += 1
        tui._bottom = r
        tui.flush()
        time.sleep(0.4)
        webbrowser.open(result_url)

# ─── History ─────────────────────────────────────────────────────────────────
def load_history() -> List[str]:
    try:    return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))[:8]
    except: return []

def save_history(path: str):
    hist = load_history()
    path = str(Path(path).resolve())
    if path in hist: hist.remove(path)
    hist.insert(0, path)
    try: HISTORY_FILE.write_text(json.dumps(hist[:8]), encoding="utf-8")
    except: pass

# ─── Menu & screens ───────────────────────────────────────────────────────────

def run_menu(title: str, items: List[str],
             hint: str = "↑↓ move   Enter select   Esc quit") -> Optional[int]:
    tui = _tui
    sel = 0
    n   = len(items)
    while items[sel].startswith("-"): sel = (sel + 1) % n

    tui.update_badge('ready' if is_server_running() else 'none')
    tui.show_menu(title, items, hint, sel)

    try:
        while True:
            key = _getch()
            if key == 'UP':
                prev = sel; sel = (sel - 1) % n
                while items[sel].startswith("-"): sel = (sel - 1) % n
                tui.move_menu(prev, sel)
            elif key == 'DOWN':
                prev = sel; sel = (sel + 1) % n
                while items[sel].startswith("-"): sel = (sel + 1) % n
                tui.move_menu(prev, sel)
            elif key == 'ENTER': return sel
            elif key in ('ESC', 'q', 'Q'): return None
    except KeyboardInterrupt:
        return None

def prompt_path(msg: str) -> str:
    r = _tui._bottom + 1
    _tui._at(r, f"  {cyan('❯')} {bold(msg)}")
    r += 1
    _tui._at(r, "  → ")
    _tui._bottom = r
    _tui._w(_goto(r, 6), SHOW_C)
    sys.stdout.flush()
    try:    return input().strip().strip('"\'')
    except: return ""

# ─── Actions ─────────────────────────────────────────────────────────────────


def ask_generate_report() -> Optional[bool]:
    """Ask user if they want to generate AI report (vizcode_report.md).
    Returns: True (yes), False (no), None (back).
    """
    items = [
        "✓  Yes  (recommended for AI analysis)",
        "✗  No   (faster, visualization only)",
        "-" * 40,
        "<- Back",
    ]
    
    _tui.update_badge('ready' if is_server_running() else 'none')
    _tui._clear_zone()
    r = CONTENT_START
    
    # Title and description
    _tui._at(r, f"  {bold('Generate AI Report?')}"); r += 1
    _tui._at(r, f"  {dim('Creates .vizcode/vizcode_report.md — a structured summary')}"); r += 1
    _tui._at(r, f"  {dim('for AI assistants (Claude, ChatGPT, etc.) to understand')}"); r += 1
    _tui._at(r, f"  {dim('↑↓ move   Enter select   Esc back')}"); r += 1
    _tui._at(r, ""); r += 1
    
    # Menu items
    sel = 0
    item_rows = {}
    for i, label in enumerate(items):
        item_rows[i] = r
        if label.startswith("-"):
            _tui._at(r, f"  {dim(label)}")
        elif i == sel:
            _tui._at(r, f"  {orange('▶')} {orange(bold(label))}")
        else:
            _tui._at(r, f"    {label}")
        r += 1
    
    _tui._at(r, ""); r += 1
    _tui._bottom = r
    _tui.flush()
    
    # Input loop
    while True:
        try:
            key = _getch()
            if key == 'UP':
                old_sel = sel
                sel = (sel - 1) % len(items)
                while items[sel].startswith("-"):
                    sel = (sel - 1) % len(items)
                # Redraw only changed items
                _tui._at(item_rows[old_sel], f"    {items[old_sel]}")
                _tui._at(item_rows[sel], f"  {orange('▶')} {orange(bold(items[sel]))}")
                _tui.flush()
            elif key == 'DOWN':
                old_sel = sel
                sel = (sel + 1) % len(items)
                while items[sel].startswith("-"):
                    sel = (sel + 1) % len(items)
                # Redraw only changed items
                _tui._at(item_rows[old_sel], f"    {items[old_sel]}")
                _tui._at(item_rows[sel], f"  {orange('▶')} {orange(bold(items[sel]))}")
                _tui.flush()
            elif key == 'ENTER':
                if sel == 0:
                    return True
                elif sel == 1:
                    return False
                elif sel == 3:
                    return None
            elif key in ('ESC', 'q', 'Q'):
                return None
        except KeyboardInterrupt:
            return None


def _generate_report_for_path(path: str) -> bool:
    """Generate vizcode_report.md for the given path. Returns True on success."""
    _tui.show_text(["", f"  {cyan('◉')} Generating AI report... (this may take a moment)"])
    _tui.flush()
    try:
        from analyze_viz import build_graph
        from analytics_helpers import generate_report as gen_report
        
        def _silent_progress(pct, msg, **kwargs):
            pass  # Silent during background scan
        
        data = build_graph(path, progress_cb=_silent_progress)
        report_path = os.path.join(path, '.vizcode', 'vizcode_report.md')
        gen_report(data, report_path)
        
        _tui.show_text(["", f"  {green('✓')} Report saved:", f"     {dim(report_path)}", ""])
        time.sleep(1.2)
        return True
    except Exception as e:
        _tui.show_text(["", f"  {red('✗')} Report generation failed:", f"     {dim(str(e))}", ""])
        time.sleep(2.0)
        return False


def _action_analyze_local():
    path = prompt_path("Enter the project folder path:")
    if not path: return
    p = Path(path).expanduser()
    if not p.is_dir():
        _tui.show_text(["", f"  {red('✗')} Not a valid directory:", f"  {dim(path)}"])
        time.sleep(1.5); return
    
            # Ask if user wants AI report
    report_choice = ask_generate_report()
    if report_choice is None:
        return  # User chose back, return to main menu
    
    run_analysis_with_progress(str(p.resolve()), generate_report=report_choice)
    _press_enter()

def _action_analyze_git():
    url = prompt_path("Enter Git repository URL (https://...):")
    if not url: return
    if not (url.startswith("https://") or url.startswith("git@") or url.startswith("ssh://")):
        _tui.show_text(["", f"  {red('✗')} URL must start with https://, git@, or ssh://"])
        time.sleep(1.5); return
    _run_analysis(url, trigger_fn=lambda: trigger_git(url))
    _press_enter()

def _action_analyze_zip():
    path = prompt_path("Enter path to ZIP file:")
    if not path: return
    p = Path(path).expanduser()
    if not p.is_file() or p.suffix.lower() != ".zip":
        _tui.show_text(["", f"  {red('✗')} Not a valid .zip file:", f"  {dim(str(p))}"])
        time.sleep(1.5); return
    _run_analysis(str(p), trigger_fn=lambda: trigger_zip(str(p.resolve())))
    _press_enter()

def _action_analyze_npm():
    pkg = prompt_path("Enter npm package name (e.g. lodash or react@18):")
    if not pkg: return
    _run_analysis(pkg, trigger_fn=lambda: trigger_npm(pkg))
    _press_enter()

def action_analyze_new():
    SOURCE_MENU = [
        (f"📂  Local Folder",  _action_analyze_local),
        (f"🔗  Git Repository", _action_analyze_git),
        (f"📦  ZIP File",       _action_analyze_zip),
        (f"⬡   npm Package",   _action_analyze_npm),
        ("-" * 30,              None),
        ("<- Back",             None),
    ]
    idx = run_menu("Analyze a Project", [label for label, _ in SOURCE_MENU],
                   "↑↓ move   Enter select   Esc back")
    if idx is None: return
    _, fn = SOURCE_MENU[idx]
    if fn is None: return
    fn()

def action_recent():
    hist = load_history()
    if not hist:
        _tui.show_text(["", f"  {dim('No recent projects yet.')}"])
        time.sleep(1.5); return
    items = hist + ["-" * 40, "<- Back"]
    idx   = run_menu("Recent Projects", items, "↑↓ move   Enter select")
    if idx is None or items[idx].startswith("-") or items[idx] == "<- Back": return
    path = items[idx]
    if not Path(path).is_dir():
        _tui.show_text(["", f"  {red('✗')} Directory no longer exists.", f"  {dim(path)}"])
        time.sleep(1.5); return
    
            # Ask if user wants AI report
    report_choice = ask_generate_report()
    if report_choice is None:
        return  # User chose back, return to main menu
    
    run_analysis_with_progress(path, generate_report=report_choice)
    _press_enter()

def action_open_browser():
    if not is_server_running():
        _tui.show_text(["", f"  {cyan('○')} Starting server…"])
        _tui.flush()
        try:
            start_server(_tui)
        except Exception as e:
            _tui.show_text(["", f"  {red('✗')} Could not start server:", f"  {dim(str(e))}"])
            time.sleep(2.5); return
    webbrowser.open(BASE_URL)

def action_help():
    _tui.update_badge('ready' if is_server_running() else 'none')
    _tui.show_text([
        "",
        f"  {bold(cyan('How to use VIZCODE'))}",
        "",
        f"  {yellow('1.')} Analyze a Project  — choose a source:",
        f"       {dim('📂 Local Folder')}   — scan a folder on disk",
        f"       {dim('🔗 Git Repository')} — clone & scan any https:// repo",
        f"       {dim('📦 ZIP File')}       — extract & scan a .zip archive",
        f"       {dim('⬡  npm Package')}   — fetch & scan from registry",
        f"  {yellow('2.')} Recent Projects     — re-run on a previously scanned project.",
        f"  {yellow('3.')} Open Browser        — start server (if needed) and open browser.",
        "",
        f"  {bold(cyan('Supported languages:'))}",
        f"    🔲 UEFI / EDK2    🐍 Python    ⚡ JS / TS    🔵 Go",
        "",
        f"  {bold(cyan('Quick start:'))}",
        f"    {dim('python vizcode.py /path/to/project')}",
        "",
        f"  {dim('Press Enter to return to menu…')}",
    ])
    while True:
        try:
            if _getch() == 'ENTER': break
        except: break

def action_restart_server():
    _tui.show_text(["", f"  {dim('Restarting server…')}"])
    try:
        restart_server(_tui)
        _tui.update_badge('ready')
        _tui.show_text(["", f"  {green('●')} Server restarted on {BASE_URL}",
                        "", f"  {dim('Press Enter to return to menu…')}"])
    except Exception as e:
        _tui.update_badge('none')
        _tui.show_text(["", f"  {red('✗')} Restart failed: {dim(str(e))}",
                        "", f"  {dim('Press Enter to return to menu…')}"])
    while True:
        try:
            if _getch() == 'ENTER': break
        except: break

def action_exit():
    r = _tui._bottom + 1
    _tui._at(r, f"  {dim('Stopping server…')}"); _tui.flush()
    stop_server()
    _tui._at(r, f"  {dim('Server stopped.')}"); r += 1
    _tui._at(r, ""); r += 1
    _tui._at(r, f"  {orange('Goodbye! 👋')}"); r += 1
    _tui._bottom = r
    _tui.restore()
    sys.stdout.write("\n")
    sys.stdout.flush()
    sys.exit(0)

def _press_enter():
    r = _tui._bottom + 2
    _tui._at(r, f"  {dim('Press Enter to return to menu…')}")
    _tui._bottom = r
    _tui.flush()
    while True:
        try:
            if _getch() == 'ENTER': break
        except: break

# ─── Main ─────────────────────────────────────────────────────────────────────
MENU = [
    ("📂  Analyze a Project", action_analyze_new),
    ("🕑  Recent Projects",   action_recent),
    ("🌐  Open Browser",      action_open_browser),
    ("🔄  Restart Server",    action_restart_server),
    ("-" * 35,                None),
    ("❓  Help",              action_help),
    ("✖   Exit",              action_exit),
]

def _parse_cli_args():
    import argparse
    parser = argparse.ArgumentParser(prog="vizcode", add_help=True)
    parser.add_argument("path", nargs="?", help="Project root directory")
    parser.add_argument(
        "--scan-only", action="store_true",
        help="AST scan only: write scan_cache.json and exit, no browser, no TUI",
    )
    parser.add_argument(
        "--chat", action="store_true",
        help="Start AI chat REPL for the given project (no browser, no TUI)",
    )
    parser.add_argument(
        "--ai", metavar="QUESTION",
        help="Ask VizCode AI one question and exit (non-interactive, no TUI/browser)",
    )
    return parser.parse_args()


# ─── Scan-only mode (called by SKILL.md) ────────────────────────────────────

def _run_scan_only(path: str) -> None:
    """Run AST scan without TUI or browser, print progress to stdout."""
    from analyze_viz import build_graph

    root = str(Path(path).resolve())
    print(f"[vizcode] Scanning {root} …")

    stats = {}

    def _progress(pct, msg, extra=None, **kwargs):
        print(f"[{pct:3d}%] {msg}")
        if extra:
            stats.update(extra)

    data = build_graph(root, progress_cb=_progress)

    modules = data.get('modules', [])
    print(
        f"[vizcode] Done — {len(modules)} modules. "
        f"scan_cache.json updated."
    )

    # C4: auto-generate hierarchical report tree
    try:
        from analytics_helpers import generate_report
        report_path = os.path.join(root, '.vizcode', 'vizcode_report.md')
        generate_report(data, report_path)
        local_dir = os.path.join(root, '.vizcode')
        print(f"[vizcode] Report tree → {local_dir}/INDEX.md  L1/  L2/  L3/")
    except Exception as _e:
        print(f"[vizcode] Report skipped: {_e}")


def main():
    args = _parse_cli_args()

    # --scan-only: bypass TUI completely, print to stdout, exit
    if args.scan_only:
        if not args.path:
            print("Error: --scan-only requires a path argument", file=sys.stderr)
            sys.exit(1)
        if not Path(args.path).is_dir():
            print(f"Error: not a directory: {args.path}", file=sys.stderr)
            sys.exit(1)
        _run_scan_only(args.path)
        return

    # --chat: terminal AI chat REPL, no TUI, no browser
    if args.chat:
        if not args.path:
            print("Error: --chat requires a path argument", file=sys.stderr)
            print("Usage: python vizcode.py <project_path> --chat", file=sys.stderr)
            sys.exit(1)
        if not Path(args.path).is_dir():
            print(f"Error: not a directory: {args.path}", file=sys.stderr)
            sys.exit(1)
        from ai.chat_cli import run_chat
        run_chat(args.path)
        return

    # --ai: one-shot AI question, print answer and exit
    if args.ai:
        if not args.path:
            print("Error: --ai requires a path argument", file=sys.stderr)
            print('Usage: python vizcode.py <project_path> --ai "QUESTION"', file=sys.stderr)
            sys.exit(1)
        if not Path(args.path).is_dir():
            print(f"Error: not a directory: {args.path}", file=sys.stderr)
            sys.exit(1)
        from ai.chat_cli import run_oneshot
        sys.exit(run_oneshot(args.path, args.ai))

    # One-time TUI init: clear scrollback + draw fixed header
    _tui.startup()

    if args.path:
        path = args.path
        if Path(path).is_dir():
            run_analysis_with_progress(str(Path(path).resolve()))
            _press_enter()
        else:
            _tui.show_text([f"  {red('✗')} Not a directory: {path}"])
            _tui.restore(); sys.exit(1)
        return

    labels = [label for label, _ in MENU]
    while True:
        idx = run_menu("What would you like to do?", labels)
        if idx is None: action_exit()
        fn = MENU[idx][1]
        if fn: fn()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        action_exit()
