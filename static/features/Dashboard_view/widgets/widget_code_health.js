// @module Dashboard_view/widgets/widget_code_health

const _DASH_HEALTH_TRACK_LEN = Math.PI * 88;


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
            const barPct = Math.round(pct * 100);
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Code Health</div>
    <div class="dash-widget-stat" style="color:${color}">${score.toFixed(1)}</div>
    <div class="dash-widget-sub" style="color:${color}">${_dashEscape(_dashT(statusKey))} / 10</div>
  </div>
  <div class="dash-kpi-s-bar"><div class="dash-kpi-s-bar-fill" style="width:${barPct}%;background:${color}"></div></div>
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
                return `<div class="dash-kpi-bar-row">
  <span class="dash-kpi-bar-label">${_dashEscape(name)}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${bPct}%;background:${col}"></div></div>
  <span class="dash-kpi-bar-val">${v.toFixed(1)}</span>
</div>`;
            }).join('');
            container.innerHTML = `
<div class="dash-kpi-m">
  <div class="dash-kpi-m-left">
    <div class="dash-widget-title">Code Health</div>
    <div class="dash-widget-stat-md" style="color:${color}">${score.toFixed(1)}</div>
    <div class="dash-widget-sub" style="color:${color}">${_dashEscape(_dashT(statusKey))} / 10</div>
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

});
