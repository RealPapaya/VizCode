// @module viz_dashboard — Analytics dashboard overlay with Chart.js
// Owns: _dashCharts, openDashboard, closeDashboard, _buildDashboardDOM, etc.

// ═══════════════════════════════════════════════════════════════════════════════
// VIZCODE DASHBOARD — Analytics Overlay
// All chart instances stored here for destroy/recreate on resize
// ═══════════════════════════════════════════════════════════════════════════════

const _dashCharts = {};   // id → Chart instance
let _dashBuilt = false;

// ── Chart.js global defaults ──────────────────────────────────────────────────
function _applyChartDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color = '#64748b';
    Chart.defaults.borderColor = '#1a2535';
    Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.plugins.tooltip.backgroundColor = '#0d1520';
    Chart.defaults.plugins.tooltip.borderColor = '#1a2535';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleColor = '#e2e8f0';
    Chart.defaults.plugins.tooltip.bodyColor = '#94a3b8';
    Chart.defaults.plugins.tooltip.padding = 10;
}

// ── DOM builder ───────────────────────────────────────────────────────────────
function _buildDashboardDOM() {
    if (document.getElementById('dashboard-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'dashboard-overlay';
    overlay.innerHTML = `
<div id="dashboard-panel">
  <div id="dashboard-header">
    <span class="dash-logo-text">VIZCODE</span>
    <span class="dash-logo-sep">|</span>
    <span class="dash-logo-sub">📊 Analytics Dashboard</span>
    <button id="dashboard-close" data-tip="${T('dashClose')}">✕</button>
  </div>
  <div id="dashboard-scroll">

    <!-- ── Stat Strip ── -->
    <div class="dash-stat-strip" id="dash-stat-strip"></div>

    <!-- ── Row 1: File Types + ${T('dashFilesPerModule')} ── -->
    <div class="dash-section-label">${T('dashCodebaseComposition')}</div>
    <div class="dash-grid dash-grid-2" style="margin-bottom:16px">
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot"></span>${T('dashFileTypeDistribution')}</div>
        <div class="dash-chart-wrap" style="min-height:240px"><canvas id="chart-file-types"></canvas></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#ffd700"></span>${T('dashFilesPerModule')}</div>
        <div class="dash-chart-wrap" style="min-height:240px"><canvas id="chart-files-per-mod"></canvas></div>
      </div>
    </div>

    <!-- ── Row 2: Functions + Edge Types ── -->
    <div class="dash-section-label">${T('dashStructureConnectivity')}</div>
    <div class="dash-grid dash-grid-2" style="margin-bottom:16px">
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#a78bfa"></span>${T('dashFunctionsPerModule')}</div>
        <div class="dash-chart-wrap" style="min-height:220px"><canvas id="chart-funcs-per-mod"></canvas></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#fb923c"></span>${T('dashDependencyEdgeTypes')}</div>
        <div class="dash-chart-wrap" style="min-height:220px"><canvas id="chart-edge-types"></canvas></div>
      </div>
    </div>

    <!-- ── Row 3: Top Lists ── -->
    <div class="dash-section-label">${T('dashTopRankings')}</div>
    <div class="dash-grid dash-grid-2" style="margin-bottom:16px">
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#34d399"></span>${T('dashLargestFiles')}</div>
        <div class="dash-list" id="list-largest-files"></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#f472b6"></span>${T('dashMostFunctions')}</div>
        <div class="dash-list" id="list-most-funcs"></div>
      </div>
    </div>

    <!-- ── Row 4: Module Size Treemap ── -->
    <div class="dash-section-label">${T('dashModuleSizeMap')}</div>
    <div class="dash-card" style="margin-bottom:16px">
      <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#60a5fa"></span>Module Footprint — proportional to total file size</div>
      <div class="dash-treemap" id="dash-treemap" style="min-height:120px"></div>
    </div>

  </div>
</div>`;
    document.body.appendChild(overlay);

    document.getElementById('dashboard-close').addEventListener('click', closeDashboard);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeDashboard(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.style.display !== 'none') closeDashboard(); });
}

// ── Entry points ──────────────────────────────────────────────────────────────
function openDashboard() {
    if (state.galaxyActive && typeof closeGalaxy === 'function') closeGalaxy();
    _buildDashboardDOM();
    _applyChartDefaults();
    const overlay = document.getElementById('dashboard-overlay');
    overlay.style.display = 'block';
    _renderDashboard();
    _dashBuilt = true;
    if (typeof syncTopbarModeButtons === 'function') syncTopbarModeButtons();
}

function closeDashboard() {
    const overlay = document.getElementById('dashboard-overlay');
    if (overlay) overlay.style.display = 'none';
    if (typeof syncTopbarModeButtons === 'function') syncTopbarModeButtons();
}

// ── Data helpers ──────────────────────────────────────────────────────────────
function _flatFiles() {
    if (!window.DATA) return [];
    const out = [];
    for (const [, files] of Object.entries(DATA.files_by_module || {})) {
        for (const f of files) out.push(f);
    }
    return out;
}

