// @module viz — Boot file: DOMContentLoaded, global tooltip, keyboard, context menu
// This is the main entry point. All other viz_*.js modules are loaded before this.

/* viz.js — BIOSVIZ Visualization Logic v3
   CodeViz-style: graph on left, live source code on right.
   Uses cytoscape.js (canvas). No D3. No SVG renderer.
*/

// Block browser zoom on the whole page. Ctrl+wheel changes devicePixelRatio
// which causes canvas-backed views (Chart.js, cytoscape, Sigma) to clear and
// not reliably redraw, producing "disappearing chart" bugs that look like
// rendering glitches. Capture phase + passive:false so we can preventDefault
// before any nested handler sees the event. Pinch-zoom on trackpads dispatches
// wheel events with ctrlKey=true and is covered by the same handler.
(function _blockPageZoom() {
    const stop = e => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
        }
    };
    window.addEventListener('wheel', stop, { passive: false, capture: true });
    // Keyboard zoom shortcuts (Ctrl/Cmd with +, -, =, 0) — eliminate this
    // variable too while we're at it.
    window.addEventListener('keydown', e => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0') {
            e.preventDefault();
            e.stopPropagation();
        }
    }, { capture: true });
})();


// ─── Init ─────────────────────────────────────────────────────────────────────

// ─── Global themed tooltip ────────────────────────────────────────────────────
const _gtip = { el: null, timer: null, DELAY: 380 };
const _jobViewerLease = {
    jobId: window.JOB_ID || null,
    viewerId: null as any,
    openPromise: null as any,
    pingTimer: null as any,
    pingMs: 20000,
    closeSent: false,
    _initDone: false,
};

function _initGlobalTooltip() {
    const el = document.createElement('div');
    el.id = 'g-tooltip';
    document.body.appendChild(el);
    _gtip.el = el;
    // Migrate static title= → data-tip= to suppress browser tooltip
    document.querySelectorAll('[title]').forEach(n => {
        const t = n.getAttribute('title');
        if (!t) return;
        n.setAttribute('data-tip', t);
        n.removeAttribute('title');
    });
        document.addEventListener('mouseover', _gtipOver, true);
    document.addEventListener('mouseout', _gtipOut, true);
    document.addEventListener('mousemove', _gtipMove, true);
    document.addEventListener('scroll', () => _gtipHide(), true);
    document.addEventListener('keydown', () => _gtipHide(), true);
    // Hide tooltip immediately on any click (prevents sticky tooltip after button press)
    document.addEventListener('mousedown', () => _gtipHide(), true);
}
function _gtipOver(e) {
    // Lazily migrate dynamically-set title= attributes (static ones are migrated at init)
    const raw = e.target.closest('[title]');
    if (raw) { raw.dataset.tip = raw.getAttribute('title'); raw.removeAttribute('title'); }
    const t = e.target.closest('[data-tip]'); if (!t) return;
    clearTimeout(_gtip.timer);
    _gtip.timer = setTimeout(() => _gtipShow(t, e), _gtip.DELAY);
}
function _gtipOut(e) {
    if (!e.target.closest('[data-tip]')) return;
    clearTimeout(_gtip.timer); _gtipHide();
}
function _gtipMove(e) {
    if (_gtip.el && _gtip.el.style.display !== 'none') _gtipPos(e.clientX, e.clientY);
}
function _gtipShow(target, e) {
    const raw = target.dataset.tip || ''; if (!raw) return;
    const lines = raw.split('\n');
    _gtip.el.innerHTML = lines.map((l, i) => {
        if (i === 0) return `<strong class="gt-head">${escapeHtml(l)}</strong>`;
        if (l.startsWith('⚠')) return `<span class="gt-warn">${escapeHtml(l)}</span>`;
        return `<span class="gt-line">${escapeHtml(l)}</span>`;
    }).join('');
    _gtip.el.style.display = 'block';
    requestAnimationFrame(() => { _gtipPos(e.clientX, e.clientY); _gtip.el.classList.add('g-tip-visible'); });
}
function _gtipHide() {
    clearTimeout(_gtip.timer);
    if (!_gtip.el) return;
    _gtip.el.classList.remove('g-tip-visible');
    _gtip.el.style.display = 'none';
}
function _gtipPos(mx, my) {
    const el = _gtip.el; if (!el) return;
    const W = window.innerWidth, H = window.innerHeight, TW = el.offsetWidth || 220, TH = el.offsetHeight || 40, G = 14;
    let x = mx + G, y = my + G;
    if (x + TW > W - 8) x = mx - TW - G;
    if (y + TH > H - 8) y = my - TH - G;
    el.style.left = `${Math.max(4, x)}px`; el.style.top = `${Math.max(4, y)}px`;
}

