// @module Dashboard_view/widgets/widget_structure
// Structure: file types doughnut, language distribution bar, module treemap.

const _DASH_TYPES_KEY     = 'structure_file_types';
const _DASH_TYPES_TYPES   = ['doughnut', 'bar'];
const _DASH_TYPES_DEFAULT = 'doughnut';

const _DASH_LANG_KEY      = 'structure_lang_dist';
const _DASH_LANG_TYPES    = ['bar', 'pie'];
const _DASH_LANG_DEFAULT  = 'bar';

function _dashStructureId(base, scope) {
    return scope ? `${base}-${scope}` : base;
}

function _dashStructureKeys(scope) {
    return {
        typesKey:  _dashStructureId(_DASH_TYPES_KEY, scope),
        langKey:   _dashStructureId(_DASH_LANG_KEY, scope),
        typesId:   _dashStructureId('dash-chart-types', scope),
        langId:    _dashStructureId('dash-chart-lang', scope),
        treemapId: _dashStructureId('dash-treemap-target', scope),
    };
}

function _dashStructureRows(sorted, labeler) {
    if (sorted.length <= 5) {
        return sorted.map(([key, value]) => ({
            key,
            keys: [key],
            label: labeler(key),
            value,
        }));
    }

    const top = sorted.slice(0, 4).map(([key, value]) => ({
        key,
        keys: [key],
        label: labeler(key),
        value,
    }));
    const rest = sorted.slice(4);
    return top.concat([{
        key: '__others__',
        keys: rest.map(([key]) => key),
        label: _dashT('dashOthers') || 'Others',
        value: rest.reduce((sum, [, value]) => sum + value, 0),
    }]);
}

function _dashStructureFilesForRows(row, resolver) {
    return (row && row.keys ? row.keys : []).flatMap(key => resolver(key));
}

function _dashRenderStructure(container, stats, options) {
    if (!container) return;
    const scope = (options && options.scope) || '';
    const isDetail = !!(options && options.detail);
    const keys = _dashStructureKeys(scope);

    container.innerHTML = `
<div class="dash-structure-layout${isDetail ? ' dash-structure-layout--detail' : ''}" style="height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:var(--space-3);overflow:hidden;">
  ${isDetail ? `<div class="dash-detail-metrics">
    <div class="dash-detail-metric"><span>${_dashFmtExactNum(stats.files || 0)}</span><small>files</small></div>
    <div class="dash-detail-metric"><span>${_dashFmtExactNum(stats.modules || 0)}</span><small>modules</small></div>
    <div class="dash-detail-metric"><span>${_dashFmtExactNum(Object.keys(stats.type_counts || {}).length)}</span><small>file types</small></div>
    <div class="dash-detail-metric"><span>${_dashFmtExactNum(Object.keys(stats.language_distribution || {}).length)}</span><small>extensions</small></div>
  </div>` : ''}
  <div class="dash-grid dash-grid-2 dash-structure-chart-grid" style="flex:1;min-height:0;overflow:hidden;">
    <div class="dash-card" style="display:flex;flex-direction:column;overflow:hidden;min-height:0;">
      <div class="dash-card-title">
        <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashStructureFileTypes'))}
        ${_dashChartToggleHTML(keys.typesKey, _DASH_TYPES_TYPES, _DASH_TYPES_DEFAULT)}
      </div>
      <div class="dash-chart-wrap dash-structure-chart-wrap" style="flex:1;min-height:0;"><canvas id="${keys.typesId}"></canvas></div>
    </div>
    <div class="dash-card" style="display:flex;flex-direction:column;overflow:hidden;min-height:0;">
      <div class="dash-card-title">
        <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashStructureLangDist'))}
        ${_dashChartToggleHTML(keys.langKey, _DASH_LANG_TYPES, _DASH_LANG_DEFAULT)}
      </div>
      <div class="dash-chart-wrap dash-structure-chart-wrap" style="flex:1;min-height:0;"><canvas id="${keys.langId}"></canvas></div>
    </div>
  </div>
  <div class="dash-card dash-structure-treemap-card" style="flex:0 0 auto;max-height:35%;overflow:hidden;">
    <div class="dash-card-title">
      <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashStructureTreemap'))}
    </div>
    <div class="dash-treemap" id="${keys.treemapId}"></div>
  </div>
</div>`;

    _dashRegisterChartSwitch(keys.typesKey, () => _dashChartFileTypes(stats, scope));
    _dashRegisterChartSwitch(keys.langKey,  () => _dashChartLanguageDist(stats, scope));

    _dashChartFileTypes(stats, scope);
    _dashChartLanguageDist(stats, scope);
    _dashBuildTreemap(scope);
}