function _allEdges() {
    if (!window.DATA) return [];
    const out = [];
    for (const [, edges] of Object.entries(DATA.file_edges_by_module || {})) {
        for (const e of edges) out.push(e);
    }
    return out;
}

function _fmtBytes(b) {
    if (b === 0) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(2) + ' MB';
}

function _fmtNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

// ── Stat Strip ────────────────────────────────────────────────────────────────
function _buildStatStrip() {
    const s = DATA.stats || {};
    const allF = _flatFiles();
    const totalSize = allF.reduce((a, f) => a + (f.size || 0), 0);
    const edges = _allEdges();
    const estLOC = Math.round(totalSize / 40);

    const cards = [
        {
            label: T('dashStatFiles'),
            value: _fmtNum(s.files || 0),
            sub: T('dashStatFilesSub', { count: s.other_files || 0 }),
            accent: '#dfa745',
        },
        {
            label: T('dashStatFunctions'),
            value: _fmtNum(s.functions || 0),
            sub: T('dashStatFunctionsSub', { count: (s.calls || 0).toLocaleString() }),
            accent: '#a78bfa',
        },
        {
            label: T('dashStatSize'),
            value: _fmtBytes(totalSize),
            sub: `~${_fmtNum(estLOC)} lines estimated`,
            accent: '#34d399',
        },
        {
            label: 'Dependency Edges',
            value: _fmtNum(edges.length),
            sub: T('dashStatSizeSub', { count: s.modules || 0 }),
            accent: '#fb923c',
        },
    ];

    const strip = document.getElementById('dash-stat-strip');
    if (!strip) return;
    strip.innerHTML = cards.map(c => `
<div class="dash-stat-card" style="--ds-accent:${c.accent}">
  <div class="dash-stat-label">${c.label}</div>
  <div class="dash-stat-value">${c.value}</div>
  <div class="dash-stat-sub">${c.sub}</div>
</div>`).join('');
}

// ── Chart helpers ─────────────────────────────────────────────────────────────
function _mkChart(id, type, data, options) {
    if (_dashCharts[id]) {
        _dashCharts[id].destroy();
        delete _dashCharts[id];
    }
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    _dashCharts[id] = new Chart(ctx, { type, data, options });
    return _dashCharts[id];
}

const DASH_PALETTE = [
    '#dfa745', '#a78bfa', '#34d399', '#ffd700', '#fb923c',
    '#f472b6', '#60a5fa', '#e879f9', '#10b981', '#f87171',
    '#38bdf8', '#c084fc', '#4ade80', '#facc15', '#ff6b35',
];

function _chartFileTypes() {
    const tc = DATA.stats?.type_counts || {};
    const sorted = Object.entries(tc).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(([k]) => k.replace('_', ' '));
    const vals = sorted.map(([, v]) => v);
    const colors = sorted.map((_, i) => DASH_PALETTE[i % DASH_PALETTE.length]);

    _mkChart('chart-file-types', 'doughnut', {
        labels,
        datasets: [{
            data: vals,
            backgroundColor: colors.map(c => c + 'cc'),
            borderColor: colors,
            borderWidth: 1.5,
            hoverOffset: 6,
        }],
    }, {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
            legend: { position: 'right', labels: { color: '#94a3b8', boxWidth: 10, padding: 12 } },
            tooltip: {
                callbacks: {
                    label: ctx => ` ${ctx.label}: ${ctx.parsed} file${ctx.parsed !== 1 ? 's' : ''}`,
                },
            },
        },
    });
}

function _chartFilesPerMod() {
    const mods = (DATA.modules || []).slice().sort((a, b) => b.file_count - a.file_count).slice(0, 18);
    const labels = mods.map(m => m.label.length > 18 ? m.label.slice(0, 16) + '…' : m.label);
    const vals = mods.map(m => m.file_count);
    const colors = mods.map(m => m.color || '#dfa745');

    _mkChart('chart-files-per-mod', 'bar', {
        labels,
        datasets: [{
            label: T('chartFiles'),
            data: vals,
            backgroundColor: colors.map(c => c + '99'),
            borderColor: colors,
            borderWidth: 1.5,
            borderRadius: 3,
        }],
    }, {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { color: '#1a253588' }, ticks: { color: '#64748b' } },
            y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
        },
    });
}

function _chartFuncsPerMod() {
    const mods = (DATA.modules || []).slice().sort((a, b) => b.func_count - a.func_count).slice(0, 18);
    const labels = mods.map(m => m.label.length > 18 ? m.label.slice(0, 16) + '…' : m.label);
    const vals = mods.map(m => m.func_count);

    _mkChart('chart-funcs-per-mod', 'bar', {
        labels,
        datasets: [{
            label: T('chartFunctions'),
            data: vals,
            backgroundColor: '#a78bfa55',
            borderColor: '#a78bfa',
            borderWidth: 1.5,
            borderRadius: 3,
        }],
    }, {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { color: '#1a253588' }, ticks: { color: '#64748b' } },
            y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
        },
    });
}

