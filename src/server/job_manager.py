"""
job_manager.py — VIZCODE Job Lifecycle & Viewer Tracking
Extracted from server.py: JOBS state, viewer heartbeat, analysis thread, search index.
"""

import os, sys, json, threading, time, uuid, shutil
from pathlib import Path
from typing import Dict

# ─── Path setup ──────────────────────────────────────────────────────────────
_SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
_SRC_DIR    = os.path.dirname(_SERVER_DIR)
_ROOT_DIR   = os.path.dirname(_SRC_DIR)
_CORE_DIR   = os.path.join(_SRC_DIR, 'core')
for _p in (_ROOT_DIR, _SERVER_DIR, _CORE_DIR, _SRC_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    import analyze_viz as analyze_bios
except ImportError:
    import analyze_bios  # type: ignore[no-redef]

# ─── Global job state ────────────────────────────────────────────────────────
JOBS: dict = {}
JOBS_LOCK = threading.Lock()

# ─── Viewer lifecycle constants ───────────────────────────────────────────────
VIEWER_TTL_SECONDS           = 90
VIEWER_REAP_INTERVAL_SECONDS = 5
VIEWER_CLOSE_GRACE_SECONDS   = 5

# ─── Search index constants ───────────────────────────────────────────────────
_SI_SKIP_DIRS = {
    'Build', 'build', '.git', '__pycache__', 'node_modules', '.next', 'dist',
    'out', '.venv', 'venv', '.cache', '.nyc_output', 'vendor', '.idea', '.vscode',
    'coverage', '.output', 'storybook-static', 'DEBUG', 'RELEASE',
}
_SI_BINARY_EXTS = {
    '.bin', '.rom', '.efi', '.lib', '.obj', '.exe', '.dll', '.pdb',
    '.so', '.a', '.o', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp',
    '.webp', '.tiff', '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
    '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.wav',
    '.xlsx', '.xls', '.xlsm', '.xlsb',
    '.docx', '.doc', '.docm',
    '.pptx', '.ppt', '.pptm',
}
_SI_MAX_FILE_BYTES = 2 * 1024 * 1024  # 2 MB


def _build_search_index(jid: str, root: str):
    """Background thread: read all non-binary files into memory for instant search."""
    index: Dict[str, str] = {}
    try:
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            dirnames[:] = sorted(d for d in dirnames if d not in _SI_SKIP_DIRS)
            for fname in filenames:
                ext = Path(fname).suffix.lower()
                if ext in _SI_BINARY_EXTS:
                    continue
                abs_path = os.path.join(dirpath, fname)
                rel = os.path.relpath(abs_path, root).replace('\\', '/')
                try:
                    if os.path.getsize(abs_path) > _SI_MAX_FILE_BYTES:
                        continue
                    with open(abs_path, encoding='utf-8', errors='replace') as fh:
                        index[rel] = fh.read()
                except Exception:
                    pass
    except Exception:
        pass
    with JOBS_LOCK:
        if jid in JOBS:
            JOBS[jid]['search_index'] = index
    print(f'[SEARCH-IDX] Job {jid}: indexed {len(index):,} files into memory')


def _make_job_dict(root: str, temp_dir=None) -> dict:
    return {
        'pct': 0, 'msg': 'Queued...', 'done': False,
        'error': None, 'stats': None, 'data': None,
        'root': root, 'started': time.time(),
        'temp_dir': temp_dir,
        'viewers': {}, 'viewer_tracking_started': False,
        'last_viewer_gone_at': None,
        'stage': 'scan', 'stage_label': 'Scan source files',
        'stage_index': 1, 'stage_total': 6,
        'total_files': 0, 'analyzed_files': 0,
        'project_total_files': 0, 'project_processed_files': 0,
        'source_files_total': 0,
        'module_count': 0, 'function_count': 0,
        'node_count': 0, 'file_edge_count': 0,
        'func_edge_count': 0, 'edge_count': 0,
        'project_type': None,
    }


def _ensure_job_viewer_fields(job: dict):
    if not isinstance(job.get('viewers'), dict):
        job['viewers'] = {}
    if 'viewer_tracking_started' not in job:
        job['viewer_tracking_started'] = False
    if 'last_viewer_gone_at' not in job:
        job['last_viewer_gone_at'] = None


def _prune_job_viewers_locked(job: dict, now: float = None):
    _ensure_job_viewer_fields(job)
    now = time.time() if now is None else now
    viewers = job['viewers']
    stale = [
        vid for vid, last_seen in list(viewers.items())
        if now - float(last_seen or 0.0) > VIEWER_TTL_SECONDS
    ]
    for vid in stale:
        viewers.pop(vid, None)
    if viewers:
        job['last_viewer_gone_at'] = None
    elif (stale or job.get('viewer_tracking_started')) and job.get('last_viewer_gone_at') is None:
        job['last_viewer_gone_at'] = now
    return stale


def _cleanup_job_temp_if_idle(jid: str, now: float = None,
                               grace_seconds: float = VIEWER_CLOSE_GRACE_SECONDS):
    """Remove a temp dir only after all viewers are gone and the grace period elapsed."""
    now = time.time() if now is None else now
    with JOBS_LOCK:
        job = JOBS.get(jid, {})
        if not job:
            return False
        _prune_job_viewers_locked(job, now)
        tmp = job.get('temp_dir')
        viewers = job.get('viewers', {})
        last_gone = job.get('last_viewer_gone_at')
        tracking_started = job.get('viewer_tracking_started', False)
        if not tmp or viewers or not tracking_started or last_gone is None:
            return False
        if now - last_gone < grace_seconds:
            return False
        job['temp_dir'] = None
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'[CLEANUP] Job {jid}: removed {tmp}')
    return True


