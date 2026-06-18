_dashRegisterWidget({
  id: "bus_factor",
  labelKey: "dashBusFactorTitle",
  descriptionKey: "dashDescBusFactor",
  defaultSize: "M",
  render(container, size, stats) {
    console.log("[bus_factor] render called, size=", size, "items=", (stats.bus_factor_files || []).length);
    console.log("[bus_factor] has_git_history=", stats.has_git_history, "files_by_author keys=", Object.keys(stats.files_by_author || {}).length);
    const items = stats.bus_factor_files || [];
    const high = items.filter((f) => f.risk === "high");
    const medium = items.filter((f) => f.risk === "medium");
    const low = items.filter((f) => f.risk === "low");
    if (size === "L") {
      _dashRenderBusFactorLarge(container, items, high, medium, low);
    } else {
      _dashRenderBusFactorMedium(container, high, medium);
    }
  },
  renderDetail(container, stats) {
    const items = stats.bus_factor_files || [];
    const high = items.filter((f) => f.risk === "high");
    const medium = items.filter((f) => f.risk === "medium");
    const low = items.filter((f) => f.risk === "low");
    const primaryColor = high.length ? "var(--status-bad)" : "var(--status-good)";
    const summary = items.length ? `${_dashFmtExactNum(high.length)} high-risk and ${_dashFmtExactNum(medium.length)} medium-risk files have concentrated ownership.` : _dashT("dashBusFactorEmpty");
    const heroVisual = _dashBusFactorDetailBars([
      { label: _dashT("dashBusFactorHigh"), value: high.length, color: "var(--status-bad)" },
      { label: _dashT("dashBusFactorMedium"), value: medium.length, color: "var(--status-warn)" },
      { label: _dashT("dashBusFactorLow"), value: low.length, color: "var(--status-good)" }
    ]);
    const statsBody = _dashBusFactorDetailStats([
      { value: high.length, label: _dashT("dashBusFactorHigh"), color: "var(--status-bad)" },
      { value: medium.length, label: _dashT("dashBusFactorMedium"), color: "var(--status-warn)" },
      { value: low.length, label: _dashT("dashBusFactorLow"), color: "var(--status-good)" },
      { value: items.length, label: "files analyzed" }
    ]);
    const riskBody = items.length ? [
      _dashBusFactorRiskGroup(_dashT("dashBusFactorHigh"), high, "var(--status-bad)"),
      _dashBusFactorRiskGroup(_dashT("dashBusFactorMedium"), medium, "var(--status-warn)"),
      _dashBusFactorRiskGroup(_dashT("dashBusFactorLow"), low, "var(--status-good)")
    ].join("") : `<div class="dash-empty">${_dashEscape(_dashT("dashBusFactorEmpty"))}</div>`;
    container.innerHTML = `
<div class="dash-bus-factor-detail">
  <section class="dash-bus-factor-detail__hero">
    <div class="dash-bus-factor-detail__hero-copy">
      <div class="dash-bus-factor-detail__eyebrow">Ownership concentration</div>
      <h2 class="dash-bus-factor-detail__title">${_dashEscape(_dashT("dashBusFactorTitle"))}</h2>
      <div class="dash-bus-factor-detail__primary">
        <span class="dash-bus-factor-detail__primary-value" style="color:${primaryColor}">${_dashFmtExactNum(high.length)}</span>
        <span class="dash-bus-factor-detail__primary-suffix">high-risk files</span>
      </div>
      <p class="dash-bus-factor-detail__summary">${_dashEscape(summary)}</p>
    </div>
    <div class="dash-bus-factor-detail__hero-visual">${heroVisual}</div>
  </section>
  <div class="dash-bus-factor-detail__sections">
    ${_dashBusFactorDetailSection("Risk Summary", statsBody)}
    ${_dashBusFactorDetailSection("Ownership Risk Files", riskBody)}
  </div>
</div>`;
  }
});
function _dashRenderBusFactorMedium(container, high, medium) {
  const list = high.length ? high : medium;
  container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT("dashBusFactorTitle"))}
</div>
<div class="dash-list" id="dash-bf-list-m"></div>`;
  const el = container.querySelector("#dash-bf-list-m");
  if (!list.length) {
    el.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT("dashBusFactorEmpty"))}</div>`;
    return;
  }
  el.innerHTML = list.slice(0, 8).map((f) => _dashBusFactorRow(f)).join("");
}
function _dashRenderBusFactorLarge(container, items, high, medium, low) {
  container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT("dashBusFactorTitle"))}
</div>
<div class="dash-bf-kpis" style="display:flex;gap:0.5rem;margin:0 0 0.6rem 0">
  <div class="dash-kpi-pill dash-kpi-pill--bad"  title="${_dashEscape(_dashT("dashBusFactorHigh"))}">${high.length} <span>${_dashEscape(_dashT("dashBusFactorHigh"))}</span></div>
  <div class="dash-kpi-pill dash-kpi-pill--warn" title="${_dashEscape(_dashT("dashBusFactorMedium"))}">${medium.length} <span>${_dashEscape(_dashT("dashBusFactorMedium"))}</span></div>
  <div class="dash-kpi-pill dash-kpi-pill--good" title="${_dashEscape(_dashT("dashBusFactorLow"))}">${low.length} <span>${_dashEscape(_dashT("dashBusFactorLow"))}</span></div>
