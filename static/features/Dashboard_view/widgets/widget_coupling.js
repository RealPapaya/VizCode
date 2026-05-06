// @module Dashboard_view/widgets/widget_coupling
// Coupling & Hotspots — top imported (incoming) and top caller (outgoing) files.

function _dashRenderCoupling(container, stats) {
    if (!container) return;

    const imported = stats.top_imported_files || [];
    const callers  = stats.top_caller_files   || [];

    container.innerHTML = `
<div class="dash-grid dash-grid-2">
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot" style="background:#f87171"></span>${_dashEscape(_dashT('dashCouplingTopImported'))}
    </div>
    <div class="dash-list">${_dashCouplingRows(imported, '#f87171', _dashT('dashCouplingImports'))}</div>
  </div>
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot" style="background:#fbbf24"></span>${_dashEscape(_dashT('dashCouplingTopCallers'))}
    </div>
    <div class="dash-list">${_dashCouplingRows(callers, '#fbbf24', _dashT('dashCouplingCalls'))}</div>
  </div>
</div>`;
}

function _dashCouplingRows(items, color, suffix) {
    if (!items.length) {
        return `<div class="dash-empty">✅ ${_dashEscape(_dashT('dashCouplingNone'))}</div>`;
    }
    const max = items[0].count || 1;
    return items.map((item, i) => {
        const fileShort = String(item.file || '').split('/').pop();
        const fileJSON = JSON.stringify(item.file).replace(/"/g, '&quot;');
        return `
<div class="dash-list-row" data-clickable="true" data-tip="${_dashEscape(item.file)}"
     onclick="_dashDrill(${fileJSON}, null)">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(fileShort)}</span>
  <div class="dash-list-bar" style="width:${Math.round(item.count / max * 60)}px;background:${color}"></div>
  <span class="dash-list-val" style="color:${color}">${item.count} ${_dashEscape(suffix)}</span>
</div>`;
    }).join('');
}
