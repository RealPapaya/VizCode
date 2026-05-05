// @module Dashboard_view/widgets/widget_structure
// Structure — file types doughnut, language distribution bar, module treemap.

function _dashRenderStructure(container, stats) {
    if (!container) return;

    container.innerHTML = `
<div class="dash-grid dash-grid-2" style="margin-bottom:12px">
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot" style="background:#dfa745"></span>${_dashEscape(_dashT('dashStructureFileTypes'))}
    </div>
    <div class="dash-chart-wrap" style="min-height:240px"><canvas id="dash-chart-types"></canvas></div>
  </div>
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot" style="background:#60a5fa"></span>${_dashEscape(_dashT('dashStructureLangDist'))}
    </div>
    <div class="dash-chart-wrap" style="min-height:240px"><canvas id="dash-chart-lang"></canvas></div>
  </div>
</div>
<div class="dash-card">
  <div class="dash-card-title">
    <span class="dash-card-title-dot" style="background:#34d399"></span>${_dashEscape(_dashT('dashStructureTreemap'))}
  </div>
  <div class="dash-treemap" id="dash-treemap-target" style="min-height:120px"></div>
</div>`;

    _dashChartFileTypes(stats);
    _dashChartLanguageDist(stats);
    _dashBuildTreemap();
}

function _dashChartFileTypes(stats) {
    const canvas = document.getElementById('dash-chart-types');
    if (!canvas || typeof Chart === 'undefined') return;
    const tc = stats.type_counts || {};
    const sorted = Object.entries(tc).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return;
    const labels = sorted.map(([k]) => k.replace('_', ' '));
    const vals   = sorted.map(([, v]) => v);
    const colors = sorted.map((_, i) => _DASH_PALETTE[i % _DASH_PALETTE.length]);

    _dashMkChart(canvas, 'doughnut', {
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
        },
    });
}

function _dashChartLanguageDist(stats) {
    const canvas = document.getElementById('dash-chart-lang');
    if (!canvas || typeof Chart === 'undefined') return;
    const langs = stats.language_distribution || {};
    const sorted = Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (!sorted.length) return;
    const labels = sorted.map(([ext]) => ext || 'unknown');
    const vals   = sorted.map(([, v]) => v);
    const colors = sorted.map((_, i) => _DASH_PALETTE[i % _DASH_PALETTE.length]);

    _dashMkChart(canvas, 'bar', {
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

function _dashBuildTreemap() {
    const el = document.getElementById('dash-treemap-target');
    if (!el || !window.DATA) return;

    const modules = (DATA.modules || [])
        .map(m => {
            const files = (DATA.files_by_module || {})[m.id] || [];
            const size = files.reduce((sum, f) => sum + (f.size || 0), 0);
            return Object.assign({}, m, { size });
        })
        .filter(m => m.size > 0)
        .sort((a, b) => b.size - a.size);

    if (!modules.length) {
        el.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashNoData'))}</div>`;
        return;
    }
    const total = modules.reduce((sum, m) => sum + m.size, 0) || 1;
    const max   = modules[0].size || 1;
    el.innerHTML = modules.map(m => {
        const pct    = Math.max(8, Math.round((m.size / total) * 100));
        const rows   = Math.max(2, Math.round((m.size / max) * 5));
        const height = Math.max(40, rows * 22);
        const label  = `${m.label} • ${_dashFmtBytes(m.size)}`;
        return `
<div class="dash-tm-cell" data-tip="${_dashEscape(label)}"
     style="flex: ${pct} 1 180px; min-height:${height}px; background:${m.color || '#60a5fa'};">
  <span class="dash-tm-label">${_dashEscape(label)}</span>
</div>`;
    }).join('');
}