async function _jobViewerPost(path, payload, keepalive = false) {
    return fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive,
    });
}

async function _jobViewerOpen(forceNew = false) {
    if (!_jobViewerLease.jobId) return null;
    if (!forceNew && _jobViewerLease.viewerId) return _jobViewerLease.viewerId;
    if (_jobViewerLease.openPromise) return _jobViewerLease.openPromise;
    _jobViewerLease.openPromise = (async () => {
        const res = await _jobViewerPost('/job-view/open', { job_id: _jobViewerLease.jobId });
        if (!res.ok) throw new Error(`viewer open failed (${res.status})`);
        const data = await res.json();
        if (!data.viewer_id) throw new Error('viewer open missing viewer_id');
        _jobViewerLease.viewerId = data.viewer_id;
        _jobViewerLease.closeSent = false;
        if (Number.isFinite(data.ping_interval_seconds) && data.ping_interval_seconds > 0) {
            _jobViewerLease.pingMs = Math.max(5000, data.ping_interval_seconds * 1000);
        }
        return _jobViewerLease.viewerId;
    })();
    try {
        return await _jobViewerLease.openPromise;
    } finally {
        _jobViewerLease.openPromise = null;
    }
}

function _jobViewerStopHeartbeat() {
    if (_jobViewerLease.pingTimer) {
        clearInterval(_jobViewerLease.pingTimer);
        _jobViewerLease.pingTimer = null;
    }
}

function _jobViewerStartHeartbeat() {
    if (!_jobViewerLease.jobId || _jobViewerLease.pingTimer) return;
    _jobViewerLease.pingTimer = setInterval(async () => {
        try {
            if (!_jobViewerLease.viewerId) {
                await _jobViewerOpen(true);
                return;
            }
            const res = await _jobViewerPost('/job-view/ping', {
                job_id: _jobViewerLease.jobId,
                viewer_id: _jobViewerLease.viewerId,
            });
            if (res.ok) return;
            let data = null;
            try { data = await res.json(); } catch (err) { data = null; }
            if (res.status === 404 || (data && data.error === 'Unknown viewer')) {
                _jobViewerLease.viewerId = null;
                _jobViewerLease.closeSent = false;
                await _jobViewerOpen(true);
            }
        } catch (err) {
            console.warn('viewer heartbeat failed', err);
        }
    }, _jobViewerLease.pingMs);
}

function _jobViewerClose(useBeacon = false) {
    const jobId = _jobViewerLease.jobId;
    const viewerId = _jobViewerLease.viewerId;
    if (!jobId || !viewerId || _jobViewerLease.closeSent) return;
    _jobViewerLease.closeSent = true;
    _jobViewerLease.viewerId = null;
    const payload = JSON.stringify({ job_id: jobId, viewer_id: viewerId });
    if (useBeacon && navigator.sendBeacon) {
        const ok = navigator.sendBeacon('/job-view/close', new Blob([payload], { type: 'application/json' }));
        if (ok) return;
    }
    fetch('/job-view/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
    }).catch(() => { });
}

function _jobViewerHandlePageHide(ev) {
    _jobViewerStopHeartbeat();
    if (ev && ev.persisted) return;
    _jobViewerClose(true);
}

function _jobViewerHandlePageShow() {
    if (!_jobViewerLease.jobId) return;
    _jobViewerLease.closeSent = false;
    _jobViewerOpen().then(() => {
        _jobViewerStopHeartbeat();
        _jobViewerStartHeartbeat();
    }).catch(err => console.warn('viewer open failed', err));
}

