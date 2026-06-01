#!/usr/bin/env bash
# launch.sh — VIZCODE launcher for macOS / Linux (POSIX equivalent of launch.bat)
# Zero pip dependencies — pure Python stdlib only.
set -euo pipefail

# Always run from the repo root (directory of this script).
cd "$(dirname "$0")"

MIN_PYTHON="3.6"

# Prefer python3, fall back to python.
PY=""
for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
        PY="$candidate"
        break
    fi
done

if [ -z "$PY" ]; then
    echo "[ERROR] Python is not installed."
    echo "Install Python ${MIN_PYTHON}+ first:"
    echo "  macOS:  brew install python   (or https://www.python.org/downloads/)"
    echo "  Linux:  sudo apt install python3   (or your distro's package manager)"
    exit 1
fi

# Require Python 3.6+.
if ! "$PY" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 6) else 1)"; then
    echo "[ERROR] Python ${MIN_PYTHON} or newer is required."
    echo "Detected: $("$PY" --version 2>&1)"
    exit 1
fi

# Force UTF-8 I/O (matches launch.bat chcp 65001 behavior).
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

exec "$PY" src/vizcode.py "$@"
