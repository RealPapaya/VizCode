const _DASH_SEC_SEV_ORDER = ["high", "medium", "low"];
function _dashSecEmpty() {
  return {
    score: 10,
    total: 0,
    counts: { high: 0, medium: 0, low: 0 },
    top_issues: [],
    by_severity: { high: [], medium: [], low: [] },
    by_rule: [],
    trend: []
  };
}
function _dashSecSevColor(sev) {
  if (sev === "high") return "var(--status-bad)";
  if (sev === "medium") return "var(--status-warn)";
  return "var(--muted)";
}
function _dashSecScoreColor(score) {
  if (typeof _dashHealthColor === "function") return _dashHealthColor(score);
  if (score >= 8) return "var(--status-good)";
  if (score >= 5) return "var(--status-warn)";
  return "var(--status-bad)";
}
function _dashSecIssueRow(issue, opts) {
  const sev = issue.severity || "low";
  const color = _dashSecSevColor(sev);
  const title = _dashEscape(issue.title || issue.rule_id || "");
  const rawPath = issue.path || issue.file || "";
  const path = _dashEscape(rawPath);
  const lineNo = Number(issue.line) > 0 ? Number(issue.line) : 0;
  const lineSuffix = lineNo ? `:${lineNo}` : "";
  const code = issue.code ? `<div class="dash-list-sub" style="font-family:var(--font-mono,monospace);font-size:0.7rem;opacity:0.5;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_dashEscape(issue.code)}</div>` : "";
  const showCode = opts && opts.showCode;
  const clickAttrs = rawPath ? ` data-clickable="true" onclick="event.stopPropagation();_dashGoToGraphFile(${_dashJson(rawPath)}, null, ${lineNo || "null"})"` : "";
  const cursorStyle = rawPath ? ";cursor:pointer" : "";
  const tipAttr = rawPath ? ` title="${path}${lineSuffix}"` : "";
  return `
<div class="dash-list-row"${clickAttrs}${tipAttr} style="align-items:flex-start;padding:6px 8px${cursorStyle}">
  <span class="dash-arch-status-dot" style="color:${color};background:${color};margin-top:6px;flex-shrink:0"></span>
  <div style="flex:1;min-width:0">
    <div style="display:flex;gap:6px;align-items:baseline">
      <span style="font-weight:600;font-size:0.78rem">${title}</span>
      <span style="font-size:0.68rem;opacity:0.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">${path}${lineSuffix}</span>
    </div>
    ${showCode ? code : ""}
  </div>
</div>`;
}
function _dashSecGauge(score, color, opts) {
  const fontSize = opts && opts.fontSize || 40;
  const showDen = !(opts && opts.hideDen);
  return `
<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1">
  <div style="display:flex;align-items:baseline;gap:4px">
    <span style="font-size:${fontSize}px;font-weight:700;color:${color}">${score.toFixed(1)}</span>
    ${showDen ? `<span style="font-size:${Math.round(fontSize * 0.4)}px;opacity:0.4">/10</span>` : ""}
  </div>
</div>`;
}
function _dashSecSevPill(label, count, color) {
  return `
<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;background:color-mix(in srgb, ${color} 14%, transparent);font-size:0.7rem;font-weight:600;color:${color}">
  <span style="width:6px;height:6px;border-radius:50%;background:${color}"></span>${label}: ${count}
</span>`;
}
function _dashSecRenderSmall(container, f) {
  const color = _dashSecScoreColor(f.score);
  const top3 = (f.top_issues || []).slice(0, 3).map(
    (i) => `<div style="display:flex;align-items:center;gap:5px;font-size:0.7rem;opacity:0.7">
           <span class="dash-arch-status-dot" style="color:${_dashSecSevColor(i.severity)};background:${_dashSecSevColor(i.severity)}"></span>
           <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_dashEscape(i.title || i.rule_id || "")}</span>
         </div>`
  ).join("");
  container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">${_dashEscape(_dashT("dashSecurityTitle"))}</div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:6px;min-height:0">
      ${_dashSecGauge(f.score, color, { fontSize: 48, hideDen: true })}
      <div style="font-size:0.7rem;color:${color};font-weight:600">${f.total} ${_dashEscape(_dashT("dashSecurityIssues"))}</div>
    </div>
    ${top3 ? `<div style="display:flex;flex-direction:column;gap:2px;margin-top:4px;width:100%">${top3}</div>` : ""}
  </div>
</div>`;
}
function _dashSecRenderMedium(container, f) {
  const color = _dashSecScoreColor(f.score);
  const list = (f.top_issues || []).slice(0, 6).map((i) => _dashSecIssueRow(i, { showCode: false })).join("");
  const empty = !f.total ? `<div class="dash-empty" style="text-align:center;padding:10px;opacity:0.5;font-size:0.78rem">${_dashEscape(_dashT("dashSecurityClean"))}</div>` : "";
  container.innerHTML = `
<div class="dash-kpi-m" style="display:flex;height:100%">
  <div class="dash-kpi-m-left" style="align-items:center;text-align:center;min-width:130px;justify-content:center">
    <div class="dash-widget-title">${_dashEscape(_dashT("dashSecurityTitle"))}</div>
    ${_dashSecGauge(f.score, color, { fontSize: 40 })}
    <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;margin-top:6px">
      ${_dashSecSevPill("H", f.counts.high, _dashSecSevColor("high"))}
      ${_dashSecSevPill("M", f.counts.medium, _dashSecSevColor("medium"))}
      ${_dashSecSevPill("L", f.counts.low, _dashSecSevColor("low"))}
    </div>
  </div>
  <div class="dash-kpi-m-sep"></div>
  <div class="dash-kpi-m-right" style="flex:1;min-width:0;overflow-y:auto">
    ${list || empty}
  </div>
</div>`;
}
function _dashSecRenderLarge(container, f) {
  const color = _dashSecScoreColor(f.score);
  const col = (sev, label) => {
    const items = (f.by_severity[sev] || []).slice(0, 8);
    const rows = items.length ? items.map((i) => _dashSecIssueRow(i, { showCode: false })).join("") : `<div class="dash-empty" style="opacity:0.4;font-size:0.72rem;text-align:center;padding:8px">\u2014</div>`;
    const c = _dashSecSevColor(sev);
    return `
<div class="dash-card" style="display:flex;flex-direction:column;min-height:0;padding:8px 10px">
  <div style="display:flex;align-items:center;gap:6px;font-size:0.78rem;font-weight:600;margin-bottom:6px">
    <span class="dash-arch-status-dot" style="color:${c};background:${c}"></span>
    <span>${_dashEscape(label)}</span>
    <span style="opacity:0.45;font-weight:400">${(f.by_severity[sev] || []).length}</span>
  </div>
  <div class="dash-list" style="overflow-y:auto;min-height:0;flex:1">${rows}</div>
</div>`;
  };
  container.innerHTML = `
<div style="display:flex;flex-direction:column;height:100%;gap:6px">
  <div class="dash-card-title">
    <span class="dash-card-title-dot" style="background:${color}"></span>
    ${_dashEscape(_dashT("dashSecurityTitle"))}
    <span style="margin-left:auto;font-size:1.2rem;font-weight:700;color:${color}">${f.score.toFixed(1)}<span style="font-size:0.7rem;opacity:0.45">/10</span></span>
  </div>
  <div class="dash-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;flex:1;min-height:0">
    ${col("high", _dashT("dashSecuritySevHigh"))}
    ${col("medium", _dashT("dashSecuritySevMedium"))}
    ${col("low", _dashT("dashSecuritySevLow"))}
  </div>
</div>`;
}
function _dashSecRenderDetail(container, f) {
  const color = _dashSecScoreColor(f.score);
  const trend = (f.trend || []).slice(-30);
  const ruleRows = (f.by_rule || []).slice(0, 30).map((r) => `
<div class="dash-list-row" style="padding:6px 8px">
  <span class="dash-arch-status-dot" style="color:${_dashSecSevColor(r.severity)};background:${_dashSecSevColor(r.severity)};flex-shrink:0"></span>
  <span style="font-size:0.78rem;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_dashEscape(r.title)} <span style="opacity:0.4;font-weight:400">${_dashEscape(r.rule_id)}</span></span>
  <span style="font-size:0.72rem;opacity:0.6">${r.count} \xB7 ${r.files.length} files</span>
</div>`).join("");
  const allIssues = [].concat(f.by_severity.high || []).concat(f.by_severity.medium || []).concat(f.by_severity.low || []);
  const issueList = allIssues.slice(0, 200).map((i) => _dashSecIssueRow(i, { showCode: true })).join("");
  const canvasId = "dash-chart-sec-trend";
  const chartHtml = trend.length >= 2 ? `
<div class="dash-report-chart dash-report-chart--sm" style="position:relative">
  <canvas id="${canvasId}" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
</div>` : `
<div class="dash-empty" style="font-size:0.75rem;opacity:0.5;padding:6px 0">${_dashEscape(_dashT("dashSecurityTrendEmpty"))}</div>`;
  container.innerHTML = `
<div class="dash-report-section">
    <div class="dash-detail-stat-row">
      <div>
        <span style="font-size:2rem;font-weight:700;color:${color}">${f.score.toFixed(1)}</span>
        <span style="font-size:0.85rem;opacity:0.45">&nbsp;/ 10</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${_dashSecSevPill(_dashT("dashSecuritySevHigh"), f.counts.high, _dashSecSevColor("high"))}
        ${_dashSecSevPill(_dashT("dashSecuritySevMedium"), f.counts.medium, _dashSecSevColor("medium"))}
        ${_dashSecSevPill(_dashT("dashSecuritySevLow"), f.counts.low, _dashSecSevColor("low"))}
      </div>
      <div style="flex:1"></div>
      <div style="font-size:0.72rem;opacity:0.45;text-align:right">
        <div>${f.total} ${_dashEscape(_dashT("dashSecurityIssues"))}</div>
        <div style="margin-top:2px">${trend.length} ${_dashEscape(_dashT("dashSecurityRuns"))}</div>
      </div>
    </div>
    <div style="margin-top:10px">${chartHtml}</div>
</div>

<div class="dash-report-grid dash-report-grid--2">
    <div class="dash-report-section">
      <div class="dash-report-section-title">${_dashEscape(_dashT("dashSecurityByRule"))}</div>
      <div class="dash-report-list">${ruleRows || '<div class="dash-empty" style="opacity:0.4;font-size:0.75rem;text-align:center;padding:10px">??/div>'}</div>
    </div>
    <div class="dash-report-section">
      <div class="dash-report-section-title">${_dashEscape(_dashT("dashSecurityAllIssues"))}</div>
      <div class="dash-report-list">${issueList || '<div class="dash-empty" style="opacity:0.4;font-size:0.75rem;text-align:center;padding:10px">' + _dashEscape(_dashT("dashSecurityClean")) + "</div>"}</div>
    </div>
</div>`;
  if (trend.length >= 2 && typeof Chart !== "undefined") {
    requestAnimationFrame(() => {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const labels = trend.map((t) => t.date || (t.ts || "").slice(0, 10));
      const scores = trend.map((t) => Number(t.score || 0));
      _dashMkChart(canvas, "line", {
        labels,
        datasets: [{
          label: _dashT("dashSecurityTitle"),
          data: scores,
          borderColor: _dashAccentStop ? _dashAccentStop(2) : "#7ec8e3",
          backgroundColor: _dashAccentTint ? _dashAccentTint(0.12) : "rgba(126,200,227,0.12)",
          borderWidth: 2.5,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: scores.map((s) => _dashSecScoreColor(s)),
          fill: true
        }]
      }, {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 6, maxRotation: 0, font: { size: 10 } } },
          y: { min: 0, max: 10, ticks: { stepSize: 2, font: { size: 10 } } }
        }
      });
    });
  }
}
_dashRegisterWidget({
  id: "security",
  labelKey: "dashSecurityTitle",
  descriptionKey: "dashDescSecurity",
  defaultSize: "M",
  render(container, size, stats) {
    const f = stats.security_findings || _dashSecEmpty();
    if (size === "S") return _dashSecRenderSmall(container, f);
    if (size === "L") return _dashSecRenderLarge(container, f);
    return _dashSecRenderMedium(container, f);
  },
  renderDetail(container, stats) {
    _dashSecRenderDetail(container, stats.security_findings || _dashSecEmpty());
  }
});