function _jobViewerInit() {
    if (!_jobViewerLease.jobId || _jobViewerLease._initDone) return;
    _jobViewerLease._initDone = true;
    window.addEventListener('pagehide', _jobViewerHandlePageHide, true);
    window.addEventListener('beforeunload', _jobViewerHandlePageHide, true);
    window.addEventListener('pageshow', _jobViewerHandlePageShow, true);
    _jobViewerHandlePageShow();
}

window.addEventListener('DOMContentLoaded', () => {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            try {
                const el = document.getElementById('viz-data');
                if (!el) { showMsg(T('errorNoDataElement')); return; }

                document.getElementById('loading-msg').textContent = '🔍 Parsing graph data...';
                const t0 = performance.now();
                window.DATA = JSON.parse(el.textContent);
                console.log(`JSON.parse: ${(performance.now() - t0).toFixed(0)}ms`);

                if (!window.DATA?.stats) { showMsg(T('errorInvalidDataFormat')); return; }

                _jobViewerInit();

                const s = DATA.stats;
                const rootOther = (DATA.other_files_by_module || {})['_root'] || [];
                const rootFiles = (DATA.files_by_module || {})['_root'] || [];
                if ((rootOther.length || rootFiles.length) && Array.isArray(DATA.modules)
                    && !DATA.modules.some(m => m.id === '_root')) {
                    const rootPath = (DATA.stats?.root || '').replace(/\\/g, '/').replace(/\/$/, '');
                    const rootName = rootPath.split('/').filter(Boolean).pop() || '_root';
                    const rootFuncCount = rootFiles.reduce((sum, f) => sum + (f.func_count || 0), 0);
                    DATA.modules.push({
                        id: '_root',
                        label: rootName,
                        color: '#94a3b8',
                        file_count: rootFiles.length,
                        func_count: rootFuncCount,
                        other_count: rootOther.length,
                    });
                }
                                                const totalFiles = s.total_all_files ?? (s.files + (s.other_files || 0));
                if (document.getElementById('st-files')) document.getElementById('st-files').textContent = totalFiles.toLocaleString();
                if (document.getElementById('st-mods')) document.getElementById('st-mods').textContent = String((DATA.modules || []).length || s.modules);
                if (document.getElementById('st-funcs')) document.getElementById('st-funcs').textContent = s.functions.toLocaleString();

                buildSidebar();
                buildFileIdLookup();
                _PREFS.load();

                // Pre-apply theme colors to DATA.modules before building the initial L0 graph
                if (typeof _applyThemeModuleColors === 'function') {
                    _applyThemeModuleColors(_PREFS.get('theme') || 'dark');
                }

                initCy();
                loadLevel0();

                document.getElementById('search').addEventListener('input', onSearch);
                document.addEventListener('keydown', onKey);
                document.addEventListener('click', () => hideCtxMenu());
                // Prevent default browser context menu everywhere.
                // L1/L2 right-click (Cytoscape cxttap → onNodeRightClick) is unaffected
                // because it fires through Cytoscape's own event system, not the DOM contextmenu event.
                document.addEventListener('contextmenu', e => e.preventDefault());

                // Code panel init
                initCodePanel();

                // Preferences init
                initPreferences();
                syncTopbarModeButtons();

                // Search system init (must be after DATA loads)
                initSearch();

                // L1 toolbar init
                initL1Toolbar();

                // L2 toolbar init
                initL2Toolbar();

                // Tooltip actions init
                initTooltipActions();

                // Layout Switcher init
                initLayoutSwitcher();
                initGraphZoomControls();
                _initGlobalTooltip();
                // Probe which advanced layouts actually loaded (needs cy + switcher to exist)
                _probeAvailableLayouts();

                // Sidebar tabs, edge filter, legend, and stats
                initIconRail();
                initSidebarTabs();
                updateFilterTabEnabled();
                buildEdgeFilter();
                buildNodeLegend();
                updateSidebarStats();
                if (typeof scheduleGalaxyPrecompute === 'function') scheduleGalaxyPrecompute();
                // Chat panel init (VizBridge)
                if (typeof window.initChat === 'function') window.initChat();

                // Ensure Canvas redraws after Google Fonts are fully loaded
                document.fonts.ready.then(() => {
                    if (cy) applyCyFont(getSavedFont());
                });
            } catch (e) {
                showMsg('Error: ' + e.message + '\n' + (e.stack || ''));
            }
        });
    });
});



