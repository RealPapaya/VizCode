function _dashOvStatusColor(value, mode) {
  if (mode === "good") return value > 0 ? "var(--status-good)" : "var(--muted)";
  return value > 0 ? "var(--status-warn)" : "var(--status-good)";
}
function _dashOvTile(opts) {
  const value = opts.value || 0;
  const color = opts.color || "var(--muted)";
  const sub = opts.sub || "";
  const click = opts.drillFiles && opts.drillFiles.length ? ` data-clickable="true" onclick="_dashOpenFileGroupDrilldown(${_dashJson(opts.drillTitle || "")}, ${_dashJson(opts.drillFiles)})"` : "";
  const cta = opts.drillFiles && opts.drillFiles.length ? `<div class="dash-ov-tile-cta">${_dashEscape(_dashT("dashAllProblems"))} \u2192</div>` : "";
  return `
<div class="dash-ov-tile sev-${opts.tier || "info"}"${click}>
  <div class="dash-arch-stat-row" style="gap:6px;align-items:center">
    <span class="dash-arch-status-dot" style="color:${color};background:${color}"></span>
    <div class="dash-ov-tile-label">${_dashEscape(_dashT(opts.labelKey))}</div>
  </div>
  <div class="dash-ov-tile-value" style="color:${color}">${_dashFmtNum(value)}</div>
  <div class="dash-ov-tile-sub">${_dashEscape(sub)}</div>
  ${cta}
</div>`;
}
function _dashOvTilesData(stats) {
  const circular = stats.circular_dependencies || 0;
  const cycles = stats.top_circular_deps || [];
  const cycleFiles = Array.from(new Set(cycles.flat()));
  const deadFuncs = stats.uncalled_functions || 0;
  const unimp = stats.unimported_files || 0;
  const unimpFiles = stats.unimported_file_paths || [];
  const entry = stats.entry_points || 0;
  const iso = stats.isolated_files || 0;
  const entryFiles = stats.entry_point_files || [];
  return {
    circular: {
      labelKey: "dashIssuesCircular",
      value: circular,
      sub: `${cycles.length} ${_dashT("dashCircularDepsSub")}`,
      color: _dashOvStatusColor(circular),
      tier: circular >= 5 ? "critical" : circular > 0 ? "warn" : "info",
      drillFiles: cycleFiles,
      drillTitle: _dashT("dashIssuesCircular")
    },
    dead: {
      labelKey: "dashIssuesDead",
      value: deadFuncs,
      sub: `${unimp} ${_dashT("dashIssuesUnimported")}`,
      color: deadFuncs > 0 ? "var(--muted)" : "var(--status-good)",
      tier: deadFuncs > 50 ? "warn" : "info",
      drillFiles: unimpFiles,
      drillTitle: _dashT("dashIssuesUnimported")
    },
    entry: {
      labelKey: "dashIssuesEntry",
      value: entry,
      sub: `${iso} ${_dashT("dashIssuesIsolated")}`,
      color: _dashOvStatusColor(entry, "good"),
      tier: "info",
      drillFiles: entryFiles,
      drillTitle: _dashT("dashIssuesEntry")
    }
  };
}
function _dashRenderIssuesOverview(container, stats, opts) {
  const t = _dashOvTilesData(stats);
  const layout = opts && opts.layout || "grid";
  const isDetail = !!(opts && opts.detail);
  const tiles = `${_dashOvTile(t.circular)}${_dashOvTile(t.dead)}${_dashOvTile(t.entry)}`;
  if (isDetail) {
    container.innerHTML = _dashReportSection({
      title: _dashT("dashIssuesOverviewTitle"),
      subtitle: _dashT("dashIssuesOverviewSub"),
      body: `<div class="dash-ov-tiles dash-ov-tiles--${layout}">${tiles}</div>`
    });
    return;
  }
  container.innerHTML = `
<div class="dash-arch-panel">
  <div class="dash-arch-panel-header">
    <div class="dash-arch-panel-title-block">
      <div class="dash-arch-panel-title">${_dashEscape(_dashT("dashIssuesOverviewTitle"))}</div>
      <div class="dash-arch-panel-sub">${_dashEscape(_dashT("dashIssuesOverviewSub"))}</div>
    </div>
  </div>
  <div class="dash-arch-panel-body">
    <div class="dash-ov-tiles dash-ov-tiles--${layout}">${tiles}</div>
  </div>
</div>`;
}
_dashRegisterWidget({
  id: "issues",
  labelKey: "dashIssuesOverviewTitle",
  descriptionKey: "dashDescIssues",
  defaultSize: "M",
  render(container, size, stats) {
    if (size === "S") {
      const t = _dashOvTilesData(stats);
      container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">${_dashEscape(_dashT("dashIssuesOverviewTitle"))}</div>
    <div class="dash-widget-stat" style="color:${t.circular.color}">${_dashFmtNum(t.circular.value)}</div>
    <div class="dash-widget-sub">${_dashEscape(_dashT("dashIssuesCircular"))}</div>
    <div class="dash-ov-dotrow" style="flex-direction:column;align-items:stretch;gap:5px;margin-top:8px;font-family:inherit;">
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;">
        <span style="display:inline-flex;align-items:center;gap:6px;">
          <span class="dash-arch-status-dot" style="color:${t.circular.color};background:${t.circular.color};margin:0"></span>
          <span style="color:var(--muted)">Circular</span>
        </span>
        <strong style="color:${t.circular.value > 0 ? t.circular.color : "var(--text)"};font-family:'JetBrains Mono',monospace;">${_dashFmtNum(t.circular.value)}</strong>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;">
        <span style="display:inline-flex;align-items:center;gap:6px;">
          <span class="dash-arch-status-dot" style="color:${t.dead.color};background:${t.dead.color};margin:0"></span>
          <span style="color:var(--muted)">Dead Code</span>
        </span>
        <strong style="color:${t.dead.value > 0 ? t.dead.color : "var(--text)"};font-family:'JetBrains Mono',monospace;">${_dashFmtNum(t.dead.value)}</strong>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;">
        <span style="display:inline-flex;align-items:center;gap:6px;">
          <span class="dash-arch-status-dot" style="color:${t.entry.color};background:${t.entry.color};margin:0"></span>
          <span style="color:var(--muted)">Entry Pts</span>
        </span>
        <strong style="color:${t.entry.value > 0 ? t.entry.color : "var(--text)"};font-family:'JetBrains Mono',monospace;">${_dashFmtNum(t.entry.value)}</strong>
      </div>
    </div>
  </div>
</div>`;
      return;
    }
    _dashRenderIssuesOverview(container, stats, { layout: size === "L" ? "row" : "grid" });
  },
  renderDetail(container, stats) {
    const t = _dashOvTilesData(stats);
    const circular = stats.circular_dependencies || 0;
    const cycles = stats.top_circular_deps || [];
    const deadFuncs = stats.uncalled_functions || 0;
    const unimp = stats.unimported_files || 0;
    const unimpPaths = stats.unimported_file_paths || [];
    const entry = stats.entry_points || 0;
    const iso = stats.isolated_files || 0;
    const isoPaths = stats.isolated_file_paths || [];
    const deadSymbols = stats.dead_code_symbols || [];
    const heroVisual = `
<div class="dash-issues-detail-status">
    ${[
      { label: "Circular", value: circular, color: t.circular.color, tier: t.circular.tier },
      { label: "Dead code", value: deadFuncs, color: t.dead.color, tier: t.dead.tier },
      { label: "Entry pts", value: entry, color: t.entry.color, tier: t.entry.tier }
    ].map((s) => `
    <div class="dash-issues-detail-status__item">
        <span class="dash-issues-detail-status__dot" style="background:${s.color}"></span>
        <span class="dash-issues-detail-status__label">${_dashEscape(s.label)}</span>
        <span class="dash-issues-detail-status__value" style="color:${s.color}">${_dashFmtNum(s.value)}</span>
    </div>`).join("")}
</div>`;
    const summaryParts = [];
    if (circular > 0) summaryParts.push(`${circular} circular dep${circular !== 1 ? "s" : ""}`);
    if (deadFuncs > 0) summaryParts.push(`${deadFuncs} dead function${deadFuncs !== 1 ? "s" : ""}`);
    if (unimp > 0) summaryParts.push(`${unimp} unimported file${unimp !== 1 ? "s" : ""}`);
    const summaryText = summaryParts.length ? summaryParts.join(", ") + " detected." : "No architecture issues detected.";
    const cycleRows = cycles.slice(0, 10).map((cycle, i) => {
      const files = (cycle || []).map((f) => String(f).replace(/\\/g, "/"));
      const label = files.map((f) => f.split("/").pop()).join(" \u2192 ");
      return `<div class="dash-kpi-detail-row" data-clickable="true"
                onclick="_dashOpenFileGroupDrilldown(${_dashJson("Cycle " + (i + 1))}, ${_dashJson(files.map((f) => ({ file: f })))})">
                <span class="dash-kpi-detail-row__rank">${i + 1}</span>
                <span class="dash-kpi-detail-row__name">${_dashEscape(label)}</span>
                <span class="dash-kpi-detail-row__value">${files.length} files</span>
            </div>`;
    }).join("") || `<div class="dash-empty">No circular dependencies</div>`;
    const deadByFile = /* @__PURE__ */ new Map();
    deadSymbols.forEach((s) => {
      const f = String(s.file || "").replace(/\\/g, "/");
      if (!f) return;
      if (!deadByFile.has(f)) deadByFile.set(f, []);
      deadByFile.get(f).push(s);
    });
    const deadFilesSorted = [...deadByFile.entries()].sort((a, b) => b[1].length - a[1].length);
    const deadRows = deadFilesSorted.map(([file, syms], i) => {
      const short = file.split("/").pop();
      return `<div class="dash-kpi-detail-row" data-clickable="true"
                title="${_dashEscape(file)}"
                onclick="_dashOpenFunctionGroupDrilldown(${_dashJson("Dead code in " + short)}, ${_dashJson(syms.map((s) => ({ file: s.file, name: s.name, value: "unused" })))})">
                <span class="dash-kpi-detail-row__rank">${i + 1}</span>
                <span class="dash-kpi-detail-row__name">${_dashEscape(short)}</span>
                <span class="dash-kpi-detail-row__value">${syms.length} unused</span>
            </div>`;
    }).join("");
    const unimpRows = unimpPaths.map((file, i) => {
      const path = String(file).replace(/\\/g, "/");
      const short = path.split("/").pop();
      return `<div class="dash-kpi-detail-row" data-clickable="true"
                title="${_dashEscape(path)}"
                onclick="_dashGoToGraphFile(${_dashJson(path)}, null)">
                <span class="dash-kpi-detail-row__rank">${i + 1}</span>
                <span class="dash-kpi-detail-row__name">${_dashEscape(short)}<span class="dash-kpi-detail-row__meta">${_dashEscape(path)}</span></span>
                <span class="dash-kpi-detail-row__value">unimported</span>
            </div>`;
    }).join("");
    const deadSection = deadRows || `<div class="dash-empty">No dead code detected</div>`;
    const unimpSection = unimpRows || `<div class="dash-empty">No unimported files detected</div>`;
    container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--issues">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Architecture health</div>
      <h2 class="dash-kpi-detail__title">Architecture Issues</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value" style="color:${t.circular.color}">${_dashFmtNum(circular)}</span>
        <span class="dash-kpi-detail__primary-suffix">circular</span>
      </div>
      <p class="dash-kpi-detail__summary">${_dashEscape(summaryText)}</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">${heroVisual}</div>
  </section>
  <div class="dash-kpi-detail__sections">
${_dashKpiDetailSectionHTML({
      title: "Overview",
      body: _dashKpiDetailStatsHTML([
        { value: `${circular}`, label: "circular deps", color: t.circular.color },
        { value: `${deadFuncs}`, label: "dead functions", color: t.dead.color },
        { value: `${unimp}`, label: "unimported files" },
        { value: `${entry}`, label: "entry points", color: t.entry.color },
        { value: `${iso}`, label: "isolated files" }
      ])
    })}
${circular > 0 ? _dashKpiDetailSectionHTML({
      title: "Circular Dependencies",
      body: cycleRows
    }) : ""}
${deadFuncs > 0 ? _dashKpiDetailSectionHTML({
      title: _dashT("dashIssuesDead") || "Dead Code",
      className: "dash-issues-detail-scroll-section",
      body: deadSection
    }) : ""}
${unimp > 0 ? _dashKpiDetailSectionHTML({
      title: _dashT("dashUnimportedFiles") || "Unimported Files",
      className: "dash-issues-detail-scroll-section",
      body: unimpSection
    }) : ""}
  </div>
</div>`;
  }
});
