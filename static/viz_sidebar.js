// @module viz_sidebar — Sidebar tabs, file tree, filters, edge filter, node legend
// Owns: FT_GROUPS, ftActiveFilter, buildFtFilter, buildEdgeFilter, applyEdgeFilter,
//       buildNodeLegend, rerenderCurrentLevel, updateSidebarStats, buildSidebar,
//       buildFileTree, setSubdirActive, filterGraphToSubPath, initSidebarTabs

// ─── Sidebar tabs + collapse ──────────────────────────────────────────────────
function initSidebarTabs() {
    const collapseBtn = document.getElementById('sb-collapse-btn');
    document.querySelectorAll('.sb-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (_sbCollapsed) { _sbCollapsed = false; _applySidebarCollapsed(); }
            _sbActiveTab = tab.dataset.tab;
            _applySidebarTab();
        });
    });
    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            _sbCollapsed = !_sbCollapsed;
            _applySidebarCollapsed();
        });
    }
}

function _applySidebarTab() {
    document.querySelectorAll('.sb-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.tab === _sbActiveTab));
    const expl = document.getElementById('sb-body-explorer');
    const filt = document.getElementById('sb-body-filters');
    if (expl) expl.style.display = _sbActiveTab === 'explorer' ? '' : 'none';
    if (filt) filt.style.display  = _sbActiveTab === 'filters'  ? '' : 'none';
}

// Disable the Filters tab at L0 (module overview) where filters have no content.
function updateFilterTabEnabled() {
    const filterTab = document.querySelector('.sb-tab[data-tab="filters"]');
    if (!filterTab) return;
    const isL0 = (typeof state !== 'undefined' && state.level === 0);
    filterTab.disabled = isL0;
    if (isL0 && _sbActiveTab === 'filters') {
        _sbActiveTab = 'explorer';
        _applySidebarTab();
    }
}

const _SB_ICON_CLOSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>';
const _SB_ICON_OPEN  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15 3-3-3-3"/></svg>';

function _applySidebarCollapsed() {
    const sidebar = document.getElementById('sidebar');
    const collapseBtn = document.getElementById('sb-collapse-btn');
    const resizer = document.getElementById('sidebar-resizer');
    if (!sidebar) return;
    if (_sbCollapsed) {
        sidebar._expandedWidth = sidebar.offsetWidth;
        sidebar.classList.add('sb-collapsed');
        document.documentElement.style.setProperty('--sidebar', '40px');
        if (collapseBtn) { collapseBtn.innerHTML = _SB_ICON_OPEN; collapseBtn.title = 'Expand sidebar'; }
        if (resizer) resizer.style.pointerEvents = 'none';
    } else {
        sidebar.classList.remove('sb-collapsed');
        const w = sidebar._expandedWidth || 220;
        document.documentElement.style.setProperty('--sidebar', w + 'px');
        if (collapseBtn) { collapseBtn.innerHTML = _SB_ICON_CLOSE; collapseBtn.title = 'Collapse sidebar'; }
        if (resizer) resizer.style.pointerEvents = '';
        _applySidebarTab();
    }
    if (cy) cy.resize();
}


// Continuously call cy.resize() during the code-panel CSS transition so the
// cytoscape canvas tracks the panel width frame-by-frame (no black artifacts).
let _panelRafId = null;
function _startPanelResizeLoop(durationMs) {
    if (_panelRafId) cancelAnimationFrame(_panelRafId);
    const end = performance.now() + durationMs + 32; // +32ms safety margin
    function tick() {
        if (cy) cy.resize();
        if (performance.now() < end) _panelRafId = requestAnimationFrame(tick);
        else _panelRafId = null;
    }
    _panelRafId = requestAnimationFrame(tick);
}
const _PANEL_TRANSITION_MS = 200; // must match CSS transition: width .2s

const FT_GROUPS = [
    // ── BIOS / C ──────────────────────────────────────────────────────────────
    { key: 'c_source', label: '.c/.cpp', exts: ['.c', '.cpp', '.cc'], group: 'bios' },
    { key: 'header', label: '.h/.hpp', exts: ['.h', '.hpp'], group: 'bios' },
    { key: 'assembly', label: '.asm/.s', exts: ['.asm', '.s', '.S', '.nasm'], group: 'bios' },
    { key: 'module_inf', label: '.inf', exts: ['.inf'], group: 'bios' },
    { key: 'package_dec', label: '.dec', exts: ['.dec'], group: 'bios' },
    { key: 'platform_dsc', label: '.dsc', exts: ['.dsc'], group: 'bios' },
    { key: 'flash_desc', label: '.fdf', exts: ['.fdf'], group: 'bios' },
    { key: 'ami_sdl', label: '.sdl', exts: ['.sdl'], group: 'bios' },
    { key: 'ami_sd', label: '.sd', exts: ['.sd'], group: 'bios' },
    { key: 'ami_cif', label: '.cif', exts: ['.cif'], group: 'bios' },
    { key: 'makefile', label: '.mak', exts: ['.mak'], group: 'bios' },
    { key: 'hii_vfr', label: '.vfr', exts: ['.vfr'], group: 'bios' },
    { key: 'hii_hfr', label: '.hfr', exts: ['.hfr'], group: 'bios' },
    { key: 'hii_string', label: '.uni', exts: ['.uni'], group: 'bios' },
    { key: 'acpi_asl', label: '.asl', exts: ['.asl'], group: 'bios' },
    // ── Python ────────────────────────────────────────────────────────────────
    { key: 'py_source', label: '.py', exts: ['.py'], group: 'python' },
    // ── JavaScript / TypeScript ───────────────────────────────────────────────
    { key: 'js_source', label: '.js/.mjs', exts: ['.js', '.mjs', '.cjs'], group: 'js' },
    { key: 'jsx_source', label: '.jsx', exts: ['.jsx'], group: 'js' },
    { key: 'ts_source', label: '.ts', exts: ['.ts'], group: 'ts' },
    { key: 'tsx_source', label: '.tsx', exts: ['.tsx'], group: 'ts' },
    // ── Go ────────────────────────────────────────────────────────────────────
    { key: 'go_source', label: '.go', exts: ['.go'], group: 'go' },
    // ── JVM / Mobile ──────────────────────────────────────────────────────────
    { key: 'java_source',   label: '.java',        exts: ['.java'],          group: 'jvm' },
    { key: 'kotlin_source', label: '.kt',          exts: ['.kt', '.kts'],    group: 'jvm' },
    { key: 'scala_source',  label: '.scala',       exts: ['.scala'],         group: 'jvm' },
    { key: 'groovy_source', label: '.groovy',      exts: ['.groovy'],        group: 'jvm' },
    { key: 'dart_source',   label: '.dart',        exts: ['.dart'],          group: 'mobile' },
    { key: 'swift_source',  label: '.swift',       exts: ['.swift'],         group: 'mobile' },
    { key: 'objc_source',   label: '.m/.mm',       exts: ['.m', '.mm'],      group: 'mobile' },
    // ── .NET ──────────────────────────────────────────────────────────────────
    { key: 'csharp_source', label: '.cs',          exts: ['.cs'],            group: 'dotnet' },
    { key: 'vb_source',     label: '.vb',          exts: ['.vb'],            group: 'dotnet' },
    { key: 'fsharp_source', label: '.fs',          exts: ['.fs', '.fsx'],    group: 'dotnet' },
    // ── Scripting ─────────────────────────────────────────────────────────────
    { key: 'ruby_source',   label: '.rb',          exts: ['.rb'],            group: 'script' },
    { key: 'php_source',    label: '.php',         exts: ['.php'],           group: 'script' },
    { key: 'perl_source',   label: '.pl/.pm',      exts: ['.pl', '.pm'],     group: 'script' },
    { key: 'lua_source',    label: '.lua',         exts: ['.lua'],           group: 'script' },
    { key: 'shell_source',  label: '.sh/.bash',    exts: ['.sh', '.bash', '.zsh'], group: 'script' },
    { key: 'r_source',      label: '.r/.R',        exts: ['.r', '.R'],       group: 'script' },
    { key: 'julia_source',  label: '.jl',          exts: ['.jl'],            group: 'script' },
    // ── Systems ───────────────────────────────────────────────────────────────
    { key: 'rust_source',    label: '.rs',         exts: ['.rs'],            group: 'systems' },
    { key: 'zig_source',     label: '.zig',        exts: ['.zig'],           group: 'systems' },
    { key: 'd_source',       label: '.d',          exts: ['.d'],             group: 'systems' },
    { key: 'nim_source',     label: '.nim',        exts: ['.nim'],           group: 'systems' },
    { key: 'crystal_source', label: '.cr',         exts: ['.cr'],            group: 'systems' },
    // ── Functional ────────────────────────────────────────────────────────────
    { key: 'elixir_source',  label: '.ex/.exs',    exts: ['.ex', '.exs'],    group: 'functional' },
    { key: 'erlang_source',  label: '.erl/.hrl',   exts: ['.erl', '.hrl'],   group: 'functional' },
    { key: 'clojure_source', label: '.clj/.cljs',  exts: ['.clj', '.cljs'],  group: 'functional' },
    { key: 'haskell_source', label: '.hs',         exts: ['.hs'],            group: 'functional' },
    { key: 'ocaml_source',   label: '.ml/.mli',    exts: ['.ml', '.mli'],    group: 'functional' },
    { key: 'elm_source',     label: '.elm',        exts: ['.elm'],           group: 'functional' },
    // ── Data / Schema ─────────────────────────────────────────────────────────
    { key: 'sql_source',     label: '.sql',        exts: ['.sql'],           group: 'data' },
    { key: 'graphql_source', label: '.graphql',    exts: ['.graphql', '.gql'], group: 'data' },
    { key: 'proto_source',   label: '.proto',      exts: ['.proto'],         group: 'data' },
    // ── Unanalysed ────────────────────────────────────────────────────────────
    { key: 'other', label: 'Other', exts: [], isExtra: true },
    { key: 'binary', label: 'Binary', exts: [], isExtra: true },
];
// Default: all analysed types on (isExtra types like 'other'/'binary' remain off)
const ftActiveFilter = new Set(
    FT_GROUPS.filter(g => !g.isExtra).map(g => g.key)
);

let ftFilterCollapsed = false;
let efFilterCollapsed = false;
let nlFilterCollapsed = false;
let _sbCollapsed = false;
let _sbActiveTab = 'explorer';
const edgeActiveFilter = new Set(Object.keys(EDGE_TYPE_STYLE));

// ─── L2 (Call Flow) filter state ─────────────────────────────────────────────
const L2_NODE_FILTER_DEFS = [
    { key: 'func',      label: 'Current File',  color: '#60a5fa', types: ['func'] },
    { key: 'external',  label: 'External',      color: '#64748b', types: ['ext_group', 'ext_func', 'drill_group', 'drilled_func'] },
    { key: 'ambiguous', label: 'Ambiguous',     color: '#a78bfa', types: ['potential_func'] },
    { key: 'system',    label: 'System API',    color: '#34d399', types: ['sys_group', 'sys_func'] },
];
const L2_EDGE_FILTER_DEFS = [
    { key: 'call_internal', label: 'Internal Calls',  color: '#38bdf8', style: 'solid' },
    { key: 'call_ext',      label: 'External Calls',  color: '#94a3b8', style: 'dashed' },
    { key: 'call_potential',label: 'Ambiguous',        color: '#a78bfa', style: 'dashed' },
    { key: 'call_sys',      label: 'System API',       color: '#34d399', style: 'solid' },
];
const l2NodeFilter = new Set(L2_NODE_FILTER_DEFS.map(d => d.key));
const l2EdgeFilter = new Set(L2_EDGE_FILTER_DEFS.map(d => d.key));
let l2NodeFilterCollapsed = false;
let l2EdgeFilterCollapsed = false;

function resetL2Filters() {
    l2NodeFilter.clear();
    L2_NODE_FILTER_DEFS.forEach(d => l2NodeFilter.add(d.key));
    l2EdgeFilter.clear();
    L2_EDGE_FILTER_DEFS.forEach(d => l2EdgeFilter.add(d.key));
}

// ─── Filter section header helper ─────────────────────────────────────────────
function _filterSectionHdr(label, collapsed, actions = '') {
    const rot = collapsed ? 'rotate(-90deg)' : '';
    return `<div class="flt-section-hdr" style="cursor:pointer">` +
        `<span class="flt-chevron" style="transform:${rot}">▾</span>` +
        `<span class="flt-section-label">${label}</span>` +
        (actions ? `<span class="flt-actions">${actions}</span>` : '') +
        `</div>`;
}

function buildFtFilter(modId = null, subDir = null) {
    const wrap = document.getElementById('ft-filter');
    if (!wrap) return;
    if (state.level !== 1 || !modId) {
        wrap.innerHTML = '<div class="ft-filter-placeholder">Navigate to a module to filter file types.</div>';
        wrap.style.display = 'block';
        return;
    }

    // Detect which types actually exist in data
    const presentTypes = new Set();
    let otherTotal = 0;
    let binaryTotal = 0;

    function addFiles(files) {
        files.forEach(f => presentTypes.add(f.file_type || 'other'));
    }

    if (modId) {
        let files = DATA.files_by_module[modId] || [];
        let others = (DATA.other_files_by_module || {})[modId] || [];
        if (subDir) {
            const prefix = modId + '/' + subDir + '/';
            const exc = modId + '/' + subDir;
            files = files.filter(f => f.path.startsWith(prefix) || f.path === exc);
            others = others.filter(f => f.path.startsWith(prefix) || f.path === exc);
        }
        addFiles(files);
        addFiles(others);

        others.forEach(f => {
            if (f.file_type === 'other') otherTotal++;
            if (f.file_type === 'binary') binaryTotal++;
        });
    } else {
        Object.values(DATA.files_by_module).forEach(addFiles);
        const otherByMod = DATA.other_files_by_module || {};
        Object.values(otherByMod).forEach(addFiles);
        otherTotal = (DATA.stats?.other_files || 0) - (DATA.stats?.binary_files || 0);
        binaryTotal = DATA.stats?.binary_files || 0;
    }

    const groups = FT_GROUPS.filter(g => {
        if (g.isExtra) {
            if (g.key === 'other') return otherTotal > 0;
            if (g.key === 'binary') return binaryTotal > 0;
        }
        return presentTypes.has(g.key);
    });
    if (!groups.length) {
        wrap.style.display = 'none';
        return;
    }
    wrap.style.display = 'block';

    const analysed = groups.filter(g => !g.isExtra);
    const extra = groups.filter(g => g.isExtra);

    function chipHtml(g) {
        const col = g.isExtra ? '#4b5563' : extColor(g.exts[0] || '');
        const checked = ftActiveFilter.has(g.key) ? 'checked' : '';
        const count = g.key === 'other' ? otherTotal :
            g.key === 'binary' ? binaryTotal : '';
        const countBadge = count !== '' ? `<span class="ft-count">${count}</span>` : '';
        return `<label class="ft-chip${g.isExtra ? ' ft-chip-extra' : ''}" style="--ft-col:${col}">
  <input type="checkbox" data-ft="${g.key}" ${checked}>
  <div class="ft-icon-bg"><span class="ft-dot" style="background:${col}"></span></div>
  <span class="ft-label">${g.label}</span>${countBadge}
</label>`;
    }

    const bodyDisplay = ftFilterCollapsed ? 'none' : 'flex';
    const actionsHtml =
        `<button class="flt-action" data-ft-action="all">${T('selectAll')}</button>` +
        `<button class="flt-action" data-ft-action="none">${T('selectNone')}</button>`;

    wrap.innerHTML =
        _filterSectionHdr(T('fileTypes'), ftFilterCollapsed, actionsHtml) +
        `<div id="ft-filter-body" style="display:${bodyDisplay}; flex-direction:column; padding:4px 0 2px;">` +
        analysed.map(chipHtml).join('') +
        (extra.length
            ? `<div class="ft-separator">— unanalysed —</div>` + extra.map(chipHtml).join('')
            : '') +
        `</div>`;

    const titleEl = wrap.querySelector('.flt-section-hdr');
    const rerender = () => {
        if (state.level === 1 && state.activeModule) {
            const allFiles = DATA.files_by_module[state.activeModule] || [];
            const filtered = state.activeSubDir
                ? allFiles.filter(f => f.path.startsWith(state.activeModule + '/' + state.activeSubDir + '/'))
                : allFiles;
            renderFilesFlat(state.activeModule, filtered, state.activeSubDir);
        }
        updateSidebarStats();
    };
    titleEl.addEventListener('click', () => {
        ftFilterCollapsed = !ftFilterCollapsed;
        const body = document.getElementById('ft-filter-body');
        const chev = titleEl.querySelector('.flt-chevron');
        body.style.display = ftFilterCollapsed ? 'none' : 'flex';
        chev.style.transform = ftFilterCollapsed ? 'rotate(-90deg)' : '';
    });

    wrap.querySelectorAll('.flt-action').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const action = btn.dataset.ftAction;
            if (action === 'all') {
                ftActiveFilter.clear();
                groups.forEach(g => ftActiveFilter.add(g.key));
                wrap.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = true; });
            } else if (action === 'none') {
                ftActiveFilter.clear();
                wrap.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = false; });
            }
            rerender();
        });
    });

    wrap.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) ftActiveFilter.add(cb.dataset.ft);
            else ftActiveFilter.delete(cb.dataset.ft);
            // Re-render current view
            rerender();
        });
    });
}

