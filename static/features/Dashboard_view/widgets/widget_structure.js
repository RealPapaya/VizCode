// @module Dashboard_view/widgets/widget_structure
// Structure — file types doughnut, language distribution bar, module treemap.

const _DASH_TYPES_KEY    = 'structure_file_types';
const _DASH_TYPES_TYPES  = ['doughnut', 'bar'];
const _DASH_TYPES_DEFAULT = 'doughnut';

const _DASH_LANG_KEY      = 'structure_lang_dist';
const _DASH_LANG_TYPES    = ['bar', 'pie'];
const _DASH_LANG_DEFAULT  = 'bar';

function _dashRenderStructure(container, stats) {
    if (!container) return;

    container.innerHTML = `
<div class="dash-grid dash-grid-2" style="margin-bottom:var(--space-3)">
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashStructureFileTypes'))}
      ${_dashChartToggleHTML(_DASH_TYPES_KEY, _DASH_TYPES_TYPES, _DASH_TYPES_DEFAULT)}
    </div>
    <div class="dash-chart-wrap dash-chart-wrap--tall"><canvas id="dash-chart-types"></canvas></div>
  </div>
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashStructureLangDist'))}
      ${_dashChartToggleHTML(_DASH_LANG_KEY, _DASH_LANG_TYPES, _DASH_LANG_DEFAULT)}
    </div>
    <div class="dash-chart-wrap dash-chart-wrap--tall"><canvas id="dash-chart-lang"></canvas></div>
  </div>
</div>
<div class="dash-card">
  <div class="dash-card-title">
    <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashStructureTreemap'))}
  </div>
  <div class="dash-treemap" id="dash-treemap-target"></div>
</div>`;

    _dashRegisterChartSwitch(_DASH_TYPES_KEY, () => _dashChartFileTypes(stats));
    _dashRegisterChartSwitch(_DASH_LANG_KEY,  () => _dashChartLanguageDist(stats));

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
    // Categorical fills derived from accent at decreasing alpha — replaces
    // the old 15-colour _DASH_PALETTE rainbow.
    const fills   = _dashAccentSeries(sorted.length);
    const strokes = fills.map(() => _dashAccentTint(1.0));

    const type = _dashChartCurrentType(_DASH_TYPES_KEY, _DASH_TYPES_DEFAULT);
    const isCircular = (type === 'doughnut' || type === 'pie');

    _dashMkChart(canvas, type, {
        labels,
        datasets: [{
            label: 'Files',
            data: vals,
            backgroundColor: fills,
            borderColor:     strokes,
            borderWidth: 1.5,
            hoverOffset: isCircular ? 6 : 0,
            borderRadius: isCircular ? 0 : 4,
        }],
    }, {
        responsive: true,
        maintainAspectRatio: false,
        cutout: type === 'doughnut' ? '60%' : 0,
        indexAxis: type === 'bar' ? 'y' : undefined,
        plugins: {
            legend: isCircular
                ? { position: 'right', labels: { boxWidth: 10, padding: 12 } }
                : { display: false },
        },
        scales: type === 'bar' ? {
            x: { grid: { color: _dashBorderTint(0.6) } },
            y: { grid: { display: false }, ticks: { font: { size: 11 } } },
        } : {},
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
    const fills   = _dashAccentSeries(sorted.length);
    const strokes = fills.map(() => _dashAccentTint(1.0));

    const type = _dashChartCurrentType(_DASH_LANG_KEY, _DASH_LANG_DEFAULT);
    const isPie = (type === 'pie');

    _dashMkChart(canvas, type, {
        labels,
        datasets: [{
            label: 'Files',
            data: vals,
            backgroundColor: fills,
            borderColor:     strokes,
            borderWidth: 1.5,
            borderRadius: isPie ? 0 : 4,
        }],
    }, {
        indexAxis: type === 'bar' ? 'y' : undefined,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: isPie
                ? { position: 'right', labels: { boxWidth: 10, padding: 10 } }
                : { display: false },
        },
        scales: type === 'bar' ? {
            x: { grid: { color: _dashBorderTint(0.6) } },
            y: { grid: { display: false }, ticks: { font: { size: 11, family: 'JetBrains Mono, monospace' } } },
        } : {},
    });
}

function _dashBuildTreemap() {
    const el = document.getElementById('dash-treemap-target');
    if (!el || !window.DATA) return;

    const modules = (DATA.modules || [])
        .map(m => {
            const files = (DATA.files_by_module || {})[m.id] || [];
            const size = files.reduce((sum, f) => sum + (f.size || 0), 0);
            const firstFile = files.length ? files[0].path : '';
            return Object.assign({}, m, { size, firstFile });
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
        const click  = m.firstFile
            ? ` data-clickable="true" onclick="_dashDrill(${JSON.stringify(m.firstFile).replace(/"/g, '&quot;')}, null)"`
            : '';
        return `
<div class="dash-tm-cell"${click} data-tip="${_dashEscape(label)}"
     style="flex: ${pct} 1 180px; min-height:${height}px; background:${m.color || 'var(--accent)'};">
  <span class="dash-tm-label">${_dashEscape(label)}</span>
</div>`;
    }).join('');
}


_dashRegisterWidget({
    id: 'structure',
    labelKey: 'dashStructureFileTypes',
    defaultSize: 'L',

    render(container, size, stats) {
        if (size === 'M') {
            container.innerHTML = `
<div style="height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:var(--space-2);">
  <div class="dash-card-title">
    <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashStructureFileTypes'))}
    ${_dashChartToggleHTML(_DASH_TYPES_KEY, _DASH_TYPES_TYPES, _DASH_TYPES_DEFAULT)}
  </div>
  <div class="dash-chart-wrap" style="flex:1;min-height:0;"><canvas id="dash-chart-types"></canvas></div>
</div>`;
            _dashRegisterChartSwitch(_DASH_TYPES_KEY, () => _dashChartFileTypes(stats));
            _dashChartFileTypes(stats);
            return;
        }
        _dashRenderStructure(container, stats);
    },

    renderDetail(container, stats) { _dashRenderStructure(container, stats); },
});