def _cleanup_job_temp(jid: str):
    """Remove temp dir for a job, if any. Safe to call multiple times."""
    with JOBS_LOCK:
        job = JOBS.get(jid, {})
        tmp = job.get('temp_dir')
        if tmp:
            job['temp_dir'] = None
    if tmp:
        shutil.rmtree(tmp, ignore_errors=True)
        print(f'[CLEANUP] Job {jid}: removed {tmp}')


def _cleanup_all_job_temps():
    with JOBS_LOCK:
        targets = [jid for jid, job in JOBS.items() if job.get('temp_dir')]
    for jid in targets:
        _cleanup_job_temp(jid)


def _reap_loop():
    """Daemon: reap expired viewers and clean up temp sources once all viewers are gone."""
    while True:
        time.sleep(VIEWER_REAP_INTERVAL_SECONDS)
        now = time.time()
        with JOBS_LOCK:
            job_ids = list(JOBS.keys())
            for jid in job_ids:
                job = JOBS.get(jid)
                if job:
                    _prune_job_viewers_locked(job, now)
        for jid in job_ids:
            _cleanup_job_temp_if_idle(jid, now=now)


def _read_json_body(handler) -> dict:
    length = int(handler.headers.get('Content-Length', 0))
    raw = handler.rfile.read(length) if length else b''
    if not raw:
        return {}
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8')
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError('JSON body must be an object')
    return data


