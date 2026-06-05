// @module Dashboard_view/widgets/widget_temporal_heatmap
// GitHub-style daily commit activity heatmap rendered with SVG.

// Heatmap colour ramp comes from accent alpha steps at render time —
// see _dashHeatmapColors() below. Matches DASHBOARD_DESIGN_SPEC.md §4 row 5.

const _DASH_HEATMAP_MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Index 0 = empty cell (surface-elevated), 1..5 = accent at increasing alpha.
function _dashHeatmapColors() {
    return [
        _dashCssVar('--surface-elevated', '#22241f'),
        _dashAccentTint(0.18),
        _dashAccentTint(0.36),
        _dashAccentTint(0.58),
        _dashAccentTint(0.80),
        _dashAccentTint(1.00),
    ];
}

function _dashRenderTemporalHeatmap(container, stats) {
    if (!container) return;

    const rows = stats.commit_activity_daily || [];
    const isReport = container.classList.contains('dash-report-section');
    container.innerHTML = isReport ? `
<div class="dash-report-section-head">
  <div class="dash-report-section-title">${_dashEscape(_dashT('dashTemporalHeatmap'))}</div>
</div>
<div class="dash-report-section-body"><div class="dash-temporal-heatmap-body" id="dash-temporal-heatmap-body"></div></div>` : `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashTemporalHeatmap'))}
</div>
<div class="dash-temporal-heatmap-body" id="dash-temporal-heatmap-body"></div>`;

    const host = container.querySelector('#dash-temporal-heatmap-body');
    if (!host) return;
    if (!rows.length) {
        host.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashTemporalEmpty'))}</div>`;
        return;
    }

    const model = _dashBuildTemporalHeatmapModel(rows, stats);
    if (!model) {
        host.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashTemporalEmpty'))}</div>`;
        return;
    }

    const palette = _dashHeatmapColors();
    host.innerHTML = `
${_dashTemporalHeatmapSVG(model)}
<div class="dash-temporal-heatmap-legend">
  <span>${_dashEscape(_dashT('dashTemporalLess'))}</span>
  ${palette.slice(1).map(c =>
        `<span class="dash-temporal-heatmap-swatch" style="background:${c}"></span>`
    ).join('')}
  <span>${_dashEscape(_dashT('dashTemporalMore'))}</span>
  <span class="dash-temporal-heatmap-summary">
    ${_dashFmtNum(model.totalCommits)} ${_dashEscape(_dashT('dashTemporalCommits'))} / max ${model.maxCommits}
  </span>
</div>`;
    _dashBindTemporalHeatmapTooltips(host);
}

function _dashBuildTemporalHeatmapModel(rows, stats) {
    // dayMap key = 'YYYY-MM-DD' string from git log (already UTC-agnostic ISO date)
    const dayMap = new Map();
    let maxCommits = 0;
    let totalCommits = 0;

    rows.forEach(row => {
        const date = String(row.date || '').trim();
        if (!_dashHeatmapValidISO(date)) return;
        const commits = Math.max(0, Number(row.commits || 0));
        const additions = Math.max(0, Number(row.additions || 0));
        const deletions = Math.max(0, Number(row.deletions || 0));
        const prev = dayMap.get(date) || { commits: 0, additions: 0, deletions: 0 };
        const next = {
            commits: prev.commits + commits,
            additions: prev.additions + additions,
            deletions: prev.deletions + deletions,
        };
        dayMap.set(date, next);
        maxCommits = Math.max(maxCommits, next.commits);
    });

    dayMap.forEach(v => { totalCommits += v.commits; });

    const sortedDates = Array.from(dayMap.keys()).sort();
    if (!sortedDates.length) return null;

    // Determine visible window: prefer stats metadata, fall back to data extent
    let endStr = stats.window_end || stats.period_end || sortedDates[sortedDates.length - 1];
    let startStr = stats.window_start || stats.period_start || sortedDates[0];

    // If window_end is missing, compute from today
    if (!endStr) {
        const today = new Date();
        endStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
    }
    // If window_start is missing, use window_days fallback
    if (!startStr) {
        const span = Math.max(1, Number(stats.window_days || 180));
        const endD = _dashHeatmapParseISO(endStr);
        if (endD) startStr = _dashHeatmapISOStr(_dashHeatmapAddDays(endD, -span));
    }

    const start = _dashHeatmapParseISO(startStr);
    const end = _dashHeatmapParseISO(endStr);
    if (!start || !end || start > end) return null;

    const gridStart = _dashHeatmapWeekStart(start);
    const gridEnd = _dashHeatmapWeekEnd(end);
    const totalDays = Math.round((gridEnd - gridStart) / 86400000) + 1;
    const weeks = Math.max(1, Math.ceil(totalDays / 7));

    return { dayMap, start, end, gridStart, totalDays, weeks, maxCommits, totalCommits };
}

