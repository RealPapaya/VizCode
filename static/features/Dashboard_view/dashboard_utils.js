// @module Dashboard_view/dashboard_utils
// Small formatting and DATA-walking helpers shared by every widget.

function _dashFmtNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

function _dashFmtBytes(b) {
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(2) + ' MB';
}

function _dashEscape(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _dashFlatFiles() {
    if (!window.DATA) return [];
    const out = [];
    for (const [, files] of Object.entries(DATA.files_by_module || {})) {
        for (const f of files) out.push(f);
    }
    return out;
}

function _dashAllEdges() {
    if (!window.DATA) return [];
    const out = [];
    for (const [, edges] of Object.entries(DATA.file_edges_by_module || {})) {
        for (const e of edges) out.push(e);
    }
    return out;
}

// Translate a key with i18n if available, otherwise fall back to the key itself.
function _dashT(key) {
    if (typeof T === 'function') {
        try {
            const out = T(key);
            if (out && out !== key) return out;
        } catch (_) { /* ignore */ }
    }
    return key;
}

// Single drill-through helper used by every clickable row. Closes the
// dashboard, navigates to the file, and (optionally) opens the code panel
// at the named function. Replaces the per-widget _dashJumpToFile /
// _dashJumpToFunction copies that lived in widget_duplication.js and
// widget_complexity.js.
function _dashDrill(filePath, funcName) {
    if (!filePath) return;
    if (typeof closeDashboard === 'function') closeDashboard();
    const target = _dashFlatFiles().find(f =>
        (f.path || '').replace(/\\/g, '/') === String(filePath).replace(/\\/g, '/')
    );
    if (!target || typeof drillFile !== 'function') return;
    drillFile(target);
    if (funcName && typeof openCodePanel === 'function') {
        setTimeout(() => openCodePanel(target, funcName), 300);
    }
}
