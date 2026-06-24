// @module viz_code_panel — Code panel: init, open/close, file loading, renderers
// Owns: initCodePanel, openCodePanel, closeCodePanel, loadFileInPanel,
//       renderFileContent, renderCode, renderImage, renderPDF, renderHexDump,
//       jumpToFunc, jumpToLine, showFuncBar, hideFuncBar, navigateFunc,
//       showCpLoading, showCpError, initResizer, initSidebarResizer,
//       cpToggleMultiSnip, _cpSyncMultiSnipBtn, cpExitMultiSnip
// Office rendering delegated to file_viewers/viz_office.js \n
// ─── Code Panel ──────────────────────────────────────────────────────────────
function initCodePanel() {
    document.getElementById('cp-close').onclick = closeCodePanel;
    const codeViewBtn = document.getElementById('cp-view-code');
    const renderedViewBtn = document.getElementById('cp-view-rendered');
    if (codeViewBtn) codeViewBtn.onclick = () => setCodePanelViewMode('code');
    if (renderedViewBtn) renderedViewBtn.onclick = () => setCodePanelViewMode('markdown');

    document.getElementById('code-toggle-btn').onclick = () => {
        if (codeState.isOpen) {
            closeCodePanel();
        } else {
            codeState.userClosed = false; // user wants panel open
            // If we have a current file loaded, sync it
            if (codeState.currentFile) {
                _syncCodePanel(codeState.currentFile, codeState.currentFunc);
            } else {
                openCodePanel();
            }
        }
    };

    initLevelSwitcher();

    document.getElementById('cp-prev-func').onclick = () => navigateFunc(-1);
    document.getElementById('cp-next-func').onclick = () => navigateFunc(1);

    // Resizer drag
    initResizer();
    initSidebarResizer();
}

// ─── Level Switcher ──────────────────────────────────────────────────────────
let _lswIdx = 0;        // current visual/drag index
let _lswActualIdx = 0;  // last committed index (action fired)
let _lswDragStart = null;
let _lswDragStartIdx = 0;
let _lswDragging = false;
let _lswMode = 'levels';
let _lswSegCount = 4;
const _LSW_LEVEL_LABELS = [
    { label: 'L0 Map', title: 'Module Graph' },
    { label: 'L1 Graph', title: 'File Graph' },
    { label: 'L2 Flow', title: 'Call Flow' },
    { label: 'L3 Structure', title: 'Structure' },
];
const _LSW_OVERVIEW_LABELS = [
    { label: 'Galaxy', title: 'Galaxy Graph', icon: '<svg viewBox="0 0 256 256" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M241.47,30.53a36,36,0,0,0-50.92,0h0a36.06,36.06,0,0,0-1.2,49.66l-23.83,44.26a36.08,36.08,0,0,0-21,3.07l-16-16a36,36,0,0,0-57.94-41h0a36,36,0,0,0-1.2,49.66L45.5,164.45a36,36,0,0,0-31,10.1h0a36,36,0,1,0,52.12,1.26l23.83-44.26A35.21,35.21,0,0,0,96,132a36.07,36.07,0,0,0,15.51-3.5l16,16a36,36,0,1,0,59.14-8.68L210.5,91.55A36.32,36.32,0,0,0,216,92a36,36,0,0,0,25.46-61.45Zm-154,57a12,12,0,0,1,17,17h0a12,12,0,0,1-17-17Zm-39,121a12,12,0,1,1,0-17A12,12,0,0,1,48.47,208.5Zm120-40a12,12,0,1,1,0-17A12,12,0,0,1,168.49,168.49Zm56-104a12,12,0,1,1,0-17A12,12,0,0,1,224.5,64.48Z"/></svg>' },
    { label: 'Treemap', title: 'Treemap', icon: '<svg viewBox="0 0 256 256" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M216,36H40A20,20,0,0,0,20,56V200a20,20,0,0,0,20,20H216a20,20,0,0,0,20-20V56A20,20,0,0,0,216,36Zm-4,24V92H44V60ZM44,116H92v80H44Zm72,80V116h96v80Z"/></svg>' },
    { label: 'Sankey', title: 'Sankey Flow', icon: '<svg viewBox="0 0 256 256" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M28,40h24v176H28Zm176,0h24v176h-24ZM60,56l136,44v28L60,84Zm0,144 136-60v-28L60,172Z"/></svg>' },
];

function _lswApplyLabels(labels) {
    const bar = document.getElementById('level-switcher');
    if (!bar) return;
    const segs = bar.querySelectorAll('.lsw-seg');
    segs.forEach((seg, i) => {
        const def = labels[i];
        seg.style.display = def ? '' : 'none';
        seg.classList.remove('lsw-unavailable');
        if (!def) return;
        seg.title = def.title;
        const existing = seg.querySelector('.lsw-seg-icon');
        if (existing) existing.remove();
        const label = seg.querySelector('.lsw-label');
        if (label) label.textContent = def.label;
        if (def.icon && label) {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'lsw-seg-icon';
            iconSpan.innerHTML = def.icon;
            seg.insertBefore(iconSpan, label);
        }
    });
    bar.style.setProperty('--lsw-seg-count', String(labels.length));
}

