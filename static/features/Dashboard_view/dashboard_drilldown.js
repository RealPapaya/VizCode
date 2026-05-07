// @module Dashboard_view/dashboard_drilldown
// In-dashboard detail panel for hotspot files. Opens an overlay above the
// dashboard (not a navigation event) showing:
//   1. Functions in this file ranked by current cyclomatic complexity
//   2. Weekly churn (commits / additions / deletions) for this file
//
// The dashboard underneath stays mounted, so closing the drilldown returns
// the user to their previous scroll position. Function rows still drill
// out via the shared _dashDrill helper — that exit is intentional.

const _DASH_DRILL_OVERLAY_ID = 'dash-drilldown-overlay';
const _DASH_DRILL_CHART_ID   = 'dash-drilldown-chart';

let _dashDrillEscBound = false;

function _dashOpenDrilldown(filePath) {
    if (!filePath) return;
    _dashCloseDrilldown();   // idempotent — replace existing panel if any

    const fileRel = String(filePath).replace(/\\/g, '/');
    const stats   = (window.DATA && DATA.stats) || {};

    const overlay = document.createElement('div');
    overlay.id = _DASH_DRILL_OVERLAY_ID;
    overlay.style.cssText = [
        'position:fixed', 'inset:0',
        'background:rgba(8,12,20,0.72)', 'backdrop-filter:blur(3px)',
        'z-index:120', 'display:flex', 'align-items:center', 'justify-content:center',
        'animation:dash-fade-in 0.18s ease-out',
    ].join(';');

    overlay.innerHTML = _dashDrilldownShell(fileRel, stats);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => {
        if (e.target === overlay) _dashCloseDrilldown();
    });
    overlay.querySelector('[data-drill-close]')
        ?.addEventListener('click', _dashCloseDrilldown);

    if (!_dashDrillEscBound) {
        document.addEventListener('keydown', _dashDrillKeyHandler);
        _dashDrillEscBound = true;
    }

    _dashDrilldownDrawChart(fileRel, stats);
}

function _dashCloseDrilldown() {
    const overlay = document.getElementById(_DASH_DRILL_OVERLAY_ID);
    if (!overlay) return;
    // Destroy the chart instance so the canvas can be GC'd.
    const canvas = document.getElementById(_DASH_DRILL_CHART_ID);
    if (canvas && _dashCharts && _dashCharts[canvas.id]) {
        try { _dashCharts[canvas.id].destroy(); } catch (_) { /* ignore */ }
        delete _dashCharts[canvas.id];
    }
    overlay.remove();
    if (_dashDrillEscBound) {
        document.removeEventListener('keydown', _dashDrillKeyHandler);
        _dashDrillEscBound = false;
    }
}

function _dashDrillKeyHandler(e) {
    if (e.key === 'Escape') {
        e.stopPropagation();
        _dashCloseDrilldown();
    }
}

function _dashDrilldownShell(fileRel, stats) {
    const fileShort = fileRel.split('/').pop();
    const funcsHTML = _dashDrilldownFunctionsHTML(fileRel);
    const churnRows = (stats.per_file_churn_timeline || {})[fileRel] || [];
    const hasChurn  = churnRows.length > 0;
    const churnEmpty = `<div class="dash-empty">${_dashEscape(_dashT('dashDrilldownEmpty'))}</div>`;

    return `
<div class="dash-drilldown-panel" style="
    width:min(900px,calc(100vw - 80px));
    max-height:calc(100vh - 80px);
    background:var(--panel);
    border:1px solid var(--border);
    border-radius:10px;
    box-shadow:0 20px 60px rgba(0,0,0,0.5);
    display:flex;
    flex-direction:column;
    overflow:hidden;
">
  <div style="
      flex-shrink:0;
      padding:14px 18px;
      border-bottom:1px solid var(--border);
      display:flex;align-items:center;gap:12px;
  ">
    <div style="flex:1;min-width:0">
      <div style="font-size:11px;letter-spacing:0.08em;color:var(--muted);text-transform:uppercase">
        ${_dashEscape(_dashT('dashDrilldownTitle'))}
      </div>
      <div style="font-size:14px;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
           title="${_dashEscape(fileRel)}">
        ${_dashEscape(fileShort)}
        <span style="color:var(--muted);font-weight:400;font-size:11px;margin-left:6px">${_dashEscape(fileRel)}</span>
      </div>
    </div>
    <button data-drill-close type="button" title="${_dashEscape(_dashT('dashDrilldownClose'))}" style="
        background:transparent;border:1px solid var(--border);color:var(--muted);
        width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:14px;
        display:flex;align-items:center;justify-content:center;
    ">×</button>
  </div>
  <div style="flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:14px">
    <div class="dash-card">
      <div class="dash-card-title">
        <span class="dash-card-title-dot" style="background:#fb923c"></span>${_dashEscape(_dashT('dashDrilldownFunctions'))}
      </div>
      ${funcsHTML}
    </div>
    <div class="dash-card">
      <div class="dash-card-title">
        <span class="dash-card-title-dot" style="background:#34d399"></span>${_dashEscape(_dashT('dashDrilldownChurn'))}
      </div>
      ${hasChurn
          ? `<div class="dash-chart-wrap" style="min-height:200px"><canvas id="${_DASH_DRILL_CHART_ID}"></canvas></div>`
          : churnEmpty}
    </div>
  </div>
</div>`;
}