// ─── Edge type filter ─────────────────────────────────────────────────────────
// L1: interactive toggle rows; L2: interactive call-flow edge filter; L0: placeholder.
function buildEdgeFilter() {
    const wrap = document.getElementById('edge-filter');
    if (!wrap) return;

    // L2: interactive edge-kind filter
    if (state.level === 2) {
        const presentKinds = new Set();
        if (cy) cy.edges().forEach(e => { const k = e.data('l2kind'); if (k) presentKinds.add(k); });

        const visible = L2_EDGE_FILTER_DEFS.filter(d => presentKinds.has(d.key));
        if (!visible.length) { wrap.innerHTML = ''; return; }

        const actionsHtml =
            `<button class="flt-action" data-l2e-action="all">${typeof T === 'function' ? T('selectAll') : 'All'}</button>` +
            `<button class="flt-action" data-l2e-action="none">${typeof T === 'function' ? T('selectNone') : 'None'}</button>`;
        const bodyDisplay = l2EdgeFilterCollapsed ? 'none' : 'block';
        let rowsHtml = '';
        visible.forEach(d => {
            const isActive = l2EdgeFilter.has(d.key);
            rowsHtml += `<div class="ef-row${isActive ? ' active' : ''}" data-l2e="${d.key}" style="--ef-col:${d.color}">` +
                `<div class="ef-icon-bg"><span class="ef-indicator">` + _edgeLine(d.color, d.style) + `</span></div>` +
                `<span class="ef-label">${d.label}</span>` +
                `</div>`;
        });
        wrap.innerHTML =
            _filterSectionHdr('Edge Types', l2EdgeFilterCollapsed, actionsHtml) +
            `<div class="l2e-filter-body" style="display:${bodyDisplay}; padding:4px 0 2px;">` +
            rowsHtml + `</div>`;

        wrap.querySelector('.flt-section-hdr').addEventListener('click', () => {
            l2EdgeFilterCollapsed = !l2EdgeFilterCollapsed;
            wrap.querySelector('.l2e-filter-body').style.display = l2EdgeFilterCollapsed ? 'none' : 'block';
            wrap.querySelector('.flt-chevron').style.transform = l2EdgeFilterCollapsed ? 'rotate(-90deg)' : '';
        });
        wrap.querySelectorAll('[data-l2e]').forEach(row => {
            row.addEventListener('click', e => {
                e.stopPropagation();
                const k = row.dataset.l2e;
                if (l2EdgeFilter.has(k)) l2EdgeFilter.delete(k); else l2EdgeFilter.add(k);
                row.classList.toggle('active', l2EdgeFilter.has(k));
                applyL2Filter();
            });
        });
        wrap.querySelectorAll('[data-l2e-action]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                if (btn.dataset.l2eAction === 'all') {
                    visible.forEach(d => l2EdgeFilter.add(d.key));
                    wrap.querySelectorAll('[data-l2e]').forEach(r => r.classList.add('active'));
                } else {
                    l2EdgeFilter.clear();
                    wrap.querySelectorAll('[data-l2e]').forEach(r => r.classList.remove('active'));
                }
                applyL2Filter();
            });
        });
        return;
    }

    // Structure view or L0: placeholder
    if ((window._sv && window._sv.active) || state.level === 0) {
        wrap.innerHTML = '<div class="ft-filter-placeholder">Navigate to a module to filter edge types.</div>';
        return;
    }

    // L1: scan edges for which etype values actually exist
    const presentTypes = new Set();
    if (cy) {
        cy.edges().forEach(edge => {
            const t = edge.data('etype');
            if (t) presentTypes.add(t);
        });
    }

    if (presentTypes.size === 0) {
        wrap.innerHTML = '<div class="ft-filter-placeholder">No edges in current view.</div>';
        return;
    }

    let rowsHtml = '';
    Object.entries(EDGE_TYPE_STYLE).forEach(([type, info]) => {
        if (!presentTypes.has(type)) return;
        const isActive = edgeActiveFilter.has(type);
        rowsHtml += `<div class="ef-row${isActive ? ' active' : ''}" data-etype="${type}" style="--ef-col:${info.color}">` +
            `<div class="ef-icon-bg"><span class="ef-indicator">` + _edgeLine(info.color, info.style) + `</span></div>` +
            `<span class="ef-label">${info.label || type}</span>` +
            `</div>`;
    });

    const bodyDisplay = efFilterCollapsed ? 'none' : 'block';
    const actionsHtml =
        `<button class="flt-action" data-ef-action="all">${typeof T === 'function' ? T('selectAll') : 'All'}</button>` +
        `<button class="flt-action" data-ef-action="none">${typeof T === 'function' ? T('selectNone') : 'None'}</button>`;
    wrap.innerHTML =
        _filterSectionHdr('Edge Types', efFilterCollapsed, actionsHtml) +
        `<div class="ef-filter-body" style="display:${bodyDisplay}; padding:4px 0 2px;">` +
        rowsHtml +
        `</div>`;

    wrap.querySelector('.flt-section-hdr').addEventListener('click', () => {
        efFilterCollapsed = !efFilterCollapsed;
        const body = wrap.querySelector('.ef-filter-body');
        const chev = wrap.querySelector('.flt-chevron');
        body.style.display = efFilterCollapsed ? 'none' : 'block';
        chev.style.transform = efFilterCollapsed ? 'rotate(-90deg)' : '';
    });

    wrap.querySelectorAll('.ef-row').forEach(row => {
        row.addEventListener('click', e => {
            e.stopPropagation();
            const t = row.dataset.etype;
            if (edgeActiveFilter.has(t)) edgeActiveFilter.delete(t);
            else edgeActiveFilter.add(t);
            row.classList.toggle('active', edgeActiveFilter.has(t));
            applyEdgeFilter();
            updateSidebarStats();
        });
    });

    wrap.querySelectorAll('.flt-action').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const action = btn.dataset.efAction;
            if (action === 'all') {
                edgeActiveFilter.clear();
                Object.keys(EDGE_TYPE_STYLE).forEach(t => edgeActiveFilter.add(t));
                wrap.querySelectorAll('.ef-row').forEach(row => row.classList.add('active'));
            } else if (action === 'none') {
                edgeActiveFilter.clear();
                wrap.querySelectorAll('.ef-row').forEach(row => row.classList.remove('active'));
            }
            applyEdgeFilter();
            updateSidebarStats();
        });
    });
}