function _dashChartFileTypes(stats, scope) {
    const keys = _dashStructureKeys(scope);
    const canvas = document.getElementById(keys.typesId);
    if (!canvas || typeof Chart === 'undefined') return;

    const tc = stats.type_counts || {};
    const sorted = Object.entries(tc).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return;

    const type = _dashChartCurrentType(keys.typesKey, _DASH_TYPES_DEFAULT);
    const isCircular = (type === 'doughnut' || type === 'pie');
    const rows = isCircular
        ? _dashStructureRows(sorted, key => key.replace('_', ' '))
        : sorted.map(([key, value]) => ({ key, keys: [key], label: key.replace('_', ' '), value }));

    const labels = rows.map(row => row.label);
    const vals   = rows.map(row => row.value);
    const fills  = isCircular ? _dashAccentForSlices(rows.length) : _dashAccentSeries(rows.length);
    const strokes = fills.map(() => _dashAccentTint(1.0));

    _dashMkChart(canvas, type, {
        labels,
        datasets: [{
            label: 'Files',
            data: vals,
            backgroundColor: fills,
            borderColor: strokes,
            borderWidth: 1.5,
            hoverOffset: isCircular ? 10 : 0,
            borderRadius: isCircular ? 0 : 4,
        }],
    }, {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_evt, elements) => {
            if (!elements || !elements.length) return;
            const row = rows[elements[0].index];
            if (row) {
                _dashOpenFileGroupDrilldown(
                    `Files: ${row.label}`,
                    _dashStructureFilesForRows(row, _dashFilesByType)
                );
            }
        },
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

function _dashChartLanguageDist(stats, scope) {
    const keys = _dashStructureKeys(scope);
    const canvas = document.getElementById(keys.langId);
    if (!canvas || typeof Chart === 'undefined') return;

    const langs = stats.language_distribution || {};
    const sorted = Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (!sorted.length) return;

    const type = _dashChartCurrentType(keys.langKey, _DASH_LANG_DEFAULT);
    const isPie = (type === 'pie');
    const rows = isPie
        ? _dashStructureRows(sorted, ext => ext || 'unknown')
        : sorted.map(([key, value]) => ({ key, keys: [key], label: key || 'unknown', value }));

    const labels = rows.map(row => row.label);
    const vals   = rows.map(row => row.value);
    const fills  = isPie ? _dashAccentForSlices(rows.length) : _dashAccentSeries(rows.length);
    const strokes = fills.map(() => _dashAccentTint(1.0));

    _dashMkChart(canvas, type, {
        labels,
        datasets: [{
            label: 'Files',
            data: vals,
            backgroundColor: fills,
            borderColor: strokes,
            borderWidth: 1.5,
            hoverOffset: isPie ? 10 : 0,
            borderRadius: isPie ? 0 : 4,
        }],
    }, {
        indexAxis: type === 'bar' ? 'y' : undefined,
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_evt, elements) => {
            if (!elements || !elements.length) return;
            const row = rows[elements[0].index];
            if (row) {
                _dashOpenFileGroupDrilldown(
                    `Files ${row.label}`,
                    _dashStructureFilesForRows(row, _dashFilesByExt)
                );
            }
        },
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

function _dashBuildTreemap(scope) {
    const el = document.getElementById(_dashStructureKeys(scope).treemapId);
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
        const label  = `${m.label} - ${_dashFmtBytes(m.size)}`;
        const click  = m.firstFile
            ? ` data-clickable="true" onclick="_dashOpenFileGroupDrilldown('Module ${_dashEscape(m.label)}', _dashFilesByModule(${_dashJson(m.id)}))"`
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
        if (size === 'S') {
            const langs = Object.entries(stats.language_distribution || {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([ext, cnt]) => ({
                    label: ext || 'unknown',
                    value: cnt,
                    onclick: `_dashOpenFileGroupDrilldown('Files ${_dashEscape(ext || 'unknown')}', _dashFilesByExt(${_dashJson(ext)}))`,
                }));
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">${_dashEscape(_dashT('dashStructureFileTypes'))}</div>
    <div class="dash-widget-stat">${_dashFmtNum(stats.files || 0)}</div>
    <div class="dash-widget-sub">${_dashFmtNum(stats.modules || 0)} modules</div>
    ${_dashMiniPills(langs)}
  </div>
</div>`;
            return;
        }
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

    renderDetail(container, stats) {
        _dashRenderStructure(container, stats, { scope: 'detail', detail: true });
    },
});