function _dashTemporalHeatmapSVG(model) {
    const cell = 10;
    const gap = 3;
    const labelW = 24;
    const monthH = 16;
    const gridW = model.weeks * (cell + gap) - gap;
    const gridH = 7 * (cell + gap) - gap;
    const width = labelW + gridW;
    const height = monthH + gridH + 3;
    const cells = [];
    const labels = [];

    labels.push(_dashHeatmapDayLabel('Mon', 0, labelW, monthH, cell, gap));
    labels.push(_dashHeatmapDayLabel('Wed', 2, labelW, monthH, cell, gap));
    labels.push(_dashHeatmapDayLabel('Fri', 4, labelW, monthH, cell, gap));

    let lastMonthKey = '';
    for (let week = 0; week < model.weeks; week += 1) {
        const weekDate = _dashHeatmapAddDays(model.gridStart, week * 7);
        const labelDate = weekDate < model.start ? model.start : weekDate;
        const weekEnd = _dashHeatmapAddDays(weekDate, 6);
        if (weekEnd < model.start || weekDate > model.end) continue;

        const monthKey = `${labelDate.getUTCFullYear()}-${labelDate.getUTCMonth()}`;
        if (monthKey !== lastMonthKey) {
            const x = labelW + week * (cell + gap);
            labels.push(`<text class="dash-temporal-heatmap-month" x="${x}" y="10">${_DASH_HEATMAP_MONTHS[labelDate.getUTCMonth()]}</text>`);
            lastMonthKey = monthKey;
        }
    }

    for (let i = 0; i < model.totalDays; i += 1) {
        const date = _dashHeatmapAddDays(model.gridStart, i);
        if (date < model.start || date > model.end) continue;

        // Use UTC-based ISO string that matches dayMap keys from git log
        const iso = _dashHeatmapISOStr(date);
        const info = model.dayMap.get(iso) || { commits: 0, additions: 0, deletions: 0 };
        const week = Math.floor(i / 7);
        const day = _dashHeatmapDayIndex(date);
        const x = labelW + week * (cell + gap);
        const y = monthH + day * (cell + gap);
        const fill = _dashHeatmapColor(info.commits, model.maxCommits);
        const commitsLabel = `${info.commits} ${_dashT('dashTemporalCommits')}`;

        cells.push(`
<rect class="dash-temporal-heatmap-cell${info.commits ? ' active' : ''}"
      x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2"
      fill="${fill}"
      data-date="${_dashEscape(iso)}"
      data-commits="${info.commits}"
      data-additions="${info.additions}"
      data-deletions="${info.deletions}"
      ${info.commits ? `data-clickable="true" onclick="_dashOpenCommitDayDrilldown(${_dashJson(iso)})"` : ''}
      aria-label="${_dashEscape(`${iso}: ${commitsLabel}, +${info.additions} / -${info.deletions}`)}"></rect>`);
    }

    return `
<svg class="dash-temporal-heatmap-svg"
     viewBox="0 0 ${width} ${height}"
     role="img"
     aria-label="${_dashEscape(_dashT('dashTemporalHeatmap'))}"
     preserveAspectRatio="xMinYMin meet">
  ${labels.join('')}
  ${cells.join('')}
</svg>`;
}

function _dashBindTemporalHeatmapTooltips(host) {
    if (!host || typeof _dashChartTooltipEl !== 'function') return;
    host.querySelectorAll('.dash-temporal-heatmap-cell').forEach(cell => {
        cell.addEventListener('mousemove', e => _dashShowTemporalHeatmapTooltip(e, cell));
        cell.addEventListener('mouseleave', () => {
            if (typeof _dashHideChartTooltip === 'function') _dashHideChartTooltip();
        });
    });
}

function _dashShowTemporalHeatmapTooltip(evt, cell) {
    const el = _dashChartTooltipEl();
    if (!el) return;
    const commits = Number(cell.dataset.commits || 0);
    const additions = Number(cell.dataset.additions || 0);
    const deletions = Number(cell.dataset.deletions || 0);
    const date = cell.dataset.date || '';
    const commitLabel = commits === 1 ? 'commit' : 'commits';

    el.innerHTML = `
<div class="dash-chart-tip-row">
  <span class="dash-chart-tip-swatch" style="background:${_dashEscape(cell.getAttribute('fill') || 'var(--accent)')}"></span>
  <span class="dash-chart-tip-label">${_dashEscape(date)}</span>
</div>
<div class="dash-chart-tip-value">${_dashFmtNum(commits)} ${commitLabel}</div>
<div class="dash-chart-tip-delta">
  <span class="dash-chart-tip-add">+${_dashFmtNum(additions)}</span>
  <span class="dash-chart-tip-del">-${_dashFmtNum(deletions)}</span>
</div>`;

    const offset = 14;
    const pad = 8;
    let left = evt.clientX + offset;
    let top = evt.clientY + offset;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.classList.add('visible');

    const rect = el.getBoundingClientRect();
    if (left + rect.width + pad > window.innerWidth) left = evt.clientX - rect.width - offset;
    if (top + rect.height + pad > window.innerHeight) top = evt.clientY - rect.height - offset;
    el.style.left = `${Math.max(pad, left)}px`;
    el.style.top = `${Math.max(pad, top)}px`;
}

function _dashHeatmapDayLabel(text, day, labelW, monthH, cell, gap) {
    const y = monthH + day * (cell + gap) + cell - 1;
    return `<text class="dash-temporal-heatmap-label" x="${labelW - 5}" y="${y}" text-anchor="end">${text}</text>`;
}

function _dashHeatmapColor(commits, maxCommits) {
    const palette = _dashHeatmapColors();
    if (!commits) return palette[0];
    if (commits <= 1) return palette[1];
    if (!maxCommits) return palette[1];
    const level = Math.max(2, Math.min(5, Math.ceil((commits / maxCommits) * 5)));
    return palette[level];
}

function _dashHeatmapParseISO(value) {
    if (!value || typeof value !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) return null;
    // Construct as UTC midnight — consistent with _dashHeatmapISOStr
    const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return Number.isNaN(date.getTime()) ? null : date;
}

