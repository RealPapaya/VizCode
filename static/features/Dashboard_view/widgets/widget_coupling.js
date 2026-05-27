// @module Dashboard_view/widgets/widget_coupling
// Coupling — top imported and top caller files with severity tiers,
// concentration index, and graph jump. S/M/L all redesigned.

// ── Severity tier from rank percentile (top 10% critical, 25% warn, else info) ──
function _dashCouplingSeverity(items, idx) {
  if (!items.length) return 'info';
  const pct = (idx + 1) / items.length;
  if (pct <= 0.1) return 'critical';
  if (pct <= 0.25) return 'warn';
  return 'info';
}

function _dashCouplingTotal(items) {
  return items.reduce((sum, it) => sum + (it.count || 0), 0);
}

function _dashCouplingConcentration(items) {
  const total = _dashCouplingTotal(items);
  if (!total) return 0;
  const top3 = items.slice(0, 3).reduce((sum, it) => sum + (it.count || 0), 0);
  return Math.round((top3 / total) * 100);
}

// ── Row renderer (used by M / L / detail) ──
function _dashCouplingRow(item, idx, items, suffix) {
  const max = items[0] ? items[0].count || 1 : 1;
  const sev = _dashCouplingSeverity(items, idx);
  const total = _dashCouplingTotal(items);
  const pct = total ? Math.round((item.count / total) * 100) : 0;
  const fileShort = String(item.file || '').split('/').pop();
  const fileJson = _dashJson(item.file);
  const widthPct = Math.max(2, Math.round((item.count / max) * 100));
  return `
<div class="dash-list-row dash-coupling-row" data-clickable="true" data-tip="${_dashEscape(item.file)}"
     onclick="_dashDrill(${fileJson}, null)">
  <span class="dash-list-rank">${idx + 1}<span class="dash-sev-dot dash-sev-${sev}"></span></span>
  <span class="dash-list-name">${_dashEscape(fileShort)}<span class="dash-list-meta">${_dashEscape(item.file)}</span></span>
  <div class="dash-list-bar-track"><div class="dash-list-bar-fill sev-${sev}" style="width:${widthPct}%"></div></div>
  <span class="dash-list-val">${item.count}<small>${pct}%</small></span>
</div>`;
}

function _dashCouplingRows(items, suffix) {
  if (!items.length) {
    return `<div class="dash-empty">✅ ${_dashEscape(_dashT('dashCouplingNone'))}</div>`;
  }
  return items.map((it, i) => _dashCouplingRow(it, i, items, suffix)).join('');
}

function _dashCouplingLegend() {
  return `
<span class="dash-coupling-legend">
  <span class="dash-coupling-legend-item"><span class="dash-sev-dot dash-sev-critical"></span>${_dashEscape(_dashT('dashIssuesSevCritical'))}</span>
  <span class="dash-coupling-legend-item"><span class="dash-sev-dot dash-sev-warn"></span>${_dashEscape(_dashT('dashIssuesSevWarn'))}</span>
  <span class="dash-coupling-legend-item"><span class="dash-sev-dot dash-sev-info"></span>${_dashEscape(_dashT('dashIssuesSevInfo'))}</span>
</span>`;
}

