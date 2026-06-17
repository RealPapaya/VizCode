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
  <span class="dash-list-count">${item.count}</span>
  <span class="dash-list-pct">${pct}%</span>
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

// ── L layout ──
function _dashRenderCoupling(container, stats) {
  if (!container) return;
  const imported = stats.top_imported_files || [];
  const conc = _dashCouplingConcentration(imported);
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
    <div class="dash-card" style="height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden">
      <div class="dash-list" style="overflow-y:auto;min-height:0;padding:3px 4px 0">${_dashCouplingRows(imported, _dashT('dashCouplingImports'))}</div>
    </div>
  </div>
</div>`;
}


// ── Detail panel (dash-kpi-detail--coupling) ─────────────────────────────
function _dashCouplingRenderDetail(container, stats) {
  if (!container) return;
  const imported = stats.top_imported_files || [];
  const callers  = stats.top_caller_files  || [];
  const total    = _dashCouplingTotal(imported);
  const conc     = _dashCouplingConcentration(imported);

  // Concentration bar segments: top1 / top2 / top3 / rest
  const seg = (idx) => {
    const it = imported[idx];
    if (!it || !total) return 0;
    return Math.round((it.count / total) * 100);
  };
  const s1 = seg(0), s2 = seg(1), s3 = seg(2);
  const sRest = Math.max(0, 100 - s1 - s2 - s3);
  const concBarHTML = `
<div class="dash-coupling-detail-conc">
  <div class="dash-coupling-detail-conc__bar">
    ${s1 > 0 ? `<div class="dash-coupling-detail-conc__seg dash-coupling-detail-conc__seg--1" style="width:${s1}%" title="${s1}%"></div>` : ''}
    ${s2 > 0 ? `<div class="dash-coupling-detail-conc__seg dash-coupling-detail-conc__seg--2" style="width:${s2}%" title="${s2}%"></div>` : ''}
    ${s3 > 0 ? `<div class="dash-coupling-detail-conc__seg dash-coupling-detail-conc__seg--3" style="width:${s3}%" title="${s3}%"></div>` : ''}
    ${sRest > 0 ? `<div class="dash-coupling-detail-conc__seg dash-coupling-detail-conc__seg--rest" style="width:${sRest}%"></div>` : ''}
  </div>
  <div class="dash-coupling-detail-conc__legend">
    ${imported[0] ? `<span class="dash-coupling-detail-conc__leg-item dash-coupling-detail-conc__leg-item--1">${_dashEscape(String(imported[0].file || '').split('/').pop())} ${s1}%</span>` : ''}
    ${imported[1] ? `<span class="dash-coupling-detail-conc__leg-item dash-coupling-detail-conc__leg-item--2">${_dashEscape(String(imported[1].file || '').split('/').pop())} ${s2}%</span>` : ''}
    ${imported[2] ? `<span class="dash-coupling-detail-conc__leg-item dash-coupling-detail-conc__leg-item--3">${_dashEscape(String(imported[2].file || '').split('/').pop())} ${s3}%</span>` : ''}
    ${sRest > 0 ? `<span class="dash-coupling-detail-conc__leg-item dash-coupling-detail-conc__leg-item--rest">others ${sRest}%</span>` : ''}
  </div>
  <div class="dash-coupling-detail-conc__caption">top 3 account for <strong>${conc}%</strong> of all imports</div>
</div>`;

  const summaryText = imported.length === 0
    ? 'No dependency hotspots detected.'
    : `${imported.length} hotspot file${imported.length !== 1 ? 's' : ''} — top 3 account for ${conc}% of all imports.`;

  const importedRows = _dashCouplingRows(imported, _dashT('dashCouplingImports'));
  const callerRows   = _dashCouplingRows(callers,  _dashT('dashCouplingCalls'));

  container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--coupling">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Dependency coupling risk</div>
      <h2 class="dash-kpi-detail__title">Most Imported</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value">${imported.length}</span>
        <span class="dash-kpi-detail__primary-suffix">hotspot files</span>
      </div>
      <p class="dash-kpi-detail__summary">${_dashEscape(summaryText)}</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">${concBarHTML}</div>
  </section>
  <div class="dash-kpi-detail__sections">
${_dashKpiDetailSectionHTML({
  title: 'Snapshot',
  body: _dashKpiDetailStatsHTML([
    { value: String(imported.length), label: 'hotspot files' },
    { value: `${conc}%`,              label: 'top-3 concentration' },
    { value: String(total),           label: 'total imports' },
    { value: String(callers.length),  label: 'top callers' },
  ]),
})}
${_dashKpiDetailGridHTML([
  _dashKpiDetailSectionHTML({
    title: `Most Imported Files (${imported.length})`,
    body: `<div class="dash-coupling-detail-list">${importedRows}</div>`,
  }),
  _dashKpiDetailSectionHTML({
    title: `Top Caller Files (${callers.length})`,
    body: `<div class="dash-coupling-detail-list">${callerRows}</div>`,
  }),
], { columns: 2 })}
  </div>
</div>`;
}

_dashRegisterWidget({
  id: 'coupling',
  labelKey: 'dashCouplingTopImported',
      descriptionKey: 'dashDescCoupling',
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
  <div class="dash-kpi-m-right dash-coupling-m-list" style="display:flex;flex-direction:column;gap:2px;overflow-y:auto;min-height:0">${rows}</div>
</div>`;
      return;
    }

    _dashRenderCoupling(container, stats);
  },

  renderDetail(container, stats) { _dashCouplingRenderDetail(container, stats); },
});
