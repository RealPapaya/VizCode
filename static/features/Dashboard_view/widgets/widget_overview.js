// @module Dashboard_view/widgets/widget_overview
// Codebase snapshot: Files, Functions, LOC, and top File Types in one widget.
// High-level summary — intentionally shallower than the dedicated KPI widgets.

function _overviewTopExts(limit) {
    const map = new Map();
    for (const files of Object.values((window.DATA || {}).files_by_module || {})) {
        for (const f of (files || [])) {
            const ext = (f.path || '').split('.').pop() || 'unknown';
            map.set(ext, (map.get(ext) || 0) + 1);
        }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function _overviewExtCount() {
    const set = new Set();
    for (const files of Object.values((window.DATA || {}).files_by_module || {})) {
        for (const f of (files || [])) {
            const ext = (f.path || '').split('.').pop() || 'unknown';
            set.add(ext);
        }
    }
    return set.size;
}

_dashRegisterWidget({
    id: 'overview',
    labelKey: 'dashOverview',
    defaultSize: 'L',

    render(container, size, stats) {
        const files     = stats.files       || 0;
        const funcs     = stats.functions   || 0;
        const loc       = stats.loc_total   || 0;
        const code      = stats.loc_code    || 0;
        const codePct   = loc ? Math.round((code / loc) * 100) : 0;
        const extCount  = _overviewExtCount();
        const calls     = stats.calls       || 0;
        const modules   = (window.DATA && DATA.modules || []).length;

        if (size === 'S') {
            const sCells = [
                { label: 'Files',     value: _dashFmtNum(files) },
                { label: 'Functions', value: _dashFmtNum(funcs) },
                { label: 'LOC',       value: _dashFmtNum(loc) },
                { label: 'Types',     value: _dashFmtNum(extCount) },
            ];
            const sCellHTML = sCells.map(c => `
<div class="dash-overview-s-cell">
  <div class="dash-overview-s-label">${c.label}</div>
  <div class="dash-overview-s-value">${c.value}</div>
</div>`).join('');
            container.innerHTML = `
<div class="dash-overview-s">
  <div class="dash-widget-title">Overview</div>
  <div class="dash-overview-s-grid">${sCellHTML}</div>
</div>`;
            return;
        }

        const topExts = _overviewTopExts(size === 'L' ? 7 : 3);
        const maxExt  = topExts.length ? topExts[0][1] : 1;
        const colors  = _dashColorScale(topExts.length);
        const extRows = topExts.map(([ext, cnt], i) => `
<div class="dash-kpi-bar-row" style="cursor:pointer" onclick="_dashOpenFileGroupDrilldown('Files .${_dashEscape(ext)}', _dashFilesByExt(${_dashJson(ext)}))">
  <span class="dash-kpi-bar-label">.${_dashEscape(ext)}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${Math.round((cnt / maxExt) * 100)}%;background:${colors[i]}"></div></div>
  <span class="dash-kpi-bar-val">${cnt}</span>
</div>`).join('');

        if (size === 'M') {
            container.innerHTML = `
<div class="dash-kpi-m">
  <div class="dash-kpi-m-left">
    <div class="dash-widget-title">Overview</div>
    <div class="dash-widget-stat-md">${_dashFmtNum(files)}</div>
    <div class="dash-widget-sub">${_dashFmtNum(funcs)} fns &middot; ${_dashFmtNum(loc)} LOC</div>
  </div>
  <div class="dash-kpi-m-sep"></div>
  <div class="dash-kpi-m-right">${extRows || '<span class="dash-kpi-empty">No data</span>'}</div>
</div>`;
            return;
        }

        // L (2x2) — snapshot grid of 4 metrics plus top file types
        const tiles = [
            {
                label: 'Files',
                value: _dashFmtNum(files),
                sub:   modules ? `${_dashFmtNum(modules)} modules` : 'all tracked',
                accent: _dashAccentStop(0),
            },
            {
                label: 'Functions',
                value: _dashFmtNum(funcs),
                sub:   calls ? `${_dashFmtNum(calls)} calls` : 'no calls tracked',
                accent: _dashAccentStop(1),
            },
            {
                label: 'Lines of Code',
                value: _dashFmtNum(loc),
                sub:   loc ? `${codePct}% code` : 'no LOC',
                accent: _dashAccentStop(2),
            },
            {
                label: 'File Types',
                value: _dashFmtNum(extCount),
                sub:   extCount ? 'extensions' : 'no data',
                accent: _dashAccentStop(3),
            },
        ];

        const tileHTML = tiles.map(t => `
<div class="dash-overview-tile" style="border-top:2px solid ${t.accent}">
  <div class="dash-overview-tile-label">${t.label}</div>
  <div class="dash-overview-tile-value">${t.value}</div>
  <div class="dash-overview-tile-sub">${_dashEscape(t.sub)}</div>
</div>`).join('');

        container.innerHTML = `
<div class="dash-overview-l">
  <div class="dash-widget-title">Overview</div>
  <div class="dash-overview-grid">${tileHTML}</div>
  <div class="dash-overview-types">
    <div class="dash-widget-sub dash-overview-types-title">Top file types</div>
    <div class="dash-overview-types-rows">
      ${extRows || '<span class="dash-kpi-empty">No data</span>'}
    </div>
  </div>
</div>`;
    },

    renderDetail(container, stats) {
        const files    = stats.files       || 0;
        const funcs    = stats.functions   || 0;
        const calls    = stats.calls       || 0;
        const loc      = stats.loc_total   || 0;
        const code     = stats.loc_code    || 0;
        const comment  = stats.loc_comment || 0;
        const blank    = stats.loc_blank   || 0;
        const codePct  = loc ? Math.round((code    / loc) * 100) : 0;
        const cmtPct   = loc ? Math.round((comment / loc) * 100) : 0;
        const blkPct   = loc ? Math.round((blank   / loc) * 100) : 0;
        const modules  = (DATA.modules || []).length;
        const exts     = _overviewTopExts(12);
        const extTotal = _overviewExtCount();
        const maxExt   = exts.length ? exts[0][1] : 1;
        const colors   = _dashColorScale(exts.length);
        const locColor0 = _dashAccentStop(0);
        const locColor1 = _dashAccentStop(1);

        // ── File type bar rows ──────────────────────────────────────────────
        const extRows = exts.map(([ext, cnt], i) => {
            const pct = Math.round((cnt / maxExt) * 100);
            return `<div class="dash-list-row" data-clickable="true"
                onclick="_dashOpenFileGroupDrilldown('.${_dashEscape(ext)} files', _dashFilesByExt(${_dashJson(ext)}))"
            ><span class="dash-list-rank">${i + 1}</span
            ><span class="dash-list-name">.${_dashEscape(ext)}</span
            ><div class="dash-list-bar-track"><div class="dash-list-bar-fill" style="width:${pct}%;background:${colors[i]}"></div></div
            ><span class="dash-list-val">${cnt}</span></div>`;
        }).join('');

        // ── Hero visual: top-5 file type bars ──────────────────────────────
        const heroVisual = _dashReportBarsHTML(
            _overviewTopExts(5).map(([ext, cnt], i) => ({
                label: `.${ext}`, value: cnt, raw: cnt, color: _dashAccentStop(i),
            }))
        );

        // ── Render: hero + divider + sections ──────────────────────────────
        container.innerHTML = `
<section class="dash-report-hero">
  <div class="dash-report-hero-copy">
    <div class="dash-report-eyebrow">Repository overview</div>
    <h2 class="dash-report-title">Codebase Snapshot</h2>
    <div class="dash-report-primary">
      <span class="dash-report-primary-value">${_dashFmtExactNum(files)}</span>
      <span class="dash-report-primary-suffix">files</span>
    </div>
    <p class="dash-report-summary">${_dashFmtExactNum(funcs)} functions across ${_dashFmtExactNum(modules)} modules with ${_dashFmtExactNum(extTotal)} file extensions.</p>
  </div>
  <div class="dash-report-hero-visual">${heroVisual}</div>
</section>
<div class="dash-report-details dash-report-details--overview">
${_dashReportSection({
    title: 'Codebase Snapshot',
    body: _dashReportStats([
        { value: _dashFmtExactNum(files),    label: 'files' },
        { value: _dashFmtExactNum(funcs),    label: 'functions' },
        { value: _dashFmtExactNum(calls),    label: 'calls' },
        { value: _dashFmtExactNum(loc),      label: 'lines of code' },
        { value: _dashFmtExactNum(extTotal), label: 'file types' },
        { value: _dashFmtExactNum(modules),  label: 'modules' },
    ]),
})}
${_dashReportSection({
    title: 'Line Composition',
    body: `<div class="dash-detail-bar-rows">
    <div class="dash-health-row" data-clickable="true" onclick="_dashOpenFileGroupDrilldown('Files with code', _dashAllFiles().filter(f => (f.loc||{}).code > 0), { meta: f => _dashFmtExactNum((f.loc||{}).code||0) + ' lines' })">
      <span class="dash-health-row-label">Code</span>
      <div class="dash-health-row-track"><div class="dash-health-row-fill" style="width:${codePct}%;background:${locColor0}"></div></div>
      <span class="dash-health-row-value">${_dashFmtExactNum(code)} <small style="color:var(--muted)">(${codePct}%)</small></span>
    </div>
    <div class="dash-health-row" data-clickable="true" onclick="_dashOpenFileGroupDrilldown('Files with comments', _dashAllFiles().filter(f => (f.loc||{}).comment > 0), { meta: f => _dashFmtExactNum((f.loc||{}).comment||0) + ' lines' })">
      <span class="dash-health-row-label">Comments</span>
      <div class="dash-health-row-track"><div class="dash-health-row-fill" style="width:${cmtPct}%;background:${locColor1}"></div></div>
      <span class="dash-health-row-value">${_dashFmtExactNum(comment)} <small style="color:var(--muted)">(${cmtPct}%)</small></span>
    </div>
    <div class="dash-health-row">
      <span class="dash-health-row-label">Blank</span>
      <div class="dash-health-row-track"><div class="dash-health-row-fill" style="width:${blkPct}%;background:var(--border)"></div></div>
      <span class="dash-health-row-value">${_dashFmtExactNum(blank)} <small style="color:var(--muted)">(${blkPct}%)</small></span>
    </div>
  </div>`,
})}
${_dashReportSection({
    title: 'Top File Types',
    body: _dashReportList(extRows || '<div class="dash-empty">No data</div>'),
})}
</div>`;
    },
});