// ── L / detail layout ──
function _dashRenderCoupling(container, stats, opts) {
  if (!container) return;
  const isDetail = !!(opts && opts.detail);
  const imported = stats.top_imported_files || [];
  const callers = stats.top_caller_files || [];
  const conc = _dashCouplingConcentration(imported);
  if (isDetail) {
    container.innerHTML = `
${_dashReportSection({
  title: _dashT('dashCouplingTopImported'),
  subtitle: `${imported.length} hotspots · ${conc}% ${_dashT('dashCouplingConcentration')}`,
  body: _dashReportGrid([
    _dashReportSection({
      title: _dashT('dashCouplingTopImported'),
      body: _dashReportList(_dashCouplingRows(imported, _dashT('dashCouplingImports'))),
    }),
    _dashReportSection({
      title: _dashT('dashCouplingTopCallers'),
      body: _dashReportList(_dashCouplingRows(callers, _dashT('dashCouplingCalls'))),
    }),
  ], { columns: 2 }),
})}`;
    return;
  }
  container.innerHTML = `
<div class="dash-arch-panel">
  <div class="dash-arch-panel-header">
    <div class="dash-arch-panel-title-block">
      <div class="dash-arch-panel-title">
        <span class="dash-arch-status-dot" style="color:var(--accent);background:var(--accent)"></span>
        ${_dashEscape(_dashT('dashCouplingTopImported'))}
      </div>
      <div class="dash-arch-panel-sub">${imported.length} hotspots · ${conc}% ${_dashEscape(_dashT('dashCouplingConcentration'))}</div>
    </div>
    <div class="dash-arch-panel-stats">${_dashCouplingLegend()}</div>
  </div>
  <div class="dash-arch-panel-body">
    <div class="dash-grid dash-grid-2" style="height:100%;min-height:0">
      <div class="dash-card" style="min-height:0;display:flex;flex-direction:column;overflow:hidden">
        <div class="dash-card-title">
          <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashCouplingTopImported'))}
        </div>
        <div class="dash-list" style="overflow-y:auto;min-height:0;padding-right:4px">${_dashCouplingRows(imported, _dashT('dashCouplingImports'))}</div>
      </div>
      <div class="dash-card" style="min-height:0;display:flex;flex-direction:column;overflow:hidden">
        <div class="dash-card-title">
          <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashCouplingTopCallers'))}
        </div>
        <div class="dash-list" style="overflow-y:auto;min-height:0;padding-right:4px">${_dashCouplingRows(callers, _dashT('dashCouplingCalls'))}</div>
      </div>
    </div>
  </div>
</div>`;
}

_dashRegisterWidget({
  id: 'coupling',
  labelKey: 'dashCouplingTopImported',
  defaultSize: 'L',

  render(container, size, stats) {
    const imported = stats.top_imported_files || [];

    if (size === 'S') {
      const top = imported[0];
      const conc = _dashCouplingConcentration(imported);
      const pills = imported.slice(0, 3).map((it, i) => {
        const sev = _dashCouplingSeverity(imported, i);
        const short = String(it.file || '').split('/').pop();
        return {
          label: short,
          value: it.count,
          title: it.file,
          onclick: `_dashDrill(${_dashJson(it.file)}, null)`,
          muted: sev === 'info',
        };
      });
      container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">${_dashEscape(_dashT('dashCouplingTopImported'))}</div>
    <div class="dash-widget-stat">${imported.length}</div>
    <div class="dash-widget-sub" ${top ? `title="${_dashEscape(top.file || '')}"` : ''}>
      ${top ? `${_dashEscape(String(top.file).split('/').pop())} · ${top.count}` : 'No data'}
    </div>
    ${_dashMiniPills(pills, { empty: 'No data' })}
    <div class="dash-arch-mini-stat-sub" style="margin-top:auto;text-align:center;font-family:'JetBrains Mono',monospace">
      ${conc}% <span style="opacity:0.7">${_dashEscape(_dashT('dashCouplingConcentration'))}</span>
    </div>
  </div>
</div>`;
      return;
    }

    if (size === 'M') {
      const conc = _dashCouplingConcentration(imported);
      const sliced = imported.slice(0, 5);
      const rows = sliced.length
        ? sliced.map((it, i) => _dashCouplingRow(it, i, imported, _dashT('dashCouplingImports'))).join('')
        : '<div class="dash-empty">No data</div>';
      container.innerHTML = `
<div class="dash-kpi-m" style="align-items:stretch">
  <div class="dash-kpi-m-left" style="display:flex;flex-direction:column;gap:var(--space-2)">
    <div class="dash-widget-title">${_dashEscape(_dashT('dashCouplingTopImported'))}</div>
    <div class="dash-widget-stat-md">${imported.length}</div>
    <div class="dash-widget-sub">hotspot files</div>
    <div class="dash-arch-mini-stat" style="margin-top:auto">
      <div class="dash-arch-mini-stat-label">${_dashEscape(_dashT('dashCouplingConcentration'))}</div>
      <div class="dash-arch-mini-stat-value">${conc}%</div>
    </div>
  </div>
  <div class="dash-kpi-m-sep"></div>
  <div class="dash-kpi-m-right" style="display:flex;flex-direction:column;gap:2px;overflow-y:auto;min-height:0">${rows}</div>
</div>`;
      return;
    }

    _dashRenderCoupling(container, stats);
  },

  renderDetail(container, stats) { _dashRenderCoupling(container, stats, { detail: true }); },
});
