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

    <!-- ── Row 5: Health Metrics ── -->
    <div class="dash-section-label">🏥 Architecture Health</div>
    <div class="dash-grid dash-grid-2" style="margin-bottom:16px">
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#f87171"></span>Coupling Hotspots</div>
        <div class="dash-list" id="list-coupling"></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#fbbf24"></span>God File Candidates</div>
        <div class="dash-list" id="list-god-files"></div>
      </div>
    </div>

    <!-- ── Row 6: Dead Code & Issues ── -->
    <div class="dash-grid dash-grid-3" style="margin-bottom:16px">
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#94a3b8"></span>Dead Code</div>
        <div class="dash-stat-value" style="color:#94a3b8;font-size:32px;text-align:center;margin:20px 0" id="stat-dead-funcs">0</div>
        <div class="dash-stat-sub" style="text-align:center">Uncalled Functions</div>
        <div class="dash-stat-value" style="color:#94a3b8;font-size:32px;text-align:center;margin:20px 0 10px" id="stat-unimported">0</div>
        <div class="dash-stat-sub" style="text-align:center">Unimported Files</div>
      </div>
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#fb923c"></span>Circular Dependencies</div>
        <div class="dash-stat-value" style="color:#fb923c;font-size:40px;text-align:center;margin:24px 0" id="stat-circular">0</div>
        <div class="dash-stat-sub" style="text-align:center">Dependency Cycles</div>
        <div class="dash-list" id="list-circular" style="margin-top:12px"></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#34d399"></span>Entry Points</div>
        <div class="dash-stat-value" style="color:#34d399;font-size:32px;text-align:center;margin:20px 0" id="stat-entry">0</div>
        <div class="dash-stat-sub" style="text-align:center">Root Files</div>
        <div class="dash-stat-value" style="color:#64748b;font-size:32px;text-align:center;margin:20px 0 10px" id="stat-isolated">0</div>
        <div class="dash-stat-sub" style="text-align:center">Isolated Files</div>
      </div>
    </div>

    <!-- ── Row 7: Complexity Metrics ── -->
    <div class="dash-section-label">📏 Complexity Metrics</div>
    <div class="dash-grid dash-grid-2" style="margin-bottom:16px">
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#a78bfa"></span>Function Complexity</div>
        <div class="dash-stat-value" style="color:#a78bfa;font-size:32px;text-align:center;margin:16px 0" id="stat-avg-func">0</div>
        <div class="dash-stat-sub" style="text-align:center">Average Function Length (lines)</div>
      </div>
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#f472b6"></span>Longest Functions</div>
        <div class="dash-list" id="list-longest-funcs"></div>
      </div>
    </div>

        <!-- ── Row 8: Language Distribution ── -->
    <div class="dash-section-label">🌐 Language Distribution</div>
    <div class="dash-card" style="margin-bottom:16px">
      <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#60a5fa"></span>File Extensions Breakdown</div>
      <div class="dash-chart-wrap" style="min-height:220px"><canvas id="chart-lang-dist"></canvas></div>
    </div>

    <!-- ── Row 9: Graph Intelligence ── -->
    <div class="dash-section-label">🔮 Graph Intelligence</div>
    <div class="dash-grid dash-grid-2" style="margin-bottom:16px">
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#60a5fa"></span>熱點節點 <span class="dash-card-sub" style="font-size:11px;color:#64748b;font-weight:400">top callee symbols</span></div>
        <div class="dash-list" id="list-hotspot"></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#f472b6"></span>跨界連結 <span class="dash-card-sub" style="font-size:11px;color:#64748b;font-weight:400">surprising connections</span></div>
        <div class="dash-list" id="list-surprising"></div>
      </div>
    </div>
    <div class="dash-card" style="margin-bottom:16px">
      <div class="dash-card-title"><span class="dash-card-title-dot" style="background:#a78bfa"></span>社群結構 <span class="dash-card-sub" style="font-size:11px;color:#64748b;font-weight:400">Louvain communities</span></div>
      <div id="list-communities" style="display:flex;flex-wrap:wrap;gap:8px;padding:8px 0"></div>
    </div>

    <!-- ── Row 10: Quick Actions ── -->
    <div class="dash-section-label">⚡ Quick Actions</div>
    <div class="dash-grid dash-grid-3" style="margin-bottom:24px">
      <button class="dash-action-btn" id="dash-btn-complex" style="--btn-accent:#f472b6">
        <div class="dash-action-icon">🔍</div>
        <div class="dash-action-title">Most Complex</div>
        <div class="dash-action-desc">Jump to longest function</div>
      </button>
      <button class="dash-action-btn" id="dash-btn-circular" style="--btn-accent:#fb923c">
        <div class="dash-action-icon">🔁</div>
        <div class="dash-action-title">Circular Deps</div>
        <div class="dash-action-desc">Show dependency cycles</div>
      </button>
      <button class="dash-action-btn" id="dash-btn-dead-code" style="--btn-accent:#94a3b8">
        <div class="dash-action-icon">🧟</div>
        <div class="dash-action-title">Dead Code</div>
        <div class="dash-action-desc">List uncalled functions</div>
      </button>
    </div>

  </div>