function _lswTriggerOverview(idx) {
    const mode = idx === 2 ? 'sankey' : (idx === 1 ? 'treemap' : 'galaxy');
    if (typeof window.setOverviewMode === 'function') {
        window.setOverviewMode(mode);
    }
}

function _lswSetActive(idx, trigger) {
    const bar = document.getElementById('level-switcher');
    if (!bar) return;
    const maxIdx = Math.max(0, _lswSegCount - 1);
    idx = Math.max(0, Math.min(maxIdx, idx));

    // During trigger: check availability before committing
    if (trigger) {
        const segs = bar.querySelectorAll('.lsw-seg');
        if (segs[idx]?.classList.contains('lsw-unavailable')) {
            if (segs[idx]) {
                segs[idx].style.color = '#f87171';
                setTimeout(() => { segs[idx].style.color = ''; }, 600);
            }
            // Revert pill to committed state
            setTimeout(() => _lswSetActive(_lswActualIdx, false), 30);
            return;
        }
        _lswActualIdx = idx;
        window._lswCurrentIdx = idx;
    }

    _lswIdx = idx;
    bar.querySelectorAll('.lsw-seg').forEach((s, i) => s.classList.toggle('lsw-active', i === idx));
    const pill = bar.querySelector('.lsw-pill');
    if (pill) pill.style.transform = `translateX(${idx * 100}%)`;

    if (!trigger) return;

    if (_lswMode === 'overview') {
        _lswTriggerOverview(idx);
        return;
    }

    if (idx === 0) {
        if (window._sv && window._sv.active) symViewClose();
        if (typeof loadLevel0 === 'function') {
            state.history = [];
            loadLevel0();
        }
    } else if (idx === 1) {
        if (window._sv && window._sv.active) symViewClose();
        if (state.level >= 2) restoreL1FromCallGraph();
    } else if (idx === 2) {
        const symActive = window._sv && window._sv.active;
        if (symActive) {
            symViewClose();
            if (state.level < 2 && typeof drillCurrentFileToL2 === 'function') {
                drillCurrentFileToL2();
            } else {
                updateCallGraphBtn(state.activeFile || codeState.currentFile || null);
            }
            return;
        }
        if (state.level !== 2) drillCurrentFileToL2();
    } else if (idx === 3) {
        if (window._sv && window._sv.active) { symViewClose(); return; }
        const fileRel = codeState.currentFile;
        if (window.symViewOpen && fileRel && DATA && DATA.symbol_index) {
            const hasSymbols = Object.values(DATA.symbol_index).some(s => s.file === fileRel);
            if (hasSymbols) { symViewOpen(fileRel); return; }
        }
    }
}

// External API — update visual state without triggering navigation
window._lswUpdate = function (opts: any = {}) {
    const bar = document.getElementById('level-switcher');
    if (!bar) return;
    if (_lswMode === 'overview' && !opts.force) return;
    if (opts.disabled !== undefined) bar.classList.toggle('lsw-disabled', !!opts.disabled);
    const segs = bar.querySelectorAll('.lsw-seg');
    if (opts.l1Available !== undefined) segs[1]?.classList.toggle('lsw-unavailable', !opts.l1Available);
    if (opts.l2Available !== undefined) segs[2]?.classList.toggle('lsw-unavailable', !opts.l2Available);
    if (opts.l3Available !== undefined) segs[3]?.classList.toggle('lsw-unavailable', !opts.l3Available);
    if (opts.active !== undefined) {
        _lswActualIdx = opts.active;
        window._lswCurrentIdx = opts.active;
        _lswSetActive(opts.active, false);
    }
};
window._lswGetActive = () => _lswActualIdx;

function _lswSyncLevelAvailability() {
    const isL1 = state?.level === 1;
    const isL2 = state?.level >= 2;
    const fileRel = (isL1 || isL2) ? (state?.activeFile || codeState?.currentFile || null) : null;
    const hasFuncs = !!(fileRel && (DATA?.funcs_by_file?.[fileRel]?.length || 0) > 0);
    const hasSymbols = !!(fileRel && DATA?.symbol_index &&
        Object.values(DATA.symbol_index).some(s => s.file === fileRel));

    window._lswUpdate({
        l1Available: isL1 || isL2,
        l2Available: isL2 || hasFuncs,
        l3Available: !!(window._sv && window._sv.active) || hasSymbols,
    });
}
window._lswSyncLevelAvailability = _lswSyncLevelAvailability;

window._lswEnterOverview = function (activeMode = 'galaxy') {
    const bar = document.getElementById('level-switcher');
    if (!bar) return;
    _lswMode = 'overview';
    _lswSegCount = _LSW_OVERVIEW_LABELS.length;
    _lswApplyLabels(_LSW_OVERVIEW_LABELS);
    bar.classList.remove('lsw-disabled');
    bar.classList.add('lsw-overview');
    _lswSetActive(activeMode === 'sankey' ? 2 : (activeMode === 'treemap' ? 1 : 0), false);
};

