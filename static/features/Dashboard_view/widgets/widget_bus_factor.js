// @module Dashboard_view/widgets/widget_bus_factor

_dashRegisterWidget({
    id: 'bus_factor',
    labelKey: 'dashBusFactorTitle',
    defaultSize: 'M',

    render(container, size, stats) {
        console.log('[bus_factor] render called, size=', size, 'items=', (stats.bus_factor_files || []).length);
        console.log('[bus_factor] has_git_history=', stats.has_git_history, 'files_by_author keys=', Object.keys(stats.files_by_author || {}).length);
        const items = stats.bus_factor_files || [];
        const high   = items.filter(f => f.risk === 'high');
        const medium = items.filter(f => f.risk === 'medium');
        const low    = items.filter(f => f.risk === 'low');

        if (size === 'L') {
            _dashRenderBusFactorLarge(container, items, high, medium, low);
        } else {
            _dashRenderBusFactorMedium(container, high, medium);
        }
    },

    renderDetail(container, stats) {
        const items  = stats.bus_factor_files || [];
        const high   = items.filter(f => f.risk === 'high');
        const medium = items.filter(f => f.risk === 'medium');
        const low    = items.filter(f => f.risk === 'low');

        container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>Summary</div>
  <div style="display:flex;gap:0.75rem;padding:8px 0">
    <div class="dash-kpi-pill dash-kpi-pill--bad">${high.length} <span>${_dashEscape(_dashT('dashBusFactorHigh'))}</span></div>
    <div class="dash-kpi-pill dash-kpi-pill--warn">${medium.length} <span>${_dashEscape(_dashT('dashBusFactorMedium'))}</span></div>
    <div class="dash-kpi-pill dash-kpi-pill--good">${low.length} <span>${_dashEscape(_dashT('dashBusFactorLow'))}</span></div>
  </div>
</div>
<div class="dash-card" style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>All Files</div>
  <div class="dash-list" style="flex:1;overflow-y:auto">
    ${items.length
        ? items.map(f => _dashBusFactorRow(f)).join('')
        : `<div class="dash-empty">${_dashEscape(_dashT('dashBusFactorEmpty'))}</div>`}
  </div>
</div>`;
    },
});

function _dashRenderBusFactorMedium(container, high, medium) {
    const list = high.length ? high : medium;
    container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashBusFactorTitle'))}
</div>
<div class="dash-list" id="dash-bf-list-m"></div>`;

    const el = container.querySelector('#dash-bf-list-m');
    if (!list.length) {
        el.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashBusFactorEmpty'))}</div>`;
        return;
    }
    el.innerHTML = list.slice(0, 8).map(f => _dashBusFactorRow(f)).join('');
}

function _dashRenderBusFactorLarge(container, items, high, medium, low) {
    container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashBusFactorTitle'))}
</div>
<div class="dash-bf-kpis" style="display:flex;gap:0.5rem;margin:0 0 0.6rem 0">
  <div class="dash-kpi-pill dash-kpi-pill--bad"  title="${_dashEscape(_dashT('dashBusFactorHigh'))}">${high.length} <span>${_dashEscape(_dashT('dashBusFactorHigh'))}</span></div>
  <div class="dash-kpi-pill dash-kpi-pill--warn" title="${_dashEscape(_dashT('dashBusFactorMedium'))}">${medium.length} <span>${_dashEscape(_dashT('dashBusFactorMedium'))}</span></div>
  <div class="dash-kpi-pill dash-kpi-pill--good" title="${_dashEscape(_dashT('dashBusFactorLow'))}">${low.length} <span>${_dashEscape(_dashT('dashBusFactorLow'))}</span></div>
</div>
<div class="dash-list" id="dash-bf-list-l" style="flex:1;overflow-y:auto"></div>`;

    const el = container.querySelector('#dash-bf-list-l');
    const visible = items.filter(f => f.risk !== 'low').slice(0, 15);
    if (!visible.length) {
        el.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashBusFactorEmpty'))}</div>`;
        return;
    }
    el.innerHTML = visible.map(f => _dashBusFactorRow(f)).join('');
}

function _dashBusFactorRow(f) {
    const pct      = Math.round((f.primary_share || 0) * 100);
    const fileName = String(f.file || '').split('/').pop();
    const fullPath = _dashEscape(f.file || '');
    const owner    = _dashEscape(f.primary_owner || 'Unknown');
    const authors  = f.total_authors || 1;
    const riskCls  = f.risk === 'high' ? 'var(--status-bad)' : 'var(--status-warn)';

    return `
<div class="dash-list-row" title="${fullPath}" style="display:flex;flex-direction:column;gap:3px;padding:5px 4px">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
    <span class="dash-list-label" style="font-size:0.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%"
          title="${fullPath}">${_dashEscape(fileName)}</span>
    <span style="font-size:0.72rem;opacity:0.7;white-space:nowrap">${owner}</span>
    <span class="dash-pill" style="background:${riskCls};opacity:0.85;font-size:0.68rem;padding:1px 6px">${authors} ${_dashEscape(_dashT(authors === 1 ? 'dashBusFactorAuthor' : 'dashBusFactorAuthors'))}</span>
  </div>
  <div style="display:flex;align-items:center;gap:6px">
    <div style="flex:1;height:4px;background:var(--panel-border-color);border-radius:2px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${riskCls};border-radius:2px"></div>
    </div>
    <span style="font-size:0.72rem;min-width:2.8rem;text-align:right;color:${riskCls}">${pct}%</span>
  </div>
</div>`;
}