function applyEdgeFilter() {
    if (!cy) return;
    cy.batch(() => {
        cy.edges().forEach(edge => {
            const etype = edge.data('etype') || 'include';
            edge.style('display', edgeActiveFilter.has(etype) ? 'element' : 'none');
        });
    });
}

// ─── L2 filter application ────────────────────────────────────────────────────
function applyL2Filter() {
    if (!cy || state.level !== 2) return;
    // Build set of hidden _t values from node filter
    const hiddenTypes = new Set();
    L2_NODE_FILTER_DEFS.forEach(d => {
        if (!l2NodeFilter.has(d.key)) d.types.forEach(t => hiddenTypes.add(t));
    });
    cy.batch(() => {
        cy.nodes().forEach(node => {
            const t = node.data('_t');
            node.style('display', hiddenTypes.has(t) ? 'none' : 'element');
        });
        cy.edges().forEach(edge => {
            const k = edge.data('l2kind');
            const edgeOk = !k || l2EdgeFilter.has(k);
            // Also hide edges whose source or target node is hidden
            const srcHidden = hiddenTypes.has(edge.source().data('_t'));
            const tgtHidden = hiddenTypes.has(edge.target().data('_t'));
            edge.style('display', edgeOk && !srcHidden && !tgtHidden ? 'element' : 'none');
        });
    });
}