// Check date string validity without constructing a Date object
function _dashHeatmapValidISO(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

// Canonical ISO string from a Date object — always uses UTC fields
// to stay consistent with Date objects built via Date.UTC()
function _dashHeatmapISOStr(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function _dashHeatmapAddDays(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

function _dashHeatmapDayIndex(date) {
    return (date.getUTCDay() + 6) % 7;
}

function _dashHeatmapWeekStart(date) {
    return _dashHeatmapAddDays(date, -_dashHeatmapDayIndex(date));
}

function _dashHeatmapWeekEnd(date) {
    return _dashHeatmapAddDays(date, 6 - _dashHeatmapDayIndex(date));
}

function _dashHeatmapAppendStats(container, stats) {
    const rows = stats.commit_activity_daily || [];
    if (!rows.length) return;
    const model = _dashBuildTemporalHeatmapModel(rows, stats);
    if (!model) return;

    const activeDays = Array.from(model.dayMap.values()).filter(d => d.commits > 0).length;

    const weekMap = new Map();
    model.dayMap.forEach((v, dateStr) => {
        const d = _dashHeatmapParseISO(dateStr);
        if (!d) return;
        const ws = _dashHeatmapISOStr(_dashHeatmapWeekStart(d));
        weekMap.set(ws, (weekMap.get(ws) || 0) + v.commits);
    });
    const maxWeek = weekMap.size ? Math.max(...weekMap.values()) : 0;

    const statsEl = document.createElement('div');
    statsEl.className = 'dash-temporal-heatmap-stats';
    statsEl.innerHTML = `
<div class="dash-temporal-heatmap-stat">
  <div class="dash-temporal-heatmap-stat-val">${_dashFmtNum(model.totalCommits)}</div>
  <div class="dash-temporal-heatmap-stat-label">Commits</div>
</div>
<div class="dash-temporal-heatmap-stat">
  <div class="dash-temporal-heatmap-stat-val">${model.maxCommits}</div>
  <div class="dash-temporal-heatmap-stat-label">Peak Day</div>
</div>
<div class="dash-temporal-heatmap-stat">
  <div class="dash-temporal-heatmap-stat-val">${activeDays}</div>
  <div class="dash-temporal-heatmap-stat-label">Active Days</div>
</div>
<div class="dash-temporal-heatmap-stat">
  <div class="dash-temporal-heatmap-stat-val">${_dashFmtNum(maxWeek)}</div>
  <div class="dash-temporal-heatmap-stat-label">Peak Week</div>
</div>`;
    container.appendChild(statsEl);
}

function _dashHeatmapAppendChurnFiles(container, stats) {
    const rows = (stats.file_churn || []).slice(0, 5);
    if (!rows.length) return;
    const max = rows[0].commits || 1;
    const wrap = document.createElement('div');
    wrap.className = 'dash-commit-activity-files';
    const isReport = container.classList.contains('dash-report-section');
    wrap.innerHTML = `
${isReport ? '<div class="dash-report-section-title">Most Changed Files</div>' : '<div class="dash-card-title"><span class="dash-card-title-dot"></span>Most Changed Files</div>'}
<div class="${isReport ? 'dash-report-list' : 'dash-list'}">
${rows.map((row, i) => {
        const file = String(row.file || '');
        const short = file.split('/').pop();
        return `
  <div class="dash-list-row" data-clickable="true" data-tip="${_dashEscape(file)}"
       onclick="_dashGoToGraphFile(${_dashJson(file)}, null)">
    <span class="dash-list-rank">${i + 1}</span>
    <span class="dash-list-name">${_dashEscape(short)}<span class="dash-list-meta">${_dashEscape(file)}</span></span>
    <div class="dash-list-bar-track"><div class="dash-list-bar-fill" style="width:${Math.round((row.commits || 0) / max * 100)}%"></div></div>
    <span class="dash-list-val">${_dashFmtNum(row.commits || 0)}</span>
  </div>`;
    }).join('')}
</div>`;
    container.appendChild(wrap);
}

function _dashCommitActivityModel(stats) {
    const rows = stats.commit_activity_daily || [];
    const model = rows.length ? _dashBuildTemporalHeatmapModel(rows, stats) : null;
    const dayValues = model ? Array.from(model.dayMap.entries()) : [];
    const activeDays = dayValues.filter(([, d]) => d.commits > 0).length;
    const peak = dayValues.reduce((best, [date, d]) => (
        d.commits > Number(best.commits || 0)
            ? { date, commits: d.commits, additions: d.additions, deletions: d.deletions }
            : best
    ), {});

    const weekMap = new Map();
    if (model) {
        model.dayMap.forEach((v, dateStr) => {
            const d = _dashHeatmapParseISO(dateStr);
            if (!d) return;
            const ws = _dashHeatmapISOStr(_dashHeatmapWeekStart(d));
            weekMap.set(ws, (weekMap.get(ws) || 0) + v.commits);
        });
    }
    const peakWeek = weekMap.size ? Math.max(...weekMap.values()) : 0;
    return { rows, model, activeDays, peak, peakWeek };
}

function _dashCommitActivityFileRowsHTML(stats, limit, compact) {
    const rows = (stats.file_churn || []).slice(0, limit);
    if (!rows.length) return '<div class="dash-empty">No changed files</div>';
    const max = rows.reduce((m, row) => Math.max(m, Number(row.commits || 0)), 1);
    return rows.map((row, i) => {
        const file = String(row.file || '');
        const short = file.split('/').pop() || file;
        const commits = Number(row.commits || 0);
        const pct = Math.max(4, Math.round((commits / max) * 100));
        const meta = compact
            ? `${_dashFmtNum(commits)} ${_dashEscape(_dashT('dashTemporalCommits'))}`
            : `${_dashEscape(file)} &middot; +${_dashFmtNum(row.additions || 0)} / -${_dashFmtNum(row.deletions || 0)}`;
        return `
  <div class="dash-commit-activity-detail-file" data-clickable="true" data-tip="${_dashEscape(file)}"
       onclick="_dashGoToGraphFile(${_dashJson(file)}, null)">
    <span class="dash-commit-activity-detail-file__rank">${i + 1}</span>
    <span class="dash-commit-activity-detail-file__name">${_dashEscape(short)}<small>${meta}</small></span>
    <div class="dash-commit-activity-detail-file__track"><i style="width:${pct}%"></i></div>
    <span class="dash-commit-activity-detail-file__value">${_dashFmtNum(commits)}</span>
  </div>`;
    }).join('');
}

function _dashCommitActivityStatsHTML(model) {
    const total = model.model ? model.model.totalCommits : 0;
    return `
<div class="dash-commit-activity-detail-stats">
  <div><span>${_dashFmtExactNum(total)}</span><small>Commits</small></div>
  <div><span>${_dashFmtExactNum(model.activeDays)}</span><small>Active days</small></div>
  <div><span>${_dashFmtExactNum(model.peak.commits || 0)}</span><small>Peak day</small></div>
  <div><span>${_dashFmtExactNum(model.peakWeek)}</span><small>Peak week</small></div>
</div>`;
}

function _dashCommitActivityHeatmapHTML(model) {
    if (!model.model) return `<div class="dash-empty">${_dashEscape(_dashT('dashTemporalEmpty'))}</div>`;
    const palette = _dashHeatmapColors();
    return `
${_dashTemporalHeatmapSVG(model.model)}
<div class="dash-temporal-heatmap-legend">
  <span>${_dashEscape(_dashT('dashTemporalLess'))}</span>
  ${palette.slice(1).map(c => `<span class="dash-temporal-heatmap-swatch" style="background:${c}"></span>`).join('')}
  <span>${_dashEscape(_dashT('dashTemporalMore'))}</span>
  <span class="dash-temporal-heatmap-summary">
    ${_dashFmtNum(model.model.totalCommits)} ${_dashEscape(_dashT('dashTemporalCommits'))} / max ${model.model.maxCommits}
  </span>
</div>`;
}

const _DASH_COMMIT_DRILL_ID = 'dash-commit-day-drilldown-overlay';
let _dashCommitDrillEscBound = false;
let _dashCommitHealthPollTimer = null;

function _dashOpenCommitDayDrilldown(date) {
    const stats = (window.DATA && DATA.stats) || {};
    const day = String(date || '').trim();
    let commits = _dashCommitRowsForDay(day, stats);
    if (!commits.length && !stats._commitHistoryFetched && !stats._commitHistoryFetching) {
        return _dashFetchCommitHistory(day);
    }
    if (!commits.length) commits = _dashAggregateCommitRowsForDay(day, stats);

    _dashCloseCommitDayDrilldown();
    if (typeof _dashCloseGroupDrilldown === 'function') _dashCloseGroupDrilldown();

    const impacts = commits.map(c => _dashCommitHealthImpact(c, stats, commits.length));
    const exactHealth = impacts.filter(i => i.available && i.matchType === 'commit').length;
    const anyMissing = impacts.some(i => !i.available);
    const needsCommitRows = commits.some(c => c.aggregate);
    const totalAdd = commits.reduce((sum, c) => sum + Number(c.additions || 0), 0);
    const totalDel = commits.reduce((sum, c) => sum + Number(c.deletions || 0), 0);
    const totalFiles = commits.reduce((sum, c) => sum + Number(c.file_count || (c.files || []).length || 0), 0);

    const overlay = document.createElement('div');
    overlay.id = _DASH_COMMIT_DRILL_ID;
    overlay.className = 'dash-commit-drilldown-overlay';
    overlay.innerHTML = `
<div class="dash-commit-drilldown-panel" role="dialog" aria-modal="true" aria-label="Commits on ${_dashEscape(day)}">
  <div class="dash-commit-drilldown-head">
    <div>
      <div class="dash-detail-head-label">Commit Activity</div>
      <div class="dash-detail-head-name">${_dashEscape(day)}<span class="dash-list-meta dash-list-meta--inline"> ${_dashFmtExactNum(commits.length)} commits</span></div>
    </div>
    <button class="dash-detail-close" type="button" data-close-commit-day aria-label="Close">x</button>
  </div>
  <div class="dash-commit-drilldown-body">
    <div class="dash-commit-drill-summary-strip">
      <div><span>${_dashFmtExactNum(commits.length)}</span><small>commits</small></div>
      <div><span>${_dashFmtExactNum(totalFiles)}</span><small>files touched</small></div>
      <div><span>+${_dashFmtExactNum(totalAdd)}</span><small>additions</small></div>
      <div><span>-${_dashFmtExactNum(totalDel)}</span><small>deletions</small></div>
      <div><span>${_dashFmtExactNum(exactHealth)}</span><small>health snapshots</small></div>
    </div>
    ${(needsCommitRows || anyMissing) ? _dashCommitHealthBackfillCallout(day, { needsCommitRows, needsHealth: anyMissing }) : ''}
    <div class="dash-commit-drill-list">
      ${commits.map((commit, i) => _dashCommitDrillRowHTML(commit, impacts[i], i, commits.length)).join('')}
    </div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
        if (e.target === overlay || e.target.closest('[data-close-commit-day]')) {
            _dashCloseCommitDayDrilldown();
        }
    });
    overlay.querySelector('[data-commit-history-refresh]')
        ?.addEventListener('click', e => _dashFetchCommitHistory(day, e.currentTarget));
    overlay.querySelector('[data-commit-health-backfill]')
        ?.addEventListener('click', e => _dashCommitHealthBackfill(e.currentTarget, day));
    if (!_dashCommitDrillEscBound) {
        document.addEventListener('keydown', _dashCommitDrillKeyHandler);
        _dashCommitDrillEscBound = true;
    }
}

function _dashCloseCommitDayDrilldown() {
    document.getElementById(_DASH_COMMIT_DRILL_ID)?.remove();
    if (_dashCommitDrillEscBound) {
        document.removeEventListener('keydown', _dashCommitDrillKeyHandler);
        _dashCommitDrillEscBound = false;
    }
}

function _dashCommitDrillKeyHandler(e) {
    if (e.key === 'Escape') {
        e.stopPropagation();
        _dashCloseCommitDayDrilldown();
    }
}

function _dashCommitRowsForDay(day, stats) {
    return ((stats.commits_by_day || {})[day] || []).filter(Boolean);
}

function _dashAggregateCommitRowsForDay(day, stats) {
    const dayFiles = ((stats.files_by_day || {})[day] || []).filter(Boolean);
    const activity = ((stats.commit_activity_daily || [])).find(r => String(r.date || '') === day) || {};
    const commits = Math.max(0, Number(activity.commits || 0));
    if (!dayFiles.length && !commits) return [];
    return [{
        sha: '',
        short_sha: 'day total',
        date: day,
        author: stats._commitHistoryRefreshFailed
            ? 'Git history refresh failed'
            : 'Refresh analysis for per-commit rows',
        additions: Number(activity.additions || 0),
        deletions: Number(activity.deletions || 0),
        file_count: dayFiles.length,
        aggregate: true,
        aggregate_commits: commits,
        files: dayFiles.map(f => ({
            file: f.file || f.path || '',
            additions: 0,
            deletions: 0,
            count: f.count,
        })),
    }];
}

function _dashCommitHealthBackfillCallout(day, opts) {
    const needsCommitRows = !!(opts && opts.needsCommitRows);
    const needsHealth = !!(opts && opts.needsHealth);
    const history = ((window.DATA && DATA.stats && DATA.stats.health_history) || []);
    const note = needsCommitRows
        ? 'This loaded dashboard does not have per-commit file rows yet.'
        : history.length
        ? 'Some commits do not have an exact health snapshot yet.'
        : 'No commit health snapshots have been recorded yet.';
    const hint = needsCommitRows
        ? 'Refresh git history or re-run analysis to list individual commits.'
        : 'Backfill will analyze commits in this git window.';
    return `
<div class="dash-commit-health-callout">
  <div>
    <strong>${_dashEscape(needsCommitRows ? 'Commit rows need fresh git history' : 'Code Health delta needs commit snapshots')}</strong>
    <span>${_dashEscape(note)} ${_dashEscape(hint)}</span>
  </div>
  <div class="dash-commit-health-callout__actions">
    ${needsCommitRows ? `<button class="dash-btn dash-btn--ghost" type="button" data-commit-history-refresh data-date="${_dashEscape(day)}">Refresh git history</button>` : ''}
    ${needsHealth ? `<button class="dash-btn dash-btn--ghost" type="button" data-commit-health-backfill data-date="${_dashEscape(day)}">Backfill commit health</button>` : ''}
  </div>
</div>`;
}

function _dashCommitDrillRowHTML(commit, impact, index, commitCount) {
    const sha = commit.aggregate
        ? 'day total'
        : (String(commit.short_sha || commit.sha || '').slice(0, 8) || 'unknown');
    const author = String(commit.author || '').trim();
    const files = commit.files || [];
    const fileCount = Number(commit.file_count || files.length || 0);
    const add = Number(commit.additions || 0);
    const del = Number(commit.deletions || 0);
    const metaBits = commit.aggregate
        ? [
            `${_dashFmtExactNum(commit.aggregate_commits || commitCount)} commit${Number(commit.aggregate_commits || commitCount) === 1 ? '' : 's'} aggregated`,
            `${_dashFmtExactNum(fileCount)} file${fileCount === 1 ? '' : 's'}`,
            author,
        ].filter(Boolean)
        : [
            author,
            `${_dashFmtExactNum(fileCount)} file${fileCount === 1 ? '' : 's'}`,
        ].filter(Boolean);
    return `
<details class="dash-commit-drill-row"${commitCount === 1 ? ' open' : ''}>
  <summary class="dash-commit-drill-summary">
    <span class="dash-commit-drill-rank">${index + 1}</span>
    <span class="dash-commit-drill-identity">
      <b>${_dashEscape(sha)}</b>
      <small>${_dashEscape(metaBits.join(' / '))}</small>
    </span>
    ${_dashCommitHealthSummaryHTML(impact)}
    <span class="dash-commit-drill-churn"><b>+${_dashFmtExactNum(add)}</b><b>-${_dashFmtExactNum(del)}</b></span>
  </summary>
  <div class="dash-commit-drill-details">
    ${_dashCommitHealthBreakdownHTML(impact)}
    <div class="dash-commit-drill-files">${_dashCommitFilesHTML(commit)}</div>
  </div>
</details>`;
}

function _dashCommitFilesHTML(commit) {
    const files = commit.files || [];
    const fileCount = Number(commit.file_count || files.length || 0);
    if (!files.length) {
        return `<div class="dash-empty">No changed files in the current tree</div>`;
    }
    const rows = files.map((row, i) => {
        const file = String(row.file || row.path || '').replace(/\\/g, '/');
        const short = file.split('/').pop() || file;
        const add = Number(row.additions || row.add || 0);
        const del = Number(row.deletions || row.del || 0);
        const meta = row.count != null ? `${file} / ${row.count} commits` : file;
        return `
<div class="dash-commit-file-row" data-clickable="true" data-tip="${_dashEscape(file)}"
     onclick="_dashGoToGraphFile(${_dashJson(file)}, null)">
  <span class="dash-commit-file-row__rank">${i + 1}</span>
  <span class="dash-commit-file-row__name">${_dashEscape(short)}<small>${_dashEscape(meta)}</small></span>
  <span class="dash-commit-file-row__delta"><b>+${_dashFmtExactNum(add)}</b><b>-${_dashFmtExactNum(del)}</b></span>
</div>`;
    }).join('');
    const capped = commit.files_capped
        ? `<div class="dash-commit-file-row__note">Showing ${_dashFmtExactNum(files.length)} of ${_dashFmtExactNum(fileCount)} changed files.</div>`
        : '';
    return rows + capped;
}

function _dashCommitHealthEntries(stats) {
    return ((stats && stats.health_history) || [])
        .filter(e => e && e.score != null)
        .slice()
        .sort((a, b) => {
            const ak = `${a.date || (a.ts || '').slice(0, 10)}|${a.ts || ''}|${a.commit || ''}`;
            const bk = `${b.date || (b.ts || '').slice(0, 10)}|${b.ts || ''}|${b.commit || ''}`;
            return ak.localeCompare(bk);
        });
}

function _dashCommitHealthImpact(commit, stats, dayCommitCount) {
    const entries = _dashCommitHealthEntries(stats);
    if (!entries.length) return { available: false };
    let idx = entries.findIndex(e => _dashCommitEntryMatches(e, commit));
    let matchType = 'commit';
    if (idx < 0 && (dayCommitCount === 1 || commit.aggregate)) {
        const date = String(commit.date || '').slice(0, 10);
        const dateMatches = entries
            .map((entry, i) => ({ entry, i }))
            .filter(({ entry }) => (entry.date || (entry.ts || '').slice(0, 10)) === date);
        if (dateMatches.length === 1) {
            idx = dateMatches[0].i;
            matchType = 'date';
        }
    }
    if (idx < 0) return { available: false };

    const entry = entries[idx];
    const prev = idx > 0 ? entries[idx - 1] : null;
    const score = Number(entry.score || 0);
    const prevScore = prev ? Number(prev.score || 0) : null;
    const breakdown = {};
    _dashCommitHealthKeys().forEach(key => {
        const after = Number((entry.breakdown || {})[key] || 0);
        const before = prev ? Number((prev.breakdown || {})[key] || 0) : null;
        breakdown[key] = {
            before,
            after,
            delta: before == null ? null : after - before,
        };
    });
    return {
        available: true,
        matchType,
        entry,
        prev,
        score,
        prevScore,
        delta: prevScore == null ? null : score - prevScore,
        breakdown,
    };
}

function _dashCommitEntryMatches(entry, commit) {
    const sha = String(commit.sha || '').trim().toLowerCase();
    const short = String(commit.short_sha || sha.slice(0, 8)).trim().toLowerCase();
    const candidates = [entry.commit_full, entry.sha, entry.commit]
        .map(v => String(v || '').trim().toLowerCase())
        .filter(v => v.length >= 7);
    return candidates.some(v => (
        (sha && (sha === v || sha.startsWith(v) || v.startsWith(sha))) ||
        (short && (short === v || v.startsWith(short)))
    ));
}

function _dashCommitHealthKeys() {
    return ['complexity', 'coupling', 'dead_code', 'duplication', 'cohesion'];
}

function _dashCommitHealthLabel(key) {
    const labels = {
        complexity: 'dashHealthComplexity',
        coupling: 'dashHealthCoupling',
        dead_code: 'dashHealthDeadCode',
        duplication: 'dashHealthDuplication',
        cohesion: 'dashHealthCohesion',
    };
    return _dashT(labels[key]) || key.replace(/_/g, ' ');
}

function _dashCommitHealthSummaryHTML(impact) {
    if (!impact || !impact.available) {
        return `
<span class="dash-commit-health-impact dash-commit-health-impact--missing">
  <b>n/a</b>
  <small>health snapshot</small>
</span>`;
    }
    const scoreColor = typeof _dashHealthColor === 'function' ? _dashHealthColor(impact.score) : 'var(--accent)';
    const deltaColor = _dashCommitDeltaColor(impact.delta);
    const deltaText = _dashCommitDeltaText(impact.delta);
    const source = impact.matchType === 'commit' ? 'commit delta' : 'date snapshot';
    return `
<span class="dash-commit-health-impact">
  <b style="color:${scoreColor}">${impact.score.toFixed(1)}</b>
  <em style="color:${deltaColor}">${_dashEscape(deltaText)}</em>
  <small>${_dashEscape(source)}</small>
</span>`;
}

function _dashCommitHealthBreakdownHTML(impact) {
    if (!impact || !impact.available) {
        return `
<div class="dash-commit-health-breakdown dash-commit-health-breakdown--missing">
  <span>Code Health impact is unavailable for this commit.</span>
</div>`;
    }
    const scoreLine = impact.prevScore == null
        ? `${impact.score.toFixed(1)} baseline`
        : `${impact.prevScore.toFixed(1)} -> ${impact.score.toFixed(1)} (${_dashCommitDeltaText(impact.delta)})`;
    return `
<div class="dash-commit-health-breakdown">
  <div class="dash-commit-health-breakdown__overall">
    <span>Overall Code Health</span>
    <b style="color:${_dashCommitDeltaColor(impact.delta)}">${_dashEscape(scoreLine)}</b>
  </div>
  <div class="dash-commit-health-breakdown__chips">
    ${_dashCommitHealthKeys().map(key => {
        const row = impact.breakdown[key] || {};
        const before = row.before == null ? 'base' : row.before.toFixed(1);
        const after = Number(row.after || 0).toFixed(1);
        const delta = row.delta == null ? '' : ` ${_dashCommitDeltaText(row.delta)}`;
        return `<span><small>${_dashEscape(_dashCommitHealthLabel(key))}</small><b>${_dashEscape(before)} -> ${_dashEscape(after)}</b><em style="color:${_dashCommitDeltaColor(row.delta)}">${_dashEscape(delta)}</em></span>`;
    }).join('')}
  </div>
</div>`;
}

function _dashCommitDeltaColor(delta) {
    if (delta == null || Math.abs(delta) < 0.05) return 'var(--muted)';
    return delta > 0 ? 'var(--status-good)' : 'var(--status-bad)';
}

function _dashCommitDeltaText(delta) {
    if (delta == null) return 'baseline';
    return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
}

function _dashOpenCommitDayLoading(day) {
    _dashCloseCommitDayDrilldown();
    const overlay = document.createElement('div');
    overlay.id = _DASH_COMMIT_DRILL_ID;
    overlay.className = 'dash-commit-drilldown-overlay';
    overlay.innerHTML = `
<div class="dash-commit-drilldown-panel" role="dialog" aria-modal="true" aria-label="Loading commits on ${_dashEscape(day)}">
  <div class="dash-commit-drilldown-head">
    <div>
      <div class="dash-detail-head-label">Commit Activity</div>
      <div class="dash-detail-head-name">${_dashEscape(day)}<span class="dash-list-meta dash-list-meta--inline"> loading commit rows</span></div>
    </div>
    <button class="dash-detail-close" type="button" data-close-commit-day aria-label="Close">x</button>
  </div>
  <div class="dash-commit-drilldown-body">
    <div class="dash-empty">Loading commit details...</div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
        if (e.target === overlay || e.target.closest('[data-close-commit-day]')) {
            _dashCloseCommitDayDrilldown();
        }
    });
}

function _dashFetchCommitHistory(day, btn) {
    const stats = (window.DATA && DATA.stats) || {};
    if (stats._commitHistoryFetching) return;
    stats._commitHistoryFetching = true;
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Refreshing...';
    } else {
        _dashOpenCommitDayLoading(day);
    }
    const jobId = (window.DATA && DATA.job_id) ? DATA.job_id : '';
    const days = Math.max(7, Math.min(3650, Number(stats.window_days || 180)));
    const url = `/api/git-history?days=${encodeURIComponent(days)}${jobId ? `&job_id=${encodeURIComponent(jobId)}` : ''}`;
    fetch(url)
        .then(r => r.json())
        .then(payload => {
            if (payload.error) throw new Error(payload.error);
            _dashMergeCommitHistory(payload);
            stats._commitHistoryFetched = true;
            stats._commitHistoryRefreshFailed = false;
        })
        .catch(err => {
            stats._commitHistoryFetched = true;
            stats._commitHistoryRefreshFailed = true;
            if (btn) btn.title = String(err && err.message ? err.message : err);
        })
        .finally(() => {
            stats._commitHistoryFetching = false;
            _dashOpenCommitDayDrilldown(day);
        });
}

