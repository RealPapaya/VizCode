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
    descriptionKey: 'dashDescOverview',
    defaultSize: 'L',

    render(container, size, stats) {
        const files     = stats.files       || 0;
        const funcs     = stats.functions   || 0;
        const loc       = stats.loc_total   || 0;
        const code      = stats.loc_code    || 0;
        const comment   = stats.loc_comment || 0;
        const blank     = stats.loc_blank   || 0;
        const codePct   = loc ? Math.round((code / loc) * 100) : 0;
        const cmtPct    = loc ? Math.round((comment / loc) * 100) : 0;
        const blkPct    = loc ? Math.round((blank / loc) * 100) : 0;
        const extCount  = _overviewExtCount();
        const calls     = stats.calls       || 0;
        const modules   = (window.DATA && DATA.modules || []).length;
        const topExts   = _overviewTopExts(size === 'L' ? 7 : 3);

        if (size === 'S') {
            const sStats = [
                { label: 'Fns',   value: _dashFmtNum(funcs),   color: _dashAccentStop(1) },
                { label: 'LOC',   value: _dashFmtNum(loc),     color: _dashAccentStop(2) },
                { label: 'Types', value: _dashFmtNum(extCount), color: _dashAccentStop(3) },
            ];
            const sStatsHTML = sStats.map(c => `
<div class="dash-overview-s-stat" style="--dash-overview-s-accent:${c.color}">
  <span class="dash-overview-s-stat-label">${c.label}</span>
  <span class="dash-overview-s-stat-value">${c.value}</span>
</div>`).join('');
            const sExtRows = topExts.map(([ext, cnt], i) => `
<span class="dash-overview-s-type" style="--dash-overview-s-accent:${_dashAccentStop(i)}">
  <i></i><span>.${_dashEscape(ext)}</span><b>${cnt}</b>
</span>`).join('');
            container.innerHTML = `
<div class="dash-overview-s">
  <div class="dash-overview-s-head">
    <div class="dash-widget-title">Overview</div>
    <div class="dash-overview-s-context">${modules ? `${_dashFmtNum(modules)} modules` : 'snapshot'}</div>
  </div>
  <div class="dash-overview-s-hero">
    <span class="dash-overview-s-hero-label">Files</span>
    <strong class="dash-overview-s-hero-value">${_dashFmtNum(files)}</strong>
  </div>
  <div class="dash-overview-s-stats">${sStatsHTML}</div>
  <div class="dash-overview-s-loc" aria-label="Line composition">
    <span style="width:${codePct}%;background:${_dashAccentStop(0)}" title="Code ${codePct}%"></span>
    <span style="width:${cmtPct}%;background:${_dashAccentStop(1)}" title="Comments ${cmtPct}%"></span>
    <span style="width:${blkPct}%;background:var(--border)" title="Blank ${blkPct}%"></span>
  </div>
  <div class="dash-overview-s-types">${sExtRows || '<span class="dash-kpi-empty">No data</span>'}</div>
</div>`;
            return;
        }

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

        // File type bar rows.
        const extRows = exts.map(([ext, cnt], i) => {
            const pct = Math.round((cnt / maxExt) * 100);
            return `<div class="dash-kpi-detail-row" data-clickable="true"
                onclick="_dashOpenFileGroupDrilldown('.${_dashEscape(ext)} files', _dashFilesByExt(${_dashJson(ext)}))"
            ><span class="dash-kpi-detail-row__rank">${i + 1}</span
            ><span class="dash-kpi-detail-row__name">.${_dashEscape(ext)}</span
            ><div class="dash-kpi-detail-row__bar-track"><div class="dash-kpi-detail-row__bar-fill" style="width:${pct}%;background:${colors[i]}"></div></div
            ><span class="dash-kpi-detail-row__value">${cnt}</span></div>`;
        }).join('');

        // Hero visual: top-5 file type bars.
        const heroVisual = _dashKpiDetailBarsHTML(
            _overviewTopExts(5).map(([ext, cnt], i) => ({
                label: `.${ext}`, value: cnt, raw: cnt, color: _dashAccentStop(i),
            }))
        );

        // Render: dedicated detail DOM.
        container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--overview">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Repository overview</div>
      <h2 class="dash-kpi-detail__title">Codebase Snapshot</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value">${_dashFmtExactNum(files)}</span>
        <span class="dash-kpi-detail__primary-suffix">files</span>
      </div>
      <p class="dash-kpi-detail__summary">${_dashFmtExactNum(funcs)} functions across ${_dashFmtExactNum(modules)} modules with ${_dashFmtExactNum(extTotal)} file extensions.</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">${heroVisual}</div>
  </section>
  <div class="dash-kpi-detail__sections">
${_dashKpiDetailSectionHTML({
    title: 'Codebase Snapshot',
    body: _dashKpiDetailStatsHTML([
        { value: _dashFmtExactNum(files),    label: 'files' },
        { value: _dashFmtExactNum(funcs),    label: 'functions' },
        { value: _dashFmtExactNum(calls),    label: 'calls' },
        { value: _dashFmtExactNum(loc),      label: 'lines of code' },
        { value: _dashFmtExactNum(extTotal), label: 'file types' },
        { value: _dashFmtExactNum(modules),  label: 'modules' },
    ]),
})}
${_dashKpiDetailSectionHTML({
    title: 'Line Composition',
    body: `<div class="dash-kpi-detail-meters">
    <div class="dash-kpi-detail-meter" data-clickable="true" onclick="_dashOpenFileGroupDrilldown('Files with code', _dashAllFiles().filter(f => (f.loc||{}).code > 0), { meta: f => _dashFmtExactNum((f.loc||{}).code||0) + ' lines' })">
      <span class="dash-kpi-detail-meter__label">Code</span>
      <div class="dash-kpi-detail-meter__track"><div class="dash-kpi-detail-meter__fill" style="width:${codePct}%;background:${locColor0}"></div></div>
      <span class="dash-kpi-detail-meter__value">${_dashFmtExactNum(code)} <small style="color:var(--muted)">(${codePct}%)</small></span>
    </div>
    <div class="dash-kpi-detail-meter" data-clickable="true" onclick="_dashOpenFileGroupDrilldown('Files with comments', _dashAllFiles().filter(f => (f.loc||{}).comment > 0), { meta: f => _dashFmtExactNum((f.loc||{}).comment||0) + ' lines' })">
      <span class="dash-kpi-detail-meter__label">Comments</span>
      <div class="dash-kpi-detail-meter__track"><div class="dash-kpi-detail-meter__fill" style="width:${cmtPct}%;background:${locColor1}"></div></div>
      <span class="dash-kpi-detail-meter__value">${_dashFmtExactNum(comment)} <small style="color:var(--muted)">(${cmtPct}%)</small></span>
    </div>
    <div class="dash-kpi-detail-meter">
      <span class="dash-kpi-detail-meter__label">Blank</span>
      <div class="dash-kpi-detail-meter__track"><div class="dash-kpi-detail-meter__fill" style="width:${blkPct}%;background:var(--border)"></div></div>
      <span class="dash-kpi-detail-meter__value">${_dashFmtExactNum(blank)} <small style="color:var(--muted)">(${blkPct}%)</small></span>
    </div>
  </div>`,
})}
${_dashKpiDetailSectionHTML({
    title: 'Top File Types',
    body: _dashKpiDetailListHTML(extRows || '<div class="dash-empty">No data</div>'),
})}
  </div>
</div>`;
    },
});