</div>`;
    document.body.appendChild(overlay);

        document.getElementById('dashboard-close').addEventListener('click', closeDashboard);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeDashboard(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.style.display !== 'none') closeDashboard(); });
    
    // Quick action buttons
    document.getElementById('dash-btn-complex')?.addEventListener('click', _jumpToMostComplex);
    document.getElementById('dash-btn-circular')?.addEventListener('click', _showCircularDeps);
    document.getElementById('dash-btn-dead-code')?.addEventListener('click', _showDeadCode);
}

// ── Entry points ──────────────────────────────────────────────────────────────
function openDashboard() {
    if (state.galaxyActive && typeof closeGalaxy === 'function') closeGalaxy();
    
    // Close AI chat window and hide button when entering Dashboard mode
    const chatBtn = document.getElementById('chat-btn');
    const chatPanel = document.getElementById('chat-panel');
    if (chatBtn) chatBtn.style.display = 'none';
    if (chatPanel && chatPanel.classList.contains('open')) {
        chatPanel.classList.remove('open');
    }
    
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
    
    // Show AI chat button when leaving Dashboard mode
    const chatBtn = document.getElementById('chat-btn');
    if (chatBtn) chatBtn.style.display = 'flex';
    
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

    // Health indicator badge
    const deadCode = (s.uncalled_functions || 0) + (s.unimported_files || 0);
    const circularDeps = s.circular_dependencies || 0;
    let healthBadge = '🟢';
    let healthText = 'Healthy';
    if (circularDeps > 5 || deadCode > 50) {
        healthBadge = '🔴';
        healthText = 'Needs Attention';
    } else if (circularDeps > 0 || deadCode > 20) {
        healthBadge = '🟡';
        healthText = 'Fair';
    }

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
            label: `${healthBadge} Code Health`,
            value: healthText,
            sub: `${circularDeps} cycles, ${deadCode} dead code items`,
            accent: circularDeps > 5 || deadCode > 50 ? '#f87171' : (circularDeps > 0 || deadCode > 20 ? '#fbbf24' : '#34d399'),
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
    
    // New health metrics
    _buildCouplingHotspots();
    _buildGodFiles();
    _buildDeadCodeStats();
    _buildCircularDepsStats();
    _buildComplexityStats();
    _buildLongestFunctions();

    // Graph Intelligence (C1/C2/C3)
    _buildHotspotNodes();
    _buildSurprisingConnections();
    _buildCommunityStructure();

    if (typeof Chart === 'undefined') {
        _fillChartPlaceholders();
        return;
    }

        _chartFileTypes();
    _chartFilesPerMod();
    _chartFuncsPerMod();
    _chartEdgeTypes();
    _chartLanguageDistribution();
}

// ── Health Metrics Builders ──────────────────────────────────────────
function _buildCouplingHotspots() {
    const el = document.getElementById('list-coupling');
    if (!el) return;
    const items = DATA.stats?.top_imported_files || [];
    const max = items[0]?.count || 1;
    el.innerHTML = items.map((item, i) => `
<div class="dash-list-row" data-tip="${item.file}">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${item.file.split('/').pop()}</span>
  <div class="dash-list-bar" style="width:${Math.round(item.count / max * 60)}px;background:#f87171"></div>
  <span class="dash-list-val" style="color:#f87171">${item.count} imports</span>
</div>`).join('') || `<div class="dash-empty">✅ No high-coupling files</div>`;
}

function _buildGodFiles() {
    const el = document.getElementById('list-god-files');
    if (!el) return;
    const items = DATA.stats?.top_caller_files || [];
    const max = items[0]?.count || 1;
    el.innerHTML = items.map((item, i) => `
<div class="dash-list-row" data-tip="${item.file}">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${item.file.split('/').pop()}</span>
  <div class="dash-list-bar" style="width:${Math.round(item.count / max * 60)}px;background:#fbbf24"></div>
  <span class="dash-list-val" style="color:#fbbf24">${item.count} calls</span>