// ─── Node shape legend (informational) ───────────────────────────────────────
// L1: shows file-type shapes present in current view (from LEGEND_NODES).
// L2: shows call-flow node type legend. L0: hidden.
const _L2_NODE_TYPES = [
    { shape: '▣', color: '#60a5fa', label: 'Current file' },
    { shape: '▣', color: '#64748b', label: 'External func' },
    { shape: '▣', color: '#a78bfa', label: 'Ambiguous func' },
    { shape: '▣', color: '#34d399', label: 'System API group' },
    { shape: '▣', color: '#475569', label: 'Unresolved' },
];

function buildNodeLegend() {
    const wrap = document.getElementById('node-legend');
    if (!wrap) return;

    // L2: interactive node-type filter
    if (state.level === 2) {
        // Detect which _t types are actually present
        const presentTypes = new Set();
        if (cy) cy.nodes().forEach(n => { const t = n.data('_t'); if (t) presentTypes.add(t); });

        const visible = L2_NODE_FILTER_DEFS.filter(d => d.types.some(t => presentTypes.has(t)));
        if (!visible.length) { wrap.innerHTML = ''; return; }

        const actionsHtml =
            `<button class="flt-action" data-l2n-action="all">${typeof T === 'function' ? T('selectAll') : 'All'}</button>` +
            `<button class="flt-action" data-l2n-action="none">${typeof T === 'function' ? T('selectNone') : 'None'}</button>`;
        const bodyDisplay = l2NodeFilterCollapsed ? 'none' : 'block';
        let rowsHtml = '';
        visible.forEach(d => {
            const isActive = l2NodeFilter.has(d.key);
            rowsHtml += `<div class="ef-row${isActive ? ' active' : ''}" data-l2n="${d.key}" style="--ef-col:${d.color}">` +
                `<div class="ef-icon-bg"><span class="nl-shape" style="color:${d.color}">▣</span></div>` +
                `<span class="ef-label">${d.label}</span>` +
                `</div>`;
        });
        wrap.innerHTML =
            _filterSectionHdr('Node Types', l2NodeFilterCollapsed, actionsHtml) +
            `<div class="l2n-filter-body" style="display:${bodyDisplay}; padding:4px 0 2px;">` +
            rowsHtml + `</div>`;

        wrap.querySelector('.flt-section-hdr').addEventListener('click', () => {
            l2NodeFilterCollapsed = !l2NodeFilterCollapsed;
            wrap.querySelector('.l2n-filter-body').style.display = l2NodeFilterCollapsed ? 'none' : 'block';
            wrap.querySelector('.flt-chevron').style.transform = l2NodeFilterCollapsed ? 'rotate(-90deg)' : '';
        });
        wrap.querySelectorAll('[data-l2n]').forEach(row => {
            row.addEventListener('click', e => {
                e.stopPropagation();
                const k = row.dataset.l2n;
                if (l2NodeFilter.has(k)) l2NodeFilter.delete(k); else l2NodeFilter.add(k);
                row.classList.toggle('active', l2NodeFilter.has(k));
                applyL2Filter();
            });
        });
        wrap.querySelectorAll('[data-l2n-action]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                if (btn.dataset.l2nAction === 'all') {
                    visible.forEach(d => l2NodeFilter.add(d.key));
                    wrap.querySelectorAll('[data-l2n]').forEach(r => r.classList.add('active'));
                } else {
                    l2NodeFilter.clear();
                    wrap.querySelectorAll('[data-l2n]').forEach(r => r.classList.remove('active'));
                }
                applyL2Filter();
            });
        });
        return;
    }

    // L0 or no graph
    if (state.level === 0) {
        wrap.innerHTML = '';
        return;
    }

    // L1: scan present file extensions
    const usedExts = new Set();
    if (cy) {
        cy.nodes().forEach(node => {
            const t = node.data('_t');
            if (t !== 'file' && t !== 'dep_ext_file') return;
            const f = node.data('_f');
            const path = (f && f.path) || '';
            if (!path) return;
            const dot = path.lastIndexOf('.');
            if (dot !== -1) usedExts.add(path.slice(dot).toLowerCase());
        });
    }

    const active = LEGEND_NODES.filter(n => n.exts.some(e => usedExts.has(e)));
    if (active.length === 0) { wrap.innerHTML = ''; return; }

    const isSimpleLegend = _shapeMode === 'simple';
    const sectionLabel = isSimpleLegend ? 'Node Colors' : 'Node Shapes';
    let rowsHtml = '';
    active.forEach(n => {
        const shapeChar = isSimpleLegend ? '●' : n.shape;
        rowsHtml += `<div class="nl-row" style="--nl-col:${n.color}">` +
            `<div class="nl-icon-bg"><span class="nl-shape" style="color:${n.color}">${shapeChar}</span></div>` +
            `<span class="nl-label" style="color:${n.color}">${n.label}</span>` +
            `</div>`;
    });

    const bodyDisplay = nlFilterCollapsed ? 'none' : 'block';
    wrap.innerHTML =
        _filterSectionHdr(sectionLabel, nlFilterCollapsed) +
        `<div class="nl-filter-body" style="display:${bodyDisplay}; padding:4px 0 2px;">` +
        rowsHtml +
        `</div>`;

    wrap.querySelector('.flt-section-hdr').addEventListener('click', () => {
        nlFilterCollapsed = !nlFilterCollapsed;
        const body = wrap.querySelector('.nl-filter-body');
        const chev = wrap.querySelector('.flt-chevron');
        body.style.display = nlFilterCollapsed ? 'none' : 'block';
        chev.style.transform = nlFilterCollapsed ? 'rotate(-90deg)' : '';
    });
}

