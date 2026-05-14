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

        function riskSection(label, list, color) {
            if (!list.length) return '';
            return `
<div style="margin-bottom:1.5rem">
  <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;padding-bottom:0.4rem;border-bottom:1px solid ${color}35">
    <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
    <span style="font-size:0.72rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:${color}">${_dashEscape(label)}</span>
    <span style="font-size:0.72rem;opacity:0.45">(${list.length})</span>
  </div>
  ${list.map(f => _dashBusFactorDetailRow(f, color)).join('')}
</div>`;
        }

        container.innerHTML = `
<div class="dash-card" style="padding:12px 16px;margin-bottom:0.75rem">
  <div style="display:flex;align-items:center;gap:2rem">
    <div style="text-align:center">
      <div style="font-size:2.25rem;font-weight:700;color:var(--status-bad);line-height:1">${high.length}</div>
      <div style="font-size:0.7rem;opacity:0.55;margin-top:4px">${_dashEscape(_dashT('dashBusFactorHigh'))}</div>
    </div>
    <div style="width:1px;height:40px;background:var(--panel-border-color)"></div>
    <div style="text-align:center">
      <div style="font-size:2.25rem;font-weight:700;color:var(--status-warn);line-height:1">${medium.length}</div>
      <div style="font-size:0.7rem;opacity:0.55;margin-top:4px">${_dashEscape(_dashT('dashBusFactorMedium'))}</div>
    </div>
    <div style="width:1px;height:40px;background:var(--panel-border-color)"></div>
    <div style="text-align:center">
      <div style="font-size:2.25rem;font-weight:700;color:var(--status-good);line-height:1">${low.length}</div>
      <div style="font-size:0.7rem;opacity:0.55;margin-top:4px">${_dashEscape(_dashT('dashBusFactorLow'))}</div>
    </div>
    <div style="flex:1"></div>
    <div style="font-size:0.75rem;opacity:0.4">${items.length} files</div>
  </div>
</div>
<div style="flex:1;min-height:0;overflow-y:auto;padding-right:4px">
  ${riskSection(_dashT('dashBusFactorHigh'),   high,   'var(--status-bad)')}
  ${riskSection(_dashT('dashBusFactorMedium'), medium, 'var(--status-warn)')}
  ${riskSection(_dashT('dashBusFactorLow'),    low,    'var(--status-good)')}
  ${!items.length ? `<div class="dash-empty">${_dashEscape(_dashT('dashBusFactorEmpty'))}</div>` : ''}
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

// Compact row for the widget tiles
function _dashBusFactorRow(f) {
    const pct      = Math.round((f.primary_share || 0) * 100);
    const fileName = String(f.file || '').split(/[/\\]/).pop();
    const fullPath = _dashEscape(f.file || '');
    const owner    = _dashEscape(f.primary_owner || 'Unknown');
    const authors  = f.total_authors || 1;
    const riskCls  = f.risk === 'high' ? 'var(--status-bad)' : f.risk === 'low' ? 'var(--status-good)' : 'var(--status-warn)';

    return `
<div class="dash-list-row" title="${fullPath}" style="display:flex;flex-direction:column;gap:4px;padding:5px 4px">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
    <span class="dash-list-label" style="font-size:0.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1"
          title="${fullPath}">${_dashEscape(fileName)}</span>
    <span style="font-size:0.72rem;opacity:0.65;white-space:nowrap;flex-shrink:0">${owner}</span>
    <span class="dash-pill" style="background:${riskCls};opacity:0.85;font-size:0.68rem;padding:1px 6px;flex-shrink:0">${authors} ${_dashEscape(_dashT(authors === 1 ? 'dashBusFactorAuthor' : 'dashBusFactorAuthors'))}</span>
  </div>
  <div style="display:flex;align-items:center;gap:6px">
    <div style="flex:1;height:4px;background:var(--panel-border-color);border-radius:2px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${riskCls};border-radius:2px"></div>
    </div>
    <span style="font-size:0.72rem;min-width:2.5rem;text-align:right;color:${riskCls};flex-shrink:0">${pct}%</span>
  </div>
</div>`;
}

// Expanded row for the detail panel
function _dashBusFactorDetailRow(f, color) {
    const pct      = Math.round((f.primary_share || 0) * 100);
    const parts    = String(f.file || '').split(/[/\\]/);
    const fileName = parts.pop() || '';
    const dirPath  = parts.join('/');
    const owner    = _dashEscape(f.primary_owner || 'Unknown');
    const authors  = f.total_authors || 1;
    const commits  = f.total_commits || 0;

    return `
<div class="dash-list-row" style="padding:8px 6px;margin-bottom:4px;border-radius:5px">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
    <div style="flex:1;min-width:0">
      <div style="font-size:0.82rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
           title="${_dashEscape(f.file || '')}">${_dashEscape(fileName)}</div>
      ${dirPath ? `<div style="font-size:0.68rem;opacity:0.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px">${_dashEscape(dirPath)}</div>` : ''}
    </div>
    <div style="text-align:right;flex-shrink:0;font-size:0.75rem">
      <div style="font-weight:600;color:${color}">${pct}%</div>
      <div style="opacity:0.5;margin-top:1px">${owner}</div>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:8px">
    <div style="flex:1;height:6px;background:var(--panel-border-color);border-radius:3px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;opacity:0.85"></div>
    </div>
    <span style="font-size:0.7rem;opacity:0.45;flex-shrink:0">${authors} ${_dashEscape(_dashT(authors === 1 ? 'dashBusFactorAuthor' : 'dashBusFactorAuthors'))}${commits ? ` · ${commits} commits` : ''}</span>
  </div>
</div>`;
}
