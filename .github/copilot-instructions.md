---
applyTo: "**"
---

> **Note:** GitHub Copilot does not support MCP. Use the static report files below instead of calling MCP tools.

## 無 MCP 時：靜態報告導航

Run scan first:
```bash
python vizcode.py <project_path> --scan-only
```

Then read in order:
1. `.local/INDEX.md` — L0 module overview (always start here, ~100-200 lines)
2. `.local/L1/<module>.md` — file map for a specific module (~30-70 lines)
3. `.local/L2/<module>/<file>.md` — function call graph for a specific file (~50-100 lines)

**Do not read** `.local/scan_cache.json` or `.local/semantic_cache.json` directly.

---
