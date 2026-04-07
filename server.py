#!/usr/bin/env python3
"""
server.py — VIZCODE Local Server V4
Serves launcher.html and runs analyze_viz.py on demand.
Backward compatible: still works if analyze_bios.py is present.
stdlib only: http.server, threading, json, uuid
Usage: python server.py [port]   (default port 7777)
"""

import sys, os, json, threading, uuid, time
import zipfile, tarfile, tempfile, shutil, subprocess, io
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from typing import Dict, Optional


# Import sibling module — prefer analyze_viz (new), fall back to analyze_bios
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import analyze_viz as analyze_bios
except ImportError:
    import analyze_bios

PORT = 7777
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# job_id -> { pct, msg, done, error, stats, data, root }
JOBS: dict = {}
JOBS_LOCK = threading.Lock()

# ─── Input-source limits ──────────────────────────────────────────────────────
ZIP_MAX_BYTES          = 200 * 1024 * 1024   # 200 MB upload cap
NPM_TARBALL_MAX_BYTES  =  50 * 1024 * 1024   # 50 MB npm tarball cap
TEMP_DIR_TTL_SECONDS   = 1800                 # 30 min before cleanup


def _browse_for_folder(start_dir: str = '') -> str:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise RuntimeError('Native folder browser is unavailable in this Python environment') from exc

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes('-topmost', True)
    except Exception:
        pass

    try:
        options = {'title': 'Select a local folder to analyze'}
        if start_dir and os.path.isdir(start_dir):
            options['initialdir'] = start_dir
        selected = filedialog.askdirectory(**options)
        return selected or ''
    finally:
        try:
            root.destroy()
        except Exception:
            pass

# ─── Search index constants ──────────────────────────────────────────────────
_SI_SKIP_DIRS = {
    'Build','build','.git','__pycache__','node_modules','.next','dist',
    'out','.venv','venv','.cache','.nyc_output','vendor','.idea','.vscode',
    'coverage','.output','storybook-static','DEBUG','RELEASE',
}
_SI_BINARY_EXTS = {
    '.bin','.rom','.efi','.lib','.obj','.exe','.dll','.pdb',
    '.so','.a','.o','.png','.jpg','.jpeg','.gif','.ico','.bmp',
    '.webp','.tiff','.pdf','.zip','.tar','.gz','.7z','.rar',
    '.woff','.woff2','.ttf','.eot','.mp4','.mp3','.wav',
    # Office formats
    '.xlsx','.xls','.xlsm','.xlsb',
    '.docx','.doc','.docm',
    '.pptx','.ppt','.pptm',
}
_SI_MAX_FILE_BYTES = 2 * 1024 * 1024  # 2 MB


def _build_search_index(jid: str, root: str):
    """Background thread: read all non-binary files into memory for instant search."""
    index: Dict[str, str] = {}  # rel_path -> full content string
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


# Cleanup old .result_*.html files left from previous server design
for _f in Path(SCRIPT_DIR).glob('.result_*.html'):
    try:
        _f.unlink()
    except FileNotFoundError:
        pass


# ─── Input-source helpers ─────────────────────────────────────────────────────

