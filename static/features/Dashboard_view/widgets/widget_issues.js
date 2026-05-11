// @module Dashboard_view/widgets/widget_issues
// Issues — circular deps, dead code, god files, longest functions. The
// existing per-issue widgets compressed into a single 4-card row.

function _dashRenderIssues(container, stats) {
    if (!container) return;

    // Issue cards differ in semantics: circular = warning, dead = neutral,
    // entry = positive. We map to status tokens for the headline number while
    // keeping the title-dot on accent (single-accent identity).
    container.innerHTML = `
<div class="dash-grid dash-grid-3" style="margin-bottom:var(--space-3)">
  ${_dashIssueCard(
        _dashT('dashIssuesCircular'),
        'var(--status-warn)',
        stats.circular_dependencies || 0,
        _dashT('dashIssuesCirculaSub'),
        _dashCircularList(stats.top_circular_deps || [])
    )}
  ${_dashIssueCard(
        _dashT('dashIssuesDead'),
        'var(--muted)',
        stats.uncalled_functions || 0,
        _dashT('dashIssuesDeadSub'),
        `<div class="dash-issue-foot">${stats.unimported_files || 0} ${_dashEscape(_dashT('dashIssuesUnimported'))}</div>`
    )}
  ${_dashIssueCard(
        _dashT('dashIssuesEntry'),
        'var(--status-good)',
        stats.entry_points || 0,
        _dashT('dashIssuesEntrySub'),
        `<div class="dash-issue-foot">${stats.isolated_files || 0} ${_dashEscape(_dashT('dashIssuesIsolated'))}</div>`
    )}
</div>
<div class="dash-card">
  <div class="dash-card-title">
    <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashIssuesLongestFuncs'))}
  </div>
  <div class="dash-list">${_dashLongestFuncsRows(stats.longest_functions || [])}</div>
</div>`;
}

function _dashIssueCard(title, color, value, sub, extra) {
    return `
<div class="dash-card">
  <div class="dash-card-title">
    <span class="dash-card-title-dot"></span>${_dashEscape(title)}
  </div>
  <div class="dash-issue-value" style="color:${color}">${_dashFmtNum(value)}</div>
  <div class="dash-stat-sub dash-issue-sub">${_dashEscape(sub)}</div>
  ${extra || ''}
</div>`;
}

function _dashCircularList(cycles) {
    if (!cycles.length) return `<div class="dash-issue-foot">✅ ${_dashEscape(_dashT('dashIssuesNoCycles'))}</div>`;
    return `<div class="dash-list" style="margin-top:var(--space-2)">${cycles.slice(0, 3).map((cycle, i) => `
<div class="dash-list-row dash-list-row--stacked">
  <div class="dash-cycle-head">
    <span class="dash-list-rank">${i + 1}</span>
    <span class="dash-cycle-count">${cycle.length} files</span>
  </div>
  <div class="dash-cycle-path">
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
  <div class="dash-list-bar" style="width:${Math.round(it.lines / max * 60)}px"></div>
  <span class="dash-list-val">${it.lines} lines</span>
</div>`;
    }).join('');
}

_dashRegisterWidget({
    id: 'issues',
    labelKey: 'dashIssuesCircular',
    defaultSize: 'L',

    render(container, size, stats) {
        if (size === 'S') {
            const circular = stats.circular_dependencies || 0;
            const color = circular > 0 ? 'var(--status-warn)' : 'var(--status-good)';
            const barPct = Math.min(100, circular * 10);
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Issues</div>
    <div class="dash-widget-stat" style="color:${color}">${circular}</div>
    <div class="dash-widget-sub">circular deps</div>
  </div>
  <div class="dash-kpi-s-bar"><div class="dash-kpi-s-bar-fill" style="width:${barPct}%;background:${color}"></div></div>
</div>`;
            return;
        }

        if (size === 'M') {
            container.innerHTML = `
<div class="dash-grid dash-grid-3">
  ${_dashIssueCard(
        _dashT('dashIssuesCircular'),
        'var(--status-warn)',
        stats.circular_dependencies || 0,
        _dashT('dashIssuesCirculaSub'),
        _dashCircularList(stats.top_circular_deps || [])
    )}
  ${_dashIssueCard(
        _dashT('dashIssuesDead'),
        'var(--muted)',
        stats.uncalled_functions || 0,
        _dashT('dashIssuesDeadSub'),
        `<div class="dash-issue-foot">${stats.unimported_files || 0} ${_dashEscape(_dashT('dashIssuesUnimported'))}</div>`
    )}
  ${_dashIssueCard(
        _dashT('dashIssuesEntry'),
        'var(--status-good)',
        stats.entry_points || 0,
        _dashT('dashIssuesEntrySub'),
        `<div class="dash-issue-foot">${stats.isolated_files || 0} ${_dashEscape(_dashT('dashIssuesIsolated'))}</div>`
    )}
</div>`;
            return;
        }

        _dashRenderIssues(container, stats);
    },

    renderDetail(container, stats) { _dashRenderIssues(container, stats); },
});
