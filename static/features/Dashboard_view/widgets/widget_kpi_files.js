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
        const sub   = other ? `+${other} other` : 'all tracked';

        if (size === 'S') {
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-widget-title">Files</div>
  <div class="dash-widget-stat">${_dashFmtNum(count)}</div>
  <div class="dash-widget-sub">${sub}</div>
</div>`;
            return;
        }

        const exts  = _kpiFileExts();
        const max   = exts.length ? exts[0][1] : 1;
        const limit = size === 'L' ? 7 : 4;
        const rows  = exts.slice(0, limit).map(([ext, cnt], i) => `
<div class="dash-kpi-bar-row">
  <span class="dash-kpi-bar-label">.${_dashEscape(ext)}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${Math.round((cnt / max) * 100)}%;background:${_dashAccentStop(i)}"></div></div>
  <span class="dash-kpi-bar-val">${cnt}</span>
</div>`).join('');

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
        const max   = langs.length ? langs[0][1] : 1;

        const canvasId = 'dash-detail-files-donut';
        const { labels, data, colors: sliceColors } = _dashGroupedSlices(
            langs.map(l => `.${l[0]}`),
            langs.map(l => l[1])
        );

        container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>File Types</div>
  <div class="dash-chart-wrap" style="min-height:200px;">
    <canvas id="${canvasId}"></canvas>
  </div>
</div>
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>Breakdown</div>
  <div class="dash-list">
    ${langs.slice(0, 12).map(([ext, cnt], i) => {
        const pct = Math.round((cnt / max) * 100);
        const col = sliceColors[Math.min(i, sliceColors.length - 1)];
        return `<div class="dash-list-row">
          <span class="dash-list-rank">${i + 1}</span>
          <span class="dash-list-name">.${_dashEscape(ext)}</span>
          <div class="dash-list-bar" style="width:${Math.round(pct * 0.6)}px;background:${col}"></div>
          <span class="dash-list-val">${cnt}</span>
        </div>`;
    }).join('')}
  </div>
</div>`;

        const canvas = document.getElementById(canvasId);
        if (canvas && typeof Chart !== 'undefined') {
            _dashMkChart(canvas, 'doughnut', {
                labels,
                datasets: [{ data, backgroundColor: sliceColors, borderWidth: 0, hoverOffset: 8 }],
            }, {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'right', labels: { boxWidth: 10, padding: 10 } } },
                cutout: '70%',
            });
        }
    },
});
