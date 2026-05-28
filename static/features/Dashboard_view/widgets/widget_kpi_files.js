// @module Dashboard_view/widgets/widget_kpi_files

function _kpiFileExts() {
  const map = new Map();
  for (const files of Object.values((window.DATA || {}).files_by_module || {})) {
    for (const f of (files || [])) {
      const ext = (f.path || '').split('.').pop() || 'unknown';
      map.set(ext, (map.get(ext) || 0) + 1);
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function _dashKpiDetailBarsHTML(items) {
  const rows = (items || []).slice(0, 5);
  const vals = rows.map(m => Number(m.raw ?? String(m.value ?? '').replace(/[^\d.-]/g, '')) || 0);
  const max = Math.max(1, ...vals);
  return `
<div class="dash-kpi-detail-bars">
  ${rows.map((m, i) => {
    const pct = Math.max(4, Math.round((vals[i] || 0) / max * 100));
    const color = m.color || _dashAccentStop(i);
    return `<div class="dash-kpi-detail-bars__row">
  <span class="dash-kpi-detail-bars__label">${_dashEscape(m.label || '')}</span>
  <div class="dash-kpi-detail-bars__track"><i style="width:${pct}%;background:${color}"></i></div>
  <b class="dash-kpi-detail-bars__value">${_dashEscape(String(m.value ?? ''))}</b>
</div>`;
  }).join('')}
</div>`;
}

function _dashKpiDetailStatsHTML(items) {
  return `<div class="dash-kpi-detail-stats">${(items || []).map(item => {
    const color = item.color ? ` style="color:${item.color}"` : '';
    return `<div class="dash-kpi-detail-stat">
  <span class="dash-kpi-detail-stat__value"${color}>${_dashEscape(String(item.value ?? ''))}</span>
  <small class="dash-kpi-detail-stat__label">${_dashEscape(item.label || '')}</small>
</div>`;
  }).join('')}</div>`;
}

function _dashKpiDetailSectionHTML({ title, subtitle, body, className } = {}) {
  const cls = className ? ` ${className}` : '';
  const subtitleHTML = subtitle && String(subtitle).includes('<')
    ? String(subtitle)
    : (subtitle ? _dashEscape(subtitle) : '');
  const head = (title || subtitle) ? `
  <div class="dash-kpi-detail-section__head">
    ${title ? `<div class="dash-kpi-detail-section__title">${_dashEscape(title)}</div>` : ''}
    ${subtitle ? `<div class="dash-kpi-detail-section__subtitle">${subtitleHTML}</div>` : ''}
  </div>` : '';
  return `
<section class="dash-kpi-detail-section${cls}">
  ${head}
  <div class="dash-kpi-detail-section__body">${body || ''}</div>
</section>`;
}

function _dashKpiDetailGridHTML(items, { columns } = {}) {
  const cols = columns ? ` dash-kpi-detail-grid--${columns}` : '';
  return `<div class="dash-kpi-detail-grid${cols}">${(items || []).join('')}</div>`;
}

function _dashKpiDetailChartHTML(html, { size } = {}) {
  return `<div class="dash-chart-wrap dash-kpi-detail-chart dash-kpi-detail-chart--${size || 'md'}">${html || ''}</div>`;
}

function _dashKpiDetailListHTML(html, { className } = {}) {
  const cls = className ? ` ${className}` : '';
  return `<div class="dash-kpi-detail-list${cls}">${html || ''}</div>`;
}

_dashRegisterWidget({
  id: 'kpi_files',
  labelKey: 'dashKpiFiles',
      descriptionKey: 'dashDescKpiFiles',
  defaultSize: 'S',

  render(container, size, stats) {
    const count = stats.files || 0;
    const other = stats.other_files || 0;
    const sub = other ? `+${other} other` : 'all tracked';

    if (size === 'S') {
      const pills = _kpiFileExts().slice(0, 3).map(([ext, cnt]) => ({
        label: `.${ext}`,
        value: cnt,
        onclick: `_dashOpenFileGroupDrilldown('Files .${_dashEscape(ext)}', _dashFilesByExt(${_dashJson(ext)}))`,
      }));
      container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Files</div>
    <div class="dash-widget-stat">${_dashFmtNum(count)}</div>
    <div class="dash-widget-sub">${sub}</div>
    ${_dashMiniPills(pills)}
  </div>
</div>`;
      return;
    }

    const exts = _kpiFileExts();
    const max = exts.length ? exts[0][1] : 1;
    const limit = size === 'L' ? 7 : 4;
    const sliced = exts.slice(0, limit);
    const colors = typeof _dashColorScale === 'function' ? _dashColorScale(sliced.length) : [];
    const rows = sliced.map(([ext, cnt], i) => {
        const bg = colors[i] ? `background:${colors[i]}` : '';
        return `
<div class="dash-kpi-bar-row" style="cursor:pointer" onclick="_dashOpenFileGroupDrilldown('Files .${_dashEscape(ext)}', _dashFilesByExt(${_dashJson(ext)}))">
  <span class="dash-kpi-bar-label">.${_dashEscape(ext)}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${Math.round((cnt / max) * 100)}%;${bg}"></div></div>
  <span class="dash-kpi-bar-val">${cnt}</span>
</div>`;
    }).join('');

    if (size === 'M') {
      container.innerHTML = `
<div class="dash-kpi-m">
  <div class="dash-kpi-m-left">
    <div class="dash-widget-title">Files</div>
    <div class="dash-widget-stat-md">${_dashFmtNum(count)}</div>
    <div class="dash-widget-sub">${sub}</div>
  </div>
  <div class="dash-kpi-m-sep"></div>
  <div class="dash-kpi-m-right">${rows || '<span class="dash-kpi-empty">No data</span>'}</div>
</div>`;
    } else {
      container.innerHTML = `
<div class="dash-kpi-l">
  <div class="dash-kpi-l-head">
    <div class="dash-widget-title">Files</div>
    <div class="dash-widget-stat-lg">${_dashFmtNum(count)}</div>
    <div class="dash-widget-sub">${sub}</div>
  </div>
  <div class="dash-kpi-divider"></div>
  <div class="dash-kpi-l-body">${rows || '<span class="dash-kpi-empty">No file data</span>'}</div>
</div>`;
    }
  },

  renderDetail(container, stats) {
    // ── Build extension map ───────────────────────────────────────────────
    const langMap = new Map();
    for (const files of Object.values(DATA.files_by_module || {})) {
      (files || []).forEach(f => {
        const ext = (f.path || '').split('.').pop() || 'unknown';
        langMap.set(ext, (langMap.get(ext) || 0) + 1);
      });
    }
    const langs = [...langMap.entries()].sort((a, b) => b[1] - a[1]);
    const totalFiles = stats.files || _dashAllFiles().length;
    const extCount = langs.length;
    const modules = (DATA.modules || []).length;
    const max = langs.length ? langs[0][1] : 1;

    // ── Chart setup ──────────────────────────────────────────────────────
    const canvasId = 'dash-detail-files-donut';
    const chartKey = 'kpi_files_detail_chart';
    const chartTypes = ['doughnut', 'bar'];
    const sliceRows = langs.length > 5
      ? langs.slice(0, 4).map(([ext, cnt]) => ({ label: `.${ext}`, exts: [ext], count: cnt }))
        .concat([{
          label: _dashT('dashOthers') || 'Others',
          exts: langs.slice(4).map(([ext]) => ext),
          count: langs.slice(4).reduce((sum, [, cnt]) => sum + cnt, 0),
        }])
      : langs.map(([ext, cnt]) => ({ label: `.${ext}`, exts: [ext], count: cnt }));
    const sliceColors = typeof _dashColorScale === 'function' ? _dashColorScale(sliceRows.length) : _dashAccentForSlices(sliceRows.length);

    // ── Hero visual: top-5 extension bars ────────────────────────────────
    const heroVisual = _dashKpiDetailBarsHTML(
      langs.slice(0, 5).map(([ext, cnt], i) => ({
        label: `.${ext}`, value: cnt, raw: cnt, color: _dashAccentStop(i),
      }))
    );

    // ── Breakdown list rows ───────────────────────────────────────────────
    const breakdownSlice = langs.slice(0, 12);
    const breakdownColors = typeof _dashColorScale === 'function' ? _dashColorScale(breakdownSlice.length) : [];
    const breakdownRows = breakdownSlice.map(([ext, cnt], i) => {
      const pct = Math.round((cnt / max) * 100);
      const col = breakdownColors[i];
      const fileList = _dashFilesByExt(ext);
      return `<div class="dash-kpi-detail-row" data-clickable="true"
          onclick="_dashOpenFileGroupDrilldown('Files .${_dashEscape(ext)}', _dashFilesByExt(${_dashJson(ext)}))">
          <span class="dash-kpi-detail-row__rank">${i + 1}</span>
          <span class="dash-kpi-detail-row__name">.${_dashEscape(ext)}</span>
          <div class="dash-kpi-detail-row__bar-track"><div class="dash-kpi-detail-row__bar-fill" style="width:${pct}%;background:${col}"></div></div>
          <span class="dash-kpi-detail-row__value">${fileList.length || cnt}</span>
        </div>`;
    }).join('');

    // ── Render: hero + details wrapper ───────────────────────────────────
    container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--files">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Codebase files</div>
      <h2 class="dash-kpi-detail__title">File Inventory</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value" style="color:${_dashAccentStop(0)}">${_dashFmtExactNum(totalFiles)}</span>
        <span class="dash-kpi-detail__primary-suffix">files</span>
      </div>
      <p class="dash-kpi-detail__summary">${_dashFmtExactNum(extCount)} file extensions across ${_dashFmtExactNum(modules)} modules.</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">${heroVisual}</div>
  </section>
  <div class="dash-kpi-detail__sections">
${_dashKpiDetailSectionHTML({
  title: 'Overview',
  body: _dashKpiDetailStatsHTML([
    { value: _dashFmtExactNum(totalFiles), label: 'files' },
    { value: _dashFmtExactNum(extCount), label: 'extensions' },
    { value: _dashFmtExactNum(modules), label: 'modules' },
  ]),
})}
${_dashKpiDetailSectionHTML({
  title: 'File Types',
  subtitle: _dashChartToggleHTML(chartKey, chartTypes, 'doughnut'),
  body: `<div class="dash-kpi-detail-split">
    ${_dashKpiDetailChartHTML(`<canvas id="${canvasId}"></canvas>`, { size: 'sm' })}
    ${_dashKpiDetailListHTML(breakdownRows || '<div class="dash-empty">No file data</div>')}
  </div>`,
})}
  </div>
</div>`;

    // ── Init chart (after innerHTML) ──────────────────────────────────────
    function renderChart() {
      const canvas = document.getElementById(canvasId);
      if (!canvas || typeof Chart === 'undefined') return;
      const type = _dashChartCurrentType(chartKey, 'doughnut');
      const circular = type === 'doughnut' || type === 'pie';
      const rows = circular
        ? sliceRows
        : langs.slice(0, 12).map(([ext, cnt]) => ({ label: `.${ext}`, exts: [ext], count: cnt }));
      const colors = circular ? sliceColors : (typeof _dashColorScale === 'function' ? _dashColorScale(rows.length) : rows.map((_, i) => _dashAccentStop(i)));
      _dashMkChart(canvas, type, {
        labels: rows.map(row => row.label),
        datasets: [{
          data: rows.map(row => row.count),
          backgroundColor: colors,
          borderWidth: circular ? 0 : 1,
          borderRadius: circular ? 0 : 5,
        }],
      }, {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: type === 'bar' ? 'y' : undefined,
        onClick: (_evt, elements) => {
          if (!elements || !elements.length) return;
          const row = rows[elements[0].index];
          if (row) {
            _dashOpenFileGroupDrilldown(
              `Files ${row.label}`,
              row.exts.flatMap(ext => _dashFilesByExt(ext))
            );
          }
        },
        plugins: { legend: circular ? { position: 'bottom', labels: { boxWidth: 10, padding: 10 } } : { display: false } },
        cutout: type === 'doughnut' ? '70%' : 0,
        scales: type === 'bar' ? {
          x: { beginAtZero: true, grid: { color: _dashBorderTint(0.6) } },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } },
        } : {},
      });
    }

    _dashRegisterChartSwitch(chartKey, renderChart);
    renderChart();
  },
});