def _open_job_viewer(jid: str):
    now = time.time()
    with JOBS_LOCK:
        job = JOBS.get(jid)
        if not job:
            return None
        _prune_job_viewers_locked(job, now)
        _ensure_job_viewer_fields(job)
        viewer_id = uuid.uuid4().hex[:16]
        job['viewers'][viewer_id] = now
        job['viewer_tracking_started'] = True
        job['last_viewer_gone_at'] = None
        return {
            'viewer_id': viewer_id,
            'viewer_ttl_seconds': VIEWER_TTL_SECONDS,
            'ping_interval_seconds': max(1, VIEWER_TTL_SECONDS // 4),
        }


def _ping_job_viewer(jid: str, viewer_id: str):
    now = time.time()
    with JOBS_LOCK:
        job = JOBS.get(jid)
        if not job:
            return False, 'Unknown job'
        _prune_job_viewers_locked(job, now)
        viewers = job.get('viewers', {})
        if viewer_id not in viewers:
            return False, 'Unknown viewer'
        viewers[viewer_id] = now
        job['last_viewer_gone_at'] = None
        return True, None


def _close_job_viewer(jid: str, viewer_id: str):
    now = time.time()
    with JOBS_LOCK:
        job = JOBS.get(jid)
        if not job:
            return False, 0
        _prune_job_viewers_locked(job, now)
        viewers = job.get('viewers', {})
        viewers.pop(viewer_id, None)
        remaining = len(viewers)
        if remaining == 0 and job.get('viewer_tracking_started'):
            job['last_viewer_gone_at'] = now
    return True, remaining


def _run_analysis_thread(jid: str, root: str, pre_fn=None, generate_report: bool = False):
    """Background thread: optionally run pre_fn(tmp_dir) then build_graph(root).

    If generate_report is True, analytics_helpers.generate_report() is called
    after build_graph completes, driving the 90→100 % progress window.
    """
    import importlib

    def run():
        try:
            if pre_fn:
                with JOBS_LOCK:
                    JOBS[jid]['msg'] = 'Preparing source...'
                new_root = pre_fn()
                if new_root:
                    root_to_use = new_root
                    with JOBS_LOCK:
                        JOBS[jid]['root'] = new_root
                else:
                    root_to_use = root
            else:
                root_to_use = root

            # Progress callback: maps 0-99 from build_graph into 0-89 overall
            # (the final 90-100 window is reserved for report generation).
            if generate_report:
                def cb(pct, msg, **kwargs):
                    scaled = int(pct * 0.90)   # remap 0-100 → 0-90
                    with JOBS_LOCK:
                        JOBS[jid].update({'pct': scaled, 'msg': msg})
                        if kwargs:
                            JOBS[jid].update(kwargs)
            else:
                def cb(pct, msg, **kwargs):
                    with JOBS_LOCK:
                        JOBS[jid].update({'pct': pct, 'msg': msg})
                        if kwargs:
                            JOBS[jid].update(kwargs)

            importlib.reload(analyze_bios)
            graph_data = analyze_bios.build_graph(root_to_use, progress_cb=cb)

            s = graph_data['stats']

            # ── Optional report generation (90 → 100 %) ──────────────────────
            if generate_report:
                with JOBS_LOCK:
                    JOBS[jid].update({
                        'pct': 90,
                        'msg': 'Generating AI report…',
                        'stage': 'report',
                        'stage_label': 'Generate AI report',
                    })
                try:
                    from analytics_helpers import generate_report as _gen_report
                    report_path = os.path.join(root_to_use, '.vizcode', 'vizcode_report.md')
                    _gen_report(graph_data, report_path)
                    print(f'[REPORT] Job {jid}: report tree written to {os.path.dirname(report_path)}')
                    with JOBS_LOCK:
                        JOBS[jid].update({'pct': 99, 'msg': 'AI report ready', 'report_done': True})
                except Exception as _re:
                    print(f'[REPORT] Job {jid}: report failed: {_re}')
                    with JOBS_LOCK:
                        JOBS[jid].update({'pct': 99, 'msg': f'Report skipped: {_re}', 'report_done': False})

            with JOBS_LOCK:
                JOBS[jid].update({
                    'pct': 100, 'done': True,
                    'msg': f"Done! {s.get('total_all_files', s['files'])} files, {s['functions']} functions",
                    'data': graph_data,
                    'stats': {k: (sorted(s[k]) if isinstance(s[k], (set, frozenset)) else s[k])
                              for k in (
                        'files', 'modules', 'functions', 'calls',
                        'other_files', 'binary_files',
                        'total_visible_files', 'total_all_files',
                        'total_dirs', 'total_dirs_skipped',
                        'skipped_files', 'skipped_dir_names',
                    ) if k in s},
                })
            print(f'\n[DONE] Job {jid}: {s.get("total_all_files", s["files"])} files, {s["functions"]} funcs')
            threading.Thread(target=_build_search_index, args=(jid, root_to_use),
                             daemon=True, name=f'search-idx-{jid}').start()

        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            print(f'\n[ERROR] Job {jid}: {e}\n{tb}')
            with JOBS_LOCK:
                JOBS[jid].update({
                    'done': True, 'error': str(e), 'pct': 0,
                    'msg': f'Error: {e}',
                })

    threading.Thread(target=run, daemon=True).start()