// ─── Re-render current level (used after settings changes) ────────────────────
function rerenderCurrentLevel() {
    if (state.level === 0) { loadLevel0(); return; }
    if (state.level === 1) { rerenderCurrentL1(); return; }
    if (state.level === 2 && l2State.activeFile) {
        openL2File(l2State.activeFile, { pushHistory: false });
    }
}

// ─── Sidebar stats footer ─────────────────────────────────────────────────────
function updateSidebarStats() {
    const nodesEl = document.getElementById('sb-stat-nodes');
    const edgesEl = document.getElementById('sb-stat-edges');
    if (!nodesEl || !edgesEl) return;
    if (!cy) { nodesEl.textContent = '\u2013'; edgesEl.textContent = '\u2013'; return; }
    nodesEl.textContent = cy.nodes(':visible').length + ' nodes';
    edgesEl.textContent = cy.edges(':visible').length + ' edges';
}

// ─── Sidebar tree ─────────────────────────────────────────────────────────────
// Builds a tree in the sidebar: Module → sub-folders (expandable)
// Graph always shows file nodes only.

let fsCollapsed = false;

function collectAllFilesForTree() {
    const out = [];
    Object.values(DATA.files_by_module || {}).forEach(files => {
        files.forEach(f => out.push(f));
    });
    Object.values(DATA.other_files_by_module || {}).forEach(files => {
        files.forEach(f => out.push(f));
    });
    return out;
}

