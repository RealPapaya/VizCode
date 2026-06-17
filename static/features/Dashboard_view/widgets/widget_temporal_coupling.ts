// @ts-nocheck -- JS->TS migration: deferred (leaf widget renderer). Curate later.
// @module Dashboard_view/widgets/widget_temporal_coupling
// Phase 2 — Change Coupling (file pairs that change together).

function _dashRenderTemporalCoupling(container, stats) {
  if (!container) return;

  const items = stats.change_coupling || [];
  const isReport = container.classList.contains('dash-report-section');
  container.innerHTML = isReport ? `
<div class="dash-report-section-head">
  <div class="dash-report-section-title">${_dashEscape(_dashT('dashTemporalCoupling'))}</div>
</div>
<div class="dash-report-section-body"><div class="dash-report-list" id="dash-temporal-coupling-list"></div></div>` : `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashTemporalCoupling'))}
</div>
<div class="dash-list" id="dash-temporal-coupling-list"></div>`;

  const list = container.querySelector('#dash-temporal-coupling-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashTemporalEmpty'))}</div>`;
    return;
  }
  const max = items[0].co_changes || 1;
  list.innerHTML = items.slice(0, 10).map((p, i) => {
    const aShort = String(p.file_a || '').split('/').pop();
    const bShort = String(p.file_b || '').split('/').pop();
    const supportPct = Math.round((p.support || 0) * 100);
    const aJSON = JSON.stringify(p.file_a).replace(/"/g, '&quot;');
    const bJSON = JSON.stringify(p.file_b).replace(/"/g, '&quot;');
    return `
<div class="dash-list-row dash-list-row--stacked">
  <div class="dash-pair-head">
    <span class="dash-list-rank">${i + 1}</span>
    <span class="dash-temporal-pair">
      <span class="dash-temporal-pair-name" data-clickable="true" data-tip="${_dashEscape(p.file_a)}"
            onclick="_dashDrill(${aJSON}, null)">${_dashEscape(aShort)}</span>
      <span class="dash-temporal-pair-arrow">↔</span>
      <span class="dash-temporal-pair-name" data-clickable="true" data-tip="${_dashEscape(p.file_b)}"
            onclick="_dashDrill(${bJSON}, null)">${_dashEscape(bShort)}</span>
    </span>
    <span class="dash-temporal-support">${supportPct}%</span>
  </div>
  <div class="dash-pair-body">
    <div class="dash-list-bar-track" style="flex:1"><div class="dash-list-bar-fill" style="width:${Math.round(p.co_changes / max * 100)}%"></div></div>
    <span class="dash-pair-count">${p.co_changes} ${_dashEscape(_dashT('dashTemporalCoChange'))}</span>
  </div>
</div>`;
  }).join('');
}
