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
      ${info.commits ? `data-clickable="true" onclick="_dashOpenFileGroupDrilldown('Files changed on ${iso}', (DATA.stats.files_by_day || {})[${_dashJson(iso)}] || [], { meta: f => (f.count || 0) + ' commits' })"` : ''}
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
                peak.date && { label: 'Peak', value: peak.commits, onclick: `_dashOpenFileGroupDrilldown('Files changed on ${_dashEscape(peak.date)}', (DATA.stats.files_by_day || {})[${_dashJson(peak.date)}] || [], { meta: f => (f.count || 0) + ' commits' })` },
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
