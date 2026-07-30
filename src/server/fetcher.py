"""
fetcher.py — VIZCODE Input-Source Helpers
Extracted from server.py: ZIP extraction, git clone, npm package fetch.
"""

import os, subprocess, zipfile, tarfile, tempfile, shutil, io, json
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

from job_manager import JOBS, JOBS_LOCK

# ─── Size limits ──────────────────────────────────────────────────────────────
ZIP_MAX_BYTES         = 200 * 1024 * 1024   # 200 MB upload cap
NPM_TARBALL_MAX_BYTES =  50 * 1024 * 1024   # 50 MB npm tarball cap


def _extract_zip(data: bytes):
    """Extract ZIP bytes to a temp dir. Returns (analyze_root, temp_dir)."""
    tmp_dir = tempfile.mkdtemp(prefix='vizcode_zip_')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for member in zf.namelist():
                if os.path.isabs(member) or '..' in member.split('/'):
                    raise ValueError(f'Unsafe path in ZIP: {member}')
            zf.extractall(tmp_dir)
    except zipfile.BadZipFile:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise ValueError('Invalid or corrupted ZIP file')

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
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=120,
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
            for member in tf.getmembers():
                if os.path.isabs(member.name) or '..' in member.name.split('/'):
                    raise ValueError(f'Unsafe path in tarball: {member.name}')
                if member.issym() or member.islnk():
                    raise ValueError(f'Link entry not allowed in tarball: {member.name}')
            tf.extractall(tmp_dir)
    except Exception as e:
        raise RuntimeError(f'Failed to extract tarball: {e}')
    pkg_dir = os.path.join(tmp_dir, 'package')
    return pkg_dir if os.path.isdir(pkg_dir) else tmp_dir


def _fetch_npm_package(spec: str, tmp_dir: str, jid: str) -> str:
    """Fetch and extract an npm package. Returns analyze_root."""
    name, _, version = spec.partition('@') if not spec.startswith('@') else (spec, '', '')
    if spec.startswith('@'):
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
