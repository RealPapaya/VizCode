const _DASH_DRILL_OVERLAY_ID = "dash-drilldown-overlay";
const _DASH_DRILL_CHART_ID = "dash-drilldown-chart";
let _dashDrillEscBound = false;
function _dashOpenDrilldown(filePath) {
  if (!filePath) return;
  _dashCloseDrilldown();
  const fileRel = String(filePath).replace(/\\/g, "/");
  const stats = window.DATA && DATA.stats || {};
  const overlay = document.createElement("div");
  overlay.id = _DASH_DRILL_OVERLAY_ID;
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "background:color-mix(in srgb, var(--bg) 70%, transparent)",
    "backdrop-filter:blur(3px)",
    "z-index:120",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "animation:dash-fade-in 0.18s ease-out"
  ].join(";");
  overlay.innerHTML = _dashDrilldownShell(fileRel, stats);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) _dashCloseDrilldown();
  });
  overlay.querySelector("[data-drill-close]")?.addEventListener("click", _dashCloseDrilldown);
  if (!_dashDrillEscBound) {
    document.addEventListener("keydown", _dashDrillKeyHandler);
    _dashDrillEscBound = true;
  }
  _dashDrilldownDrawChart(fileRel, stats);
}
function _dashCloseDrilldown() {
  const overlay = document.getElementById(_DASH_DRILL_OVERLAY_ID);
  if (!overlay) return;
  const canvas = document.getElementById(_DASH_DRILL_CHART_ID);
  if (canvas && _dashCharts && _dashCharts[canvas.id]) {
    try {
      _dashCharts[canvas.id].destroy();
    } catch (_) {
    }
    delete _dashCharts[canvas.id];
  }
  overlay.remove();
  if (_dashDrillEscBound) {
    document.removeEventListener("keydown", _dashDrillKeyHandler);
    _dashDrillEscBound = false;
  }
}
function _dashDrillKeyHandler(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    _dashCloseDrilldown();
  }
}
function _dashDrilldownShell(fileRel, stats) {
  const fileShort = fileRel.split("/").pop();
  const funcsHTML = _dashDrilldownFunctionsHTML(fileRel);
  const churnRows = (stats.per_file_churn_timeline || {})[fileRel] || [];
  const hasChurn = churnRows.length > 0;
  const churnEmpty = `<div class="dash-empty">${_dashEscape(_dashT("dashDrilldownEmpty"))}</div>`;
  return `
<div class="dash-drilldown-panel" style="
    width:min(900px,calc(100vw - 80px));
    max-height:calc(100vh - 80px);
    background:var(--surface-card);
    border:1px solid var(--border);
    border-radius:var(--radius-md);
    box-shadow:var(--shadow-lg);
    display:flex;
    flex-direction:column;
    overflow:hidden;
">
  <div style="
      flex-shrink:0;
      padding:var(--space-3) var(--space-5);
      border-bottom:1px solid var(--border);
      display:flex;align-items:center;gap:var(--space-3);
  ">
    <div style="flex:1;min-width:0">
      <div style="font-size:11px;letter-spacing:0.08em;color:var(--muted);text-transform:uppercase">
        ${_dashEscape(_dashT("dashDrilldownTitle"))}
      </div>
      <div style="font-size:14px;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
           title="${_dashEscape(fileRel)}">
        ${_dashEscape(fileShort)}
        <span style="color:var(--muted);font-weight:400;font-size:11px;margin-left:6px">${_dashEscape(fileRel)}</span>
      </div>
    </div>
    <button data-drill-close type="button" title="${_dashEscape(_dashT("dashDrilldownClose"))}" style="
        background:transparent;border:1px solid var(--border);color:var(--muted);
        width:30px;height:30px;border-radius:var(--radius-sm);cursor:pointer;font-size:14px;
        display:flex;align-items:center;justify-content:center;
    ">\xD7</button>
  </div>
  <div style="flex:1;overflow-y:auto;padding:var(--space-4) var(--space-5);display:flex;flex-direction:column;gap:var(--space-3)">
    <div class="dash-card">
      <div class="dash-card-title">
        <span class="dash-card-title-dot"></span>${_dashEscape(_dashT("dashDrilldownFunctions"))}
      </div>
      ${funcsHTML}
    </div>
    <div class="dash-card">
      <div class="dash-card-title">
        <span class="dash-card-title-dot"></span>${_dashEscape(_dashT("dashDrilldownChurn"))}
      </div>
      ${hasChurn ? `<div class="dash-chart-wrap"><canvas id="${_DASH_DRILL_CHART_ID}"></canvas></div>` : churnEmpty}
    </div>
  </div>
</div>`;
}
function _dashDrilldownFunctionsHTML(fileRel) {
  const idx = window.DATA && DATA.symbol_index || {};
  const funcKinds = { function: 1, method: 1 };
  const rows = [];
  for (const sym of Object.values(idx)) {
    if (!sym || sym.file !== fileRel) continue;
    if (!funcKinds[sym.kind]) continue;
    rows.push(sym);
  }
  if (!rows.length) {
    return `<div class="dash-empty">${_dashEscape(_dashT("dashDrilldownEmpty"))}</div>`;
  }
  rows.sort((a, b) => (b.complexity || 0) - (a.complexity || 0));
  const max = rows[0].complexity || 1;
  const top = rows.slice(0, 15);
  const html = top.map((s, i) => {
    const cx = s.complexity != null ? s.complexity : "\u2014";
    const cxBar = s.complexity != null ? Math.round(s.complexity / max * 60) : 0;
    const lineRange = s.line ? `${s.line}${s.end_line && s.end_line !== s.line ? "\u2013" + s.end_line : ""}` : "";
    const fileJSON = JSON.stringify(fileRel).replace(/"/g, "&quot;");
    const nameJSON = JSON.stringify(s.name || "").replace(/"/g, "&quot;");
    return `
<div class="dash-list-row" data-clickable="true"
     onclick="_dashDrill(${fileJSON}, ${nameJSON})"
     data-tip="${_dashEscape(s.name || "")}">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(s.name || "(anon)")}<span class="dash-list-meta">${_dashEscape(lineRange)}</span></span>
  <div class="dash-list-bar" style="width:${cxBar}px"></div>
  <span class="dash-list-val">cx ${cx}</span>
</div>`;
  }).join("");
  return `<div class="dash-list">${html}</div>`;
}
function _dashDrilldownDrawChart(fileRel, stats) {
  const buckets = (stats.per_file_churn_timeline || {})[fileRel] || [];
  if (!buckets.length) return;
  const canvas = document.getElementById(_DASH_DRILL_CHART_ID);
  if (!canvas || typeof Chart === "undefined") return;
  const labels = buckets.map((b) => b.week_start);
  const commits = buckets.map((b) => b.commits);
  const additions = buckets.map((b) => b.additions);
  const deletions = buckets.map((b) => -Math.abs(b.deletions));
  _dashMkChart(canvas, "line", {
    labels,
    datasets: [
      {
        label: _dashT("dashTemporalCommits"),
        data: commits,
        yAxisID: "yCommits",
        borderColor: _dashAccentTint(1),
        backgroundColor: _dashAccentTint(0.25),
        borderWidth: 2,
        tension: 0.25,
        pointRadius: 3,
        fill: true
      },
      {
        label: _dashT("dashTemporalAdditions"),
        data: additions,
        yAxisID: "yLines",
        borderColor: _dashAccentTint(0.55),
        backgroundColor: _dashAccentTint(0.12),
        borderWidth: 1.5,
        tension: 0.25,
        pointRadius: 2,
        fill: false
      },
      {
        label: _dashT("dashTemporalDeletions"),
        data: deletions,
        yAxisID: "yLines",
        borderColor: _dashMutedTint(0.7),
        backgroundColor: _dashMutedTint(0.15),
        borderWidth: 1.5,
        tension: 0.25,
        pointRadius: 2,
        fill: false
      }
    ]
  }, {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", labels: { boxWidth: 10, padding: 10 } }
    },
    scales: {
      x: {
        grid: { color: _dashBorderTint(0.6) },
        ticks: { maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 10 }
      },
      yCommits: {
        position: "left",
        grid: { color: _dashBorderTint(0.6) },
        ticks: { color: _dashAccentTint(1) },
        beginAtZero: true
      },
      yLines: {
        position: "right",
        grid: { display: false }
      }
    }
  });
}