// ─── Keyboard ─────────────────────────────────────────────────────────────────
function onKey(e) {
    const tag = e.target.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA';
    if (e.key === '/') {
        if (!inInput) { e.preventDefault(); document.getElementById('search').focus(); }
        return;
    }
    if (inInput) return;
    if (e.key === 'Escape') {
        const srPanel = document.getElementById('sr-panel');
        if (srPanel && srPanel.classList.contains('visible')) {
            (document.getElementById('search') as HTMLInputElement).value = '';
            _srState.query = '';
            _srClose();
            _resetGraphHighlightPreservingPin();
            return;
        }
        (document.getElementById('search') as HTMLInputElement).value = '';
        _resetGraphHighlightPreservingPin();
        goBack();
    }
    if (e.key === 'm' || e.key === 'M') { state.history = []; loadLevel0(); }
    if (e.key === 'c' || e.key === 'C') { document.getElementById('code-toggle-btn').click(); }
    if (e.key === 'g' || e.key === 'G') { drillCurrentFileToL2(); }
    if (e.key === 'ArrowLeft') navigateFunc(-1);
    if (e.key === 'ArrowRight') navigateFunc(1);
}

// ─── Context Menu ─────────────────────────────────────────────────────────────
function onNodeRightClick(ev, node) {
    ev.originalEvent.preventDefault();
    const menu = document.getElementById('ctx-menu');
    menu.style.display = 'block';
    menu.style.left = ev.originalEvent.clientX + 'px';
    menu.style.top = ev.originalEvent.clientY + 'px';

    document.getElementById('ctx-copy').onclick = () => {
        const d = node.data();
        const path = _nodeRelPath(d);
        navigator.clipboard?.writeText(path ? _absPath(path) : (d._m?.id || d.label)).catch(() => { });
        hideCtxMenu();
    };
    document.getElementById('ctx-open-code').onclick = () => {
        const d = node.data();
        const path = _nodeRelPath(d);
        if (path && d._t !== 'module') loadFileInPanel(path);
        else if (d._t === 'module') drillToModule(d._m.id);
        hideCtxMenu();
    };
    document.getElementById('ctx-vscode').onclick = () => {
        const d = node.data();
        const path = _nodeRelPath(d);
        if (path) _openPath(path, 'vscode');
        else if (typeof showToast === 'function') showToast('No file path for this node', 'error');
        hideCtxMenu();
    };
    document.getElementById('ctx-reveal-explorer').onclick = () => {
        const d = node.data();
        const path = _nodeRelPath(d);
        if (path) _openPath(path, d._t === 'module' ? 'folder' : 'reveal');
        else if (typeof showToast === 'function') showToast('No file path for this node', 'error');
        hideCtxMenu();
    };
    document.getElementById('ctx-pin').onclick = () => {
        const id = node.id();
        if (state.pinnedNodes.has(id)) { state.pinnedNodes.delete(id); node.unlock(); }
        else { state.pinnedNodes.add(id); node.lock(); }
        hideCtxMenu();
    };
}

function hideCtxMenu() { document.getElementById('ctx-menu').style.display = 'none'; }

// ─── Shared path opener (calls server /open-path) ─────────────────────────
function _nodeRelPath(d) {
    if (!d) return '';
    if (typeof d._f === 'string') return d._f;
    if (d._f?.path) return d._f.path;
    if (typeof d._file === 'string') return d._file;
    if (typeof d._path === 'string') return d._path;
    if (Array.isArray(d._files) && d._files.length) return d._files[0];
    if (d._t === 'module' && d._m?.id) return d._m.id === '_root' ? '.' : d._m.id;
    return '';
}

function _absPath(relPath) {
    const root = (DATA?.stats?.root || '').replace(/\\/g, '/').replace(/\/$/, '');
    return root + '/' + relPath;
}

