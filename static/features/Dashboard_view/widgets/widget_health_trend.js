// @module Dashboard_view/widgets/widget_health_trend

_dashRegisterWidget({
    id: 'health_trend',
    labelKey: 'dashHealthTrendTitle',
    defaultSize: 'M',

    render(container, size, stats) {
        console.log('[health_trend] render called, size=', size, 'history length=', (stats.health_history || []).length);
        const history = stats.health_history || [];
        const canvasId = 'dash-chart-health-trend-' + (container.dataset.dashWidgetSeq || Math.random().toString(36).slice(2, 6));
        container.dataset.dashWidgetSeq = canvasId;

        container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashHealthTrendTitle'))}
</div>
<div class="dash-chart-wrap" style="flex:1;min-height:0"><canvas id="${canvasId}"></canvas></div>`;

        if (history.length < 2) {
            const wrap = container.querySelector('.dash-chart-wrap');
            if (wrap) {
                if (history.length === 1) {
                    const h = history[0];
                    const s = Number(h.score || 0);
                    const col = _dashHealthColor(s);
                    wrap.innerHTML = `<div style="padding:0.6rem 0.5rem;display:flex;align-items:center;gap:0.75rem">
  <div style="font-size:2.2rem;font-weight:700;color:${col};line-height:1">${s.toFixed(1)}</div>
  <div style="font-size:0.72rem;opacity:0.6;line-height:1.5">
    <div>${_dashEscape(h.date || (h.ts || '').slice(0, 10))}</div>
    <div>${_dashEscape(_dashT('dashHealthTrendEmpty'))}</div>
  </div>
</div>`;
                } else {
                    wrap.innerHTML = `<div class="dash-empty" style="padding:1rem 0.5rem;font-size:0.8rem;opacity:0.55">${_dashEscape(_dashT('dashHealthTrendEmpty'))}</div>`;
                }
            }
            return;
        }

        const recent = history.slice(-20);
        const labels = recent.map(h => h.date || h.ts.slice(0, 10));
        const scores = recent.map(h => Number(h.score || 0));

        const canvas = document.getElementById(canvasId);
        if (!canvas || typeof Chart === 'undefined') return;

        if (size === 'L') {
            _dashDrawHealthTrendLarge(canvas, recent, labels, scores);
        } else {
            _dashDrawHealthTrendMain(canvas, labels, scores);
        }
    },

    renderDetail(container, stats) {
        const history = stats.health_history || [];

        if (!history.length) {
            container.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashHealthTrendEmpty'))}</div>`;
            return;
        }

        if (history.length === 1) {
            const h = history[0];
            const s = Number(h.score || 0);
            const col = _dashHealthColor(s);
            const bd  = h.breakdown || {};
            const subKeys   = ['complexity', 'coupling', 'dead_code', 'duplication', 'cohesion'];
            const subLabels = [
                _dashT('dashHealthComplexity'), _dashT('dashHealthCoupling'),
                _dashT('dashHealthDeadCode'),   _dashT('dashHealthDuplication'),
                _dashT('dashHealthCohesion'),
            ];
            container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot" style="background:${col}"></span>${_dashEscape(_dashT('dashHealthTrendTitle'))}</div>
  <div style="display:flex;align-items:baseline;gap:0.5rem;padding:12px 0 8px">
    <div style="font-size:3rem;font-weight:700;color:${col};line-height:1">${s.toFixed(1)}</div>
    <div style="font-size:1rem;opacity:0.45">/ 10</div>
    <div style="font-size:0.78rem;opacity:0.5;margin-left:0.5rem">${_dashEscape(h.date || (h.ts || '').slice(0, 10))}</div>
  </div>
  <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.25rem">
    ${subKeys.map((k, i) => {
        const v = Number(bd[k] || 0);
        const c = _dashHealthColor(v);
        return `<div style="background:var(--surface-elevated);border-radius:6px;padding:6px 10px;min-width:84px">
          <div style="font-size:1.1rem;font-weight:600;color:${c}">${v.toFixed(1)}</div>
          <div style="font-size:0.7rem;opacity:0.55;margin-top:2px">${_dashEscape(subLabels[i])}</div>
        </div>`;
    }).join('')}
  </div>
  <div style="margin-top:1rem;font-size:0.75rem;opacity:0.45">${_dashEscape(_dashT('dashHealthTrendEmpty'))}</div>
</div>`;
            return;
        }

        const recent = history.slice(-30);
        const labels = recent.map(h => h.date || h.ts.slice(0, 10));
        const scores = recent.map(h => Number(h.score || 0));
        const canvasId = 'dash-chart-ht-detail';

        container.innerHTML = `
<div style="display:flex;flex-direction:column;height:100%;gap:0.5rem">
  <div style="flex:1;min-height:0;position:relative"><canvas id="${canvasId}" style="position:absolute;inset:0;width:100%;height:100%"></canvas></div>
</div>`;

        requestAnimationFrame(() => {
            const canvas = document.getElementById(canvasId);
            if (canvas && typeof Chart !== 'undefined') {
                _dashDrawHealthTrendLarge(canvas, recent, labels, scores);
            }
        });
    },
});

function _dashDrawHealthTrendMain(canvas, labels, scores) {
    _dashMkChart(canvas, 'line', {
        labels,
        datasets: [{
            label: _dashT('dashCodeHealthTitle'),
            data: scores,
            borderColor: _dashAccentStop(2),
            backgroundColor: _dashAccentTint(0.15),
            borderWidth: 2.5,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: scores.map(s => _dashHealthColor(s)),
            fill: true,
        }],
    }, {
        plugins: { legend: { display: false } },
        scales: {
            x: { ticks: { maxTicksLimit: 6, maxRotation: 0 } },
            y: { min: 0, max: 10, ticks: { stepSize: 2 } },
        },
    });
}

function _dashDrawHealthTrendLarge(canvas, recent, labels, scores) {
    const subKeys   = ['complexity', 'coupling', 'dead_code', 'duplication', 'cohesion'];
    const subLabels = ['dashHealthComplexity', 'dashHealthCoupling', 'dashHealthDeadCode', 'dashHealthDuplication', 'dashHealthCohesion'];
    const subColors = ['#7ec8e3', '#c57429', '#e05a5a', '#a4b55b', '#9b7fe8'];

    const subDatasets = subKeys.map((key, i) => ({
        label: _dashT(subLabels[i]),
        data: recent.map(h => Number((h.breakdown || {})[key] || 0)),
        borderColor: subColors[i],
        backgroundColor: 'transparent',
        borderWidth: 1.2,
        borderDash: [4, 3],
        tension: 0.3,
        pointRadius: 2,
        fill: false,
    }));

    _dashMkChart(canvas, 'line', {
        labels,
        datasets: [
            {
                label: _dashT('dashCodeHealthTitle'),
                data: scores,
                borderColor: _dashAccentStop(2),
                backgroundColor: _dashAccentTint(0.12),
                borderWidth: 3,
                tension: 0.3,
                pointRadius: 4,
                pointBackgroundColor: scores.map(s => _dashHealthColor(s)),
                fill: true,
                order: 0,
            },
            ...subDatasets,
        ],
    }, {
        plugins: {
            legend: {
                display: true,
                position: 'bottom',
                labels: { boxWidth: 12, font: { size: 10 }, padding: 8 },
            },
        },
        scales: {
            x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } },
            y: { min: 0, max: 10, ticks: { stepSize: 2 } },
        },
    });
}
