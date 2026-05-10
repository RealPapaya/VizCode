// @module Dashboard_view/widgets/widget_code_health

const _DASH_HEALTH_TRACK_LEN = Math.PI * 88;

function _dashRenderHealthDetailBars(breakdown, weights) {
    const target = document.getElementById('dash-health-detail');
    if (!target) return;
    const fills = _dashAccentForSlices(_DASH_HEALTH_SUBSCORES.length);
    const rows  = _DASH_HEALTH_SUBSCORES.map((s, i) => {
        const v         = Number(breakdown[s.key] || 0);
        const weight    = Number(weights[s.key]   || 0);
        const pct       = Math.max(0, Math.min(100, (v / 10) * 100));
        const weightPct = Math.round(weight * 100);
        const color     = fills[Math.min(i, fills.length - 1)];
        return `
<div class="dash-health-row">
  <span class="dash-health-row-label">${_dashEscape(_dashT(s.label))}</span>
  <span class="dash-health-row-weight">${weightPct}%</span>
  <div class="dash-health-row-track">
    <div class="dash-health-row-fill" style="width:${pct}%;background:${color}"></div>
  </div>
  <span class="dash-health-row-value">${v.toFixed(1)}</span>
</div>`;
    }).join('');
    target.innerHTML = `<div class="dash-health-bars">${rows}</div>`;
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
      <text x="110" y="82"  class="dash-health-gauge-score">${score.toFixed(1)}</text>
      <text x="110" y="104" class="dash-health-gauge-den">/ 10</text>
    </svg>
    <span class="dash-health-status-badge" style="color:${color}">${_dashEscape(_dashT(statusKey))}</span>
  </div>
  <button class="dash-health-expand-btn" id="dash-health-expand-btn" type="button">
    <span>${_dashEscape(_dashT('dashHealthDetails') || 'Details')}</span>
    <svg class="dash-health-chevron" id="dash-health-chevron" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  </button>
  <div class="dash-health-detail" id="dash-health-detail"></div>
</div>`;

        _dashRenderHealthDetailBars(breakdown, weights);
        document.getElementById('dash-health-expand-btn')?.addEventListener('click', () => {
            const detail  = document.getElementById('dash-health-detail');
            const chevron = document.getElementById('dash-health-chevron');
            if (!detail) return;
            const open = detail.classList.toggle('dash-health-detail--open');
            if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
        });
    },

    renderDetail(container, stats) {
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
        const fills   = _dashAccentForSlices(_DASH_HEALTH_SUBSCORES.length);

        const rows = _DASH_HEALTH_SUBSCORES.map((s, i) => {
            const v      = Number(breakdown[s.key] || 0);
            const w      = Number(weights[s.key]   || 0);
            const barPct = Math.max(0, Math.min(100, (v / 10) * 100));
            const wPct   = Math.round(w * 100);
            const col    = fills[Math.min(i, fills.length - 1)];
            return `
<div class="dash-health-row">
  <span class="dash-health-row-label">${_dashEscape(_dashT(s.label))}</span>
  <span class="dash-health-row-weight">${wPct}%</span>
  <div class="dash-health-row-track">
    <div class="dash-health-row-fill" style="width:${barPct}%;background:${col}"></div>
  </div>
  <span class="dash-health-row-value">${v.toFixed(1)}</span>
</div>`;
        }).join('');

        container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot" style="background:${color}"></span>Overall</div>
  <div class="dash-health-gauge-area">
    <svg class="dash-health-gauge-svg" viewBox="0 0 220 130" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path class="dash-health-gauge-track" d="M 22 110 A 88 88 0 0 1 198 110"/>
      <path class="dash-health-gauge-fill" d="M 22 110 A 88 88 0 0 1 198 110"
            style="stroke-dasharray:${fillLen} ${gapLen};stroke:${color}"/>
      <text x="110" y="82"  class="dash-health-gauge-score">${score.toFixed(1)}</text>
      <text x="110" y="104" class="dash-health-gauge-den">/ 10</text>
    </svg>
    <span class="dash-health-status-badge" style="color:${color}">${_dashEscape(_dashT(statusKey))}</span>
  </div>
</div>
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>Sub-score Breakdown</div>
  <div class="dash-health-bars" style="margin-top:8px;">
    ${rows || '<div class="dash-empty">No breakdown available</div>'}
  </div>
</div>`;
    },
});