async function _openPath(relPath, action = 'reveal') {
    if (!relPath) return false;
    const jobId = window.JOB_ID || '';
    if (!jobId) {
        console.warn('Cannot open path without an active job id:', relPath);
        if (typeof showToast === 'function') showToast('Cannot open path: missing job id', 'error');
        return false;
    }
    try {
        const res = await _jobViewerPost('/open-path', {
            job_id: jobId,
            path: relPath,
            action,
        });
        if (!res.ok) {
            let msg = `open-path failed (${res.status})`;
            try {
                const data = await res.json();
                if (data?.error) msg = data.error;
            } catch (_) {}
            throw new Error(msg);
        }
        return true;
    } catch (err) {
        console.error('Failed to open path:', err);
        if (typeof showToast === 'function') showToast(`Failed to open path: ${err.message || err}`, 'error');
        return false;
    }
}

// ─── Helper: switch sidebar to Explorer tab ───────────────────────────
function _sbSwitchToExplorer() {
    const tab = document.querySelector('.sb-tab[data-tab="explorer"]') as HTMLElement | null;
    if (tab) tab.click();
}

// ─── Explorer sidebar context menu ─────────────────────────────────────────
let _expCtxMenu = null;
const _svgCopy   = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const _svgFile   = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const _svgVscode = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
const _svgFolder = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';