</div>
<div class="dash-list" id="dash-bf-list-l" style="flex:1;overflow-y:auto"></div>`;
  const el = container.querySelector("#dash-bf-list-l");
  const visible = items.filter((f) => f.risk !== "low").slice(0, 15);
  if (!visible.length) {
    el.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT("dashBusFactorEmpty"))}</div>`;
    return;
  }
  el.innerHTML = visible.map((f) => _dashBusFactorRow(f)).join("");
}
function _dashBusFactorRow(f) {
  const pct = Math.round((f.primary_share || 0) * 100);
  const fileName = String(f.file || "").split(/[/\\]/).pop();
  const fullPath = _dashEscape(f.file || "");
  const owner = _dashEscape(f.primary_owner || "Unknown");
  const authors = f.total_authors || 1;
  const riskCls = f.risk === "high" ? "var(--status-bad)" : f.risk === "low" ? "var(--status-good)" : "var(--status-warn)";
  return `
<div class="dash-list-row" title="${fullPath}" style="display:flex;flex-direction:column;gap:4px;padding:5px 4px">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
    <span class="dash-list-label" style="font-size:0.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1"
          title="${fullPath}">${_dashEscape(fileName)}</span>
    <span style="font-size:0.72rem;opacity:0.65;white-space:nowrap;flex-shrink:0">${owner}</span>
    <span class="dash-pill" style="background:${riskCls};opacity:0.85;font-size:0.68rem;padding:1px 6px;flex-shrink:0">${authors} ${_dashEscape(_dashT(authors === 1 ? "dashBusFactorAuthor" : "dashBusFactorAuthors"))}</span>
  </div>
  <div style="display:flex;align-items:center;gap:6px">
    <div style="flex:1;height:4px;background:var(--panel-border-color);border-radius:2px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${riskCls};border-radius:2px"></div>
    </div>
    <span style="font-size:0.72rem;min-width:2.5rem;text-align:right;color:${riskCls};flex-shrink:0">${pct}%</span>
  </div>
</div>`;
}
function _dashBusFactorDetailSection(title, body) {
  return `
<section class="dash-bus-factor-detail-section">
  <div class="dash-bus-factor-detail-section__head">
    <div class="dash-bus-factor-detail-section__title">${_dashEscape(title)}</div>
  </div>
  <div class="dash-bus-factor-detail-section__body">${body || ""}</div>
</section>`;
}
function _dashBusFactorDetailStats(items) {
  return `
<div class="dash-bus-factor-detail-stats">
  ${(items || []).map((item) => {
    const color = item.color ? ` style="color:${item.color}"` : "";
    return `<div class="dash-bus-factor-detail-stat">
    <span class="dash-bus-factor-detail-stat__value"${color}>${_dashFmtExactNum(item.value || 0)}</span>
    <small class="dash-bus-factor-detail-stat__label">${_dashEscape(item.label || "")}</small>
  </div>`;
  }).join("")}
</div>`;
}
function _dashBusFactorDetailBars(items) {
  const rows = items || [];
  const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  return `
<div class="dash-bus-factor-detail-bars">
  ${rows.map((row) => {
    const value = Number(row.value || 0);
    const pct = Math.max(4, Math.round(value / max * 100));
    return `<div class="dash-bus-factor-detail-bars__row" style="--dash-bf-color:${row.color};--dash-bf-width:${pct}%">
    <span class="dash-bus-factor-detail-bars__label">${_dashEscape(row.label || "")}</span>
    <div class="dash-bus-factor-detail-bars__track"><i></i></div>
    <b class="dash-bus-factor-detail-bars__value">${_dashFmtExactNum(value)}</b>
  </div>`;
  }).join("")}
</div>`;
}
function _dashBusFactorRiskGroup(label, list, color) {
  if (!list.length) return "";
  return `
<section class="dash-bus-factor-detail-risk" style="--dash-bf-color:${color}">
  <div class="dash-bus-factor-detail-risk__head">
    <span class="dash-bus-factor-detail-risk__dot"></span>
    <span class="dash-bus-factor-detail-risk__label">${_dashEscape(label)}</span>
    <span class="dash-bus-factor-detail-risk__count">${_dashFmtExactNum(list.length)}</span>
  </div>
  <div class="dash-bus-factor-detail-files">
    ${list.map((f, i) => _dashBusFactorDetailRow(f, color, i + 1)).join("")}
  </div>
</section>`;
}
function _dashBusFactorDetailRow(f, color, rank) {
  const pct = Math.round((f.primary_share || 0) * 100);
  const parts = String(f.file || "").split(/[/\\]/);
  const fileName = parts.pop() || "";
  const dirPath = parts.join("/");
  const rawPath = f.file || "";
  const owner = _dashEscape(f.primary_owner || "Unknown");
  const authors = f.total_authors || 1;
  const commits = f.total_commits || 0;
  const clickAttrs = rawPath ? ` data-clickable="true" onclick="event.stopPropagation();_dashGoToGraphFile(${_dashJson(rawPath)}, null, null)"` : "";
  return `
<div class="dash-bus-factor-detail-file"${clickAttrs} title="${_dashEscape(rawPath)}" style="--dash-bf-color:${color};--dash-bf-share:${Math.max(0, Math.min(100, pct))}%">
  <span class="dash-bus-factor-detail-file__rank">${_dashFmtExactNum(rank || 0)}</span>
  <div class="dash-bus-factor-detail-file__name">
    <strong>${_dashEscape(fileName)}</strong>
    ${dirPath ? `<small>${_dashEscape(dirPath)}</small>` : ""}
  </div>
  <div class="dash-bus-factor-detail-file__track"><i></i></div>
  <div class="dash-bus-factor-detail-file__meta">
    <span class="dash-bus-factor-detail-file__share">${pct}%</span>
    <small>${owner}</small>
    <small>${authors} ${_dashEscape(_dashT(authors === 1 ? "dashBusFactorAuthor" : "dashBusFactorAuthors"))}${commits ? ` &middot; ${_dashFmtExactNum(commits)} commits` : ""}</small>
  </div>
</div>`;
}
