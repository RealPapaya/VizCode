// @ts-nocheck -- JS->TS migration: deferred (leaf widget renderer). Curate later.
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

function _dashStructureHeroBarsHTML(rows) {
    const items = (rows || []).slice(0, 5);
    const max = Math.max(1, ...items.map(([, value]) => Number(value) || 0));
    return `<div class="dash-filetypes-detail-bars">${items.map(([label, value], i) => {
        const pct = Math.max(4, Math.round(((Number(value) || 0) / max) * 100));
        return `<div class="dash-filetypes-detail-bars__row">
  <span class="dash-filetypes-detail-bars__label">${_dashEscape(String(label).replace('_', ' '))}</span>
  <div class="dash-filetypes-detail-bars__track"><i style="width:${pct}%;background:${_dashAccentStop(i)}"></i></div>
  <b class="dash-filetypes-detail-bars__value">${_dashFmtExactNum(value)}</b>
</div>`;
    }).join('')}</div>`;
}

function _dashStructureRankRowsHTML(rows, resolver, titlePrefix) {
    const max = Math.max(1, ...rows.map(([, value]) => Number(value) || 0));
    const colors = typeof _dashColorScale === 'function' ? _dashColorScale(rows.length) : [];
    return rows.map(([key, value], i) => {
        const label = String(key || 'unknown').replace('_', ' ');
        const pct = Math.max(4, Math.round(((Number(value) || 0) / max) * 100));
        const color = colors[i] || _dashAccentStop(i);
        return `<div class="dash-filetypes-detail-row" data-clickable="true"
    onclick="_dashOpenFileGroupDrilldown('${_dashEscape(titlePrefix)} ${_dashEscape(label)}', ${resolver}(${_dashJson(key)}))">
  <span class="dash-filetypes-detail-row__rank">${i + 1}</span>
  <span class="dash-filetypes-detail-row__name">${_dashEscape(label)}</span>
  <div class="dash-filetypes-detail-row__track"><i style="width:${pct}%;background:${color}"></i></div>
  <span class="dash-filetypes-detail-row__value">${_dashFmtExactNum(value)}</span>
</div>`;
    }).join('');
}