def _make_job_dict(root: str, temp_dir=None) -> dict:
    return {
        'pct': 0, 'msg': 'Queued...', 'done': False,
        'error': None, 'stats': None, 'data': None,
        'root': root, 'started': time.time(),
        'temp_dir': temp_dir, 'served': False,
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


def _reap_loop():
    """Daemon: every 5 min, delete temp dirs for jobs older than TTL."""
    while True:
        time.sleep(300)
        now = time.time()
        with JOBS_LOCK:
            stale = [jid for jid, j in JOBS.items()
                     if j.get('temp_dir') and now - j.get('started', now) > TEMP_DIR_TTL_SECONDS]
        for jid in stale:
            _cleanup_job_temp(jid)


def _run_analysis_thread(jid: str, root: str, pre_fn=None):
    """Background thread: optionally run pre_fn(tmp_dir) then build_graph(root)."""
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

            def cb(pct, msg, **kwargs):
                with JOBS_LOCK:
                    JOBS[jid].update({'pct': pct, 'msg': msg})
                    if kwargs:
                        JOBS[jid].update(kwargs)

            importlib.reload(analyze_bios)
            graph_data = analyze_bios.build_graph(root_to_use, progress_cb=cb)

            s = graph_data['stats']
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


def _extract_zip(data: bytes):
    """Extract ZIP bytes to a temp dir. Returns (analyze_root, temp_dir)."""
    tmp_dir = tempfile.mkdtemp(prefix='vizcode_zip_')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            # Security: reject path-traversal members
            for member in zf.namelist():
                if os.path.isabs(member) or '..' in member.split('/'):
                    raise ValueError(f'Unsafe path in ZIP: {member}')
            zf.extractall(tmp_dir)
    except zipfile.BadZipFile:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise ValueError('Invalid or corrupted ZIP file')

    # If all content lives under a single top-level directory, use that as root
    entries = os.listdir(tmp_dir)
    if len(entries) == 1:
        candidate = os.path.join(tmp_dir, entries[0])
        if os.path.isdir(candidate):
            return candidate, tmp_dir
    return tmp_dir, tmp_dir


def _clone_git_repo(url: str, tmp_dir: str, jid: str):
    """Clone a git repo (shallow) into tmp_dir. Updates job msg."""
    with JOBS_LOCK:
        JOBS[jid]['msg'] = f'Cloning {url} ...'
    try:
        result = subprocess.run(
            ['git', 'clone', '--depth=1', url, tmp_dir],
            capture_output=True, timeout=120,
        )
    except FileNotFoundError:
        raise RuntimeError('git is not installed or not in PATH')
    except subprocess.TimeoutExpired:
        raise RuntimeError('Clone timed out after 120 s')
    if result.returncode != 0:
        err = result.stderr.decode('utf-8', errors='replace').strip()
        raise RuntimeError(f'git clone failed: {err}')


def _fetch_npm_metadata(name: str) -> dict:
    """Fetch package metadata from the npm registry."""
    encoded = name.replace('/', '%2F') if name.startswith('@') else name
    url = f'https://registry.npmjs.org/{encoded}'
    try:
        req = Request(url, headers={'Accept': 'application/json'})
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        if e.code == 404:
            raise RuntimeError(f'Package not found on npm: {name}')
        raise RuntimeError(f'npm registry error {e.code}: {e.reason}')
    except URLError as e:
        raise RuntimeError(f'Cannot reach npm registry: {e.reason}')


def _download_npm_tarball(tarball_url: str, tmp_dir: str) -> str:
    """Download and extract an npm tarball. Returns analyze_root inside tmp_dir."""
    try:
        req = Request(tarball_url, headers={'Accept-Encoding': 'identity'})
        with urlopen(req, timeout=60) as resp:
            data = resp.read()
    except URLError as e:
        raise RuntimeError(f'Failed to download tarball: {e.reason}')
    if len(data) > NPM_TARBALL_MAX_BYTES:
        raise RuntimeError(f'Package exceeds {NPM_TARBALL_MAX_BYTES // 1024 // 1024} MB limit')
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tf:
            tf.extractall(tmp_dir)
    except Exception as e:
        raise RuntimeError(f'Failed to extract tarball: {e}')
    # npm tarballs always extract to a 'package/' subdirectory
    pkg_dir = os.path.join(tmp_dir, 'package')
    return pkg_dir if os.path.isdir(pkg_dir) else tmp_dir


def _fetch_npm_package(spec: str, tmp_dir: str, jid: str) -> str:
    """Fetch and extract an npm package. Returns analyze_root."""
    name, _, version = spec.partition('@') if not spec.startswith('@') else (spec, '', '')
    if spec.startswith('@'):
        # Scoped package: split on second '@'
        parts = spec[1:].split('@', 1)
        name = '@' + parts[0]
        version = parts[1] if len(parts) > 1 else ''

    with JOBS_LOCK:
        JOBS[jid]['msg'] = f'Fetching {spec} from npm registry...'
    meta = _fetch_npm_metadata(name)

    if not version:
        version = meta.get('dist-tags', {}).get('latest', '')
    if not version:
        raise RuntimeError(f'Could not resolve latest version for {name}')

    versions = meta.get('versions', {})
    if version not in versions:
        raise RuntimeError(f'Version {version} not found for {name}')

    tarball_url = versions[version].get('dist', {}).get('tarball', '')
    if not tarball_url:
        raise RuntimeError(f'No tarball URL for {name}@{version}')

    with JOBS_LOCK:
        JOBS[jid]['msg'] = f'Downloading {name}@{version}...'
    return _download_npm_tarball(tarball_url, tmp_dir)


# ─── HTTP Handler ─────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress default access log

    # ── GET ───────────────────────────────────────────────────────────────────
    def do_GET(self):
        parsed = urlparse(self.path)
        p = parsed.path
        qs = parse_qs(parsed.query)

        if p == '/':
            self.serve_disk('launcher.html', 'text/html')

        elif p.startswith('/static/'):
            filename = p[len('/static/'):]
            ext = filename.rsplit('.', 1)[-1] if '.' in filename else ''
            mime = {'css':'text/css','js':'application/javascript',
                    'html':'text/html','json':'application/json'}.get(ext, 'text/plain')
            self.serve_disk(os.path.join('static', filename), mime)

        elif p == '/progress':
            jid = qs.get('job', [''])[0]
            with JOBS_LOCK:
                job = JOBS.get(jid)
            if not job:
                self.json_resp({'error': 'Unknown job'}, 404)
            else:
                # Strip 'data' (graph payload) — not needed by frontend, and may contain non-serialisable types
                safe = {k: v for k, v in job.items() if k != 'data'}
                self.json_resp(safe)

        elif p == '/result':
            jid = qs.get('job', [''])[0]
            with JOBS_LOCK:
                job = JOBS.get(jid, {})
            data = job.get('data')
            if not data:
                if job.get('error'):
                    self.html_error(job['error'])
                else:
                    self.html_error('Result not ready — analysis may still be running')
                return
            try:
                import importlib
                importlib.reload(analyze_bios)
                html = analyze_bios.build_html(data, job_id=jid)
                body = html.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', len(body))
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(body)
                # Mark served so temp dir can be cleaned up
                with JOBS_LOCK:
                    if jid in JOBS:
                        JOBS[jid]['served'] = True
                threading.Thread(target=_cleanup_job_temp, args=(jid,),
                                 daemon=True).start()
            except Exception as e:
                self.html_error(f'Failed to render HTML: {e}')

        elif p == '/file':
            # Serve raw source file content for the code panel
            jid = qs.get('job', [''])[0]
            rel = qs.get('path', [''])[0]
            raw_dl = qs.get('raw', ['0'])[0] == '1'
            with JOBS_LOCK:
                job = JOBS.get(jid, {})
            root = job.get('root', '')
            if not root or not rel:
                self.json_resp({'error': 'Missing job or path param'}, 400)
                return
            try:
                abs_path = os.path.normpath(os.path.join(root, rel))
                root_norm = os.path.normpath(root)
                # Security: path must stay within root
                if not (abs_path.startswith(root_norm + os.sep) or abs_path == root_norm):
                    self.json_resp({'error': 'Path traversal not allowed'}, 403)
                    return

                # ── Raw binary download (raw=1) ───────────────────────────────
                if raw_dl:
                    raw_bytes = Path(abs_path).read_bytes()
                    fname_dl = Path(abs_path).name
                    # Guess MIME
                    _mime_map = {
                        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
                        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        '.docm': 'application/vnd.ms-word.document.macroEnabled.12',
                        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                        '.pptm': 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
                        '.pdf':  'application/pdf',
                        '.xls':  'application/vnd.ms-excel',
                        '.doc':  'application/msword',
                        '.ppt':  'application/vnd.ms-powerpoint',
                    }
                    _ext_dl = Path(fname_dl).suffix.lower()
                    mime_dl = _mime_map.get(_ext_dl, 'application/octet-stream')
                    self.send_response(200)
                    self.send_header('Content-Type', mime_dl)
                    self.send_header('Content-Disposition', f'attachment; filename="{fname_dl}"')
                    self.send_header('Content-Length', str(len(raw_bytes)))
                    self.end_headers()
                    self.wfile.write(raw_bytes)
                    return

                import base64
                ext = Path(abs_path).suffix.lower()

                # ── Image files → base64 ──────────────────────────────────────
                IMAGE_EXTS = {
                    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                    '.png': 'image/png',  '.bmp': 'image/bmp',
                    '.gif': 'image/gif',  '.ico': 'image/x-icon',
                    '.tiff': 'image/tiff', '.tif': 'image/tiff',
                    '.webp': 'image/webp',
                }
                if ext in IMAGE_EXTS:
                    raw = Path(abs_path).read_bytes()
                    b64 = base64.b64encode(raw).decode('ascii')
                    self.json_resp({
                        'content_type': 'image',
                        'mime': IMAGE_EXTS[ext],
                        'data': b64,
                        'size': len(raw),
                        'path': rel,
                    })
                    return

                # ── Known binary / object files → hex dump ───────────────────
                BINARY_EXTS = {
                    '.bin', '.rom', '.efi', '.lib', '.obj',
                    '.veb', '.map', '.pdb', '.exe', '.dll',
                }
                if ext in BINARY_EXTS:
                    MAX_HEX = 8192   # show first 8 KB
                    raw = Path(abs_path).read_bytes()
                    chunk = raw[:MAX_HEX]
                    lines = []
                    for i in range(0, len(chunk), 16):
                        row = chunk[i:i+16]
                        hex_part  = ' '.join(f'{b:02X}' for b in row)
                        hex_pad   = hex_part.ljust(47)
                        ascii_part = ''.join(chr(b) if 32 <= b < 127 else '.' for b in row)
                        lines.append(f'{i:08X}  {hex_pad}  |{ascii_part}|')
                    truncated = len(raw) > MAX_HEX
                    self.json_resp({
                        'content_type': 'binary',
                        'content': '\n'.join(lines),
                        'size': len(raw),
                        'truncated': truncated,
                        'path': rel,
                    })
                    return

                # ── PDF files → base64 embed ──────────────────────────────────
                PDF_EXTS = {'.pdf'}
                if ext in PDF_EXTS:
                    raw = Path(abs_path).read_bytes()
                    b64 = base64.b64encode(raw).decode('ascii')
                    self.json_resp({
                        'content_type': 'pdf',
                        'data': b64,
                        'size': len(raw),
                        'path': rel,
                    })
                    return

                # ── Legacy binary Office files (.xls, .doc, .ppt) → download only ─
                LEGACY_OFFICE_EXTS = {'.xls', '.doc', '.ppt'}
                if ext in LEGACY_OFFICE_EXTS:
                    icon_map = {'.xls': '📊', '.doc': '📝', '.ppt': '📋'}
                    self.json_resp({
                        'content_type': 'office',
                        'office_type': 'legacy',
                        'office_icon': icon_map.get(ext, '📄'),
                        'size': Path(abs_path).stat().st_size,
                        'path': rel,
                    })
                    return

                # ── Office files (xlsx/docx/pptx) → extracted content ─────────
                OFFICE_EXTS = {
                    '.xlsx', '.xlsm',
                    '.docx', '.docm',
                    '.pptx', '.pptm',
                }
                if ext in OFFICE_EXTS:
                    import zipfile as _zf
                    import xml.etree.ElementTree as _ET
                    import html as _html_mod

                    raw = Path(abs_path).read_bytes()
                    size = len(raw)

                    try:
                        import io as _io
                        zf = _zf.ZipFile(_io.BytesIO(raw))
                    except Exception as ze:
                        self.json_resp({'error': f'Cannot open Office file: {ze}'}, 500)
                        return

                    # ── Shared: build standalone HTML for srcdoc iframe ────────
                    def _office_page(body_html: str, extra_style: str = '') -> str:
                        return (
                            '<!doctype html><html><head>'
                            '<meta charset="utf-8">'
                            '<style>'
                            'html,body{margin:0;padding:0;height:100%;'
                            'background:#0d1117;color:#e2e8f0;'
                            'font-family:system-ui,sans-serif;font-size:13px}'
                            + extra_style +
                            '</style></head><body>'
                            + body_html +
                            '</body></html>'
                        )

                    # ── XLSX ──────────────────────────────────────────────────
                    if ext in ('.xlsx', '.xlsm'):
                        shared_strings = []
                        if 'xl/sharedStrings.xml' in zf.namelist():
                            ss_xml = zf.read('xl/sharedStrings.xml')
                            ss_root = _ET.fromstring(ss_xml)
                            ns_ss = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                            for si in ss_root.findall('ns:si', ns_ss):
                                texts = [t.text or '' for t in si.iter() if t.tag.endswith('}t') or t.tag == 't']
                                shared_strings.append(''.join(texts))

                        sheet_names = []
                        try:
                            wb_xml = zf.read('xl/workbook.xml')
                            wb_root = _ET.fromstring(wb_xml)
                            ns_wb = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                            sheets_el = wb_root.find('ns:sheets', ns_wb)
                            if sheets_el is not None:
                                for sh in sheets_el:
                                    sheet_names.append(sh.get('name', ''))
                        except Exception:
                            pass

                        sheet_files = sorted(
                            [n for n in zf.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')],
                            key=lambda x: int(''.join(filter(str.isdigit, x.split('/')[-1])) or '0')
                        )

                        sheets_html = []
                        for idx, sf in enumerate(sheet_files):
                            sh_xml = zf.read(sf)
                            sh_root = _ET.fromstring(sh_xml)
                            rows_data = []
                            for row in sh_root.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row'):
                                cells = {}
                                for cell in row:
                                    ref = cell.get('r', '')
                                    col_str = ''.join(c for c in ref if c.isalpha())
                                    t = cell.get('t', '')
                                    v_el = cell.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                                    val = ''
                                    if v_el is not None and v_el.text:
                                        if t == 's':
                                            try:
                                                val = shared_strings[int(v_el.text)]
                                            except (IndexError, ValueError):
                                                val = v_el.text
                                        elif t == 'b':
                                            val = 'TRUE' if v_el.text == '1' else 'FALSE'
                                        else:
                                            val = v_el.text
                                    is_el = cell.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}is')
                                    if is_el is not None:
                                        val = ''.join(t2.text or '' for t2 in is_el.iter() if t2.tag.endswith('}t'))
                                    if col_str:
                                        col_idx = sum((ord(c) - 64) * (26 ** i) for i, c in enumerate(reversed(col_str)))
                                        cells[col_idx] = val
                                if cells:
                                    rows_data.append(cells)

                            if not rows_data:
                                sheets_html.append('<p style="padding:16px;color:#94a3b8">Empty sheet</p>')
                                continue

                            max_col = max(max(r.keys()) for r in rows_data)
                            MAX_ROWS = 2000
                            MAX_COLS = 100
                            total_rows = len(rows_data)
                            truncated = total_rows > MAX_ROWS
                            rows_data = rows_data[:MAX_ROWS]
                            max_col = min(max_col, MAX_COLS)

                            def col_label(n):
                                s = ''
                                while n > 0:
                                    n, r2 = divmod(n - 1, 26)
                                    s = chr(65 + r2) + s
                                return s

                            thead = '<thead><tr><th></th>' + ''.join(f'<th>{col_label(c)}</th>' for c in range(1, max_col + 1)) + '</tr></thead>'
                            tbody_rows = []
                            for ri, row in enumerate(rows_data, 1):
                                cells_html = f'<td class="rn">{ri}</td>'
                                for ci in range(1, max_col + 1):
                                    v = _html_mod.escape(str(row.get(ci, '')))
                                    cells_html += f'<td>{v}</td>'
                                tbody_rows.append(f'<tr>{cells_html}</tr>')
                            tbody = '<tbody>' + ''.join(tbody_rows) + '</tbody>'
                            trunc_msg = f'<div class="trunc">⚠ Showing first {MAX_ROWS} of {total_rows} rows</div>' if truncated else ''
                            sheets_html.append(f'{trunc_msg}<div class="tw"><table>{thead}{tbody}</table></div>')

                        sname = lambda i: sheet_names[i] if i < len(sheet_names) else f'Sheet{i+1}'
                        n = len(sheets_html)
                        tab_js = 'function sw(i){document.querySelectorAll(".sh").forEach((s,j)=>s.style.display=j===i?"block":"none");document.querySelectorAll(".tb").forEach((b,j)=>b.className="tb"+(j===i?" a":""));}sw(0);'
                        tabs = ''.join(f'<button class="tb" onclick="sw({i})">{_html_mod.escape(sname(i))}</button>' for i in range(n))
                        sheets = ''.join(f'<div class="sh">{h}</div>' for h in sheets_html)
                        xlsx_style = (
                            '.wrap{display:flex;flex-direction:column;height:100vh}'
                            '.tabs{display:flex;flex-wrap:wrap;gap:2px;padding:4px 6px;background:#161b22;border-bottom:1px solid #30363d;flex-shrink:0}'
                            '.tb{padding:3px 10px;border:1px solid #30363d;border-bottom:none;border-radius:3px 3px 0 0;background:#161b22;color:#94a3b8;cursor:pointer;font-size:11px}'
                            '.tb.a{background:#0d1117;color:#e2e8f0;border-bottom:1px solid #0d1117}'
                            '.body{flex:1;overflow:auto}'
                            '.tw{overflow:auto}'
                            'table{border-collapse:collapse;font-size:12px;font-family:monospace;min-width:100%}'
                            'th,td{border:1px solid #30363d;padding:3px 8px;white-space:nowrap;max-width:300px;overflow:hidden;text-overflow:ellipsis}'
                            'th{background:#161b22;color:#94a3b8;font-weight:600;position:sticky;top:0;z-index:1;text-align:center}'
                            'tr:hover td{background:#1c2128}'
                            '.rn{color:#94a3b8;background:#161b22!important;text-align:right;user-select:none;font-size:11px;min-width:36px}'
                            '.trunc{padding:5px 10px;background:#f59e0b22;color:#f59e0b;font-size:11px;border-bottom:1px solid #30363d}'
                        )
                        body = f'<div class="wrap"><div class="tabs">{tabs}</div><div class="body">{sheets}</div></div><script>{tab_js}</script>'
                        srcdoc = _office_page(body, xlsx_style)
                        self.json_resp({
                            'content_type': 'office',
                            'office_type': 'xlsx',
                            'srcdoc': srcdoc,
                            'size': size,
                            'path': rel,
                        })
                        return

                    # ── DOCX ──────────────────────────────────────────────────
                    if ext in ('.docx', '.docm'):
                        ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
                        try:
                            doc_xml = zf.read('word/document.xml')
                            root = _ET.fromstring(doc_xml)
                        except Exception as e:
                            self.json_resp({'error': f'Cannot parse docx: {e}'}, 500)
                            return

                        paras = []
                        for p in root.iter(f'{{{ns}}}p'):
                            texts = [r2.text for r2 in p.iter(f'{{{ns}}}t') if r2.text]
                            line = _html_mod.escape(''.join(texts).rstrip())
                            paras.append(f'<p>{line if line else "&nbsp;"}</p>')

                        docx_style = (
                            'body{padding:32px 48px;max-width:820px;margin:0 auto;'
                            'line-height:1.8;font-size:14px;font-family:Georgia,serif}'
                            'p{margin:0 0 6px}'
                        )
                        srcdoc = _office_page(''.join(paras), docx_style)
                        self.json_resp({
                            'content_type': 'office',
                            'office_type': 'docx',
                            'srcdoc': srcdoc,
                            'size': size,
                            'path': rel,
                        })
                        return

                    # ── PPTX ──────────────────────────────────────────────────
                    if ext in ('.pptx', '.pptm'):
                        slide_files = sorted(
                            [n for n in zf.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml')],
                            key=lambda x: int(''.join(filter(str.isdigit, x.split('/')[-1])) or '0')
                        )
                        ns_a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
                        slides = []
                        for sli, sf in enumerate(slide_files, 1):
                            sl_xml = zf.read(sf)
                            sl_root = _ET.fromstring(sl_xml)
                            texts = [_html_mod.escape(t_el.text) for t_el in sl_root.iter(f'{{{ns_a}}}t') if t_el.text and t_el.text.strip()]
                            content = '<br>'.join(texts) if texts else '<span style="color:#64748b">Empty slide</span>'
                            slides.append(f'<div class="slide"><div class="sn">Slide {sli}</div><div class="sc">{content}</div></div>')

                        pptx_style = (
                            'body{padding:16px;display:flex;flex-direction:column;gap:10px}'
                            '.slide{border:1px solid #30363d;border-radius:6px;overflow:hidden}'
                            '.sn{padding:5px 12px;background:#161b22;font-size:11px;color:#94a3b8;'
                            'font-family:monospace;border-bottom:1px solid #30363d}'
                            '.sc{padding:14px 16px;line-height:1.6;min-height:50px}'
                        )
                        srcdoc = _office_page(''.join(slides), pptx_style)
                        self.json_resp({
                            'content_type': 'office',
                            'office_type': 'pptx',
                            'srcdoc': srcdoc,
                            'size': size,
                            'path': rel,
                        })
                        return

                # ── Comprehensive lang hint map (ext → highlight.js language alias) ──
                # Covers 130+ extensions — mirrors VS Code's grammar support.
                LANG_HINT_MAP = {
                    # ── Web ────────────────────────────────────────────────────
                    '.html': 'html', '.htm': 'html', '.xhtml': 'html',
                    '.css': 'css', '.scss': 'scss', '.sass': 'scss',
                    '.less': 'less', '.styl': 'stylus',
                    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
                    '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
                    '.graphql': 'graphql', '.gql': 'graphql',
                    '.wasm': 'wasm', '.wat': 'wasm',
                    # ── Systems languages ──────────────────────────────────────
                    '.c': 'c', '.h': 'cpp',
                    '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
                    '.hpp': 'cpp', '.hxx': 'cpp', '.hh': 'cpp',
                    '.cs': 'csharp', '.vb': 'vbnet',
                    '.rs': 'rust',
                    '.go': 'go',
                    '.zig': 'plaintext',
                    '.v': 'verilog',
                    '.vhd': 'vhdl', '.vhdl': 'vhdl',
                    '.sv': 'verilog', '.svh': 'verilog',
                    # ── Assembly ──────────────────────────────────────────────
                    '.asm': 'x86asm', '.s': 'x86asm', '.S': 'x86asm',
                    '.nasm': 'x86asm', '.mips': 'mipsasm',
                    # ── JVM / mobile ──────────────────────────────────────────
                    '.java': 'java',
                    '.kt': 'kotlin', '.kts': 'kotlin',
                    '.scala': 'scala', '.sc': 'scala',
                    '.groovy': 'groovy', '.gradle': 'groovy',
                    '.dart': 'dart',
                    '.swift': 'swift',
                    '.m': 'objectivec', '.mm': 'objectivec',
                    # ── Scripting ─────────────────────────────────────────────
                    '.py': 'python', '.pyw': 'python', '.pyx': 'python',
                    '.rb': 'ruby', '.gemspec': 'ruby', '.rake': 'ruby',
                    '.php': 'php', '.php3': 'php', '.php4': 'php', '.php5': 'php',
                    '.pl': 'perl', '.pm': 'perl',
                    '.lua': 'lua',
                    '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
                    '.fish': 'bash', '.ksh': 'bash', '.tcsh': 'bash',
                    '.ps1': 'powershell', '.psm1': 'powershell', '.psd1': 'powershell',
                    '.bat': 'dos', '.cmd': 'dos',
                    '.awk': 'awk',
                    '.tcl': 'tcl',
                    '.r': 'r', '.R': 'r',
                    '.jl': 'julia',
                    '.ex': 'elixir', '.exs': 'elixir',
                    '.erl': 'erlang', '.hrl': 'erlang',
                    '.clj': 'clojure', '.cljs': 'clojure', '.cljc': 'clojure',
                    '.hs': 'haskell', '.lhs': 'haskell',
                    '.ml': 'ocaml', '.mli': 'ocaml',
                    '.fs': 'fsharp', '.fsi': 'fsharp', '.fsx': 'fsharp',
                    '.nim': 'nim',
                    '.cr': 'crystal',
                    '.d': 'd',
                    '.coffee': 'coffeescript',
                    '.elm': 'elm',
                    '.ex': 'elixir',
                    '.pony': 'pony',
                    '.pas': 'delphi', '.dpr': 'delphi',
                    '.lisp': 'lisp', '.lsp': 'lisp', '.el': 'lisp',
                    '.scm': 'scheme',
                    '.prolog': 'prolog', '.pro': 'prolog',
                    '.ada': 'ada', '.adb': 'ada', '.ads': 'ada',
                    '.for': 'fortran', '.f90': 'fortran', '.f95': 'fortran', '.f': 'fortran',
                    '.vala': 'vala',
                    '.hx': 'haxe',
                    # ── Data / Config ─────────────────────────────────────────
                    '.json': 'json', '.jsonc': 'json', '.json5': 'json',
                    '.yaml': 'yaml', '.yml': 'yaml',
                    '.toml': 'ini',
                    '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
                    '.properties': 'properties',
                    '.env': 'properties',
                    '.xml': 'xml', '.xsl': 'xml', '.xsd': 'xml',
                    '.plist': 'xml', '.rss': 'xml', '.atom': 'xml',
                    '.svg': 'xml',
                    '.csv': 'plaintext', '.tsv': 'plaintext',
                    # ── Infrastructure / DevOps ────────────────────────────────
                    '.tf': 'hcl', '.hcl': 'hcl',
                    '.dockerfile': 'dockerfile',
                    '.nginx': 'nginx',
                    '.proto': 'protobuf',
                    '.thrift': 'thrift',
                    # ── Build systems ─────────────────────────────────────────
                    '.cmake': 'cmake',
                    '.mk': 'makefile', '.mak': 'makefile',
                    '.bazel': 'python', '.bzl': 'python',
                    '.gradle': 'groovy',
                    # ── Documentation / text ──────────────────────────────────
                    '.md': 'markdown', '.mdx': 'markdown',
                    '.rst': 'plaintext',
                    '.txt': 'plaintext',
                    '.tex': 'latex', '.ltx': 'latex',
                    '.asciidoc': 'asciidoc', '.adoc': 'asciidoc',
                    # ── Database ──────────────────────────────────────────────
                    '.sql': 'sql', '.psql': 'pgsql', '.pgsql': 'pgsql',
                    '.ddl': 'sql', '.dml': 'sql',
                    # ── UEFI / Firmware (existing BIOS support) ────────────────
                    '.inf': 'ini', '.dec': 'ini', '.dsc': 'ini', '.fdf': 'ini',
                    '.sdl': 'ini', '.sd': 'ini', '.cif': 'ini',
                    '.vfr': 'c', '.hfr': 'c', '.uni': 'plaintext',
                    '.asl': 'c',
                    # ── Misc ──────────────────────────────────────────────────
                    '.diff': 'diff', '.patch': 'diff',
                    '.vim': 'vim', '.vimrc': 'vim',
                    '.nix': 'nix',
                    '.rego': 'plaintext',
                    '.wgsl': 'plaintext',
                    '.glsl': 'glsl', '.vert': 'glsl', '.frag': 'glsl', '.hlsl': 'plaintext',
                    '.sol': 'javascript',   # Solidity — close enough
                    '.proto': 'protobuf',
                    '.feature': 'gherkin',
                    '.http': 'http',
                    '.ipynb': 'json',
                    '.lock': 'plaintext',
                    '.log': 'plaintext',
                    '.editorconfig': 'ini',
                    '.gitignore': 'plaintext', '.gitattributes': 'plaintext',
                    '.dockerignore': 'plaintext', '.npmignore': 'plaintext',
                }

                # Special filenames with no extension
                FILENAME_LANG_MAP = {
                    'dockerfile': 'dockerfile', 'Dockerfile': 'dockerfile',
                    'makefile': 'makefile', 'Makefile': 'makefile', 'GNUmakefile': 'makefile',
                    'jenkinsfile': 'groovy', 'Jenkinsfile': 'groovy',
                    'vagrantfile': 'ruby', 'Vagrantfile': 'ruby',
                    'gemfile': 'ruby', 'Gemfile': 'ruby',
                    'rakefile': 'ruby', 'Rakefile': 'ruby',
                    'brewfile': 'ruby', 'Brewfile': 'ruby',
                    'pipfile': 'ini', 'Pipfile': 'ini',
                    'procfile': 'plaintext', 'Procfile': 'plaintext',
                    '.bashrc': 'bash', '.zshrc': 'bash', '.bash_profile': 'bash',
                    '.bash_aliases': 'bash', '.profile': 'bash',
                    '.env': 'properties', '.env.local': 'properties',
                    '.eslintrc': 'json', '.prettierrc': 'json', '.babelrc': 'json',
                    'cmakelists.txt': 'cmake', 'CMakeLists.txt': 'cmake',
                    'go.mod': 'plaintext', 'go.sum': 'plaintext',
                    'cargo.toml': 'ini', 'cargo.lock': 'plaintext',
                    'package.json': 'json', 'package-lock.json': 'json',
                    'yarn.lock': 'plaintext',
                    'requirements.txt': 'plaintext',
                    'pyproject.toml': 'ini', 'setup.cfg': 'ini', 'setup.py': 'python',
                    'tsconfig.json': 'json', 'jsconfig.json': 'json',
                    'webpack.config.js': 'javascript', 'vite.config.js': 'javascript',
                    'nginx.conf': 'nginx', 'httpd.conf': 'apache',
                    'robots.txt': 'plaintext', 'humans.txt': 'plaintext',
                    'license': 'plaintext', 'LICENSE': 'plaintext',
                    'readme': 'markdown', 'README': 'markdown',
                    'changelog': 'markdown', 'CHANGELOG': 'markdown',
                    'authors': 'plaintext', 'AUTHORS': 'plaintext',
                }

                fname_lower = Path(abs_path).name
                lang_hint = (
                    FILENAME_LANG_MAP.get(fname_lower)
                    or FILENAME_LANG_MAP.get(Path(abs_path).name)
                    or LANG_HINT_MAP.get(ext)
                )

                if lang_hint is not None or ext in LANG_HINT_MAP:
                    content = Path(abs_path).read_text(encoding='utf-8', errors='replace')
                    self.json_resp({
                        'content_type': 'text',
                        'content': content,
                        'lang_hint': lang_hint or 'plaintext',
                        'path': rel,
                    })
                    return

                # ── Default: attempt UTF-8 text; fall back to hex dump ────────
                raw = Path(abs_path).read_bytes()
                # Heuristic: if >30% non-printable bytes → treat as binary
                printable = sum(1 for b in raw[:512] if 32 <= b < 127 or b in (9, 10, 13))
                is_text = len(raw) == 0 or (printable / min(len(raw), 512)) > 0.70
                if is_text:
                    content = raw.decode('utf-8', errors='replace')
                    self.json_resp({'content_type': 'text', 'content': content, 'path': rel})
                else:
                    chunk = raw[:8192]
                    lines = []
                    for i in range(0, len(chunk), 16):
                        row = chunk[i:i+16]
                        hex_part  = ' '.join(f'{b:02X}' for b in row)
                        ascii_part = ''.join(chr(b) if 32 <= b < 127 else '.' for b in row)
                        lines.append(f'{i:08X}  {hex_part:<47}  |{ascii_part}|')
                    self.json_resp({
                        'content_type': 'binary',
                        'content': '\n'.join(lines),
                        'size': len(raw),
                        'truncated': len(raw) > 8192,
                        'path': rel,
                    })



            except FileNotFoundError:
                self.json_resp({'error': f'File not found: {rel}'}, 404)
            except Exception as e:
                self.json_resp({'error': str(e)}, 500)

        elif p == '/search':
            # Full-text content search — uses pre-built in-memory index for speed
            import re as _re
            import fnmatch as _fnmatch

            jid        = qs.get('job',        [''])[0]
            q          = qs.get('q',          [''])[0].strip()
            offset     = int(qs.get('offset', ['0'])[0])
            match_case = qs.get('match_case', ['0'])[0] == '1'
            whole_word = qs.get('whole_word', ['0'])[0] == '1'
            is_regex   = qs.get('is_regex',   ['0'])[0] == '1'
            inc_glob   = qs.get('include',    [''])[0].strip()
            exc_glob   = qs.get('exclude',    [''])[0].strip()

            _EMPTY = {'groups': [], 'total_matches': 0, 'total_files': 0,
                      'has_more': False, 'next_offset': 0, 'indexed': False}

            if not jid or not q or len(q) < 1:
                self.json_resp(_EMPTY); return

            with JOBS_LOCK:
                job = JOBS.get(jid, {})
            root = job.get('root', '')
            if not root:
                self.json_resp(_EMPTY); return

            # ── Build regex pattern ───────────────────────────────────────────
            flags = 0 if match_case else _re.IGNORECASE
            raw_q = q
            try:
                core = raw_q if is_regex else _re.escape(raw_q)
                if whole_word:
                    core = r'\b' + core + r'\b'
                pattern = _re.compile(core, flags)
            except _re.error as exc:
                self.json_resp({**_EMPTY, 'error': f'Regex error: {exc}'}); return

            # ── Glob helpers ──────────────────────────────────────────────────
            def _parse_globs(raw):
                return [g.strip() for g in raw.split(',') if g.strip()]

            inc_globs = _parse_globs(inc_glob)
            exc_globs = _parse_globs(exc_glob)

            def _glob_match(rel, globs):
                for g in globs:
                    if _fnmatch.fnmatch(rel, g) or _fnmatch.fnmatch(rel.replace('\\', '/'), g):
                        return True
                    if _fnmatch.fnmatch(os.path.basename(rel), g):
                        return True
                return False

            # ── Shared per-match extractor (used by both fast + fallback paths) ─
            MAX_LINE_LEN   = 300
            MAX_LINES_FILE = 500    # raised from 200 → capture more hits per file
            PAGE_FILES     = 100    # raised from 50 → fewer Load-more clicks

            graph_data = job.get('data') or {}
            mod_colors = {m['id']: m.get('color', '#64748b')
                          for m in graph_data.get('modules', [])}

            def _extract_matches(content: str, fname: str):
                """Return list of match dicts for one file's content string."""
                if not pattern.search(content):
                    return []
                hits = []
                for lineno, line in enumerate(content.split('\n'), 1):
                    m = pattern.search(line)
                    if not m:
                        continue
                    text = line.rstrip('\r')
                    if len(text) > MAX_LINE_LEN:
                        start  = max(0, m.start() - 60)
                        prefix = '…' if start > 0 else ''
                        text   = prefix + text[start: start + MAX_LINE_LEN]
                        adj    = m.start() - start + len(prefix)
                        ms, me = max(0, adj), max(0, adj) + (m.end() - m.start())
                    else:
                        ms, me = m.start(), m.end()
                    hits.append({'line': lineno, 'text': text, 'ms': ms, 'me': me})
                    if len(hits) >= MAX_LINES_FILE:
                        break
                return hits

            total_matches = 0
            total_files   = 0
            all_groups    = []

            # ── Fast path: use pre-built in-memory index ──────────────────────
            search_index = job.get('search_index')  # type: Optional[Dict[str, str]]
            using_index = search_index is not None

            if using_index:
                for rel in sorted(search_index.keys()):
                    if inc_globs and not _glob_match(rel, inc_globs):
                        continue
                    if exc_globs and _glob_match(rel, exc_globs):
                        continue
                    fname = rel.rsplit('/', 1)[-1]
                    ext   = Path(fname).suffix.lower()
                    hits  = _extract_matches(search_index[rel], fname)
                    if not hits:
                        continue
                    total_files   += 1
                    total_matches += len(hits)
                    mod_id = rel.split('/')[0] if '/' in rel else '_root'
                    all_groups.append({
                        'path':    rel,
                        'label':   fname,
                        'module':  mod_id,
                        'ext':     ext,
                        'color':   mod_colors.get(mod_id, '#64748b'),
                        'count':   len(hits),
                        'matches': hits,
                    })

            else:
                # ── Fallback path: walk filesystem (index still building) ─────
                FALLBACK_SKIP = {
                    'Build','build','.git','__pycache__','node_modules','.next','dist',
                    'out','.venv','venv','.cache','.nyc_output','vendor','.idea','.vscode',
                }
                for dirpath, dirnames, filenames in os.walk(root):
                    dirnames[:] = [d for d in dirnames if d not in FALLBACK_SKIP]
                    for fname in sorted(filenames):
                        ext = Path(fname).suffix.lower()
                        if ext in _SI_BINARY_EXTS:
                            continue
                        abs_path = os.path.join(dirpath, fname)
                        rel = os.path.relpath(abs_path, root).replace('\\', '/')
                        if inc_globs and not _glob_match(rel, inc_globs):
                            continue
                        if exc_globs and _glob_match(rel, exc_globs):
                            continue
                        try:
                            if os.path.getsize(abs_path) > _SI_MAX_FILE_BYTES:
                                continue
                            with open(abs_path, encoding='utf-8', errors='replace') as fh:
                                content = fh.read()
                        except Exception:
                            continue
                        hits = _extract_matches(content, fname)
                        if not hits:
                            continue
                        total_files   += 1
                        total_matches += len(hits)
                        mod_id = rel.split('/')[0] if '/' in rel else '_root'
                        all_groups.append({
                            'path':    rel,
                            'label':   fname,
                            'module':  mod_id,
                            'ext':     ext,
                            'color':   mod_colors.get(mod_id, '#64748b'),
                            'count':   len(hits),
                            'matches': hits,
                        })

            all_groups.sort(key=lambda g: (-g['count'], g['path']))
            page_groups = all_groups[offset: offset + PAGE_FILES]

            self.json_resp({
                'groups':        page_groups,
                'total_matches': total_matches,
                'total_files':   total_files,
                'has_more':      (offset + PAGE_FILES) < len(all_groups),
                'next_offset':   offset + PAGE_FILES,
                'query':         q,
                'indexed':       using_index,   # lets frontend show ⚡ badge
            })

        elif p == '/search-stream':
            # SSE streaming content search — results appear progressively as found
            import re as _re
            import fnmatch as _fnmatch

            jid        = qs.get('job',        [''])[0]
            q          = qs.get('q',          [''])[0].strip()
            match_case = qs.get('match_case', ['0'])[0] == '1'
            whole_word = qs.get('whole_word', ['0'])[0] == '1'
            is_regex   = qs.get('is_regex',   ['0'])[0] == '1'
            inc_glob   = qs.get('include',    [''])[0].strip()
            exc_glob   = qs.get('exclude',    [''])[0].strip()

            # ── SSE headers ──────────────────────────────────────────────────────
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('X-Accel-Buffering', 'no')
            self.end_headers()

            def _sse(obj):
                try:
                    line = 'data: ' + json.dumps(obj, ensure_ascii=False) + '\n\n'
                    self.wfile.write(line.encode('utf-8'))
                    self.wfile.flush()
                    return True
                except (BrokenPipeError, ConnectionResetError, OSError):
                    return False  # client disconnected

            with JOBS_LOCK:
                job = JOBS.get(jid, {})

            if not jid or not q or not job:
                _sse({'done': True, 'error': 'Invalid job or query',
                      'total_matches': 0, 'total_files': 0}); return

            root = job.get('root', '')
            if not root:
                _sse({'done': True, 'total_matches': 0, 'total_files': 0}); return

            # ── Regex ─────────────────────────────────────────────────────────────
            flags = 0 if match_case else _re.IGNORECASE
            raw_q = q
            try:
                core = raw_q if is_regex else _re.escape(raw_q)
                if whole_word: core = r'\b' + core + r'\b'
                pattern = _re.compile(core, flags)
            except _re.error as exc:
                _sse({'done': True, 'error': f'Regex error: {exc}',
                      'total_matches': 0, 'total_files': 0}); return

            # ── Glob helpers ──────────────────────────────────────────────────────
            def _parse_globs(raw):
                return [g.strip() for g in raw.split(',') if g.strip()]
            inc_globs = _parse_globs(inc_glob)
            exc_globs = _parse_globs(exc_glob)
            def _glob_match(rel, globs):
                for g in globs:
                    if _fnmatch.fnmatch(rel, g) or _fnmatch.fnmatch(os.path.basename(rel), g):
                        return True
                return False

            MAX_LINE_LEN   = 300
            MAX_LINES_FILE = 500

            graph_data = job.get('data') or {}
            mod_colors = {m['id']: m.get('color', '#64748b')
                          for m in graph_data.get('modules', [])}

            def _extract(content, fname):
                if not pattern.search(content): return []
                hits = []
                for lineno, line in enumerate(content.split('\n'), 1):
                    m = pattern.search(line)
                    if not m: continue
                    text = line.rstrip('\r')
                    if len(text) > MAX_LINE_LEN:
                        start  = max(0, m.start() - 60)
                        prefix = '…' if start > 0 else ''
                        text   = prefix + text[start: start + MAX_LINE_LEN]
                        adj    = m.start() - start + len(prefix)
                        ms, me = max(0, adj), max(0, adj) + (m.end() - m.start())
                    else:
                        ms, me = m.start(), m.end()
                    hits.append({'line': lineno, 'text': text, 'ms': ms, 'me': me})
                    if len(hits) >= MAX_LINES_FILE: break
                return hits

            total_matches = 0
            total_files   = 0

            search_index = job.get('search_index')
            using_index  = search_index is not None

            # Stream each hit file immediately
            source = sorted(search_index.items()) if using_index else None

            if using_index:
                for rel, content in sorted(search_index.items()):
                    if inc_globs and not _glob_match(rel, inc_globs): continue
                    if exc_globs and _glob_match(rel, exc_globs):     continue
                    fname = rel.rsplit('/', 1)[-1]
                    ext   = Path(fname).suffix.lower()
                    hits  = _extract(content, fname)
                    if not hits: continue
                    total_files   += 1
                    total_matches += len(hits)
                    mod_id = rel.split('/')[0] if '/' in rel else '_root'
                    ok = _sse({'group': {
                        'path': rel, 'label': fname, 'module': mod_id,
                        'ext': ext, 'color': mod_colors.get(mod_id, '#64748b'),
                        'count': len(hits), 'matches': hits,
                    }})
                    if not ok: return
            else:
                # Fallback: filesystem walk
                FSKIP = _SI_SKIP_DIRS
                for dirpath, dirnames, filenames in os.walk(root):
                    dirnames[:] = [d for d in dirnames if d not in FSKIP]
                    for fname in sorted(filenames):
                        ext = Path(fname).suffix.lower()
                        if ext in _SI_BINARY_EXTS: continue
                        abs_path = os.path.join(dirpath, fname)
                        rel = os.path.relpath(abs_path, root).replace('\\', '/')
                        if inc_globs and not _glob_match(rel, inc_globs): continue
                        if exc_globs and _glob_match(rel, exc_globs):     continue
                        try:
                            if os.path.getsize(abs_path) > _SI_MAX_FILE_BYTES: continue
                            with open(abs_path, encoding='utf-8', errors='replace') as fh:
                                content = fh.read()
                        except Exception: continue
                        hits = _extract(content, fname)
                        if not hits: continue
                        total_files   += 1
                        total_matches += len(hits)
                        mod_id = rel.split('/')[0] if '/' in rel else '_root'
                        ok = _sse({'group': {
                            'path': rel, 'label': fname, 'module': mod_id,
                            'ext': ext, 'color': mod_colors.get(mod_id, '#64748b'),
                            'count': len(hits), 'matches': hits,
                        }})
                        if not ok: return

            _sse({'done': True, 'total_matches': total_matches,
                  'total_files': total_files, 'indexed': using_index})

        elif p == '/structure':
            # ── Structure View cross-file data ────────────────────────────────
            # GET /structure?job=JID&file=rel/path.py
            MIN_CALLS = 2   # minimum function matches to accept a neighbour

            jid = qs.get('job', [''])[0]
            rel = qs.get('file', [''])[0]
            with JOBS_LOCK:
                job = JOBS.get(jid, {})
            graph_data = job.get('data')
            root_dir   = job.get('root', '')

            if not graph_data or not root_dir or not rel:
                self.json_resp({'error': 'Missing job, file, or data not ready'}, 400)
                return

            # ── Build id↔rel maps ─────────────────────────────────────────────
            id_to_file: dict = {}
            rel_to_id_map: dict = {}
            this_file_id = None
            for mod_files in graph_data.get('files_by_module', {}).values():
                for f in mod_files:
                    id_to_file[f['id']] = f
                    rel_to_id_map[f.get('path', '')] = f['id']
                    if f.get('path') == rel:
                        this_file_id = f['id']

            if this_file_id is None:
                self.json_resp({
                    'funcs': [], 'func_edges': [],
                    'imports': [], 'imported_by': [], 'class_map': {},
                })
                return

            # ── Strategy A: pre-computed file-level edges ──────────────────────
            seen_tgt: set = set()
            seen_src: set = set()
            neighbor_edge_type: dict = {}

            for mod_edges in graph_data.get('file_edges_by_module', {}).values():
                for e in mod_edges:
                    if e['s'] == this_file_id and e['t'] not in seen_tgt:
                        seen_tgt.add(e['t'])
                        neighbor_edge_type[e['t']] = e.get('type', 'import')
                    elif e['t'] == this_file_id and e['s'] not in seen_src:
                        seen_src.add(e['s'])
                        neighbor_edge_type[e['s']] = e.get('type', 'import')

            # ── Strategy B: function-call cross-file detection ─────────────────
            # Build per-file function sets.
            # NOTE: Python parser marks everything is_public=False (is_static bug).
            # Fallback: if a file has NO public funcs, use ALL its funcs instead.
            funcs_by_file_data = graph_data.get('funcs_by_file', {})

            def _func_set(f_rel):
                funcs = funcs_by_file_data.get(f_rel, [])
                pub = {f['label'] for f in funcs if f.get('is_public', False)}
                return pub if pub else {f['label'] for f in funcs}

            # Build rel → module map for filtering
            file_to_module = graph_data.get('file_to_module', {})
            this_module = file_to_module.get(rel, '')

            func_calls_by_file_data = graph_data.get('func_calls_by_file', {})

            # Forward: which files does THIS file call into?
            # Only consider files in the SAME project module tree (share a top-level dir)
            # to avoid matching VIZCODE's own static files (viz.js, analyze_viz.py, etc.)
            call_counts: dict = {}   # other_rel → match count
            for call_list in func_calls_by_file_data.get(rel, []):
                if not isinstance(call_list, list):
                    continue
                for call_name in call_list:
                    for other_rel, func_set in (
                        (r, _func_set(r)) for r in funcs_by_file_data if r != rel
                    ):
                        # Skip files from unrelated top-level modules
                        other_mod = file_to_module.get(other_rel, '')
                        if this_module and other_mod and other_mod != this_module:
                            continue
                        if call_name in func_set:
                            call_counts[other_rel] = call_counts.get(other_rel, 0) + 1

            for other_rel, cnt in call_counts.items():
                if cnt < MIN_CALLS:
                    continue
                other_id = rel_to_id_map.get(other_rel)
                if other_id is None or other_id in seen_tgt:
                    continue
                seen_tgt.add(other_id)
                neighbor_edge_type[other_id] = 'calls'

            # Reverse: which files call INTO this file?
            # Use a higher threshold (3) for reverse direction to reduce noise —
            # many files might incidentally call 2 generic functions.
            MIN_CALLS_REVERSE = max(MIN_CALLS, 3)
            this_funcs = _func_set(rel)
            if this_funcs:
                for other_rel, call_lists in func_calls_by_file_data.items():
                    if other_rel == rel:
                        continue
                    other_id = rel_to_id_map.get(other_rel)
                    if other_id is None or other_id in seen_src:
                        continue
                    # Same-module filter for reverse direction
                    other_mod = file_to_module.get(other_rel, '')
                    if this_module and other_mod and other_mod != this_module:
                        continue
                    cnt = sum(
                        len(this_funcs.intersection(cl))
                        for cl in call_lists if isinstance(cl, list)
                    )
                    if cnt >= MIN_CALLS_REVERSE:
                        seen_src.add(other_id)
                        neighbor_edge_type.setdefault(other_id, 'calls')

            # ── Assemble lists ─────────────────────────────────────────────────
            imports = [
                dict(**id_to_file[nid], edge_type=neighbor_edge_type.get(nid, 'import'))
                for nid in seen_tgt if nid in id_to_file
            ]
            imported_by = [
                dict(**id_to_file[nid], edge_type=neighbor_edge_type.get(nid, 'import'))
                for nid in seen_src if nid in id_to_file
            ]

            # ── Scan neighbour sources for class definitions ────────────────────
            import re as _re
            _CLASS_RE = _re.compile(
                r'^[ \t]*(?:export\s+)?(?:abstract\s+)?(?:default\s+)?class\s+(\w+)'
                r'|^class\s+(\w+)'
                r'|^[ \t]*(?:class|struct)\s+(\w+)\b'
                r'|^type\s+(\w+)\s+struct\b',
                _re.MULTILINE,
            )

            class_map: dict = {}
            for nid in (seen_tgt | seen_src):
                nf = id_to_file.get(nid)
                if not nf:
                    continue
                npath = nf.get('path', '')
                abs_path = os.path.normpath(os.path.join(root_dir, npath))
                direction = 'import' if nid in seen_tgt else 'imported_by'
                try:
                    src_txt = Path(abs_path).read_text(encoding='utf-8', errors='replace')
                    for m in _CLASS_RE.finditer(src_txt):
                        cname = m.group(1) or m.group(2) or m.group(3) or m.group(4)
                        if cname and cname not in class_map:
                            class_map[cname] = {
                                'path':      npath,
                                'label':     nf.get('label', npath),
                                'edge_type': neighbor_edge_type.get(nid, 'import'),
                                'direction': direction,
                            }
                except Exception:
                    pass

            self.json_resp({
                'funcs':       graph_data.get('funcs_by_file',      {}).get(rel, []),
                'func_edges':  graph_data.get('func_edges_by_file', {}).get(rel, []),
                'imports':     imports,
                'imported_by': imported_by,
                'class_map':   class_map,
            })

        elif p == '/symbols':
            # ── Symbol search ─────────────────────────────────────────────────
            # GET /symbols?job=JID&q=foo&kind=function&limit=50
            import re as _re
            jid   = qs.get('job',   [''])[0]
            q     = qs.get('q',     [''])[0].strip()
            kind  = qs.get('kind',  [''])[0].strip()  # optional filter: class|function|method
            limit = int(qs.get('limit', ['50'])[0])

            with JOBS_LOCK:
                job = JOBS.get(jid, {})
            graph_data = job.get('data')
            if not graph_data or not q:
                self.json_resp({'results': [], 'total': 0})
                return

            sym_index = graph_data.get('symbol_index', {})

            # Build fuzzy pattern: split camelCase + underscores, accept partial match
            # e.g. "EngConn" matches "EngineConnection"
            def _fuzzy_match(name: str, pattern: str) -> bool:
                if not pattern:
                    return True
                pl = pattern.lower()
                nl = name.lower()
                # Direct substring match (fast path)
                if pl in nl:
                    return True
                # Subsequence match (all chars of pattern appear in order in name)
                pi = 0
                for c in nl:
                    if pi < len(pl) and c == pl[pi]:
                        pi += 1
                return pi == len(pl)

            results = []
            for sid, sym in sym_index.items():
                if kind and sym['kind'] != kind:
                    continue
                if not _fuzzy_match(sym['name'], q):
                    continue
                results.append({
                    'id':        sid,
                    'name':      sym['name'],
                    'kind':      sym['kind'],
                    'file':      sym['file'],
                    'line':      sym['line'],
                    'is_public': sym['is_public'],
                    'module':    sym['module'],
                    'parent':    sym['parent'],
                })
                if len(results) >= limit * 3:  # over-fetch for dedup
                    break

            # Sort: exact match first, then alphabetical
            ql = q.lower()
            results.sort(key=lambda s: (
                0 if s['name'].lower() == ql else
                1 if s['name'].lower().startswith(ql) else 2,
                s['name'],
            ))
            results = results[:limit]
            self.json_resp({'results': results, 'total': len(sym_index)})

        elif p == '/symbol-refs':
            # ── Symbol references (definition + all call sites) ───────────────
            # GET /symbol-refs?job=JID&sym=sym_0_3
            jid    = qs.get('job', [''])[0]
            sym_id = qs.get('sym', [''])[0].strip()

            with JOBS_LOCK:
                job = JOBS.get(jid, {})
            graph_data = job.get('data')
            root_dir   = job.get('root', '')
            if not graph_data or not sym_id or not root_dir:
                self.json_resp({'definitions': [], 'references': []})
                return

            sym_index = graph_data.get('symbol_index', {})
            sym = sym_index.get(sym_id)
            if not sym:
                self.json_resp({'definitions': [], 'references': [], 'error': 'Symbol not found'})
                return

            sym_name = sym['name']
            CONTEXT  = 3   # lines of context around each match

            def _read_snippet(rel_path: str, target_line: int) -> dict | None:
                try:
                    abs_path = os.path.normpath(os.path.join(root_dir, rel_path))
                    lines = Path(abs_path).read_text(encoding='utf-8', errors='replace').splitlines()
                    start = max(0, target_line - 1 - CONTEXT)
                    end   = min(len(lines), target_line + CONTEXT)
                    snippet_lines = lines[start:end]
                    return {
                        'file':        rel_path,
                        'line':        target_line,
                        'start_line':  start + 1,
                        'end_line':    end,
                        'snippet':     '\n'.join(snippet_lines),
                        'highlight':   target_line - start - 1,  # 0-based offset into snippet
                    }
                except Exception:
                    return None

            # Definition snippet
            definitions = []
            defn = _read_snippet(sym['file'], sym['line'])
            if defn:
                definitions.append(defn)

            # References: scan all files in search_index for occurrences of sym_name
            search_index = job.get('search_index', {})
            import re as _re
            pattern = _re.compile(r'\b' + _re.escape(sym_name) + r'\b')
            references = []
            for rel_path, content in (search_index.items() if search_index else {}.items()):
                if rel_path == sym['file']:
                    continue  # definition file already handled
                for lineno, line in enumerate(content.split('\n'), 1):
                    if pattern.search(line):
                        snip = _read_snippet(rel_path, lineno)
                        if snip:
                            references.append(snip)
                        if len(references) >= 100:
                            break
                if len(references) >= 100:
                    break

            self.json_resp({
                'symbol':      sym,
                'definitions': definitions,
                'references':  references,
            })

        elif p == '/symbol-graph':
            # ── Symbol-centric graph (member-level edges) ─────────────────────
            # GET /symbol-graph?job=JID&sym=sym_0_3
            jid    = qs.get('job', [''])[0]
            sym_id = qs.get('sym', [''])[0].strip()

            with JOBS_LOCK:
                job = JOBS.get(jid, {})
            graph_data = job.get('data')
            if not graph_data or not sym_id:
                self.json_resp({'error': 'Missing job or sym'}, 400)
                return

            sym_index = graph_data.get('symbol_index', {})
            sym_edges = graph_data.get('symbol_edges', [])
            center = sym_index.get(sym_id)
            if not center:
                self.json_resp({'error': 'Symbol not found'}, 404)
                return

            # ── If center is a method/field, promote to parent class ──────────
            active_member_id = None
            card_kinds = {'class', 'struct', 'interface', 'enum'}
            if center.get('kind') not in card_kinds and center.get('parent'):
                parent_name = center['parent']
                parent_file = center.get('file', '')
                for s in sym_index.values():
                    if s['name'] == parent_name and s.get('file') == parent_file and s.get('kind') in card_kinds:
                        active_member_id = sym_id
                        sym_id = s['id']
                        center = s
                        break

            # ── Helper: build children list for any class symbol ──────────────
            def _children_of(sym):
                sname, sfile = sym.get('name', ''), sym.get('file', '')
                kids = [
                    {
                        'id':           s['id'],
                        'name':         s['name'],
                        'kind':         s['kind'],
                        'line':         s.get('line', 0),
                        'end_line':     s.get('end_line', 0),
                        'is_public':    s.get('is_public', True),
                        'access_level': 'public' if s.get('is_public', True) else 'private',
                    }
                    for s in sym_index.values()
                    if s.get('parent') == sname and s.get('file') == sfile
                ]
                kids.sort(key=lambda x: x.get('line', 0))
                return kids

            def _sym_summary(sid):
                s = sym_index.get(sid)
                if not s:
                    return None
                return {
                    'id':           s['id'],
                    'name':         s['name'],
                    'kind':         s['kind'],
                    'file':         s['file'],
                    'line':         s['line'],
                    'is_public':    s['is_public'],
                    'access_level': 'public' if s.get('is_public', True) else 'private',
                    'module':       s['module'],
                    'parent':       s['parent'],
                }

            # ── Gather center ids (class + all its children) ──────────────────
            center_children = _children_of(center)
            center_child_ids = {c['id'] for c in center_children}
            all_center_ids = {sym_id} | center_child_ids

            # ── Scan all edges involving center or its members ────────────────
            from collections import defaultdict as _dd
            # raw_edges: list of (from_id, to_id, type, center_member_id)
            raw_edges = []
            for e in sym_edges:
                efrom, eto, etype = e['from'], e['to'], e['type']
                if efrom in all_center_ids:
                    cm = efrom if efrom in center_child_ids else None
                    raw_edges.append(('out', efrom, eto, etype, cm))
                elif eto in all_center_ids:
                    cm = eto if eto in center_child_ids else None
                    raw_edges.append(('in', efrom, eto, etype, cm))

            # ── Build neighbor parent lookup (sym → parent class info) ────────
            _parent_cache = {}
            def _find_parent_class(s_id):
                if s_id in _parent_cache:
                    return _parent_cache[s_id]
                s = sym_index.get(s_id)
                if not s or not s.get('parent'):
                    _parent_cache[s_id] = None
                    return None
                pname, pfile = s['parent'], s.get('file', '')
                for ps in sym_index.values():
                    if ps['name'] == pname and ps.get('file') == pfile and ps.get('kind') in card_kinds:
                        _parent_cache[s_id] = ps
                        return ps
                _parent_cache[s_id] = None
                return None

            # ── Aggregate edges into incoming/outgoing with member info ───────
            # Key: (neighbor_id, edge_type, center_member_id) → count
            in_bundles  = _dd(int)
            out_bundles = _dd(int)
            in_member   = {}   # (neighbor_id, etype, cm) → neighbor actual symId
            out_member  = {}

            for direction, efrom, eto, etype, cm in raw_edges:
                if direction == 'in':
                    neighbor_id = efrom
                    key = (neighbor_id, etype, cm)
                    in_bundles[key] += 1
                    in_member[key] = neighbor_id
                else:
                    neighbor_id = eto
                    if neighbor_id in all_center_ids:
                        continue  # skip self-edges within center
                    key = (neighbor_id, etype, cm)
                    out_bundles[key] += 1
                    out_member[key] = neighbor_id

            # ── Build incoming/outgoing arrays with member-level info ─────────
            # Collect all neighbor parent classes (for compound rendering)
            neighbor_parents = {}   # parent_sym_id → { ...sym_summary, children: [...] }

            def _enrich_neighbor(nbr_id):
                """If neighbor belongs to a class, cache its parent info."""
                pc = _find_parent_class(nbr_id)
                if pc and pc['id'] not in neighbor_parents and pc['id'] != sym_id:
                    np = dict(_sym_summary(pc['id']) or {})
                    np['children'] = _children_of(pc)
                    neighbor_parents[pc['id']] = np

            incoming = []
            for (nid, etype, cm), count in in_bundles.items():
                sym_sum = _sym_summary(nid)
                if not sym_sum:
                    continue
                _enrich_neighbor(nid)
                item = {'sym': sym_sum, 'edge_type': etype, 'count': count}
                if cm:
                    item['center_member_id'] = cm
                # Check if neighbor belongs to a parent class
                pc = _find_parent_class(nid)
                if pc and pc['id'] != sym_id:
                    item['neighbor_parent_id'] = pc['id']
                incoming.append(item)

            outgoing = []
            for (nid, etype, cm), count in out_bundles.items():
                sym_sum = _sym_summary(nid)
                if not sym_sum:
                    continue
                _enrich_neighbor(nid)
                item = {'sym': sym_sum, 'edge_type': etype, 'count': count}
                if cm:
                    item['center_member_id'] = cm
                pc = _find_parent_class(nid)
                if pc and pc['id'] != sym_id:
                    item['neighbor_parent_id'] = pc['id']
                outgoing.append(item)

            incoming.sort(key=lambda x: -x['count'])
            outgoing.sort(key=lambda x: -x['count'])

            center_with_children = dict(center)
            center_with_children['children'] = center_children

            resp = {
                'center':           center_with_children,
                'incoming':         incoming[:80],
                'outgoing':         outgoing[:80],
                'total_in':         len(incoming),
                'total_out':        len(outgoing),
                'neighbor_parents': neighbor_parents,
            }
            if active_member_id:
                resp['active_member_id'] = active_member_id

            self.json_resp(resp)

        elif p == '/symbol-file':
            # ── Per-file symbol index + intra-file call edges ─────────────────
            # GET /symbol-file?job=JID&file=path/to/file.cpp
            # Returns all symbol_index entries for the file, plus symbol_edges
            # that connect two symbols both inside that file.
            # Used by struct_view.js to enrich the class-grid with backend symbols.
            jid = qs.get('job',  [''])[0]
            rel = qs.get('file', [''])[0].strip()

            with JOBS_LOCK:
                job = JOBS.get(jid, {})
            graph_data = job.get('data')

            if not graph_data or not rel:
                self.json_resp({'symbols': [], 'edges': []})
                return

            sym_index = graph_data.get('symbol_index', {})
            sym_edges = graph_data.get('symbol_edges', [])

            # All symbols belonging to this file
            file_syms = {
                sid: s for sid, s in sym_index.items()
                if s.get('file') == rel
            }
            file_sym_ids = set(file_syms.keys())

            # Edges where both endpoints live in this file
            file_edges = [
                {'from': e['from'], 'to': e['to'], 'type': e.get('type', 'call')}
                for e in sym_edges
                if e['from'] in file_sym_ids and e['to'] in file_sym_ids
            ]

            self.json_resp({
                'file':    rel,
                'symbols': list(file_syms.values()),
                'edges':   file_edges,
            })

        elif p == '/jobs':
            with JOBS_LOCK:
                snapshot = [(k, {kk: vv for kk, vv in v.items() if kk != 'data'})
                            for k, v in JOBS.items()]
            self.json_resp([{'id': k, **v} for k, v in snapshot])

        else:
            self.json_resp({'error': 'Not found'}, 404)


    # ── POST ──────────────────────────────────────────────────────────────────
    def do_POST(self):
        parsed = urlparse(self.path)
        p = parsed.path

        if p == '/browse-folder':
            length = int(self.headers.get('Content-Length', 0))
            body = {}
            if length:
                try:
                    body = json.loads(self.rfile.read(length))
                except Exception:
                    self.json_resp({'error': 'Invalid JSON'}, 400)
                    return

            start_dir = body.get('start_dir', '').strip().strip('"\'')
            try:
                path = _browse_for_folder(start_dir)
            except RuntimeError as e:
                self.json_resp({'error': str(e)}, 500)
                return
            except Exception as e:
                self.json_resp({'error': f'Unable to open folder browser: {e}'}, 500)
                return

            self.json_resp({'path': path})

        elif p == '/analyze':
            length = int(self.headers.get('Content-Length', 0))
            try:
                body = json.loads(self.rfile.read(length))
            except Exception:
                self.json_resp({'error': 'Invalid JSON'}, 400)
                return

            root = body.get('path', '').strip().strip('"\'')
            if not root or not os.path.isdir(root):
                self.json_resp({'error': f'Path not found or not a directory: {root}'}, 400)
                return

            jid = str(uuid.uuid4())[:8]
            with JOBS_LOCK:
                JOBS[jid] = _make_job_dict(root)
            _run_analysis_thread(jid, root)
            print(f'[START] Job {jid}: {root}')
            self.json_resp({'job_id': jid})

        elif p == '/upload-zip':
            length = int(self.headers.get('Content-Length', 0))
            if length > ZIP_MAX_BYTES:
                self.json_resp({'error': f'ZIP exceeds {ZIP_MAX_BYTES // 1024 // 1024} MB limit'}, 413)
                return
            if length == 0:
                self.json_resp({'error': 'Empty body'}, 400)
                return
            data = self.rfile.read(length)
            try:
                root, tmp_dir = _extract_zip(data)
            except (ValueError, Exception) as e:
                self.json_resp({'error': str(e)}, 400)
                return
            jid = str(uuid.uuid4())[:8]
            with JOBS_LOCK:
                JOBS[jid] = _make_job_dict(root, temp_dir=tmp_dir)
            _run_analysis_thread(jid, root)
            print(f'[START-ZIP] Job {jid}: extracted to {root}')
            self.json_resp({'job_id': jid})

        elif p == '/analyze-git':
            length = int(self.headers.get('Content-Length', 0))
            try:
                body = json.loads(self.rfile.read(length))
            except Exception:
                self.json_resp({'error': 'Invalid JSON'}, 400)
                return
            url = body.get('url', '').strip()
            if not url:
                self.json_resp({'error': 'Missing url'}, 400)
                return
            if not (url.startswith('https://') or url.startswith('git@') or url.startswith('ssh://')):
                self.json_resp({'error': 'URL must start with https://, git@, or ssh://'}, 400)
                return
            tmp_dir = tempfile.mkdtemp(prefix='vizcode_git_')
            jid = str(uuid.uuid4())[:8]
            with JOBS_LOCK:
                JOBS[jid] = _make_job_dict(tmp_dir, temp_dir=tmp_dir)

            def git_pre():
                _clone_git_repo(url, tmp_dir, jid)
                return tmp_dir

            _run_analysis_thread(jid, tmp_dir, pre_fn=git_pre)
            print(f'[START-GIT] Job {jid}: {url}')
            self.json_resp({'job_id': jid})

        elif p == '/analyze-npm':
            length = int(self.headers.get('Content-Length', 0))
            try:
                body = json.loads(self.rfile.read(length))
            except Exception:
                self.json_resp({'error': 'Invalid JSON'}, 400)
                return
            pkg = body.get('package', '').strip()
            if not pkg:
                self.json_resp({'error': 'Missing package'}, 400)
                return
            tmp_dir = tempfile.mkdtemp(prefix='vizcode_npm_')
            jid = str(uuid.uuid4())[:8]
            with JOBS_LOCK:
                JOBS[jid] = _make_job_dict(tmp_dir, temp_dir=tmp_dir)

            def npm_pre():
                return _fetch_npm_package(pkg, tmp_dir, jid)

            _run_analysis_thread(jid, tmp_dir, pre_fn=npm_pre)
            print(f'[START-NPM] Job {jid}: {pkg}')
            self.json_resp({'job_id': jid})

        elif p == '/cancel':
            self.json_resp({'ok': True})

        else:
            self.json_resp({'error': 'Not found'}, 404)

    # ── Helpers ───────────────────────────────────────────────────────────────
    def serve_disk(self, filepath, content_type):
        if not os.path.isabs(filepath):
            filepath = os.path.join(SCRIPT_DIR, filepath)
        try:
            data = Path(filepath).read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', f'{content_type}; charset=utf-8')
            self.send_header('Content-Length', len(data))
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.json_resp({'error': f'File not found: {filepath}'}, 404)

    def html_error(self, msg):
        body = f'<!DOCTYPE html><html><body style="background:#050a0f;color:#f87171;font-family:monospace;padding:40px"><h2>BIOSVIZ Error</h2><pre>{msg}</pre><a href="/" style="color:#00d4ff">← Back</a></body></html>'.encode()
        self.send_response(500)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def json_resp(self, data, code=200):
        def _default(o):
            if isinstance(o, (set, frozenset)): return sorted(o)
            raise TypeError(f'Not serialisable: {type(o)}')
        body = json.dumps(data, ensure_ascii=False, default=_default).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    threading.Thread(target=_reap_loop, daemon=True, name='temp-reaper').start()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    server = HTTPServer(('127.0.0.1', port), Handler)
    url = f'http://localhost:{port}'
    print('-----------------------------------------')
    print(f'  VIZCODE V4 -> {url}')
    print('  BIOS / Python / JS/TS / Go')
    print('-----------------------------------------')
    print(f'Open Chrome and go to: {url}')
    print(f'Press Ctrl+C to stop\n')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')


if __name__ == '__main__':
    main()
