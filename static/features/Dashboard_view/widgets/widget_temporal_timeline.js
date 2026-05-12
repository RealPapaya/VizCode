// @module Dashboard_view/widgets/widget_temporal_timeline
// Phase 2 — Code Churn Timeline. Line chart of commits per week with
// secondary additions/deletions overlay. Toggleable to bar chart.

const _DASH_TIMELINE_KEY = 'temporal_timeline';
const _DASH_TIMELINE_TYPES = ['line', 'bar'];
const _DASH_TIMELINE_DEFAULT = 'line';

function _dashRenderTemporalTimeline(container, stats) {
    if (!container) return;

    const buckets = stats.churn_timeline || [];

    container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashTemporalChurn'))}
  ${_dashChartToggleHTML(_DASH_TIMELINE_KEY, _DASH_TIMELINE_TYPES, _DASH_TIMELINE_DEFAULT)}
</div>
<div class="dash-chart-wrap"><canvas id="dash-chart-timeline"></canvas></div>`;

    if (!buckets.length) {
        const wrap = container.querySelector('.dash-chart-wrap');
        if (wrap) wrap.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashTemporalEmpty'))}</div>`;
        return;
    }

    _dashRegisterChartSwitch(_DASH_TIMELINE_KEY, () =>
        _dashRenderTemporalTimeline(container, stats)
    );

    _dashDrawTimelineChart(buckets);
}

function _dashDrawTimelineChart(buckets) {
    const canvas = document.getElementById('dash-chart-timeline');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels    = buckets.map(b => b.week_start);
    const commits   = buckets.map(b => b.commits);
    const additions = buckets.map(b => b.additions);
    const deletions = buckets.map(b => -Math.abs(b.deletions));   // negative for visual diff

    const type = _dashChartCurrentType(_DASH_TIMELINE_KEY, _DASH_TIMELINE_DEFAULT);

    _dashMkChart(canvas, type, {
        labels,
        datasets: [
            {
                label: _dashT('dashTemporalCommits'),
                data:  commits,
                yAxisID: 'yCommits',
                borderColor:     _dashAccentTint(1.0),
                backgroundColor: _dashAccentTint(0.25),
                borderWidth: 2,
                tension: 0.25,
                pointRadius: 3,
                fill: type === 'line',
            },
            {
                label: _dashT('dashTemporalAdditions'),
                data:  additions,
                yAxisID: 'yLines',
                borderColor:     _dashAccentTint(0.55),
                backgroundColor: _dashAccentTint(0.12),
                borderWidth: 1.5,
                tension: 0.25,
                pointRadius: 2,
                fill: false,
                hidden: false,
            },
            {
                label: _dashT('dashTemporalDeletions'),
                data:  deletions,
                yAxisID: 'yLines',
                borderColor:     _dashMutedTint(0.7),
                backgroundColor: _dashMutedTint(0.15),
                borderWidth: 1.5,
                tension: 0.25,
                pointRadius: 2,
                fill: false,
                hidden: false,
            },
        ],
    }, {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_evt, elements) => {
            if (!elements || !elements.length) return;
            const idx = elements[0].index;
            const week = labels[idx];
            _dashOpenFileGroupDrilldown(`Files changed week ${week}`, (DATA.stats.files_by_week || {})[week] || [], {
                meta: f => `${f.count || 0} commits`,
            });
        },
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { position: 'top', labels: { boxWidth: 10, padding: 10 } },
        },
        scales: {
            x: {
                grid:  { color: _dashBorderTint(0.6) },
                ticks: { maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            },
            yCommits: {
                position: 'left',
                grid:  { color: _dashBorderTint(0.6) },
                ticks: { color: _dashAccentTint(1.0) },
                title: { display: true, text: _dashT('dashTemporalCommits'), color: _dashAccentTint(1.0) },
                beginAtZero: true,
            },
            yLines: {
                position: 'right',
                grid:  { display: false },
                title: { display: true, text: '+/-' },
            },
        },
    });
}