function buildFullFileTree(allFiles) {
    const root = { name: '', path: '', children: [], files: [] };
    const nodeMap = { '': root };
    function getNode(folderPath) {
        if (nodeMap[folderPath]) return nodeMap[folderPath];
        const parts = folderPath.split('/');
        const name = parts[parts.length - 1];
        const parent = parts.slice(0, -1).join('/');
        const parentNode = getNode(parent);
        const node = { name, path: folderPath, children: [], files: [] };
        parentNode.children.push(node);
        nodeMap[folderPath] = node;
        return node;
    }
    for (const f of allFiles) {
        if (!f || !f.path) continue;
        const lastSlash = f.path.lastIndexOf('/');
        const folder = lastSlash >= 0 ? f.path.slice(0, lastSlash) : '';
        getNode(folder).files.push(f);
    }
    function sortNode(n) {
        n.children.sort((a, b) => a.name.localeCompare(b.name));
        n.files.sort((a, b) => (a.label || a.path).localeCompare(b.label || b.path));
        n.children.forEach(sortNode);
    }
    sortNode(root);
    return root;
}

function buildFullTreeRows(container, node, depth) {
    node.children.forEach(child => {
        const modId = child.path.split('/')[0] || child.name;
        const isTop = depth === 0;
        const subPath = child.path.startsWith(modId + '/') ? child.path.slice(modId.length + 1) : '';
        const hasKids = child.children.length > 0 || child.files.length > 0;
        const row = document.createElement('div');
        row.className = `tree-row ${isTop ? 'mod-row' : 'subdir-row'}`;
        row.dataset.modId = modId;
        row.dataset.path = child.path;
        if (isTop) {
            row.id = `mi-${modId}`;
        } else {
            row.dataset.subPath = subPath;
        }

        const count = countFiles(child);
        if (isTop) {
            row.innerHTML =
                `<span class="tree-arrow ${hasKids ? '' : 'leaf'}">▶</span>` +
                `<span class="subdir-icon">${_iconFolderClosed()}</span>` +
                `<span class="mod-name" data-tip="${child.path}">${child.name}</span>` +
                `<span class="mod-count" data-tip="${count} files">${count}</span>`;
        } else {
            const indent = 20 + depth * 14;
            row.innerHTML =
                `<span style="flex-shrink:0;width:${indent}px"></span>` +
                `<span class="tree-arrow ${hasKids ? '' : 'leaf'}">▶</span>` +
                `<span class="subdir-icon">${_iconFolderClosed()}</span>` +
                `<span class="subdir-name" data-tip="${child.path}">${child.name}</span>` +
                `<span class="subdir-count">${count}</span>`;
        }

        const children = document.createElement('div');
        children.className = 'tree-children';
        if (hasKids) {
            buildFullTreeRows(children, child, depth + 1);
        }

        row.addEventListener('click', e => {
            e.stopPropagation();
            const arrow = row.querySelector('.tree-arrow');
            const iconEl = row.querySelector('.subdir-icon');
            const isOpen = children.classList.contains('open');
            if (hasKids) {
                children.classList.toggle('open', !isOpen);
                arrow?.classList.toggle('open', !isOpen);
                if (iconEl) iconEl.innerHTML = isOpen ? _iconFolderClosed() : _iconFolderOpen();
            }
            if (isTop) {
                drillToModule(modId);
            } else {
                filterGraphToSubPath(modId, subPath);
                setSubdirActive(modId, subPath);
            }
        });

        container.appendChild(row);
        container.appendChild(children);
    });

    const fileIndent = 24 + depth * 14;
    node.files.forEach(f => {
        const row = document.createElement('div');
        row.className = 'tree-row file-row';
        row.dataset.path = f.path;
        const label = f.label || f.path;
        row.innerHTML =
            `<span style="flex-shrink:0;width:${fileIndent}px"></span>` +
            `<span class="file-icon">${_iconFile()}</span>` +
            `<span class="file-name" data-tip="${f.path}">${label}</span>`;

                row.addEventListener('click', e => {
            e.stopPropagation();
            
            // Auto-enable the file type filter for this file
            const ft = f.file_type || 'other';
            if (!ftActiveFilter.has(ft)) {
                ftActiveFilter.add(ft);
                // Rebuild file type filter UI to reflect the change
                if (typeof buildFtFilter === 'function') {
                    const modId = resolveModuleForFile(f.path);
                    if (modId && state.level === 1) {
                        buildFtFilter(modId, state.activeSubDir || null);
                    }
                }
            }
            
            const modId = resolveModuleForFile(f.path) || '_root';
            
            // If file has a module, navigate to it in the graph
            if (modId && modId !== '_root') {
                drillToModule(modId, { focusFile: f.path });
                
                // Wait for graph to render, then select node and open code panel
                setTimeout(() => {
                    const nodeId = `f${f.id}`;
                    const node = cy?.$id(nodeId);
                    if (node && node.length) {
                        // Select and center on the node
                        cy.elements().unselect();
                        node.select();
                        cy.animate({ center: { eles: node }, duration: 300 });
                    }
                    
                    // Always open code panel and update buttons
                    if (typeof loadFileInPanel === 'function') {
                        loadFileInPanel(f.path);
                    }
                    
                    if (typeof updateCallGraphBtn === 'function') {
                        updateCallGraphBtn(f.path);
                    }
                    
                    if (window.svUpdateStructBtn && typeof window.svUpdateStructBtn === 'function') {
                        const hasFuncs = (DATA.funcs_by_file && DATA.funcs_by_file[f.path]?.length > 0);
                        const hasSyms = (DATA.file_symdefs && DATA.file_symdefs[f.path]?.length > 0);
                        if (hasFuncs || hasSyms) {
                            window.svUpdateStructBtn(true);
                        }
                    }
                }, 100);
                                                } else {
                // File doesn't have a graph node (e.g., docs, note folders)
                // Rerender the current level to apply the filter change
                if (state.level === 1 && state.activeModule) {
                    rerenderCurrentL1();
                    // Rebuild filter UI to show the activated filter
                    setTimeout(() => {
                        if (typeof buildFtFilter === 'function') {
                            buildFtFilter(state.activeModule, state.activeSubDir || null);
                        }
                    }, 50);
                    
                    // Wait for graph to render, then try to select and animate the node
                    setTimeout(() => {
                        const nodeId = `f${f.id}`;
                        const node = cy?.$id(nodeId);
                        if (node && node.length) {
                            // Select and center on the node with animation
                            cy.elements().unselect();
                            node.select();
                            
                            if (typeof highlightNode === 'function') {
                                highlightNode(node);
                            }
                            
                            cy.animate({
                                center: { eles: node },
                                zoom: Math.max(cy.zoom(), 1.8),
                            }, {
                                duration: 700,
                                easing: 'ease-in-out-cubic',
                                complete: () => {
                                    if (!cy.hasElementWithId(node.id())) return;
                                    let count = 0;
                                    const originalBc = node.data('bc');
                                    const flashInterval = setInterval(() => {
                                        count++;
                                        if (!cy.hasElementWithId(node.id())) { clearInterval(flashInterval); return; }
                                        node.style('border-color', count % 2 === 1 ? (typeof _tC === 'function' ? _tC('#ffffff', '#8c7851') : '#ffffff') : originalBc);
                                        node.style('border-width', count % 2 === 1 ? 4 : 2);
                                        if (count >= 6) {
                                            clearInterval(flashInterval);
                                            node.style('border-color', originalBc);
                                            node.style('border-width', 2);
                                        }
                                    }, 200);
                                }
                            });
                        }
                    }, 150);
                }
                
                // Open code panel directly
                if (typeof loadFileInPanel === 'function') {
                    loadFileInPanel(f.path);
                }
                
                if (typeof updateCallGraphBtn === 'function') {
                    updateCallGraphBtn(f.path);
                }
                
                if (window.svUpdateStructBtn && typeof window.svUpdateStructBtn === 'function') {
                    const hasFuncs = (DATA.funcs_by_file && DATA.funcs_by_file[f.path]?.length > 0);
                    const hasSyms = (DATA.file_symdefs && DATA.file_symdefs[f.path]?.length > 0);
                    if (hasFuncs || hasSyms) {
                        window.svUpdateStructBtn(true);
                    }
                }
            }
        });

        container.appendChild(row);
    });
}

