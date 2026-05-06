// @module Dashboard_view/widgets/widget_issues
// Issues — circular deps, dead code, god files, longest functions. The
// existing per-issue widgets compressed into a single 4-card row.

function _dashRenderIssues(container, stats) {
    if (!container) return;

    container.innerHTML = `
<div class="dash-grid dash-grid-3" style="margin-bottom:12px">
  ${_dashIssueCard(
        _dashT('dashIssuesCircular'),
        '#fb923c',
        stats.circular_dependencies || 0,
        _dashT('dashIssuesCirculaSub'),
        _dashCircularList(stats.top_circular_deps || [])
    )}
  ${_dashIssueCard(
        _dashT('dashIssuesDead'),
        '#94a3b8',
        stats.uncalled_functions || 0,
        _dashT('dashIssuesDeadSub'),
        `<div style="text-align:center;color:#64748b;font-size:11px">${stats.unimported_files || 0} ${_dashEscape(_dashT('dashIssuesUnimported'))}</div>`
    )}
  ${_dashIssueCard(
        _dashT('dashIssuesEntry'),
        '#34d399',
        stats.entry_points || 0,
        _dashT('dashIssuesEntrySub'),
        `<div style="text-align:center;color:#64748b;font-size:11px">${stats.isolated_files || 0} ${_dashEscape(_dashT('dashIssuesIsolated'))}</div>`
    )}
</div>
<div class="dash-card">
  <div class="dash-card-title">
    <span class="dash-card-title-dot" style="background:#f472b6"></span>${_dashEscape(_dashT('dashIssuesLongestFuncs'))}
  </div>
  <div class="dash-list">${_dashLongestFuncsRows(stats.longest_functions || [])}</div>
</div>`;
}

function _dashIssueCard(title, color, value, sub, extra) {
    return `
<div class="dash-card">
  <div class="dash-card-title">
    <span class="dash-card-title-dot" style="background:${color}"></span>${_dashEscape(title)}
  </div>
  <div class="dash-stat-value" style="color:${color};font-size:36px;text-align:center;margin:16px 0 4px">${_dashFmtNum(value)}</div>
  <div class="dash-stat-sub" style="text-align:center">${_dashEscape(sub)}</div>
  ${extra || ''}
</div>`;
}

function _dashCircularList(cycles) {
    if (!cycles.length) return `<div style="text-align:center;color:#64748b;font-size:11px;margin-top:8px">✅ ${_dashEscape(_dashT('dashIssuesNoCycles'))}</div>`;
    return `<div class="dash-list" style="margin-top:8px">${cycles.slice(0, 3).map((cycle, i) => `
<div class="dash-list-row" style="flex-direction:column;align-items:flex-start;gap:2px">
  <div style="display:flex;align-items:center;gap:6px;width:100%">
    <span class="dash-list-rank">${i + 1}</span>
    <span style="font-size:11px;color:#fb923c;font-weight:600">${cycle.length} files</span>
  </div>
  <div style="font-size:10px;color:#64748b;margin-left:24px">
    ${cycle.slice(0, 3).map(f => _dashEscape(String(f).split('/').pop())).join(' → ')}${cycle.length > 3 ? ` → +${cycle.length - 3}` : ''}
  </div>
</div>`).join('')}</div>`;
}

function _dashLongestFuncsRows(items) {
    if (!items.length) return `<div class="dash-empty">${_dashEscape(_dashT('dashNoData'))}</div>`;
    const max = items[0].lines || 1;
    return items.slice(0, 8).map((it, i) => {
        const fileJSON = JSON.stringify(it.file).replace(/"/g, '&quot;');
        const nameJSON = JSON.stringify(it.name).replace(/"/g, '&quot;');
        return `
<div class="dash-list-row" data-clickable="true" data-tip="${_dashEscape(it.file)}"
     onclick="_dashDrill(${fileJSON}, ${nameJSON})">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(it.name)}</span>
  <div class="dash-list-bar" style="width:${Math.round(it.lines / max * 60)}px;background:#f472b6"></div>
  <span class="dash-list-val" style="color:#f472b6">${it.lines} lines</span>
</div>`;
    }).join('');
}
