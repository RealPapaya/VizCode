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
      <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashCouplingTopImported'))}
    </div>
    <div class="dash-list">${_dashCouplingRows(imported, _dashT('dashCouplingImports'))}</div>
  </div>
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashCouplingTopCallers'))}
    </div>
    <div class="dash-list">${_dashCouplingRows(callers, _dashT('dashCouplingCalls'))}</div>
  </div>
</div>`;
}

function _dashCouplingRows(items, suffix) {
    if (!items.length) {
        return `<div class="dash-empty">✅ ${_dashEscape(_dashT('dashCouplingNone'))}</div>`;
    }
    const max = items[0].count || 1;
    return items.map((item, i) => {
        const fileShort = String(item.file || '').split('/').pop();
        const fileJSON  = JSON.stringify(item.file).replace(/"/g, '&quot;');
        return `
<div class="dash-list-row" data-clickable="true" data-tip="${_dashEscape(item.file)}"
     onclick="_dashDrill(${fileJSON}, null)">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(fileShort)}</span>
  <div class="dash-list-bar" style="width:${Math.round(item.count / max * 60)}px"></div>
  <span class="dash-list-val">${item.count} ${_dashEscape(suffix)}</span>
</div>`;
    }).join('');
}

_dashRegisterWidget({
    id: 'coupling',
    labelKey: 'dashCouplingTopImported',
    defaultSize: 'L',

    render(container, size, stats) {
        const imported = stats.top_imported_files || [];
        const callers  = stats.top_caller_files   || [];

        if (size === 'S') {
            const topImp  = imported[0];
            const topCall = callers[0];
            const barPct  = topImp ? Math.min(100, Math.round(topImp.count / 20 * 100)) : 0;
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Coupling</div>
    <div class="dash-widget-stat">${imported.length}</div>
    <div class="dash-widget-sub">hotspot files</div>
  </div>
  <div class="dash-kpi-s-bar"><div class="dash-kpi-s-bar-fill" style="width:${barPct}%;background:var(--accent)"></div></div>
</div>`;
            return;
        }

        if (size === 'M') {
            const max  = imported.length ? imported[0].count || 1 : 1;
            const rows = imported.slice(0, 5).map((item, i) => {
                const fileShort = String(item.file || '').split('/').pop();
                const fileJSON  = JSON.stringify(item.file).replace(/"/g, '&quot;');
                return `<div class="dash-kpi-bar-row" style="cursor:pointer" onclick="_dashDrill(${fileJSON}, null)">
  <span class="dash-kpi-bar-label">${_dashEscape(fileShort)}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${Math.round(item.count/max*100)}%;background:${_dashAccentStop(i)}"></div></div>
  <span class="dash-kpi-bar-val">${item.count}</span>
</div>`;
            }).join('') || '<span class="dash-kpi-empty">No data</span>';
            container.innerHTML = `
<div class="dash-kpi-m">
  <div class="dash-kpi-m-left">
    <div class="dash-widget-title">Coupling</div>
    <div class="dash-widget-stat-md">${imported.length}</div>
    <div class="dash-widget-sub">hotspot files</div>
  </div>
  <div class="dash-kpi-m-sep"></div>
  <div class="dash-kpi-m-right">${rows}</div>
</div>`;
            return;
        }

        // L: full two-column layout
        _dashRenderCoupling(container, stats);
    },

    renderDetail(container, stats) { _dashRenderCoupling(container, stats); },
});