function _chartEdgeTypes() {
    const edges = _allEdges();
    const counts = {};
    for (const e of edges) counts[e.type] = (counts[e.type] || 0) + 1;
    if (!Object.keys(counts).length) return;

    const edgeDefs = DATA.edge_types || {};
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(([k]) => edgeDefs[k]?.label || k);
    const vals = sorted.map(([, v]) => v);
    const colors = sorted.map(([k]) => edgeDefs[k]?.color || '#dfa745');

    _mkChart('chart-edge-types', 'doughnut', {
        labels,
        datasets: [{
            data: vals,
            backgroundColor: colors.map(c => c + 'cc'),
            borderColor: colors,
            borderWidth: 1.5,
            hoverOffset: 5,
        }],
    }, {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '58%',
        plugins: {
            legend: { position: 'right', labels: { color: '#94a3b8', boxWidth: 10, padding: 10, font: { size: 10 } } },
            tooltip: {
                callbacks: {
                    label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString()}`,
                },
            },
        },
    });
}

// ── Top Lists ─────────────────────────────────────────────────────────────────
function _buildLargestFiles() {
    const el = document.getElementById('list-largest-files');
    if (!el) return;
    const files = _flatFiles().filter(f => f.size > 0).sort((a, b) => b.size - a.size).slice(0, 10);
    const max = files[0]?.size || 1;
    el.innerHTML = files.map((f, i) => `
<div class="dash-list-row" data-tip="${f.path}">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${f.label}</span>
  <div class="dash-list-bar" style="width:${Math.round(f.size / max * 60)}px;background:#34d399"></div>
  <span class="dash-list-val" style="color:#34d399">${_fmtBytes(f.size)}</span>
</div>`).join('') || `<div class="dash-empty">${T('dashNoData')}</div>`;
}

function _buildMostFunctions() {
    const el = document.getElementById('list-most-funcs');
    if (!el) return;
    const files = _flatFiles()
        .filter(f => (f.func_count || 0) > 0)
        .sort((a, b) => (b.func_count || 0) - (a.func_count || 0))
        .slice(0, 10);
    const max = files[0]?.func_count || 1;
    el.innerHTML = files.map((f, i) => `
<div class="dash-list-row" data-tip="${f.path}">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${f.label}</span>
  <div class="dash-list-bar" style="width:${Math.round((f.func_count || 0) / max * 60)}px;background:#f472b6"></div>
  <span class="dash-list-val" style="color:#f472b6">${(f.func_count || 0).toLocaleString()}</span>
</div>`).join('') || `<div class="dash-empty">${T('dashNoData')}</div>`;
}

function _buildTreemap() {
    const el = document.getElementById('dash-treemap');
    if (!el) return;

    const modules = (DATA.modules || [])
        .map(m => {
            const files = DATA.files_by_module?.[m.id] || [];
            const size = files.reduce((sum, f) => sum + (f.size || 0), 0);
            return { ...m, size };
        })
        .filter(m => m.size > 0)
        .sort((a, b) => b.size - a.size);

    if (!modules.length) {
        el.innerHTML = `<div class="dash-empty">${T('dashNoData')}</div>`;
        return;
    }

    const total = modules.reduce((sum, m) => sum + m.size, 0) || 1;
    const max = modules[0].size || 1;
    el.innerHTML = modules.map(m => {
        const pct = Math.max(8, Math.round((m.size / total) * 100));
        const rows = Math.max(2, Math.round((m.size / max) * 5));
        const height = Math.max(40, rows * 22);
        const label = `${m.label} • ${_fmtBytes(m.size)}`;
        return `
<div class="dash-tm-cell" data-tip="${label}" style="flex: ${pct} 1 180px; min-height:${height}px; background:${m.color || '#60a5fa'};">
  <span class="dash-tm-label">${label}</span>
</div>`;
    }).join('');
}

function _fillChartPlaceholders() {
    document.querySelectorAll('#dashboard-panel .dash-chart-wrap').forEach(el => {
        el.innerHTML = `<div class="dash-empty">${T('dashNoData')}</div>`;
    });
}

function _destroyDashboardCharts() {
    Object.keys(_dashCharts).forEach(id => {
        try {
            _dashCharts[id]?.destroy();
        } catch (_) { }
        delete _dashCharts[id];
    });
}

function _renderDashboard() {
    if (!window.DATA || !DATA.stats) return;

    _destroyDashboardCharts();
    _buildStatStrip();
    _buildLargestFiles();
    _buildMostFunctions();
    _buildTreemap();

    if (typeof Chart === 'undefined') {
        _fillChartPlaceholders();
        return;
    }

    _chartFileTypes();
    _chartFilesPerMod();
    _chartFuncsPerMod();
    _chartEdgeTypes();
}