function _dashMergeCommitHistory(payload) {
    if (!window.DATA || !DATA.stats || !payload) return;
    const keys = [
        'window_days', 'window_start', 'window_end', 'period_start', 'period_end',
        'commits_analyzed', 'commit_activity_daily', 'commits_by_day',
        'files_by_day', 'files_by_week', 'files_by_author',
    ];
    keys.forEach(key => {
        if (payload[key] !== undefined) DATA.stats[key] = payload[key];
    });
}

function _dashCommitHealthBackfill(btn, day) {
    if (!btn || btn.disabled) return;
    const stats = (window.DATA && DATA.stats) || {};
    const jobId = (window.DATA && DATA.job_id) ? DATA.job_id : '';
    const days = Math.max(7, Math.min(365, Number(stats.window_days || 90)));
    btn.disabled = true;
    btn.textContent = 'Starting...';

    fetch('/api/health-backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'commits', days, job_id: jobId }),
    })
        .then(r => r.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            _dashCommitHealthPoll(data.token, day, btn);
        })
        .catch(err => {
            btn.disabled = false;
            btn.textContent = 'Backfill failed';
            btn.title = String(err && err.message ? err.message : err);
        });
}

function _dashCommitHealthPoll(token, day, btn) {
    if (_dashCommitHealthPollTimer) clearInterval(_dashCommitHealthPollTimer);
    _dashCommitHealthPollTimer = setInterval(() => {
        fetch(`/api/health-backfill-status?token=${encodeURIComponent(token)}`)
            .then(r => r.json())
            .then(prog => {
                if (!btn) return;
                const pct = prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;
                btn.textContent = prog.current_sha ? `${pct}% ${prog.current_sha}` : `${pct}%`;
                if (!prog.finished) return;
                clearInterval(_dashCommitHealthPollTimer);
                _dashCommitHealthPollTimer = null;
                if (prog.error) {
                    btn.disabled = false;
                    btn.textContent = 'Backfill failed';
                    btn.title = prog.error;
                    return;
                }
                if (prog.history && window.DATA && DATA.stats) {
                    DATA.stats.health_history = prog.history;
                }
                btn.textContent = 'Backfilled';
                setTimeout(() => _dashOpenCommitDayDrilldown(day), 180);
            })
            .catch(() => {});
    }, 1500);
}

