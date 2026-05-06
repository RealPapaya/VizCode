// @module Dashboard_view/widgets/widget_temporal_heatmap
// GitHub-style daily commit activity heatmap rendered with SVG.

const _DASH_HEATMAP_COLORS = [
    '#172033',
    '#d1fae5',
    '#86efac',
    '#4ade80',
    '#16a34a',
    '#14532d',
];

const _DASH_HEATMAP_MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function _dashRenderTemporalHeatmap(container, stats) {
    if (!container) return;

    const rows = stats.commit_activity_daily || [];
    container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot" style="background:#22c55e"></span>${_dashEscape(_dashT('dashTemporalHeatmap'))}
</div>
<div class="dash-temporal-heatmap-body" id="dash-temporal-heatmap-body"></div>`;

    const host = document.getElementById('dash-temporal-heatmap-body');
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

    host.innerHTML = `
${_dashTemporalHeatmapSVG(model)}
<div class="dash-temporal-heatmap-legend">
  <span>${_dashEscape(_dashT('dashTemporalLess'))}</span>
  ${_DASH_HEATMAP_COLORS.slice(1).map(c =>
        `<span class="dash-temporal-heatmap-swatch" style="background:${c}"></span>`
    ).join('')}
  <span>${_dashEscape(_dashT('dashTemporalMore'))}</span>
  <span class="dash-temporal-heatmap-summary">
    ${_dashFmtNum(model.totalCommits)} ${_dashEscape(_dashT('dashTemporalCommits'))} / max ${model.maxCommits}
  </span>
</div>`;
}

function _dashBuildTemporalHeatmapModel(rows, stats) {
    const dayMap = new Map();
    let maxCommits = 0;
    let totalCommits = 0;

    rows.forEach(row => {
        const date = String(row.date || '');
        if (!_dashHeatmapParseISO(date)) return;
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
    let start = _dashHeatmapParseISO(stats.window_start);
    let end = _dashHeatmapParseISO(stats.window_end) ||
        _dashHeatmapParseISO(stats.period_end);

    if (!end && sortedDates.length) end = _dashHeatmapParseISO(sortedDates[sortedDates.length - 1]);
    if (!start && end) {
        const span = Math.max(0, Number(stats.window_days || 180));
        start = _dashHeatmapAddDays(end, -span);
    }
    if (!start && sortedDates.length) start = _dashHeatmapParseISO(sortedDates[0]);
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
    const height = monthH + gridH;
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

        const iso = _dashHeatmapISO(date);
        const info = model.dayMap.get(iso) || { commits: 0, additions: 0, deletions: 0 };
        const week = Math.floor(i / 7);
        const day = _dashHeatmapDayIndex(date);
        const x = labelW + week * (cell + gap);
        const y = monthH + day * (cell + gap);
        const fill = _dashHeatmapColor(info.commits, model.maxCommits);
        const commitsLabel = `${info.commits} ${_dashT('dashTemporalCommits')}`;
        const title = `${iso}: ${commitsLabel}, +${info.additions} / -${info.deletions}`;

        cells.push(`
<rect class="dash-temporal-heatmap-cell${info.commits ? ' active' : ''}"
      x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2"
      fill="${fill}">
  <title>${_dashEscape(title)}</title>
</rect>`);
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

function _dashHeatmapDayLabel(text, day, labelW, monthH, cell, gap) {
    const y = monthH + day * (cell + gap) + cell - 1;
    return `<text class="dash-temporal-heatmap-label" x="${labelW - 5}" y="${y}" text-anchor="end">${text}</text>`;
}

function _dashHeatmapColor(commits, maxCommits) {
    if (!commits) return _DASH_HEATMAP_COLORS[0];
    if (commits <= 1) return _DASH_HEATMAP_COLORS[1];
    if (!maxCommits) return _DASH_HEATMAP_COLORS[1];
    const level = Math.max(2, Math.min(5, Math.ceil((commits / maxCommits) * 5)));
    return _DASH_HEATMAP_COLORS[level];
}

function _dashHeatmapParseISO(value) {
    if (!value || typeof value !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return null;
    const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return Number.isNaN(date.getTime()) ? null : date;
}

function _dashHeatmapISO(date) {
    return date.toISOString().slice(0, 10);
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
