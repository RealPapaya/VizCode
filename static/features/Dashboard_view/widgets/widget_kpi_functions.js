// @module Dashboard_view/widgets/widget_kpi_functions

function _kpiFuncModules() {
    return Object.entries((window.DATA || {}).files_by_module || {})
        .map(([mod, files]) => {
            const cnt = (files || []).reduce((s, f) => s + (f.functions || []).length, 0);
            return [mod.split('/').pop() || mod, cnt];
        })
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]);
}

_dashRegisterWidget({
    id: 'kpi_functions',
    labelKey: 'dashKpiFunctions',
    defaultSize: 'S',

    render(container, size, stats) {
        const count = stats.functions || 0;
        const calls = stats.calls || 0;
        const sub   = calls ? `${_dashFmtNum(calls)} calls` : 'no calls tracked';

        if (size === 'S') {
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-widget-title">Functions</div>
  <div class="dash-widget-stat">${_dashFmtNum(count)}</div>
  <div class="dash-widget-sub">${sub}</div>
</div>`;
            return;
        }

        const mods  = _kpiFuncModules();
        const max   = mods.length ? mods[0][1] : 1;
        const limit = size === 'L' ? 7 : 4;
        const rows  = mods.slice(0, limit).map(([mod, cnt], i) => `
<div class="dash-kpi-bar-row">
  <span class="dash-kpi-bar-label">${_dashEscape(mod)}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${Math.round((cnt / max) * 100)}%;background:${_dashAccentStop(i)}"></div></div>
  <span class="dash-kpi-bar-val">${cnt}</span>
</div>`).join('');

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
        const allFuncs = [];
        for (const files of Object.values(DATA.files_by_module || {})) {
            (files || []).forEach(f => {
                (f.functions || []).forEach(fn => {
                    allFuncs.push({ file: f.path || '', name: fn.name || '?', lines: fn.lines || 0 });
                });
            });
        }
        allFuncs.sort((a, b) => b.lines - a.lines);
        const top = allFuncs.slice(0, 15);
        const max = top.length ? top[0].lines : 1;
        const colors = _dashAccentForSlices(Math.min(top.length, 5));

        const modEntries = Object.entries(DATA.files_by_module || {}).map(([mod, files]) => {
            const fnCount = (files || []).reduce((s, f) => s + (f.functions || []).length, 0);
            return [mod.split('/').pop() || mod, fnCount];
        }).sort((a, b) => b[1] - a[1]).slice(0, 8);

        const canvasId = 'dash-detail-functions-chart';
        container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>Functions per Module</div>
  <div class="dash-chart-wrap" style="min-height:160px;">
    <canvas id="${canvasId}"></canvas>
  </div>
</div>
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>Longest Functions</div>
  <div class="dash-list">
    ${top.map((fn, i) => {
        const pct = Math.round((fn.lines / max) * 100);
        const col = colors[Math.min(i, colors.length - 1)];
        return `<div class="dash-list-row">
          <span class="dash-list-rank">${i + 1}</span>
          <span class="dash-list-name" title="${_dashEscape(fn.file)}">${_dashEscape(fn.name)}</span>
          <div class="dash-list-bar" style="width:${Math.round(pct * 0.6)}px;background:${col}"></div>
          <span class="dash-list-val">${fn.lines}L</span>
        </div>`;
    }).join('')}
  </div>
</div>`;

        const canvas = document.getElementById(canvasId);
        if (canvas && typeof Chart !== 'undefined' && modEntries.length) {
            _dashMkChart(canvas, 'bar', {
                labels: modEntries.map(e => e[0]),
                datasets: [{
                    data: modEntries.map(e => e[1]),
                    backgroundColor: modEntries.map((_, i) => _dashAccentStop(i)),
                    borderRadius: 6,
                    borderWidth: 0,
                }],
            }, {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' } },
                    x: { grid: { display: false } },
                },
            });
        }
    },
});
