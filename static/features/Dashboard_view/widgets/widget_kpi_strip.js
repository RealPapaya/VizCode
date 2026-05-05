// @module Dashboard_view/widgets/widget_kpi_strip
// KPI strip — files / functions / real LOC / Code Health badge.

function _dashRenderKpiStrip(container, stats) {
    if (!container) return;

    const score = Number(stats.code_health_score || 0);
    const healthColor = _dashHealthColor(score);

    const cards = [
        {
            label: _dashT('dashKpiFiles'),
            value: _dashFmtNum(stats.files || 0),
            sub:   `${stats.other_files || 0} other`,
            accent: '#dfa745',
        },
        {
            label: _dashT('dashKpiFunctions'),
            value: _dashFmtNum(stats.functions || 0),
            sub:   `${(stats.calls || 0).toLocaleString()} calls`,
            accent: '#a78bfa',
        },
        {
            label: _dashT('dashKpiLoc'),
            value: _dashFmtNum(stats.loc_total || 0),
            sub:   `${_dashFmtNum(stats.loc_code || 0)} code · ${_dashFmtNum(stats.loc_comment || 0)} comments`,
            accent: '#34d399',
        },
        {
            label: _dashT('dashKpiHealth'),
            value: score.toFixed(1) + ' / 10',
            sub:   _dashHealthLabel(score),
            accent: healthColor,
        },
    ];

    container.innerHTML = `<div class="dash-stat-strip">${
        cards.map(c => `
<div class="dash-stat-card" style="--ds-accent:${c.accent}">
  <div class="dash-stat-label">${_dashEscape(c.label)}</div>
  <div class="dash-stat-value">${_dashEscape(c.value)}</div>
  <div class="dash-stat-sub">${_dashEscape(c.sub)}</div>
</div>`).join('')
    }</div>`;
}

function _dashHealthLabel(score) {
    if (score >= _DASH_HEALTH_BANDS.amber) return _dashT('dashHealthGood');
    if (score >= _DASH_HEALTH_BANDS.red)   return _dashT('dashHealthFair');
    return _dashT('dashHealthPoor');
}