</div>`).join('') || `<div class="dash-empty">✅ No god file detected</div>`;
}

function _buildDeadCodeStats() {
    const deadFuncs = DATA.stats?.uncalled_functions || 0;
    const unimported = DATA.stats?.unimported_files || 0;
    
    const dfEl = document.getElementById('stat-dead-funcs');
    if (dfEl) dfEl.textContent = _fmtNum(deadFuncs);
    
    const uiEl = document.getElementById('stat-unimported');
    if (uiEl) uiEl.textContent = _fmtNum(unimported);
}

function _buildCircularDepsStats() {
    const circCount = DATA.stats?.circular_dependencies || 0;
    const topCycles = DATA.stats?.top_circular_deps || [];
    
    const cEl = document.getElementById('stat-circular');
    if (cEl) cEl.textContent = circCount;
    
    const el = document.getElementById('list-circular');
    if (!el) return;
    
    if (topCycles.length === 0) {
        el.innerHTML = '<div class="dash-empty">✅ No circular dependencies</div>';
        return;
    }
    
    el.innerHTML = topCycles.map((cycle, i) => `
<div class="dash-list-row" style="flex-direction:column;align-items:flex-start;gap:4px">
  <div style="display:flex;align-items:center;gap:6px;width:100%">
    <span class="dash-list-rank">${i + 1}</span>
    <span style="font-size:11px;color:#fb923c;font-weight:600">${cycle.length} files</span>
  </div>
  <div style="font-size:10px;color:var(--muted);margin-left:24px;line-height:1.4">
    ${cycle.slice(0, 3).map(f => f.split('/').pop()).join(' → ')}
    ${cycle.length > 3 ? ` → +${cycle.length - 3} more` : ''}
  </div>
</div>`).join('');
}

function _buildComplexityStats() {
    const avgLen = DATA.stats?.avg_func_length || 0;
    const entryPts = DATA.stats?.entry_points || 0;
    const isolated = DATA.stats?.isolated_files || 0;
    
    const afEl = document.getElementById('stat-avg-func');
    if (afEl) afEl.textContent = avgLen.toFixed(1);
    
    const epEl = document.getElementById('stat-entry');
    if (epEl) epEl.textContent = _fmtNum(entryPts);
    
    const isoEl = document.getElementById('stat-isolated');
    if (isoEl) isoEl.textContent = _fmtNum(isolated);
}

function _buildLongestFunctions() {
    const el = document.getElementById('list-longest-funcs');
    if (!el) return;
    const items = (DATA.stats?.longest_functions || []).slice(0, 8);
    const max = items[0]?.lines || 1;
    el.innerHTML = items.map((item, i) => `
<div class="dash-list-row" data-tip="${item.file}">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${item.name}</span>
  <div class="dash-list-bar" style="width:${Math.round(item.lines / max * 60)}px;background:#f472b6"></div>
  <span class="dash-list-val" style="color:#f472b6">${item.lines} lines</span>
</div>`).join('') || `<div class="dash-empty">✅ No complex functions</div>`;
}

function _chartLanguageDistribution() {
    const langDist = DATA.stats?.language_distribution || {};
    const sorted = Object.entries(langDist).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const labels = sorted.map(([ext]) => ext || 'unknown');
    const vals = sorted.map(([, count]) => count);
    const colors = sorted.map((_, i) => DASH_PALETTE[i % DASH_PALETTE.length]);

    _mkChart('chart-lang-dist', 'bar', {
        labels,
        datasets: [{
            label: 'Files',
            data: vals,
            backgroundColor: colors.map(c => c + '99'),
            borderColor: colors,
            borderWidth: 1.5,
            borderRadius: 4,
        }],
    }, {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { color: '#1a253588' }, ticks: { color: '#64748b' } },
                        y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11, family: 'JetBrains Mono, monospace' } } },
        },
    });
}

// ── Quick Action Handlers ───────────────────────────────────────
// ── C1: Hotspot Nodes ─────────────────────────────────────────────────────────
function _buildHotspotNodes() {
    const el = document.getElementById('list-hotspot');
    if (!el) return;
    const items = DATA.stats?.hotspot_nodes || [];
    const max = items[0]?.degree || 1;
    el.innerHTML = items.map((item, i) => {
        const short = item.file.replace(/\\/g, '/').split('/').pop();
        return `<div class="dash-list-row" style="cursor:pointer" data-file="${item.file}"
            onclick="_jumpToHotspot('${item.file.replace(/'/g, "\\'")}')">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name" title="${item.file}">${item.label}<span style="color:#64748b;font-size:11px;margin-left:4px">${short}</span></span>
  <div class="dash-list-bar" style="width:${Math.round(item.degree / max * 60)}px;background:#60a5fa"></div>
  <span class="dash-list-val" style="color:#60a5fa">${item.degree}</span>