function buildSidebar() {
    const list = document.getElementById('module-list');
    list.innerHTML = '';

    // Handle collapsible sidebar title
    const sidebarTitle = document.getElementById('sidebar-title');
    if (sidebarTitle) {
        const togglerStyle = fsCollapsed ? 'transform: rotate(-90deg);' : '';
        const titleKey = (state.level === 0) ? 'sidebarModules' : 'sidebarFileSystem';
        sidebarTitle.innerHTML = `<span class="legend-toggle" style="font-size:15px; transition:transform 0.2s; ${togglerStyle}">▾</span><span class="sidebar-title-text">${T(titleKey)}</span>`;
        sidebarTitle.style.cursor = 'pointer';
        sidebarTitle.style.display = 'flex';
        sidebarTitle.style.justifyContent = 'flex-start';
        sidebarTitle.style.alignItems = 'center';
        sidebarTitle.style.gap = '6px';

        // Remove old listener if exists, normally not needed if innerHTML clears, but here it's on the title itself
        const newTitle = sidebarTitle.cloneNode(true);
        sidebarTitle.parentNode.replaceChild(newTitle, sidebarTitle);

        newTitle.addEventListener('click', () => {
            fsCollapsed = !fsCollapsed;
            const toggle = newTitle.querySelector('.legend-toggle');
            if (!fsCollapsed) {
                list.style.display = '';
                toggle.style.transform = '';
            } else {
                list.style.display = 'none';
                toggle.style.transform = 'rotate(-90deg)';
            }
        });

        // Apply initial state
        if (fsCollapsed) {
            list.style.display = 'none';
        } else {
            list.style.display = '';
        }
    }

    const rootPath = (DATA.stats?.root || '').replace(/\\/g, '/').replace(/\/$/, '');
    const rootName = rootPath.split('/').filter(Boolean).pop() || 'VIZCODE';
    const allFiles = collectAllFilesForTree();
    const tree = buildFullFileTree(allFiles);
    const totalCount = countFiles(tree);
    const hasKids = tree.children.length > 0 || tree.files.length > 0;

    // Skip root row — render children directly so the project folder itself is hidden
    const rootChildren = document.createElement('div');
    rootChildren.className = 'tree-children open';
    if (hasKids) buildFullTreeRows(rootChildren, tree, 0);
    list.appendChild(rootChildren);
}

// Recursively build a virtual tree node from flat file list
// Returns { name, path, files:[], children:[] }
function buildFileTree(files, modId) {
    const root = { name: modId, path: '', files: [], children: [] };
    const nodeMap = { '': root };

    function ensureNode(parts, upTo) {
        const key = parts.slice(0, upTo + 1).join('/');
        if (!nodeMap[key]) {
            const parent = nodeMap[parts.slice(0, upTo).join('/') || ''];
            const node = { name: parts[upTo], path: key, files: [], children: [] };
            parent.children.push(node);
            nodeMap[key] = node;
        }
        return nodeMap[key];
    }

    files.forEach(f => {
        // Path relative to module: strip "ModuleId/"
        const prefix = modId + '/';
        const rel = f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path;
        const parts = rel.split('/');
        if (parts.length === 1) {
            // root-level file
            root.files.push(f);
        } else {
            // Walk every directory part
            for (let i = 0; i < parts.length - 1; i++) {
                ensureNode(parts, i);
            }
            const dirKey = parts.slice(0, -1).join('/');
            nodeMap[dirKey].files.push(f);
        }
    });
    return root;
}