function _dashRenderStructure(container, stats, options) {
    if (!container) return;
    const scope = (options && options.scope) || '';
    const isDetail = !!(options && options.detail);
    const keys = _dashStructureKeys(scope);
    const layoutStyle = isDetail
        ? 'box-sizing:border-box;display:flex;flex-direction:column;gap:var(--space-3);'
        : 'height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:var(--space-3);overflow:hidden;';
    const chartGridStyle = isDetail
        ? ''
        : 'flex:1;min-height:0;overflow:hidden;';
    const chartCardStyle = isDetail
        ? ''
        : 'display:flex;flex-direction:column;overflow:hidden;min-height:0;';
    const chartWrapStyle = isDetail
        ? ''
        : 'flex:1;min-height:0;';
    const treemapStyle = isDetail
        ? ''
        : 'flex:0 0 auto;max-height:35%;overflow:hidden;';
    const typeCount = Object.keys(stats.type_counts || {}).length;
    const extCount = Object.keys(stats.language_distribution || {}).length;
    const moduleCount = (window.DATA && DATA.modules || []).length;
    const layoutOpen = isDetail
        ? ''
        : `<div class="dash-arch-panel dash-structure-panel">
  <div class="dash-arch-panel-header">
    <div class="dash-arch-panel-title-block">
      <div class="dash-arch-panel-title">${_dashEscape(_dashT('dashStructureFileTypes'))}</div>
      <div class="dash-arch-panel-sub">${_dashFmtNum(typeCount)} types &middot; ${_dashFmtNum(extCount)} extensions &middot; ${_dashFmtNum(moduleCount)} modules</div>
    </div>
  </div>
  <div class="dash-arch-panel-body">
    <div class="dash-structure-layout" style="${layoutStyle}">`;
    const layoutClose = isDetail ? '' : '</div></div></div>';

    if (isDetail) {
        const typeRows = Object.entries(stats.type_counts || {}).sort((a, b) => b[1] - a[1]);
        const langRows = Object.entries(stats.language_distribution || {}).sort((a, b) => b[1] - a[1]);
        const detailTypeCount = typeRows.length;
        const detailExtCount = langRows.length;
        const files = stats.files || _dashAllFiles().length;
        const modules = (DATA.modules || []).length;
        const topTypeRows = typeRows.slice(0, 12);
        const topLangRows = langRows.slice(0, 12);
        const heroVisual = _dashStructureHeroBarsHTML(typeRows);
        const typeRankRows = _dashStructureRankRowsHTML(topTypeRows, '_dashFilesByType', 'Files:');
        const langRankRows = _dashStructureRankRowsHTML(topLangRows, '_dashFilesByExt', 'Files');

        container.innerHTML = `
<div class="dash-filetypes-detail">
  <section class="dash-filetypes-detail__hero">
    <div class="dash-filetypes-detail__hero-copy">
      <div class="dash-filetypes-detail__eyebrow">Codebase file types</div>
      <h2 class="dash-filetypes-detail__title">${_dashEscape(_dashT('dashStructureFileTypes'))}</h2>
      <div class="dash-filetypes-detail__primary">
        <span class="dash-filetypes-detail__primary-value">${_dashFmtExactNum(detailTypeCount)}</span>
        <span class="dash-filetypes-detail__primary-suffix">types</span>
      </div>
      <p class="dash-filetypes-detail__summary">${_dashFmtExactNum(files)} files across ${_dashFmtExactNum(detailExtCount)} extensions and ${_dashFmtExactNum(modules)} modules.</p>
    </div>
    <div class="dash-filetypes-detail__hero-visual">${heroVisual}</div>
  </section>
  <div class="dash-filetypes-detail__sections">
    <section class="dash-filetypes-detail-section dash-filetypes-detail-section--types">
      <div class="dash-filetypes-detail-section__head">
        <div class="dash-filetypes-detail-section__title">${_dashEscape(_dashT('dashStructureFileTypes'))}</div>
        <div class="dash-filetypes-detail-section__tools">${_dashChartToggleHTML(keys.typesKey, _DASH_TYPES_TYPES, _DASH_TYPES_DEFAULT)}</div>
      </div>
      <div class="dash-filetypes-detail-split">
        <div class="dash-chart-wrap dash-filetypes-detail-chart"><canvas id="${keys.typesId}"></canvas></div>
        <div class="dash-filetypes-detail-list">${typeRankRows || '<div class="dash-empty">No file type data</div>'}</div>
      </div>
    </section>
    <section class="dash-filetypes-detail-section dash-filetypes-detail-section--languages">
      <div class="dash-filetypes-detail-section__head">
        <div class="dash-filetypes-detail-section__title">${_dashEscape(_dashT('dashStructureLangDist'))}</div>
        <div class="dash-filetypes-detail-section__tools">${_dashChartToggleHTML(keys.langKey, _DASH_LANG_TYPES, _DASH_LANG_DEFAULT)}</div>
      </div>
      <div class="dash-filetypes-detail-split">
        <div class="dash-chart-wrap dash-filetypes-detail-chart"><canvas id="${keys.langId}"></canvas></div>
        <div class="dash-filetypes-detail-list">${langRankRows || '<div class="dash-empty">No language data</div>'}</div>
      </div>
    </section>
    <section class="dash-filetypes-detail-section dash-filetypes-detail-section--treemap">
      <div class="dash-filetypes-detail-section__head">
        <div class="dash-filetypes-detail-section__title">${_dashEscape(_dashT('dashStructureTreemap'))}</div>
      </div>
      <div class="dash-filetypes-detail-treemap"><div class="dash-treemap" id="${keys.treemapId}"></div></div>
    </section>
  </div>
</div>`;

        _dashRegisterChartSwitch(keys.typesKey, () => _dashChartFileTypes(stats, scope));
        _dashRegisterChartSwitch(keys.langKey,  () => _dashChartLanguageDist(stats, scope));

        _dashChartFileTypes(stats, scope);
        _dashChartLanguageDist(stats, scope);
        _dashBuildTreemap(scope);
        return;
    }

    container.innerHTML = `
${layoutOpen}
  <div class="dash-grid dash-grid-2 dash-structure-chart-grid" style="${chartGridStyle}">
    <div class="dash-card" style="${chartCardStyle}">
      <div class="dash-card-title">
        <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashStructureFileTypes'))}
        ${_dashChartToggleHTML(keys.typesKey, _DASH_TYPES_TYPES, _DASH_TYPES_DEFAULT)}
      </div>
      <div class="dash-chart-wrap dash-structure-chart-wrap" style="${chartWrapStyle}"><canvas id="${keys.typesId}"></canvas></div>
    </div>
    <div class="dash-card" style="${chartCardStyle}">
      <div class="dash-card-title">
        <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashStructureLangDist'))}
        ${_dashChartToggleHTML(keys.langKey, _DASH_LANG_TYPES, _DASH_LANG_DEFAULT)}
      </div>
      <div class="dash-chart-wrap dash-structure-chart-wrap" style="${chartWrapStyle}"><canvas id="${keys.langId}"></canvas></div>
    </div>
  </div>
  <div class="dash-card dash-structure-treemap-card" style="${treemapStyle}">
    <div class="dash-card-title">
      <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashStructureTreemap'))}
    </div>
    <div class="dash-treemap" id="${keys.treemapId}"></div>
  </div>
${layoutClose}`;

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

    const isDetail = scope === 'detail';
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
                ? { position: isDetail ? 'bottom' : 'right', labels: { boxWidth: 10, padding: isDetail ? 8 : 12 } }
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

    const isDetail = scope === 'detail';
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
                ? { position: isDetail ? 'bottom' : 'right', labels: { boxWidth: 10, padding: isDetail ? 8 : 10 } }
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
    descriptionKey: 'dashDescStructure',
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
