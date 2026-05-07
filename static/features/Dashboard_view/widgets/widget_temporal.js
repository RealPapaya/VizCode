// @module Dashboard_view/widgets/widget_temporal
// Phase 2 orchestrator. Lays out the temporal sub-cards and delegates
// rendering to the per-card sub-widgets. Returns early when there is no git
// history or no commits in the analysed window.
//
// The day-range pills (30 / 90 / 180 / All) filter commit_activity_daily and
// churn_timeline client-side — no server round-trip needed.

let _dashTemporalDays = 180; // currently-selected window (0 = show all)

function _dashRenderTemporal(container, stats) {
    if (!container) return;
    container.innerHTML = '';
    if (!stats.has_git_history) return;
    if (!stats.commits_analyzed) return;

    _dashTemporalDays = Math.min(Number(stats.window_days || 180), 180);

    container.innerHTML = _dashTemporalShell(stats);

    // Attach pill click handlers
    container.querySelectorAll('.dash-temporal-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            const days = Number(btn.dataset.days);
            _dashTemporalDays = days;
            container.querySelectorAll('.dash-temporal-pill').forEach(b =>
                b.classList.toggle('active', b === btn)
            );
            _dashTemporalRefreshSubs(container, stats);
        });
    });

    _dashTemporalRefreshSubs(container, stats);
}

// Build filtered copies of the daily / weekly arrays based on _dashTemporalDays.
function _dashTemporalFilteredStats(stats) {
    if (!_dashTemporalDays) return stats; // 0 = All

    const cutoffDate = (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - _dashTemporalDays);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    })();

    const daily  = (stats.commit_activity_daily || []).filter(r => (r.date || '') >= cutoffDate);
    const weekly = (stats.churn_timeline || []).filter(r => (r.week_start || '') >= cutoffDate);

    return Object.assign({}, stats, {
        commit_activity_daily: daily,
        churn_timeline:        weekly,
        // Pass overridden window bounds for the heatmap model
        window_start:  cutoffDate,
        window_end:    stats.window_end || stats.period_end,
        window_days:   _dashTemporalDays,
    });
}

function _dashTemporalRefreshSubs(container, stats) {
    const filtered = _dashTemporalFilteredStats(stats);
    _dashRenderTemporalHotspot(document.getElementById('dash-temporal-hotspot'), stats);
    _dashRenderTemporalCoupling(document.getElementById('dash-temporal-coupling'), stats);
    _dashRenderTemporalHeatmap(document.getElementById('dash-temporal-heatmap'), filtered);
    _dashRenderTemporalTimeline(document.getElementById('dash-temporal-timeline'), filtered);
    // Authors use unfiltered stats — counts must match commits_analyzed.
    _dashRenderTemporalAuthors(document.getElementById('dash-temporal-authors'), stats);
}

function _dashTemporalShell(stats) {
    const maxDays = Number(stats.window_days || 180);
    const pills = [30, 90, 180]
        .filter(d => d <= maxDays)
        .concat(0)  // 0 = All
        .map(d => {
            const label = d ? `${d}d` : _dashEscape(_dashT('dashTemporalAll') || 'All');
            const active = (d === _dashTemporalDays) ? ' active' : '';
            return `<button class="dash-temporal-pill${active}" data-days="${d}">${label}</button>`;
        }).join('');

    return `
<div class="dash-temporal-period">
  <span class="dash-temporal-period-label">${_dashEscape(_dashT('dashTemporalTitle'))}</span>
  <span class="dash-temporal-period-range">
    ${_dashEscape(stats.period_start)} &rarr; ${_dashEscape(stats.period_end)}
  </span>
  <span class="dash-temporal-period-meta">
    ${stats.commits_analyzed} ${_dashEscape(_dashT('dashTemporalCommits'))} &middot; ${stats.window_days}d
  </span>
  <span class="dash-temporal-pills">${pills}</span>
</div>
<div class="dash-grid dash-grid-2 dash-temporal-grid">
  <div class="dash-card" id="dash-temporal-hotspot"></div>
  <div class="dash-card" id="dash-temporal-coupling"></div>
  <div class="dash-card" id="dash-temporal-heatmap"></div>
  <div class="dash-card" id="dash-temporal-timeline"></div>
  <div class="dash-card" id="dash-temporal-authors"></div>
</div>`;
}
