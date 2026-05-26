// @module Dashboard_view/widgets/widget_code_health

const _DASH_HEALTH_TRACK_LEN = Math.PI * 88;

function _dashHealthGaugeSvg(score, color, opts = {}) {
    const pct       = Math.max(0, Math.min(1, score / 10));
    const fillLen   = (pct * _DASH_HEALTH_TRACK_LEN).toFixed(2);
    const gapLen    = _DASH_HEALTH_TRACK_LEN.toFixed(2);
    const scoreFont = opts.scoreFont || 28;
    const denFont   = opts.denFont   || 13;
    const denDy     = opts.denDy     || 20;
    const showDen   = opts.showDen !== false;
    const scoreY    = showDen ? (104 - denDy) : 100;
    return `
<svg class="dash-health-gauge-svg" viewBox="0 0 220 130" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"${opts.style ? ` style="${opts.style}"` : ''}>
  <path class="dash-health-gauge-track" d="M 22 110 A 88 88 0 0 1 198 110"/>
  <path class="dash-health-gauge-fill" d="M 22 110 A 88 88 0 0 1 198 110"
        style="stroke-dasharray:${fillLen} ${gapLen};stroke:${color}"/>
  <text x="110" y="${scoreY}" class="dash-health-gauge-score" style="font-size:${scoreFont}px">${score.toFixed(1)}</text>
  ${showDen ? `<text x="110" y="104" class="dash-health-gauge-den" style="font-size:${denFont}px">/ 10</text>` : ''}
</svg>`;
}

function _dashHealthCategoryFiles(key, stats) {
    if (key === 'complexity') return (stats.complexity_top_offenders || []).map(x => x.file);
    if (key === 'coupling') {
        const files = [
            ...(stats.top_imported_files || []).map(x => x.file),
            ...(stats.top_caller_files || []).map(x => x.file),
            ...(stats.top_circular_deps || []).flat(),
        ];
        return files;
    }
    if (key === 'dead_code') return (stats.dead_code_symbols || []).map(x => x.file);
    if (key === 'duplication') return (stats.duplication_blocks || []).flatMap(b => (b.occurrences || []).map(o => o.file));
    if (key === 'cohesion') return _dashAllFiles();
    return [];
}