_dashRegisterWidget({
    id: 'commit_heatmap',
    labelKey: 'dashTemporalHeatmap',
    descriptionKey: 'dashDescCommitHeatmap',
    defaultSize: 'M',
    render(container, size, stats) {
        if (size === 'S') {
            const rows = stats.commit_activity_daily || [];
            const activeDays = rows.filter(r => (r.commits || 0) > 0).length;
            const peak = rows.reduce((best, r) => ((r.commits || 0) > (best.commits || 0) ? r : best), {});
            const topFiles = (stats.file_churn || []).slice(0, 2).map(f => ({
                label: String(f.file || '').split('/').pop(),
                value: f.commits,
                title: f.file,
                onclick: `_dashGoToGraphFile(${_dashJson(f.file)}, null)`,
            }));
            const pills = [
                { label: 'Days', value: activeDays },
                peak.date && { label: 'Peak', value: peak.commits, onclick: `_dashOpenCommitDayDrilldown(${_dashJson(peak.date)})` },
                ...topFiles,
            ].filter(Boolean);
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">${_dashEscape(_dashT('dashTemporalHeatmap'))}</div>
    <div class="dash-widget-stat">${_dashFmtNum(stats.commits_analyzed || 0)}</div>
    <div class="dash-widget-sub">${activeDays} active days</div>
    ${_dashMiniPills(pills)}
  </div>
</div>`;
            return;
        }
        _dashRenderTemporalHeatmap(container, stats);
        if (size === 'L') {
            container.classList.add('dash-commit-activity-l');
            _dashHeatmapAppendStats(container, stats);
            _dashHeatmapAppendChurnFiles(container, stats);
        }
    },

    renderDetail(container, stats) {
        const activity = _dashCommitActivityModel(stats);
        const totalCommits = activity.model ? activity.model.totalCommits : Number(stats.commits_analyzed || 0);
        const peakLabel = activity.peak.date
            ? `Peak day ${_dashEscape(activity.peak.date)} with ${_dashFmtExactNum(activity.peak.commits || 0)} commits.`
            : 'No peak day in this window.';
        const rangeLabel = [stats.period_start, stats.period_end].filter(Boolean).join(' to ');
        const heroFiles = _dashCommitActivityFileRowsHTML(stats, 5, true);
        const fileRows = _dashCommitActivityFileRowsHTML(stats, 10, false);
        const heatmapHTML = _dashCommitActivityHeatmapHTML(activity);

        container.innerHTML = `
<div class="dash-commit-activity-detail">
  <section class="dash-commit-activity-detail__hero">
    <div class="dash-commit-activity-detail__hero-copy">
      <div class="dash-commit-activity-detail__eyebrow">Commit activity</div>
      <h2 class="dash-commit-activity-detail__title">${_dashEscape(_dashT('dashTemporalHeatmap'))}</h2>
      <div class="dash-commit-activity-detail__primary">
        <span class="dash-commit-activity-detail__primary-value">${_dashFmtExactNum(totalCommits)}</span>
        <span class="dash-commit-activity-detail__primary-suffix">commits</span>
      </div>
      <p class="dash-commit-activity-detail__summary">${_dashFmtExactNum(activity.activeDays)} active days${rangeLabel ? ` from ${_dashEscape(rangeLabel)}` : ''}. ${peakLabel}</p>
    </div>
    <div class="dash-commit-activity-detail__hero-visual">${heroFiles}</div>
  </section>
  <div class="dash-commit-activity-detail__sections">
    <section class="dash-commit-activity-detail-section">
      <div class="dash-commit-activity-detail-section__head">
        <div class="dash-commit-activity-detail-section__title">Daily Activity</div>
      </div>
      <div class="dash-commit-activity-detail-section__body">
        <div class="dash-commit-activity-detail__heatmap-body">${heatmapHTML}</div>
      </div>
    </section>
    <section class="dash-commit-activity-detail-section">
      <div class="dash-commit-activity-detail-section__head">
        <div class="dash-commit-activity-detail-section__title">Activity Summary</div>
      </div>
      <div class="dash-commit-activity-detail-section__body">${_dashCommitActivityStatsHTML(activity)}</div>
    </section>
    <section class="dash-commit-activity-detail-section">
      <div class="dash-commit-activity-detail-section__head">
        <div class="dash-commit-activity-detail-section__title">Most Changed Files</div>
      </div>
      <div class="dash-commit-activity-detail-section__body">
        <div class="dash-commit-activity-detail-files">${fileRows}</div>
      </div>
    </section>
  </div>
</div>`;
        _dashBindTemporalHeatmapTooltips(container.querySelector('.dash-commit-activity-detail__heatmap-body'));
    },
});