function _showExplorerCtxMenu(e, filePath, isFolder) {
    e.preventDefault();
    e.stopPropagation();
    if (!_expCtxMenu) {
        _expCtxMenu = document.createElement('div');
        _expCtxMenu.id = 'exp-ctx-menu';
        _expCtxMenu.innerHTML = `
            <div class="ctx-item" id="exp-ctx-copy"><span class="ctx-icon">${_svgCopy}</span>Copy full path</div>
            <div class="ctx-item" id="exp-ctx-view"><span class="ctx-icon">${_svgFile}</span>View source</div>
            <div class="ctx-item" id="exp-ctx-vscode"><span class="ctx-icon">${_svgVscode}</span>Open in VS Code</div>
            <div class="ctx-sep"></div>
            <div class="ctx-item" id="exp-ctx-folder"><span class="ctx-icon">${_svgFolder}</span>Show in Explorer</div>`;
        document.body.appendChild(_expCtxMenu);
        document.addEventListener('click', (ev) => {
            if (_expCtxMenu && !_expCtxMenu.contains(ev.target)) {
                _expCtxMenu.style.display = 'none';
            }
        });
    }
    const viewEl = document.getElementById('exp-ctx-view');
    if (viewEl) viewEl.style.display = isFolder ? 'none' : '';

    document.getElementById('exp-ctx-copy').onclick = (ev) => {
        ev.stopPropagation();
        navigator.clipboard?.writeText(_absPath(filePath)).catch(() => {});
        _expCtxMenu.style.display = 'none';
    };
    document.getElementById('exp-ctx-view').onclick = (ev) => {
        ev.stopPropagation();
        if (!isFolder && typeof loadFileInPanel === 'function') loadFileInPanel(filePath);
        _expCtxMenu.style.display = 'none';
    };
    document.getElementById('exp-ctx-vscode').onclick = (ev) => {
        ev.stopPropagation();
        _openPath(filePath, 'vscode');
        _expCtxMenu.style.display = 'none';
    };
    document.getElementById('exp-ctx-folder').onclick = (ev) => {
        ev.stopPropagation();
        _openPath(filePath, 'reveal');
        _expCtxMenu.style.display = 'none';
    };

    // Position (keep in viewport)
    const W = window.innerWidth, H = window.innerHeight;
    _expCtxMenu.style.display = 'block';
    const mw = _expCtxMenu.offsetWidth || 190, mh = _expCtxMenu.offsetHeight || 140;
    _expCtxMenu.style.left = (e.clientX + mw > W ? W - mw - 6 : e.clientX) + 'px';
    _expCtxMenu.style.top  = (e.clientY + mh > H ? H - mh - 6 : e.clientY) + 'px';
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function showTooltip(e) {
    if (tooltipHideTimer) clearTimeout(tooltipHideTimer);

    const d = e.target.data();
    if (!d || !d.tt) return;

    window._currentHoverNode = e.target.isNode() ? e.target : null;

    let html = '';

    if (e.target.isNode()) {
        const outCount = e.target.outgoers('edge').length;
        const inCount = e.target.incomers('edge').length;

        if (d._t === 'ext_func') {
            const fileRel = d._f || '';
            const funcName = d.fn || '';
            html += `<div class="tip-title" title="${escapeHtml(funcName)}">${escapeHtml(funcName)}</div>`;
            html += fileRel
                ? `<div class="tip-body">${escapeHtml(fileRel)}</div>`
                : `<div class="tip-body">${escapeHtml(T('tooltipUnknownTarget'))}</div>`;
            html += `<div class="tip-actions">` +
                `<button class="tip-btn" data-action="open" data-file="${encodeURIComponent(fileRel)}" data-func="${encodeURIComponent(funcName)}">${escapeHtml(T('tooltipOpenLocation'))}</button>` +
                `<button class="tip-btn" data-action="view" data-file="${encodeURIComponent(fileRel)}" data-func="${encodeURIComponent(funcName)}">${escapeHtml(T('tooltipViewFile'))}</button>` +
                `</div>`;
        } else {

            // 取得 tooltip 各行；格式: label\n§path§\nkey: val\n...
            const lines = d.tt ? d.tt.split('\n') : [];
            const titleRaw = lines[0] || '';
            const pathMatch = lines[1] && lines[1].startsWith('§') ? lines[1].slice(1, -1) : null;
            const metaLines = lines.slice(pathMatch !== null ? 2 : 1).filter(l => l.trim());

            html += `<div class="tip-title">${escapeHtml(titleRaw)}</div>`;
            if (pathMatch) {
                html += `<div class="tip-path" title="${escapeHtml(pathMatch)}">${escapeHtml(pathMatch)}</div>`;
            }

            if (metaLines.length) {
                html += `<div class="tip-body">`;
                for (const line of metaLines) {
                    const colon = line.indexOf(':');
                    if (colon > 0) {
                        const key = escapeHtml(line.slice(0, colon).trim());
                        const val = escapeHtml(line.slice(colon + 1).trim());
                        html += `<div class="tip-row"><span class="tip-row-key">${key}</span><span class="tip-row-val">${val}</span></div>`;
                    } else {
                        html += `<div class="tip-row">${escapeHtml(line)}</div>`;
                    }
                }
                html += `</div>`;
            }
        }

        // 2. 處理 dependencies 文字和顏色
        if (outCount > 0 || inCount > 0) {
            html += `<div style="margin-top:10px; border-top:1px solid #334155; padding-top:6px;">`;
            html += `<div style="font-weight:bold; margin-bottom:4px">${T('dependencies')}:</div>`;

            const OUT_MAP = {
                'Inc': T('relInclude'), 'owns': T('relOwns'), 'Src': T('relSources'), 'Pkg': T('relPackage'), 'Lib': T('relLibrary'),
                'ELINK': T('relElink'), 'Comp': T('relComponent'), 'GUID': T('relGuidRef'),
                'Strings': T('relStrings'), 'ASL': T('relAslInclude'), 'Callback': T('relCallback'),
                'HII-Pkg': T('relHiiPkg'), 'Depex': T('relDepex'),
                'Import': T('relImports'),
                'ext': T('relExternalCalls'), 'group': T('relGroup'),
                '': state.level === 2 ? T('relCalls') : T('relIncludes')
            };
            const IN_MAP = {
                'Inc': T('relIncludedBy'), 'owns': T('relOwnedBy'), 'Src': T('relSourceOf'), 'Pkg': T('relPackagedIn'), 'Lib': T('relUsedAsLibBy'),
                'ELINK': T('relElinkParentOf'), 'Comp': T('relUsedAsCompBy'), 'GUID': T('relReferencedGuidBy'),
                'Strings': T('relReferencedAsStringBy'), 'ASL': T('relIncludedByAsl'), 'Callback': T('relTriggeredBy'),
                'HII-Pkg': T('relPackagedInHii'), 'Depex': T('relDependedBy'),
                'Import': T('relImportedBy'),
                'ext': T('relExternalCallers'), 'group': T('relGroup'),
                '': state.level === 2 ? T('relCalledBy') : T('relIncludedBy')
            };

            const outGroups = {};
            e.target.outgoers('edge').forEach(edge => {
                const lbl = edge.data('el') || '';
                const col = edge.data('ec') || '#f59e0b';
                const outTxt = OUT_MAP[lbl] || lbl || 'outgoing';
                const key = outTxt + '|' + col;
                outGroups[key] = (outGroups[key] || 0) + 1;
            });

            const inGroups = {};
            e.target.incomers('edge').forEach(edge => {
                const lbl = edge.data('el') || '';
                const col = edge.data('ec') || '#10b981';
                const inTxt = IN_MAP[lbl] || lbl || 'incoming';
                const key = inTxt + '|' + col;
                inGroups[key] = (inGroups[key] || 0) + 1;
            });

            for (const [key, count] of Object.entries(outGroups)) {
                const [lbl, col] = key.split('|');
                html += `<div style="color:${col}">• ${lbl}: ${count}</div>`;
            }
            for (const [key, count] of Object.entries(inGroups)) {
                const [lbl, col] = key.split('|');
                html += `<div style="color:${col}">• ${lbl}: ${count}</div>`;
            }

            html += `</div>`;
        }
        } else {
        // Edge tooltip — skip for L2 (Call Flow)
        if (state.level === 2) return;
        
        // Edge tooltip — show text + semantic kind badge
        const kindBadge = d.kind
            ? `<span style="font-size:10px;color:#94a3b8;margin-left:6px;opacity:0.8">[${escapeHtml(d.kind)}]</span>`
            : '';
        html = `<div>${escapeHtml(d.tt).replace(/\n/g, '<br>')}${kindBadge}</div>`;
    }

        const tip = document.getElementById('tooltip');
    if (document.getElementById('node-modal-backdrop')?.classList.contains('show')) {
        return; // Don't show tooltip if modal is open
    }

    // ── 簡略標題（只顯示檔名）──────────────────────────────────────────────────
    let briefName = '';
    if (e.target.isNode()) {
        const d2 = e.target.data();
        if (d2._t === 'module') {
            briefName = d2._m?.id || d2.label || '';
        } else if (d2._t === 'ext_func' || d2._t === 'drilled_func') {
            briefName = d2.fn || d2.label || '';
        } else if (d2._f?.path) {
            briefName = d2._f.path.split('/').pop();
        } else if (d2._f?.label) {
            briefName = d2._f.label;
        } else {
            const lines = (d2.tt || '').split('\n');
            briefName = lines[0] || d2.label || '';
        }
    }

    // 完整內容包在 .tip-full 中，hover 時展開
    const fullHtml = briefName
        ? `<div class="tip-brief">${escapeHtml(briefName)}</div><div class="tip-full">${html}</div>`
        : html;

    tip.innerHTML = fullHtml;
    tip.style.display = 'block';
    tip.style.left = (e.originalEvent.clientX + 32) + 'px';
    tip.style.top = (e.originalEvent.clientY + 32) + 'px';
}
function hideTooltip() { document.getElementById('tooltip').style.display = 'none'; }

function scheduleHideTooltip() {
    if (tooltipHideTimer) clearTimeout(tooltipHideTimer);
    tooltipHideTimer = setTimeout(() => {
        if (!tooltipPinned) {
            hideTooltip();
            if (_hlPinned && _hlPinnedNode) {
                // Restore pinned node's highlight after hover-away
                highlightNode(_hlPinnedNode);
            } else {
                clearHighlight();
            }
        }
    }, 120);
}


// ─── Graph Legend ─────────────────────────────────────────────────────────────


function buildLegend() { /* removed — legend moved into Filters sidebar tab */ }

// ─── Dynamic Legend Refresh ───────────────────────────────────────────────────
// Legend is now rendered inside the Filters sidebar tab via buildEdgeFilter()
// and buildNodeLegend(). This function is kept as a thin shim that removes any
// leftover floating legend elements from older sessions.
function refreshLegend() {
    const old = document.getElementById('graph-legend');
    if (old) old.remove();
    buildNodeLegend();
}

// Call on init
document.addEventListener('DOMContentLoaded', buildLegend);

