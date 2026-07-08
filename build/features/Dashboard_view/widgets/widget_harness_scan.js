const _DASH_HARNESS_DIMS = [
  "instructions",
  "harness_config",
  "loop_engineering",
  "memory_learning",
  "delegation",
  "safety_governance"
];
const _DASH_HARNESS_DIM_KEYS = {
  instructions: "dashHarnessDimInstructions",
  harness_config: "dashHarnessDimHarnessConfig",
  loop_engineering: "dashHarnessDimLoopEngineering",
  memory_learning: "dashHarnessDimMemoryLearning",
  delegation: "dashHarnessDimDelegation",
  safety_governance: "dashHarnessDimSafetyGovernance"
};
const _DASH_HARNESS_LEVEL_KEYS = {
  none_adhoc: "dashHarnessLevelNoneAdhoc",
  basic: "dashHarnessLevelBasic",
  structured: "dashHarnessLevelStructured",
  engineered: "dashHarnessLevelEngineered",
  self_improving: "dashHarnessLevelSelfImproving"
};
function _dashHarnessColor(score) {
  return _dashHealthColor(score);
}
function _dashHarnessRadarSvg(breakdown) {
  const cx = 100, cy = 100, maxR = 78, n = _DASH_HARNESS_DIMS.length;
  const angles = Array.from({ length: n }, (_, i) => -Math.PI / 2 + i * (Math.PI * 2 / n));
  const rings = [2.5, 5, 7.5, 10].map((v) => {
    const r = maxR * v / 10;
    const pts = angles.map(
      (a) => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
    ).join(" ");
    return `<polygon points="${pts}" fill="none" stroke="var(--muted,#888)" stroke-width="0.5" opacity="0.35"/>`;
  }).join("");
  const axes = angles.map((a) => {
    const x2 = (cx + maxR * Math.cos(a)).toFixed(1);
    const y2 = (cy + maxR * Math.sin(a)).toFixed(1);
    return `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="var(--muted,#888)" stroke-width="0.5" opacity="0.35"/>`;
  }).join("");
  const abbrs = ["Instr", "Config", "Loop", "Memory", "Deleg", "Safety"];
  const lbls = angles.map((a, i) => {
    const r = maxR + 13;
    const x = (cx + r * Math.cos(a)).toFixed(1);
    const y = (cy + r * Math.sin(a)).toFixed(1);
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="7.5" fill="var(--fg,#ccc)" opacity="0.65">${abbrs[i]}</text>`;
  }).join("");
  const bd = breakdown || {};
  const dataPts = _DASH_HARNESS_DIMS.map((dim, i) => {
    const v = Math.max(0, Math.min(10, Number(bd[dim] || 0)));
    const r = maxR * v / 10;
    return `${(cx + r * Math.cos(angles[i])).toFixed(1)},${(cy + r * Math.sin(angles[i])).toFixed(1)}`;
  }).join(" ");
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:100%;max-width:200px;height:auto;display:block;margin:0 auto">${rings}${axes}<polygon points="${dataPts}" fill="var(--accent-tint,rgba(100,180,255,0.18))" stroke="var(--accent,#64b4ff)" stroke-width="1.5"/>${lbls}</svg>`;
}
function _dashHarnessSubscoreBars(breakdown, weights) {
  const bd = breakdown || {};
  const wt = weights || {};
  return _DASH_HARNESS_DIMS.map((dim) => {
    const v = Number(bd[dim] || 0);
    const w = Number(wt[dim] || 0);
    const pct = Math.round(v / 10 * 100);
    const c = _dashHarnessColor(v);
    const label = _dashEscape(_dashT(_DASH_HARNESS_DIM_KEYS[dim] || dim));
    return `<div class="dash-kpi-bar-row">
  <span class="dash-kpi-bar-label">${label}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${pct}%;background:${c}"></div></div>
  <span class="dash-kpi-bar-val">${v.toFixed(1)}</span>
  <span style="font-size:0.62rem;opacity:0.4;min-width:26px;text-align:right">w${Math.round(w * 100)}%</span>
</div>`;
  }).join("");
}
function _dashHarnessEvidenceSection(evidence, missing) {
  const ev = evidence || {};
  const ms = missing || {};
  return _DASH_HARNESS_DIMS.map((dim) => {
    const items = ev[dim] || [];
    const gaps = ms[dim] || [];
    const top3 = items.slice(0, 3);
    const more = items.length - top3.length;
    const dimLabel = _dashEscape(_dashT(_DASH_HARNESS_DIM_KEYS[dim] || dim));
    const evRows = top3.map(
      (e) => `<div style="display:flex;align-items:baseline;gap:4px;font-size:0.68rem;padding:1px 0">
  <span class="dash-arch-status-dot" style="color:var(--status-good);background:var(--status-good);flex-shrink:0;margin-top:4px"></span>
  <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_dashEscape(e.signal || "")} <span style="opacity:0.4">${_dashEscape(e.path || "")}</span></span>
  <span style="opacity:0.45;white-space:nowrap">+${Number(e.points || 0).toFixed(1)}</span>
</div>`
    ).join("");
    const moreHtml = more > 0 ? `<div style="font-size:0.62rem;opacity:0.35;padding:1px 0 2px 14px">+${more} more</div>` : "";
    const msRows = gaps.slice(0, 3).map(
      (m) => `<div style="display:flex;align-items:baseline;gap:4px;font-size:0.68rem;padding:1px 0">
  <span class="dash-arch-status-dot" style="color:var(--status-warn);background:var(--status-warn);flex-shrink:0;margin-top:4px"></span>
  <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.65">${_dashEscape(m)}</span>
</div>`
    ).join("");
    return `<div style="margin-bottom:8px">
  <div style="font-size:0.7rem;font-weight:600;opacity:0.6;margin-bottom:2px">${dimLabel}</div>
  ${evRows}${moreHtml}${msRows}
</div>`;
  }).join("");
}
function _dashHarnessEmptyCard(container) {
  container.innerHTML = `
<div class="dash-card" style="display:flex;align-items:center;justify-content:center;height:100%;opacity:0.5">
  <div style="text-align:center;font-size:0.85rem">
    ${_dashEscape(_dashT("dashHarnessTitle"))}<br>
    <span style="font-size:0.72rem;opacity:0.6">No scan data \u2014 re-run analysis to generate harness score.</span>
  </div>
</div>`;
}
_dashRegisterWidget({
  id: "harness_scan",
  labelKey: "dashHarnessTitle",
  descriptionKey: "dashDescHarness",
  defaultSize: "L",
  render(container, size, stats) {
    const hs = stats.harness_scan || null;
    if (!hs) {
      _dashHarnessEmptyCard(container);
      return;
    }
    const score = Number(hs.score || 0);
    const level = hs.level || "none_adhoc";
    const color = _dashHarnessColor(score);
    const lvlLbl = _dashEscape(_dashT(_DASH_HARNESS_LEVEL_KEYS[level] || level));
    if (size === "S") {
      container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">${_dashEscape(_dashT("dashHarnessTitle"))}</div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:4px;min-height:0">
      <span style="font-size:2.2rem;font-weight:700;color:${color};line-height:1">${score.toFixed(1)}</span>
      <span style="font-size:0.62rem;opacity:0.4">/10</span>
      <span style="font-size:0.7rem;font-weight:600;color:${color}">${lvlLbl}</span>
    </div>
  </div>
</div>`;
      return;
    }
    const bars = _dashHarnessSubscoreBars(hs.breakdown, hs.weights);
    if (size === "M") {
      container.innerHTML = `
<div class="dash-kpi-m" style="display:flex;height:100%">
  <div class="dash-kpi-m-left" style="align-items:center;text-align:center;min-width:120px;justify-content:center">
    <div class="dash-widget-title">${_dashEscape(_dashT("dashHarnessTitle"))}</div>
    <div style="display:flex;align-items:baseline;gap:3px;justify-content:center">
      <span style="font-size:2rem;font-weight:700;color:${color}">${score.toFixed(1)}</span>
      <span style="font-size:0.78rem;opacity:0.4">/10</span>
    </div>
    <div style="font-size:0.7rem;font-weight:600;color:${color};margin-top:4px">${lvlLbl}</div>
  </div>
  <div class="dash-kpi-m-sep"></div>
  <div class="dash-kpi-m-right" style="flex:1;min-width:0;overflow-y:auto">${bars}</div>
</div>`;
      return;
    }
    container.innerHTML = `
<div style="display:flex;flex-direction:column;height:100%;gap:6px;box-sizing:border-box">
  <div class="dash-card-title">
    <span class="dash-card-title-dot" style="background:${color}"></span>
    ${_dashEscape(_dashT("dashHarnessTitle"))}
    <span style="margin-left:auto;font-size:1.15rem;font-weight:700;color:${color}">${score.toFixed(1)}<span style="font-size:0.68rem;opacity:0.4">/10</span></span>
    <span style="font-size:0.7rem;font-weight:600;color:${color};margin-left:6px">${lvlLbl}</span>
  </div>
  <div style="display:flex;gap:10px;flex:1;min-height:0;overflow:hidden">
    <div style="flex:0 0 auto;display:flex;align-items:center">
      ${_dashHarnessRadarSvg(hs.breakdown)}
    </div>
    <div style="flex:1;min-width:0;overflow-y:auto;display:flex;flex-direction:column;gap:1px">
      ${bars}
    </div>
  </div>
  <div style="overflow-y:auto;max-height:110px;border-top:1px solid var(--border,rgba(255,255,255,0.08));padding-top:5px">
    <div style="font-size:0.68rem;font-weight:600;opacity:0.55;margin-bottom:4px">${_dashEscape(_dashT("dashHarnessEvidence"))}</div>
    ${_dashHarnessEvidenceSection(hs.evidence, hs.missing)}
  </div>
</div>`;
  },
  renderDetail(container, stats) {
    const hs = stats.harness_scan || null;
    if (!hs) {
      _dashHarnessEmptyCard(container);
      return;
    }
    const score = Number(hs.score || 0);
    const level = hs.level || "none_adhoc";
    const color = _dashHarnessColor(score);
    const lvlLbl = _dashEscape(_dashT(_DASH_HARNESS_LEVEL_KEYS[level] || level));
    const bd = hs.breakdown || {};
    const wt = hs.weights || {};
    const detailRows = _DASH_HARNESS_DIMS.map((dim) => {
      const v = Number(bd[dim] || 0);
      const w = Number(wt[dim] || 0);
      const pct = Math.round(v / 10 * 100);
      const c = _dashHarnessColor(v);
      const lbl = _dashEscape(_dashT(_DASH_HARNESS_DIM_KEYS[dim] || dim));
      return `<div class="dash-code-health-detail-row">
  <span class="dash-code-health-detail-row__name">${lbl}</span>
  <div class="dash-code-health-detail-row__track"><i style="width:${pct}%;background:${c}"></i></div>
  <span class="dash-code-health-detail-row__score" style="color:${c}">${v.toFixed(1)}</span>
  <span class="dash-code-health-detail-row__meta">w ${Math.round(w * 100)}%</span>
</div>`;
    }).join("");
    container.innerHTML = `
<div class="dash-report-section">
  <div class="dash-detail-stat-row">
    <div>
      <span style="font-size:2rem;font-weight:700;color:${color}">${score.toFixed(1)}</span>
      <span style="font-size:0.85rem;opacity:0.45">&nbsp;/ 10</span>
    </div>
    <span style="font-size:0.9rem;font-weight:600;color:${color}">${lvlLbl}</span>
  </div>
  <div style="margin-top:10px">${_dashHarnessRadarSvg(hs.breakdown)}</div>
</div>
<div class="dash-report-grid dash-report-grid--2">
  <div class="dash-report-section">
    <div class="dash-report-section-title">${_dashEscape(_dashT("dashHarnessDimScores"))}</div>
    <div class="dash-report-list">${detailRows}</div>
  </div>
  <div class="dash-report-section">
    <div class="dash-report-section-title">${_dashEscape(_dashT("dashHarnessEvidence"))}</div>
    <div class="dash-report-list">${_dashHarnessEvidenceSection(hs.evidence, hs.missing)}</div>
  </div>
</div>`;
  }
});