function _dashDrilldownFunctionsHTML(fileRel) {
    const idx = (window.DATA && DATA.symbol_index) || {};
    const funcKinds = { function: 1, method: 1 };
    const rows = [];
    for (const sym of Object.values(idx)) {
        if (!sym || sym.file !== fileRel) continue;
        if (!funcKinds[sym.kind]) continue;
        rows.push(sym);
    }
    if (!rows.length) {
        return `<div class="dash-empty">${_dashEscape(_dashT('dashDrilldownEmpty'))}</div>`;
    }
    rows.sort((a, b) => (b.complexity || 0) - (a.complexity || 0));

    const max = rows[0].complexity || 1;
    const top = rows.slice(0, 15);

    const html = top.map((s, i) => {
        const cx       = (s.complexity != null) ? s.complexity : '—';
        const cxBar    = (s.complexity != null) ? Math.round(s.complexity / max * 60) : 0;
        const lineRange = s.line ? `${s.line}${s.end_line && s.end_line !== s.line ? '–' + s.end_line : ''}` : '';
        const fileJSON = JSON.stringify(fileRel).replace(/"/g, '&quot;');
        const nameJSON = JSON.stringify(s.name || '').replace(/"/g, '&quot;');
        return `
<div class="dash-list-row" data-clickable="true"
     onclick="_dashDrill(${fileJSON}, ${nameJSON})"
     data-tip="${_dashEscape(s.name || '')}">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(s.name || '(anon)')}<span style="color:#64748b;font-size:11px;margin-left:6px">${_dashEscape(lineRange)}</span></span>
  <div class="dash-list-bar" style="width:${cxBar}px;background:#fb923c"></div>
  <span class="dash-list-val" style="color:#fb923c">cx ${cx}</span>
</div>`;
    }).join('');
    return `<div class="dash-list">${html}</div>`;
}

function _dashDrilldownDrawChart(fileRel, stats) {
    const buckets = (stats.per_file_churn_timeline || {})[fileRel] || [];
    if (!buckets.length) return;
    const canvas = document.getElementById(_DASH_DRILL_CHART_ID);
    if (!canvas || typeof Chart === 'undefined') return;

    const labels    = buckets.map(b => b.week_start);
    const commits   = buckets.map(b => b.commits);
    const additions = buckets.map(b => b.additions);
    const deletions = buckets.map(b => -Math.abs(b.deletions));

    _dashMkChart(canvas, 'line', {
        labels,
        datasets: [
            {
                label: _dashT('dashTemporalCommits'),
                data:  commits,
                yAxisID: 'yCommits',
                borderColor: '#34d399',
                backgroundColor: '#34d39955',
                borderWidth: 2,
                tension: 0.25,
                pointRadius: 3,
                fill: true,
            },
            {
                label: _dashT('dashTemporalAdditions'),
                data:  additions,
                yAxisID: 'yLines',
                borderColor: '#60a5fa',
                backgroundColor: '#60a5fa55',
                borderWidth: 1.5,
                tension: 0.25,
                pointRadius: 2,
                fill: false,
            },
            {
                label: _dashT('dashTemporalDeletions'),
                data:  deletions,
                yAxisID: 'yLines',
                borderColor: '#f87171',
                backgroundColor: '#f8717155',
                borderWidth: 1.5,
                tension: 0.25,
                pointRadius: 2,
                fill: false,
            },
        ],
    }, {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { position: 'top', labels: { color: '#94a3b8', boxWidth: 10, padding: 10 } },
        },
        scales: {
            x: {
                grid: { color: '#1a253588' },
                ticks: { color: '#64748b', maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 10 },
            },
            yCommits: {
                position: 'left',
                grid: { color: '#1a253588' },
                ticks: { color: '#34d399' },
                beginAtZero: true,
            },
            yLines: {
                position: 'right',
                grid: { display: false },
                ticks: { color: '#64748b' },
            },
        },
    });
}
