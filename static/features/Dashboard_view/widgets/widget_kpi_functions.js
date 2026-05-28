// @module Dashboard_view/widgets/widget_kpi_functions

function _kpiFuncModules() {
  return Object.entries((window.DATA || {}).files_by_module || {})
    .map(([mod, files]) => {
      const cnt = (files || []).reduce((s, f) => s + (f.func_count || (f.functions || []).length), 0);
      return [mod, mod.split('/').pop() || mod, cnt];
    })
    .filter(([, , n]) => n > 0)
    .sort((a, b) => b[2] - a[2]);
}

_dashRegisterWidget({
  id: 'kpi_functions',
  labelKey: 'dashKpiFunctions',
      descriptionKey: 'dashDescKpiFunctions',
  defaultSize: 'S',

  render(container, size, stats) {
    const count = stats.functions || 0;
    const calls = stats.calls || 0;
    const sub = calls ? `${_dashFmtNum(calls)} calls` : 'no calls tracked';

    if (size === 'S') {
      const topFiles = _dashAllFiles()
        .filter(f => (f.func_count || 0) > 0)
        .sort((a, b) => (b.func_count || 0) - (a.func_count || 0))
        .slice(0, 3)
        .map(f => ({
          label: String(f.label || f.path).split('/').pop(),
          value: f.func_count || 0,
          title: f.path,
          onclick: `_dashOpenFunctionGroupDrilldown('Functions in ${_dashEscape(f.label || f.path)}', _dashFunctionsByFile(${_dashJson(f.path)}))`,
        }));
      container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Functions</div>
    <div class="dash-widget-stat">${_dashFmtNum(count)}</div>
    <div class="dash-widget-sub">${sub}</div>
    ${_dashMiniPills(topFiles)}
  </div>
</div>`;
      return;
    }

    const mods = _kpiFuncModules();
    const limit = size === 'L' ? 7 : 4;
    const sliced = mods.slice(0, limit);
    const colors = typeof _dashColorScale === 'function' ? _dashColorScale(sliced.length) : [];
    const rows = sliced.map(([modId, mod, cnt], i) => {
        const bg = colors[i] ? `background:${colors[i]}` : '';
        return `
<div class="dash-kpi-bar-row" style="cursor:pointer" onclick="_dashOpenFileGroupDrilldown('Files in ${_dashEscape(mod)}', _dashFilesByModule(${_dashJson(modId)}))">
  <span class="dash-kpi-bar-label">${_dashEscape(mod)}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${Math.round((cnt / (mods[0]?.[2] || 1)) * 100)}%;${bg}"></div></div>
  <span class="dash-kpi-bar-val">${cnt}</span>
</div>`;
    }).join('');

    if (size === 'M') {
      container.innerHTML = `
<div class="dash-kpi-m">
  <div class="dash-kpi-m-left">
    <div class="dash-widget-title">Functions</div>
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
    <div class="dash-widget-title">Functions</div>
    <div class="dash-widget-stat-lg">${_dashFmtNum(count)}</div>
    <div class="dash-widget-sub">${sub}</div>
  </div>
  <div class="dash-kpi-divider"></div>
  <div class="dash-kpi-l-body">${rows || '<span class="dash-kpi-empty">No module data</span>'}</div>
</div>`;
    }
  },

  renderDetail(container, stats) {
    // ── Collect all functions, sorted by length ───────────────────────────────
    const allFuncs = [];
    for (const files of Object.values(DATA.files_by_module || {})) {
      (files || []).forEach(f => {
        _dashFunctionsByFile(f.path || '').forEach(fn => allFuncs.push(fn));
      });
    }
    allFuncs.sort((a, b) => b.lines - a.lines);
    const top = allFuncs.slice(0, 15);
    const maxLines = top.length ? top[0].lines : 1;
    const rowColors = typeof _dashColorScale === 'function' ? _dashColorScale(top.length) : [];

    // ── Module function counts ─────────────────────────────────────────────────
    const allModEntries = Object.entries(DATA.files_by_module || {}).map(([mod, files]) => {
      const fnCount = (files || []).reduce((s, f) => s + (f.func_count || (f.functions || []).length), 0);
      return [mod, mod.split('/').pop() || mod, fnCount];
    }).filter(([, , count]) => count > 0).sort((a, b) => b[2] - a[2]);
    const modEntries = allModEntries.slice(0, 12);

    const totalFuncs = stats.functions || allFuncs.length;
    const calls = stats.calls || 0;
    const topModCount = modEntries.length;

    // ── Hero visual: top-5 module bars ───────────────────────────────────
    const heroVisual = _dashKpiDetailBarsHTML(
      modEntries.slice(0, 5).map(([, label, cnt], i) => ({
        label, value: cnt, raw: cnt, color: _dashAccentStop(i),
      }))
    );

    // ── Longest function list rows ───────────────────────────────────────
    const canvasId = 'dash-detail-functions-chart';
    const chartKey = 'kpi_functions_detail_chart';
    const chartTypes = ['bar', 'doughnut'];
    const topRows = top.map((fn, i) => {
      const pct = Math.round((fn.lines / maxLines) * 100);
      const col = rowColors[i];
      return `<div class="dash-kpi-detail-row" data-clickable="true" onclick="_dashGoToGraphFile(${_dashJson(fn.file)}, ${_dashJson(fn.name)})">
          <span class="dash-kpi-detail-row__rank">${i + 1}</span>
          <span class="dash-kpi-detail-row__name" title="${_dashEscape(fn.file)}">${_dashEscape(fn.name)}</span>
          <div class="dash-kpi-detail-row__bar-track"><div class="dash-kpi-detail-row__bar-fill" style="width:${pct}%;background:${col}"></div></div>
          <span class="dash-kpi-detail-row__value" title="Function length in source lines">${_dashFmtExactNum(fn.lines)} lines</span>
        </div>`;
    }).join('');

    // ── Render: hero + details wrapper ───────────────────────────────────
    container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--functions">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Codebase functions</div>
      <h2 class="dash-kpi-detail__title">Function Inventory</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value" style="color:${_dashAccentStop(1)}">${_dashFmtExactNum(totalFuncs)}</span>
        <span class="dash-kpi-detail__primary-suffix">functions</span>
      </div>
      <p class="dash-kpi-detail__summary">${calls ? `${_dashFmtExactNum(calls)} calls tracked across ` : ''}${_dashFmtExactNum(topModCount)} modules.</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">${heroVisual}</div>
  </section>
  <div class="dash-kpi-detail__sections">
${_dashKpiDetailSectionHTML({
  title: 'Overview',
  body: _dashKpiDetailStatsHTML([
    { value: _dashFmtExactNum(totalFuncs), label: 'functions' },
    { value: _dashFmtExactNum(calls), label: 'calls' },
    { value: _dashFmtExactNum(topModCount), label: 'modules' },
  ]),
})}
${_dashKpiDetailGridHTML([
  _dashKpiDetailSectionHTML({
    title: 'Functions per Module',
    subtitle: _dashChartToggleHTML(chartKey, chartTypes, 'bar'),
    body: _dashKpiDetailChartHTML(`<canvas id="${canvasId}"></canvas>`, { size: 'md' }),
  }),
  _dashKpiDetailSectionHTML({
    title: 'Longest Functions',
    body: _dashKpiDetailListHTML(topRows || '<div class="dash-empty">No function data</div>', { className: 'dash-kpi-detail-function-list' }),
  }),
], { columns: 2 })}
  </div>
</div>`;

    // ── Init chart (after innerHTML) ──────────────────────────────────────
    function renderChart() {
      const canvas = document.getElementById(canvasId);
      if (!canvas || typeof Chart === 'undefined' || !modEntries.length) return;
      const type = _dashChartCurrentType(chartKey, 'bar');
      const circular = type === 'doughnut' || type === 'pie';
      const rows = circular && modEntries.length > 5
        ? modEntries.slice(0, 4).map(e => ({ label: e[1], mods: [e[0]], count: e[2] }))
          .concat([{
            label: _dashT('dashOthers') || 'Others',
            mods: modEntries.slice(4).map(e => e[0]),
            count: modEntries.slice(4).reduce((sum, e) => sum + e[2], 0),
          }])
        : modEntries.map(e => ({ label: e[1], mods: [e[0]], count: e[2] }));
      const colors = circular ? _dashAccentForSlices(rows.length) : (typeof _dashColorScale === 'function' ? _dashColorScale(rows.length) : rows.map((_, i) => _dashAccentStop(i)));
      _dashMkChart(canvas, type, {
        labels: rows.map(row => row.label),
        datasets: [{
          data: rows.map(row => row.count),
          backgroundColor: colors,
          borderRadius: circular ? 0 : 6,
          borderWidth: 0,
        }],
      }, {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_evt, elements) => {
          if (!elements || !elements.length) return;
          const row = rows[elements[0].index];
          if (!row) return;
          _dashOpenFileGroupDrilldown(
            `Files in ${row.label}`,
            row.mods.flatMap(mod => _dashFilesByModule(mod))
          );
        },
        plugins: { legend: circular ? { position: 'bottom', labels: { boxWidth: 10, padding: 10 } } : { display: false } },
        cutout: type === 'doughnut' ? '68%' : 0,
        scales: type === 'bar' ? {
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' } },
          x: { grid: { display: false } },
        } : {},
      });
    }

    _dashRegisterChartSwitch(chartKey, renderChart);
    renderChart();
  },
});