_dashRegisterWidget({
    id: 'code_health',
    labelKey: 'dashCodeHealthTitle',
    defaultSize: 'L',

    render(container, size, stats) {
        const score     = Number(stats.code_health_score || 0);
        const breakdown = stats.code_health_breakdown || {};
        const weights   = stats.code_health_weights   || {};
        const color     = _dashHealthColor(score);
        const statusKey = score >= _DASH_HEALTH_BANDS.amber ? 'dashHealthGood'
                        : score >= _DASH_HEALTH_BANDS.red   ? 'dashHealthFair'
                        : 'dashHealthPoor';
        const pct     = Math.max(0, Math.min(1, score / 10));
        const fillLen = (pct * _DASH_HEALTH_TRACK_LEN).toFixed(2);
        const gapLen  = _DASH_HEALTH_TRACK_LEN.toFixed(2);

        if (size === 'S') {
            const worst = _DASH_HEALTH_SUBSCORES
                .map(s => ({ label: _dashT(s.label).split(' ').pop(), value: Number(breakdown[s.key] || 0).toFixed(1), key: s.key }))
                .sort((a, b) => Number(a.value) - Number(b.value))
                .slice(0, 3)
                .map(s => ({
                    label: s.label,
                    value: s.value,
                    onclick: `_dashOpenFileGroupDrilldown('Code Health: ${_dashEscape(s.label)}', _dashHealthCategoryFiles(${_dashJson(s.key)}, DATA.stats))`,
                }));
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Code Health</div>
    <div class="dash-health-gauge-area" style="flex:1;min-height:0;justify-content:center;margin-top:-4px;">
      ${_dashHealthGaugeSvg(score, color, { scoreFont: 50, showDen: false, style: 'width:100%;max-width:100%;height:auto;display:block;' })}
      <div class="dash-widget-sub" style="color:${color};margin-top:-6px;text-align:center;">${_dashEscape(_dashT(statusKey))}</div>
    </div>
  </div>
</div>`;
            return;
        }

        if (size === 'M') {
            const fills = _dashAccentForSlices(_DASH_HEALTH_SUBSCORES.length);
            const bars  = _DASH_HEALTH_SUBSCORES.slice(0, 4).map((s, i) => {
                const v    = Number(breakdown[s.key] || 0);
                const bPct = Math.round((v / 10) * 100);
                const col  = fills[Math.min(i, fills.length - 1)];
                const name = _dashT(s.label).split(' ').pop();
                return `<div class="dash-kpi-bar-row" style="cursor:pointer"
     onclick="_dashOpenFileGroupDrilldown('Code Health: ${_dashEscape(name)}', _dashHealthCategoryFiles(${_dashJson(s.key)}, DATA.stats))">
  <span class="dash-kpi-bar-label">${_dashEscape(name)}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${bPct}%;background:${col}"></div></div>
  <span class="dash-kpi-bar-val">${v.toFixed(1)}</span>
</div>`;
            }).join('');
            container.innerHTML = `
<div class="dash-kpi-m">
  <div class="dash-kpi-m-left" style="align-items:center;text-align:center;min-width:150px;">
    <div class="dash-widget-title">Code Health</div>
    <div class="dash-health-gauge-area" style="flex:0 0 auto;margin:2px 0;">
      ${_dashHealthGaugeSvg(score, color, { scoreFont: 32, denFont: 12, denDy: 22, style: 'width:150px;height:auto;' })}
    </div>
    <div class="dash-widget-sub" style="color:${color}">${_dashEscape(_dashT(statusKey))}</div>
  </div>
  <div class="dash-kpi-m-sep"></div>
  <div class="dash-kpi-m-right">${bars}</div>
</div>`;
            return;
        }

        // L: full gauge + expand button
        container.innerHTML = `
<div class="dash-health-card" style="height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:var(--space-3);">
  <div class="dash-card-title">
    <span class="dash-card-title-dot" style="background:${color}"></span>${_dashEscape(_dashT('dashCodeHealthTitle'))}
  </div>
  <div class="dash-health-gauge-area">
    <svg class="dash-health-gauge-svg" viewBox="0 0 220 130" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path class="dash-health-gauge-track" d="M 22 110 A 88 88 0 0 1 198 110"/>
      <path class="dash-health-gauge-fill" d="M 22 110 A 88 88 0 0 1 198 110"
            style="stroke-dasharray:${fillLen} ${gapLen};stroke:${color}"/>
      <text x="110" y="84"  class="dash-health-gauge-score">${score.toFixed(1)}</text>
      <text x="110" y="104" class="dash-health-gauge-den">/ 10</text>
    </svg>
    <span class="dash-health-status-badge" style="color:${color}">${_dashEscape(_dashT(statusKey))}</span>
  </div>
</div>`;
    },

    renderDetail(container, stats) {
        const score     = Number(stats.code_health_score || 0);
        const breakdown = stats.code_health_breakdown || {};
        const weights   = stats.code_health_weights   || {};
        const color     = _dashHealthColor(score);
        const statusKey = score >= _DASH_HEALTH_BANDS.amber ? 'dashHealthGood'
                        : score >= _DASH_HEALTH_BANDS.red   ? 'dashHealthFair'
                        : 'dashHealthPoor';
        const rows = _DASH_HEALTH_SUBSCORES.map(s => {
            const value = Number(breakdown[s.key] || 0);
            const files = _dashHealthCategoryFiles(s.key, stats);
            return `<div class="dash-list-row" data-clickable="true"
     onclick="_dashOpenFileGroupDrilldown('Code Health: ${_dashEscape(_dashT(s.label))}', _dashHealthCategoryFiles(${_dashJson(s.key)}, DATA.stats))">
  <span class="dash-list-name" style="min-width: 0;">${_dashEscape(_dashT(s.label))}</span>
  <div class="dash-list-bar-track"><div class="dash-list-bar-fill" style="width:${Math.round(value * 10)}%;background:${_dashHealthColor(value)}"></div></div>
  <div style="display:flex; flex-direction:column; align-items:flex-end;">
    <span class="dash-list-val" style="color:${_dashHealthColor(value)}">${value.toFixed(1)}</span>
    <span style="font-size:9px; color:var(--muted); line-height:1; margin-top:2px;">w ${Math.round((weights[s.key] || 0) * 100)}% · ${files.length} files</span>
  </div>
</div>`;
        }).join('');

        container.innerHTML = `
<div class="dash-card dash-health-report-breakdown dash-detail-section">
  <div class="dash-card-title">
    <span class="dash-card-title-dot" style="background:${color}"></span>Health Breakdown
    <span class="dash-card-sub" style="color:${color}">${_dashEscape(_dashT(statusKey))} ${score.toFixed(1)} / 10</span>
  </div>
  <div class="dash-list dash-detail-flow-list dash-detail-wrap-rows" style="padding-top:8px;">
    ${rows}
  </div>
</div>`;
    },

});