// Recursively create sidebar rows for a tree node's children
function buildTreeRows(container, node, modId, modColor, depth) {
    node.children.forEach(child => {
        const fileCount = countFiles(child);
        const hasKids = child.children.length > 0;
        const indent = 20 + depth * 14; // px left indent

        // Sub-folder row
        const row = document.createElement('div');
        row.className = 'tree-row subdir-row';
        row.dataset.modId = modId;
        row.dataset.subPath = child.path;
        row.dataset.path = `${modId}/${child.path}`;
        row.innerHTML =
            `<span style="flex-shrink:0;width:${indent}px"></span>` +
            `<span class="tree-arrow ${hasKids ? '' : 'leaf'}">▶</span>` +
            `<span class="subdir-icon">${_iconFolderClosed()}</span>` +
            `<span class="subdir-name" data-tip="${modId}/${child.path}">${child.name}</span>` +
            `<span class="subdir-count">${fileCount}</span>`;

        const subChildren = document.createElement('div');
        subChildren.className = 'tree-children';

        if (hasKids) {
            buildTreeRows(subChildren, child, modId, modColor, depth + 1);
        }

        row.addEventListener('click', e => {
            e.stopPropagation();
            const arrow = row.querySelector('.tree-arrow');
            const iconEl = row.querySelector('.subdir-icon');
            const isOpen = subChildren.classList.contains('open');

            if (hasKids) {
                subChildren.classList.toggle('open', !isOpen);
                arrow.classList.toggle('open', !isOpen);
                if (iconEl) iconEl.innerHTML = isOpen ? _iconFolderClosed() : _iconFolderOpen();
            }
            // Show files under this path in graph
            filterGraphToSubPath(modId, child.path);
            setSubdirActive(modId, child.path);
        });

        container.appendChild(row);
        container.appendChild(subChildren);
    });
}

function countFiles(node) {
    return node.files.length + node.children.reduce((s, c) => s + countFiles(c), 0);
}

function _sidebarNormPath(path) {
    return String(path || '')
        .replace(/\\/g, '/')
        .replace(/^\.\/+/, '')
        .replace(/\/+/g, '/')
        .replace(/\/$/, '');
}

function _sidebarDirname(path) {
    const norm = _sidebarNormPath(path);
    const idx = norm.lastIndexOf('/');
    return idx === -1 ? '' : norm.slice(0, idx);
}

function _sidebarFindRowByPath(path, selector) {
    const norm = _sidebarNormPath(path);
    return Array.from(document.querySelectorAll(selector)).find(row =>
        _sidebarNormPath(row.dataset.path || '') === norm
    ) || null;
}

function _sidebarSetFolderOpen(row, isOpen) {
    if (!row) return;
    const children = row.nextElementSibling;
    if (!children || !children.classList.contains('tree-children')) return;
    children.classList.toggle('open', isOpen);
    const arrow = row.querySelector('.tree-arrow');
    const iconEl = row.querySelector('.subdir-icon');
    arrow?.classList.toggle('open', isOpen);
    if (iconEl) iconEl.innerHTML = isOpen ? _iconFolderOpen() : _iconFolderClosed();
}

function _sidebarExpandToPath(path) {
    const norm = _sidebarNormPath(path);
    if (!norm) return;
    const parts = norm.split('/');
    let acc = '';
    parts.forEach(part => {
        acc = acc ? `${acc}/${part}` : part;
        const row = _sidebarFindRowByPath(acc, '.mod-row, .subdir-row');
        if (row) _sidebarSetFolderOpen(row, true);
    });
}

function _clearGalaxyExplorerHighlight() {
    document.querySelectorAll('.tree-row.galaxy-active').forEach(row => row.classList.remove('galaxy-active'));
}

window.clearSidebarGalaxyExplorerHighlight = _clearGalaxyExplorerHighlight;

function setSubdirActive(modId, subPath) {
    document.querySelectorAll('.subdir-row').forEach(el => el.classList.remove('active'));
    const row = document.querySelector(`.subdir-row[data-mod-id="${modId}"][data-sub-path="${subPath}"]`);
    if (row) row.classList.add('active');
}

function revealSidebarExplorerPath(path, kind = 'file') {
    if (_sbActiveTab === 'filters') return false;
    const norm = _sidebarNormPath(path);
    _clearGalaxyExplorerHighlight();
    if (!norm) return false;

    if (kind === 'folder') {
        _sidebarExpandToPath(norm);
        const folderRow = _sidebarFindRowByPath(norm, '.mod-row, .subdir-row');
        if (!folderRow) return false;
        folderRow.classList.add('galaxy-active');
        folderRow.scrollIntoView({ block: 'nearest' });
        return true;
    }

    _sidebarExpandToPath(_sidebarDirname(norm));
    const fileRow = _sidebarFindRowByPath(norm, '.file-row');
    if (!fileRow) return false;
    fileRow.classList.add('galaxy-active');
    fileRow.scrollIntoView({ block: 'nearest' });
    return true;
}

window.revealSidebarExplorerPath = revealSidebarExplorerPath;

// Show files under a given sub-path (all depths) in the graph
function filterGraphToSubPath(modId, subPath) {
    state.activeSubDir = subPath;
    const prefix = modId + '/' + subPath + '/';
    const allFiles = DATA.files_by_module[modId] || [];
    // Include files directly in this dir AND in any nested dirs
    const filtered = allFiles.filter(f => f.path.startsWith(prefix) || f.path === modId + '/' + subPath);
    pushL1History(modId, subPath);
    setL1ToolbarVisible(true);
    updateL1Toolbar(`${modId} / ${subPath}`, filtered.length);
    renderFilesFlat(modId, filtered, subPath);
    updateBreadcrumb();
    buildFtFilter(modId, subPath);
}

// ─── L0: Module View ──────────────────────────────────────────────────────────