</div>`;
    }).join('') || `<div class="dash-empty">No hotspot symbols</div>`;
}

function _jumpToHotspot(filePath) {
    closeDashboard();
    const files = _flatFiles();
    const target = files.find(f => f.path === filePath || f.path.replace(/\\/g, '/') === filePath.replace(/\\/g, '/'));
    if (target && typeof drillFile === 'function') drillFile(target);
}

// ── C2: Surprising Connections ────────────────────────────────────────────────
function _buildSurprisingConnections() {
    const el = document.getElementById('list-surprising');
    if (!el) return;
    const items = DATA.stats?.surprising_connections || [];
    el.innerHTML = items.map(item => {
        const srcShort = item.source.replace(/\\/g, '/').split('/').pop();
        const tgtShort = item.target.replace(/\\/g, '/').split('/').pop();
        return `<div class="dash-list-row" style="flex-direction:column;align-items:flex-start;gap:2px;padding:6px 8px">
  <div style="display:flex;align-items:center;gap:6px;width:100%">
    <span style="color:#f472b6;font-size:11px;font-weight:600">${srcShort}</span>
    <span style="color:#64748b">→</span>
    <span style="color:#f472b6;font-size:11px;font-weight:600">${tgtShort}</span>
    <span style="margin-left:auto;background:#1e293b;border-radius:4px;padding:1px 6px;font-size:11px;color:#f472b6">score ${item.score}</span>
  </div>
  <div style="color:#64748b;font-size:11px">${item.reason}</div>
</div>`;
    }).join('') || `<div class="dash-empty">No surprising connections</div>`;
}

// ── C3: Community Structure ───────────────────────────────────────────────────
function _buildCommunityStructure() {
    const el = document.getElementById('list-communities');
    if (!el) return;
    const communities = DATA.community_stats || [];
    if (!communities.length) {
        el.innerHTML = `<div class="dash-empty">No communities detected</div>`;
        return;
    }
    const sorted = [...communities].sort((a, b) => b.size - a.size);
    el.innerHTML = sorted.map(c => {
        const color = DASH_PALETTE[c.id % DASH_PALETTE.length];
        return `<div style="display:flex;align-items:center;gap:6px;background:#0f1a2e;border-radius:6px;padding:4px 8px;border:1px solid ${color}22">
  <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
  <span style="font-size:12px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px" title="${c.label}">${c.label}</span>
  <span style="font-size:11px;color:#64748b;margin-left:auto;white-space:nowrap">${c.size} nodes</span>
</div>`;
    }).join('');
}

function _jumpToMostComplex() {
    const longest = DATA.stats?.longest_functions?.[0];
    if (!longest) {
        showToast('✅ No complex functions found', 'success');
        return;
    }
    
    closeDashboard();
    
    // Find the file node and focus on it
    const files = _flatFiles();
    const targetFile = files.find(f => f.path === longest.file);
    if (targetFile && typeof drillFile === 'function') {
        drillFile(targetFile);
        // Open code panel to show the function
        if (typeof openCodePanel === 'function') {
            setTimeout(() => {
                openCodePanel(targetFile, longest.name);
            }, 300);
        }
    }
    
    showToast(`🔍 Jumped to ${longest.name} (${longest.lines} lines)`, 'info');
}

function _showCircularDeps() {
    const cycles = DATA.stats?.top_circular_deps || [];
    if (cycles.length === 0) {
        showToast('✅ No circular dependencies found', 'success');
        return;
    }
    
    const totalCycles = DATA.stats?.circular_dependencies || 0;
    const message = `Found ${totalCycles} circular ${totalCycles === 1 ? 'dependency' : 'dependencies'}\n\nLargest cycle involves ${cycles[0].length} files:\n${cycles[0].slice(0, 4).map(f => '• ' + f.split('/').pop()).join('\n')}${cycles[0].length > 4 ? `\n• +${cycles[0].length - 4} more...` : ''}`;
    
    // Show in modal or toast
    if (typeof showModal === 'function') {
        showModal('🔁 Circular Dependencies', message);
    } else {
        alert(message);
    }
}

function _showDeadCode() {
    const uncalledFuncs = DATA.stats?.uncalled_functions || 0;
    const unimportedFiles = DATA.stats?.unimported_files || 0;
    
    if (uncalledFuncs === 0 && unimportedFiles === 0) {
        showToast('✅ No dead code detected', 'success');
        return;
    }
    
    const message = `Dead Code Analysis:\n\n🧟 ${uncalledFuncs} uncalled function${uncalledFuncs !== 1 ? 's' : ''}\n📄 ${unimportedFiles} unimported file${unimportedFiles !== 1 ? 's' : ''}\n\nConsider reviewing these for potential cleanup opportunities.`;
    
    if (typeof showModal === 'function') {
        showModal('🧟 Dead Code Report', message);
    } else {
        alert(message);
    }
}
