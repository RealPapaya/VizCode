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

_dashRegisterWidget({
  id: 'kpi_files',
  labelKey: 'dashKpiFiles',
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
    const langMap = new Map();
    for (const files of Object.values(DATA.files_by_module || {})) {
      (files || []).forEach(f => {
        const ext = (f.path || '').split('.').pop() || 'unknown';
        langMap.set(ext, (langMap.get(ext) || 0) + 1);
      });
    }
    const langs = [...langMap.entries()].sort((a, b) => b[1] - a[1]);
    const max = langs.length ? langs[0][1] : 1;
    const canvasId = 'dash-detail-files-donut';
    const sliceRows = langs.length > 5
      ? langs.slice(0, 4).map(([ext, cnt]) => ({ label: `.${ext}`, exts: [ext], count: cnt }))
        .concat([{
          label: _dashT('dashOthers') || 'Others',
          exts: langs.slice(4).map(([ext]) => ext),
          count: langs.slice(4).reduce((sum, [, cnt]) => sum + cnt, 0),
        }])
      : langs.map(([ext, cnt]) => ({ label: `.${ext}`, exts: [ext], count: cnt }));
    const labels = sliceRows.map(row => row.label);
    const data = sliceRows.map(row => row.count);
    const sliceColors = typeof _dashColorScale === 'function' ? _dashColorScale(sliceRows.length) : _dashAccentForSlices(sliceRows.length);
    const chartKey = 'kpi_files_detail_chart';
    const chartTypes = ['doughnut', 'bar'];

    const breakdownSlice = langs.slice(0, 12);
    const breakdownColors = typeof _dashColorScale === 'function' ? _dashColorScale(breakdownSlice.length) : [];
    const breakdownRows = breakdownSlice.map(([ext, cnt], i) => {
      const pct = Math.round((cnt / max) * 100);
      const col = breakdownColors[i];
      const files = _dashFilesByExt(ext);
      return `<div class="dash-list-row" data-clickable="true"
          onclick="_dashOpenFileGroupDrilldown('Files .${_dashEscape(ext)}', _dashFilesByExt(${_dashJson(ext)}))">
          <span class="dash-list-rank">${i + 1}</span>
          <span class="dash-list-name">.${_dashEscape(ext)}</span>
          <div class="dash-list-bar-track"><div class="dash-list-bar-fill" style="width:${pct}%;background:${col}"></div></div>
          <span class="dash-list-val">${files.length || cnt}</span>
        </div>`;
    }).join('');

    container.innerHTML = _dashReportSection({
      title: 'File Types',
      subtitle: _dashChartToggleHTML(chartKey, chartTypes, 'doughnut'),
      body: `
  ${_dashReportStats([
    { value: _dashFmtExactNum(stats.files || _dashAllFiles().length), label: 'files' },
    { value: _dashFmtExactNum(langs.length), label: 'extensions' },
    { value: _dashFmtExactNum((DATA.modules || []).length), label: 'modules' },
  ])}
  <div class="dash-detail-split">
    ${_dashReportChart(`<canvas id="${canvasId}"></canvas>`, { size: 'sm' })}
    ${_dashReportList(breakdownRows)}
  </div>
`,
    });

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