window._lswExitOverview = function () {
    const bar = document.getElementById('level-switcher');
    if (!bar || _lswMode !== 'overview') return;
    _lswMode = 'levels';
    _lswSegCount = 4;
    bar.classList.remove('lsw-overview');
    _lswApplyLabels(_LSW_LEVEL_LABELS);
    const fallback = window._sv && window._sv.active ? 3 : (state?.level >= 2 ? 2 : (state?.level === 1 ? 1 : 0));
    _lswActualIdx = fallback;
    window._lswCurrentIdx = fallback;
    _lswSetActive(fallback, false);
    _lswSyncLevelAvailability();
};

function initLevelSwitcher() {
    const bar = document.getElementById('level-switcher');
    if (!bar) return;
    _lswApplyLabels(_LSW_LEVEL_LABELS);
    // On fresh load only L0 is available; L1/L2/L3 unlock after loadLevel0() completes.
    const segs = bar.querySelectorAll('.lsw-seg');
    segs[1]?.classList.add('lsw-unavailable');
    segs[2]?.classList.add('lsw-unavailable');
    segs[3]?.classList.add('lsw-unavailable');

    bar.addEventListener('pointerdown', e => {
        if (bar.classList.contains('lsw-disabled')) return;
        _lswDragStart = e.clientX;
        _lswDragStartIdx = _lswActualIdx;
        _lswDragging = false;
        bar.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    bar.addEventListener('pointermove', e => {
        if (_lswDragStart === null) return;
        if (Math.abs(e.clientX - _lswDragStart) > 5) _lswDragging = true;
        if (!_lswDragging) return;
        const segW = bar.offsetWidth / _lswSegCount;
        const newIdx = Math.max(0, Math.min(_lswSegCount - 1, _lswDragStartIdx + Math.round((e.clientX - _lswDragStart) / segW)));
        if (newIdx !== _lswIdx) _lswSetActive(newIdx, false);
    });

    bar.addEventListener('pointerup', e => {
        if (_lswDragStart === null) return;
        const dx = Math.abs(e.clientX - _lswDragStart);
        if (!_lswDragging || dx < 5) {
            const rect = bar.getBoundingClientRect();
            const idx = Math.min(_lswSegCount - 1, Math.max(0, Math.floor((e.clientX - rect.left) / (rect.width / _lswSegCount))));
            _lswSetActive(idx, true);
        } else {
            _lswSetActive(_lswIdx, true);
        }
        _lswDragStart = null;
        _lswDragging = false;
    });

    bar.addEventListener('pointercancel', () => {
        if (_lswDragStart !== null) _lswSetActive(_lswActualIdx, false);
        _lswDragStart = null;
        _lswDragging = false;
    });

    // Keyboard: allow Tab + Enter/Space on each segment
    bar.querySelectorAll('.lsw-seg').forEach((seg, i) => {
        seg.addEventListener('click', () => _lswSetActive(i, true));
    });
}

function isRenderedMarkdownSupported(ext, fname, langHint = '') {
    const lowerName = (fname || '').toLowerCase();
    return ext === '.md' || ext === '.mdx' || langHint === 'markdown' ||
        lowerName === 'readme' || lowerName === 'changelog';
}

function setCodePanelViewMode(mode) {
    const normalized = mode === 'markdown' ? 'markdown' : 'code';
    if (codeState.viewMode === normalized) return;
    codeState.viewMode = normalized;
    syncCodePanelViewToggle();
    if (codeState.currentData) {
        renderFileContent(codeState.currentData, codeState.currentExt, codeState.currentName);
    }
}

function syncCodePanelViewToggle(forceVisible = null) {
    const toggle = document.getElementById('cp-view-toggle');
    const codeBtn = document.getElementById('cp-view-code');
    const renderedBtn = document.getElementById('cp-view-rendered');
    if (!toggle || !codeBtn || !renderedBtn) return;

    const supported = forceVisible !== null
        ? !!forceVisible
        : !!(codeState.currentData && isRenderedMarkdownSupported(codeState.currentExt, codeState.currentName, codeState.currentLangHint));

    toggle.style.display = supported ? 'inline-flex' : 'none';
    codeBtn.classList.toggle('active', !supported || codeState.viewMode !== 'markdown');
    renderedBtn.classList.toggle('active', supported && codeState.viewMode === 'markdown');
}

function initResizer() {
    const resizer = document.getElementById('resizer');
    const panel = document.getElementById('code-panel');
    if (!resizer || !panel) return;
    resizer.style.display = 'flex';
    let startX, startW;
    resizer.addEventListener('mousedown', e => {
        startX = e.clientX;
        startW = panel.offsetWidth;
        resizer.classList.add('dragging');
        panel.style.transition = 'none';
        const graphWrap = document.getElementById('graph-wrap');
        const sankeyHost = document.getElementById('overview-sankey-host');
        if (graphWrap) graphWrap.style.pointerEvents = 'none';
        if (sankeyHost) sankeyHost.style.pointerEvents = 'none';
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
        e.preventDefault();
    });
    let dragRaf;
    function onDrag(e) {
        if (dragRaf) cancelAnimationFrame(dragRaf);
        dragRaf = requestAnimationFrame(() => {
            const delta = startX - e.clientX;
            const newW = Math.max(200, Math.min(1200, startW + delta));
            panel.style.width = newW + 'px';
            document.documentElement.style.setProperty('--code-panel', newW + 'px');
        });
    }
    function stopDrag() {
        resizer.classList.remove('dragging');
        panel.style.transition = '';
        panel.style.width = '';
        const graphWrap = document.getElementById('graph-wrap');
        const sankeyHost = document.getElementById('overview-sankey-host');
        if (graphWrap) graphWrap.style.pointerEvents = '';
        if (sankeyHost) sankeyHost.style.pointerEvents = '';
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
    }
}

function initSidebarResizer() {
    const handle = document.getElementById('sb-resize-handle');
    const panel = document.getElementById('sidebar');
    if (!handle || !panel) return;
    let startX, startW;
    handle.addEventListener('mousedown', e => {
        if (_sbCollapsed) return;
        startX = e.clientX;
        startW = panel.offsetWidth;
        handle.classList.add('dragging');
        panel.style.transition = 'none';
        const graphWrap = document.getElementById('graph-wrap');
        if (graphWrap) graphWrap.style.pointerEvents = 'none';
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
        e.preventDefault();
    });
    let dragRaf;
    function onDrag(e) {
        if (dragRaf) cancelAnimationFrame(dragRaf);
        dragRaf = requestAnimationFrame(() => {
            const delta = e.clientX - startX;
            const newW = Math.max(150, Math.min(800, startW + delta));
            panel.style.width = newW + 'px';
            document.documentElement.style.setProperty('--sidebar', newW + 'px');
            // Only resize cy on drag end to prevent lag
        });
    }
    function stopDrag() {
        handle.classList.remove('dragging');
        panel.style.transition = '';
        const graphWrap = document.getElementById('graph-wrap');
        if (graphWrap) graphWrap.style.pointerEvents = '';
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
        if (typeof cy !== 'undefined' && cy) cy.resize();
    }
}

let _codePanelOpenTimer = null;
const _CODE_PANEL_TRANSITION_MS = 200;

function openCodePanel() {
    if (_codePanelOpenTimer) {
        clearTimeout(_codePanelOpenTimer);
        _codePanelOpenTimer = null;
    }
    const chatPanel = document.getElementById('chat-panel');
    if (chatPanel?.classList.contains('side-mode') && chatPanel.classList.contains('open')) {
        document.getElementById('chat-btn')?.click();
        _codePanelOpenTimer = setTimeout(() => {
            _codePanelOpenTimer = null;
            openCodePanel();
        }, _CODE_PANEL_TRANSITION_MS);
        return;
    }
    const panel = document.getElementById('code-panel');
    const resizer = document.getElementById('resizer');
    panel.style.width = '';
    panel.classList.add('open');
    if (resizer) resizer.classList.add('open');
    const codeBtn = document.getElementById('code-toggle-btn');
    if (codeBtn) { codeBtn.disabled = false; codeBtn.classList.add('active'); }
    codeState.isOpen = true;
    codeState.userClosed = false;
}

function closeCodePanel() {
    if (_codePanelOpenTimer) {
        clearTimeout(_codePanelOpenTimer);
        _codePanelOpenTimer = null;
    }
    const panel = document.getElementById('code-panel');
    const resizer = document.getElementById('resizer');
    panel.classList.remove('open');
    if (resizer) resizer.classList.remove('open');
    panel.style.width = '';
    document.getElementById('code-toggle-btn').classList.remove('active');
    codeState.isOpen = false;
    codeState.userClosed = true;
}

// ─── Multi-snippet mode toggle (Structure View only) ─────────────────────────

function cpToggleMultiSnip() {
    codeState.multiSnip = !codeState.multiSnip;
    _cpSyncMultiSnipBtn();
    if (codeState.multiSnip) {
        // Turned ON: immediately show snippets for current center symbol (if in centric mode)
        if (window.symShowCurrentSnippets) symShowCurrentSnippets();
    } else {
        // Turned OFF: reload the current file (clear any snippets)
        cpExitMultiSnip();
    }
}

// Show the multi-snip button and sync its active state
function _cpSyncMultiSnipBtn() {
    const btn = document.getElementById('cp-multisnip-btn');
    if (!btn) return;
    btn.classList.toggle('active', !!codeState.multiSnip);
    btn.title = codeState.multiSnip
        ? 'Multi-snippet ON — click to switch back to full file view'
        : 'Multi-snippet mode (Structure View only)';
}

// Called by symbol_view.js when Structure View opens: show the button
window.cpEnableMultiSnipBtn = function() {
    const btn = document.getElementById('cp-multisnip-btn');
    if (btn) btn.style.display = '';
    _cpSyncMultiSnipBtn();
};

// Called when leaving Structure View: hide button, force File mode
window.cpDisableMultiSnipBtn = function() {
    const btn = document.getElementById('cp-multisnip-btn');
    if (btn) { btn.style.display = 'none'; btn.classList.remove('active'); }
    cpExitMultiSnip();
};

// Restore full-file view for the current file
function cpExitMultiSnip() {
    codeState.multiSnip = false;
    // Force re-fetch by resetting the currentFile sentinel
    const file = codeState.currentFile === '__sym_snippet__' ? null : codeState.currentFile;
    if (file && file !== '__sym_snippet__') {
        codeState.currentFile = null;  // force reload
        loadFileInPanel(file, null);
    }
}

// Load a file into the code panel; optionally jump to a function
async function loadFileInPanel(filePath, funcName?) {
    if (!filePath) return;
    if (codeState.userClosed && !codeState.isOpen) return; // respect user close
    openCodePanel();
    const fname = filePath.split('/').pop();
    const ext = fname.includes('.') ? '.' + fname.split('.').pop().toLowerCase() : '';

    // Update header immediately
    document.getElementById('cp-filename').textContent = fname;
    document.getElementById('cp-filename').title = filePath;
    document.getElementById('cp-ext-badge').textContent = ext.toUpperCase() || 'FILE';
    document.getElementById('cp-ext-badge').style.background = extColor(ext);
    document.getElementById('cp-ext-badge').style.color = '#000';
    hideFuncBar();
    showCpLoading(true);

    if (!codeState.jobId) {
        showCpError('No job ID — code preview only available via the local server (launch.bat).');
        return;
    }

    if (filePath === codeState.currentFile) {
        syncCodePanelViewToggle();
        showCpLoading(false);
        if (funcName) jumpToFunc(funcName);
        if (state.level >= 1 && window.svUpdateStructureBtn) svUpdateStructureBtn(filePath, ext);
        if (typeof window.overviewTreemapSyncCurrentFile === 'function') window.overviewTreemapSyncCurrentFile(filePath);
        return;
    }

    codeState.currentData = null;
    codeState.currentExt = ext;
    codeState.currentName = fname;
    codeState.currentLangHint = '';
    codeState.viewMode = 'code';
    syncCodePanelViewToggle(false);

    try {
        const url = `/file?job=${encodeURIComponent(codeState.jobId)}&path=${encodeURIComponent(filePath)}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) { showCpError(T('fileLoadError', { error: data.error })); return; }
        codeState.currentFile = filePath;
        codeState.currentData = data;
        codeState.currentExt = ext;
        codeState.currentName = fname;
        codeState.currentLangHint = data.lang_hint || '';
        renderFileContent(data, ext, fname);
        showCpLoading(false);
        if (funcName) setTimeout(() => jumpToFunc(funcName), 80);
        if (state.level >= 1 && window.svUpdateStructureBtn) svUpdateStructureBtn(filePath, ext);
        if (typeof window.overviewTreemapSyncCurrentFile === 'function') window.overviewTreemapSyncCurrentFile(filePath);
    } catch (e) {
        showCpError(T('fetchError', { error: e.message }));
    }
}

function showCpLoading(v) {
    document.getElementById('cp-loading').classList.toggle('hidden', !v);
    document.getElementById('cp-empty').style.display = 'none';
    if (!v) document.getElementById('cp-code-wrap').style.display = '';
    else document.getElementById('cp-code-wrap').style.display = 'none';
}

function showCpError(msg) {
    document.getElementById('cp-loading').classList.add('hidden');
    document.getElementById('cp-code-wrap').style.display = 'none';
    syncCodePanelViewToggle(false);
    const empty = document.getElementById('cp-empty');
    empty.style.display = '';
    empty.innerHTML = `<div class="cp-empty-icon">⚠</div><p>${msg}</p>`;
}

// ─── File Content Renderers ───────────────────────────────────────────────────
// Top-level dispatcher: routes to the right renderer by content_type
function renderFileContent(data, ext, fname) {
    const ct = data.content_type || 'text';
    const markdownSupported = ct === 'text' && isRenderedMarkdownSupported(ext, fname, data.lang_hint);
    if (!markdownSupported) {
        codeState.viewMode = 'code';
    }
    syncCodePanelViewToggle(markdownSupported);
    if (ct === 'image') {
        renderImage(data);
    } else if (ct === 'binary') {
        renderHexDump(data);
    } else if (ct === 'pdf') {
        renderPDF(data);
    } else if (ct === 'office') {
        renderOffice(data);
    } else if (markdownSupported && codeState.viewMode === 'markdown') {
        renderMarkdown(data.content || '', ext, fname, data.lang_hint);
    } else {
        // text ??use lang_hint from server if available, else derive from ext
        renderCode(data.content || '', ext, fname, data.lang_hint);
    }
}

// Render image files (jpg, png, bmp, gif, ico …)
function renderImage(data) {
    const wrap = document.getElementById('cp-code-wrap');
    const src = `data:${data.mime};base64,${data.data}`;
    const kb = data.size ? (data.size / 1024).toFixed(1) + ' KB' : '';
    wrap.innerHTML = `
<div style="display:flex;flex-direction:column;align-items:center;padding:20px;gap:12px;min-height:200px">
  <img src="${src}" alt="${escapeHtml(data.path || '')}"
       style="max-width:100%;max-height:calc(100vh - 180px);border-radius:4px;
              border:1px solid var(--border);background:#111;object-fit:contain"
       onerror="this.parentElement.innerHTML='<div style=\\'color:var(--muted)\\'>Failed to render image</div>'"
  />
  <div style="font-size:11px;color:var(--muted);font-family:var(--code-font)">${escapeHtml(data.path || '')} &nbsp;·&nbsp; ${escapeHtml(kb)}</div>
</div>`;
    wrap.style.display = '';
    // Reset func-related state — no functions in images
    codeState.funcLineMap = {};
    codeState.funcList = [];
}

// Render binary files as a hex dump
function renderHexDump(data) {
    const wrap = document.getElementById('cp-code-wrap');
    const lines = (data.content || '').split('\n');
    const kb = data.size ? (data.size / 1024).toFixed(1) + ' KB' : '';
    const trunc = data.truncated
        ? `<div style="color:#f59e0b;font-size:11px;padding:8px 0">⚠ Showing first 8 KB of ${escapeHtml(kb)} file</div>`
        : '';
    const rows = lines.map(ln => {
        // offset  |  hex bytes  |  ascii
        const [addr, ...rest] = ln.split('  ');
        const body = rest.join('  ');
        const asciiIdx = body.lastIndexOf('|');
        const hexPart = asciiIdx > 0 ? body.slice(0, asciiIdx) : body;
        const asciiPart = asciiIdx > 0 ? body.slice(asciiIdx) : '';
        return `<div class="hex-row"><span class="hex-addr">${escapeHtml(addr || '')}</span>` +
            `<span class="hex-bytes">${escapeHtml(hexPart)}</span>` +
            `<span class="hex-ascii">${escapeHtml(asciiPart)}</span></div>`;
    }).join('');

    wrap.innerHTML = `
<div style="padding:12px">
  ${trunc}
  <pre class="hex-dump"><code>${rows}</code></pre>
</div>`;
    wrap.style.display = '';
    codeState.funcLineMap = {};
    codeState.funcList = [];
}

function renderCode(src, ext, fname, langHint) {
    const lines = src.split('\n');
    codeState.rawLines = lines;
    const hlExt = {
        // ── C / C++ / Systems ───────────────────────────────────────────────
        '.c': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
        '.h': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp', '.hh': 'cpp',
        '.cs': 'csharp',
        '.vb': 'vbnet',
        '.rs': 'rust',
        '.zig': 'plaintext',
        '.d': 'd',
        // ── Assembly ─────────────────────────────────────────────────────────
        '.asm': 'x86asm', '.s': 'x86asm', '.S': 'x86asm', '.nasm': 'x86asm',
        '.mips': 'mipsasm',
        // ── UEFI / Firmware ──────────────────────────────────────────────────
        '.inf': 'ini', '.dec': 'ini', '.dsc': 'ini', '.fdf': 'ini',
        '.sdl': 'ini', '.sd': 'ini', '.cif': 'ini', '.mak': 'makefile',
        '.vfr': 'c', '.hfr': 'c', '.uni': 'plaintext', '.asl': 'c',
        // ── Python ───────────────────────────────────────────────────────────
        '.py': 'python', '.pyw': 'python', '.pyx': 'python',
        '.ipynb': 'json',
        // ── JavaScript / TypeScript ──────────────────────────────────────────
        '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
        '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
        '.graphql': 'graphql', '.gql': 'graphql',
        // ── Web ──────────────────────────────────────────────────────────────
        '.html': 'html', '.htm': 'html', '.xhtml': 'html',
        '.css': 'css', '.scss': 'scss', '.sass': 'scss',
        '.less': 'less', '.styl': 'stylus',
        '.svg': 'xml',
        // ── Go ───────────────────────────────────────────────────────────────
        '.go': 'go',
        // ── JVM / Mobile ─────────────────────────────────────────────────────
        '.java': 'java',
        '.kt': 'kotlin', '.kts': 'kotlin',
        '.scala': 'scala', '.sc': 'scala',
        '.groovy': 'groovy', '.gradle': 'groovy',
        '.dart': 'dart',
        '.swift': 'swift',
        '.m': 'objectivec', '.mm': 'objectivec',
        // ── Scripting ────────────────────────────────────────────────────────
        '.rb': 'ruby', '.gemspec': 'ruby', '.rake': 'ruby',
        '.php': 'php',
        '.pl': 'perl', '.pm': 'perl',
        '.lua': 'lua',
        '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'bash',
        '.ksh': 'bash', '.tcsh': 'bash',
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
        '.elm': 'elm',
        '.nim': 'nim',
        '.cr': 'crystal',
        '.coffee': 'coffeescript',
        '.lisp': 'lisp', '.lsp': 'lisp', '.el': 'lisp',
        '.scm': 'scheme',
        '.pas': 'delphi', '.dpr': 'delphi',
        '.for': 'fortran', '.f90': 'fortran', '.f95': 'fortran', '.f': 'fortran',
        '.vala': 'vala',
        '.hx': 'haxe',
        // @ts-ignore -- pre-existing duplicate key (harmless; last value wins)
        '.awk': 'awk',
        // ── Hardware description ──────────────────────────────────────────────
        '.v': 'verilog', '.sv': 'verilog', '.svh': 'verilog',
        '.vhd': 'vhdl', '.vhdl': 'vhdl',
        // ── Data / Config ────────────────────────────────────────────────────
        '.json': 'json', '.jsonc': 'json', '.json5': 'json',
        '.yaml': 'yaml', '.yml': 'yaml',
        '.toml': 'ini',
        '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
        '.properties': 'properties', '.env': 'properties',
        '.xml': 'xml', '.xsl': 'xml', '.xsd': 'xml', '.plist': 'xml',
        '.csv': 'plaintext', '.tsv': 'plaintext',
        // ── Infrastructure / Cloud ───────────────────────────────────────────
        '.tf': 'hcl', '.hcl': 'hcl',
        '.proto': 'protobuf',
        '.thrift': 'thrift',
        // ── Build systems ────────────────────────────────────────────────────
        '.cmake': 'cmake',
        // @ts-ignore -- pre-existing duplicate key (harmless; last value wins)
        '.mk': 'makefile', '.mak': 'makefile',
        '.bazel': 'python', '.bzl': 'python',
        // ── Docs ─────────────────────────────────────────────────────────────
        '.md': 'markdown', '.mdx': 'markdown',
        '.rst': 'plaintext',
        '.txt': 'plaintext',
        '.tex': 'latex', '.ltx': 'latex',
        // ── Database ─────────────────────────────────────────────────────────
        '.sql': 'sql', '.psql': 'pgsql', '.pgsql': 'pgsql',
        '.ddl': 'sql', '.dml': 'sql',
        // ── Shader / GPU ─────────────────────────────────────────────────────
        '.glsl': 'glsl', '.vert': 'glsl', '.frag': 'glsl',
        '.hlsl': 'plaintext', '.wgsl': 'plaintext',
        // ── Misc ─────────────────────────────────────────────────────────────
        '.diff': 'diff', '.patch': 'diff',
        '.vim': 'vim',
        '.nix': 'nix',
        '.sol': 'javascript',
        '.feature': 'gherkin',
        '.http': 'http',
        '.log': 'plaintext', '.lock': 'plaintext',
        '.editorconfig': 'ini',
        '.gitignore': 'plaintext', '.gitattributes': 'plaintext',
        '.dockerignore': 'plaintext', '.npmignore': 'plaintext',
    };

    // Special filename → hljs lang (files with no extension or fixed names)
    const hlFilename = {
        'dockerfile': 'dockerfile', 'Dockerfile': 'dockerfile',
        'makefile': 'makefile', 'Makefile': 'makefile', 'GNUmakefile': 'makefile',
        'jenkinsfile': 'groovy', 'Jenkinsfile': 'groovy',
        'vagrantfile': 'ruby', 'Vagrantfile': 'ruby',
        'gemfile': 'ruby', 'Gemfile': 'ruby',
        'rakefile': 'ruby', 'Rakefile': 'ruby',
        'brewfile': 'ruby', 'Brewfile': 'ruby',
        'pipfile': 'ini', 'Pipfile': 'ini',
        '.bashrc': 'bash', '.zshrc': 'bash', '.bash_profile': 'bash',
        '.bash_aliases': 'bash', '.profile': 'bash',
        'nginx.conf': 'nginx', 'httpd.conf': 'apache',
        'CMakeLists.txt': 'cmake', 'cmakelists.txt': 'cmake',
    };
    // langHint from server takes priority (e.g. 'xml', 'python')
    const lang = (langHint && langHint !== 'plaintext') ? langHint
        : hlExt[ext] || hlFilename[fname] || 'plaintext';

    // Build funcLineMap: scan for `funcName(` patterns
    codeState.funcLineMap = {};
    codeState.funcList = [];
    const funcDefs = DATA.funcs_by_file[codeState.currentFile] || [];
    funcDefs.forEach(f => {
        const pattern = new RegExp('\\b' + escapeRe(f.label) + '\\s*\\(');
        for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
                codeState.funcLineMap[f.label] = i;
                codeState.funcList.push({ name: f.label, line: i });
                break;
            }
        }
    });

    // Syntax-highlight with highlight.js if available
    let highlightedLines;
    if (window.hljs) {
        try {
            const result = hljs.highlight(src, { language: lang, ignoreIllegals: true });
            highlightedLines = result.value.split('\n');
        } catch (_) {
            highlightedLines = lines.map(l => escapeHtml(l));
        }
    } else {
        highlightedLines = lines.map(l => escapeHtml(l));
    }

    const wrap = document.getElementById('cp-code-wrap');

    const lineDivs = highlightedLines.map((hl, i) =>
        `<div class="code-line" id="cl-${i}"><span class="line-num">${i + 1}</span><span class="line-content">${hl}</span></div>`
    ).join('');

    wrap.innerHTML = `<pre><code class="hljs language-${lang}">${lineDivs}</code></pre>`;
    wrap.style.display = '';
    
    wrap.onclick = (e) => {
        // ── Detect clicked line (shared by Structure View + graph sync) ───────
        const lineEl = e.target.closest('.code-line');
        const clickedLine = (lineEl && lineEl.id.startsWith('cl-'))
            ? parseInt(lineEl.id.slice(3), 10) : -1;

        if (window._sv && window._sv.active && typeof window.svHighlightLine === 'function') {
            if (clickedLine >= 0) window.svHighlightLine(clickedLine);
        }

        // ── Detect clicked word ───────────────────────────────────────────────
        let range;
        if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(e.clientX, e.clientY);
        } else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
            if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); }
        }

        let clickedWord = null;
        if (range) {
            const rNode = range.startContainer;
            if (rNode.nodeType === 3) { // Node.TEXT_NODE
                const offset = range.startOffset;
                const text = rNode.textContent;
                let start = offset, end = offset;
                // Adjust if clicking precisely around word boundaries
                if (start > 0 && start === text.length && /[A-Za-z0-9_$#]/.test(text[start - 1])) {
                    start--; end--;
                } else if (start > 0 && !/[A-Za-z0-9_$#]/.test(text[start]) && /[A-Za-z0-9_$#]/.test(text[start - 1])) {
                    start--; end--;
                }
                while (start > 0 && /[A-Za-z0-9_$#]/.test(text[start - 1])) start--;
                while (end < text.length && /[A-Za-z0-9_$#]/.test(text[end])) end++;
                if (start < end) {
                    clickedWord = text.slice(start, end);
                    if (window.svHighlightBadgeByName) svHighlightBadgeByName(clickedWord);
                }
            }
        }

        // ── Code → Graph sync ─────────────────────────────────────────────────
        if (!window._sv?.active && window.cpSyncToGraph && clickedLine >= 0) {
            window.cpSyncToGraph(clickedLine, clickedWord);
        }
    };

    // ── Structure View hook ──────────────────────────────────────────────────
    if (window.svAfterRenderCode) svAfterRenderCode(src, ext, fname);
}

function jumpToFunc(funcName, targetCallText = null) {
    let lineIdx = codeState.funcLineMap[funcName];
    if (lineIdx === undefined) return;

    // Update func bar
    const funcDefs = DATA.funcs_by_file[codeState.currentFile] || [];
    const fDef = funcDefs.find(f => f.label === funcName);
    if (fDef) {
        showFuncBar(fDef);
        codeState.currentFunc = funcName;
        const idx = codeState.funcList.findIndex(f => f.name === funcName);
        if (idx >= 0) codeState.funcIdx = idx;
    }

    // Highlight line
    document.querySelectorAll('.code-line.fn-highlight').forEach(el => el.classList.remove('fn-highlight'));

    let highlightIdx = lineIdx;
    if (targetCallText && codeState.rawLines && codeState.rawLines.length) {
        let nextStart = codeState.rawLines.length;
        const sortedStarts = Object.values(codeState.funcLineMap).sort((a, b) => a - b);
        const myStartIdx = sortedStarts.indexOf(lineIdx);
        if (myStartIdx >= 0 && myStartIdx < sortedStarts.length - 1) {
            nextStart = sortedStarts[myStartIdx + 1];
        }

        const targetPattern = new RegExp('\\b' + escapeRe(targetCallText) + '\\b');
        for (let i = lineIdx; i < nextStart; i++) {
            if (targetPattern.test(codeState.rawLines[i])) {
                highlightIdx = i;
                break;
            }
        }
    }

    const lineEl = document.getElementById(`cl-${highlightIdx}`);
    if (lineEl) {
        lineEl.classList.add('fn-highlight');
        lineEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

function jumpToLine(lineNo) {
    const idx = lineNo - 1;   // lineNo is 1-based; cl-N ids are 0-based
    document.querySelectorAll('.code-line.fn-highlight').forEach(el => el.classList.remove('fn-highlight'));
    const el = document.getElementById(`cl-${idx}`);
    if (el) {
        el.classList.add('fn-highlight');
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

function jumpToImport(targetLabel) {
    if (!codeState.rawLines || !codeState.rawLines.length || !targetLabel) return;
    document.querySelectorAll('.code-line.fn-highlight').forEach(el => el.classList.remove('fn-highlight'));
    const base = targetLabel.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]*$/, '');
    if (!base) return;
    // Word-boundary match so a symbol like `add` lands on its real use, not
    // inside `padding`. Works for filenames too (e.g. viz_state in a path).
    const pattern = new RegExp(`\\b${escapeRe(base)}\\b`, 'i');
    for (let i = 0; i < codeState.rawLines.length; i++) {
        if (pattern.test(codeState.rawLines[i])) {
            const el = document.getElementById(`cl-${i}`);
            if (el) {
                el.classList.add('fn-highlight');
                el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                return;
            }
        }
    }
}

function showFuncBar(fDef) {
    const bar = document.getElementById('cp-func-bar');
    bar.classList.add('visible');
    document.getElementById('cp-func-name').textContent = fDef.label + '()';
    const badge = document.getElementById('cp-func-badge');
    if (fDef.is_efiapi) {
        badge.className = 'cp-func-badge cp-func-efiapi';
        badge.textContent = T('functionBadgeEFIAPI');
    } else if (fDef.is_public) {
        badge.className = 'cp-func-badge cp-func-public';
        badge.textContent = T('functionBadgePublic');
    } else {
        badge.className = 'cp-func-badge cp-func-private';
        badge.textContent = T('functionBadgeStatic');
    }
}

function hideFuncBar() {
    document.getElementById('cp-func-bar').classList.remove('visible');
    codeState.currentFunc = null;
}

function navigateFunc(dir) {
    const list = codeState.funcList;
    if (!list.length) return;
    codeState.funcIdx = (codeState.funcIdx + dir + list.length) % list.length;
    jumpToFunc(list[codeState.funcIdx].name);
}


