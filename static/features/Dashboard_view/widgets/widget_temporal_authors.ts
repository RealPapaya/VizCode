// @ts-nocheck -- JS->TS migration: deferred (leaf widget renderer). Curate later.
// @module Dashboard_view/widgets/widget_temporal_authors
// Phase 2 — Author Activity (per-author commits / additions / deletions
// over the analysed git window). Read-only ranking, no drill-through.

function _dashRenderTemporalAuthors(container, stats) {
    if (!container) return;

    const items = stats.author_activity || [];
    const isReport = container.classList.contains('dash-report-section');
    container.innerHTML = isReport ? `
<div class="dash-report-section-head">
  <div class="dash-report-section-title">${_dashEscape(_dashT('dashTemporalAuthors'))}</div>
</div>
<div class="dash-report-section-body"><div class="dash-report-list" id="dash-temporal-authors-list"></div></div>` : `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashTemporalAuthors'))}
</div>
<div class="dash-list" id="dash-temporal-authors-list"></div>`;

    const list = container.querySelector('#dash-temporal-authors-list');
    if (!list) return;
    if (!items.length) {
        list.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashTemporalEmpty'))}</div>`;
        return;
    }

    const max = items[0].commits || 1;
    const shareLabel = _dashT('dashTemporalShare');

    list.innerHTML = items.slice(0, 10).map((a, i) => {
        const sharePct = Math.round((a.share || 0) * 100);
        const adds = _dashFmtNum(a.additions || 0);
        const dels = _dashFmtNum(a.deletions || 0);
        return `
<div class="dash-list-row" data-clickable="true" data-tip="${_dashEscape(a.author)}"
     onclick="_dashOpenFileGroupDrilldown('Files by ${_dashEscape(a.author)}', (DATA.stats.files_by_author || {})[${_dashJson(a.author)}] || [], { meta: f => (f.count || 0) + ' commits' })">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(a.author)}<span class="dash-list-meta">${a.commits} ${_dashEscape(_dashT('dashTemporalCommits'))} · <span class="dash-diff-add">+${adds}</span> / <span class="dash-diff-del">-${dels}</span></span></span>
  <div class="dash-list-bar-track"><div class="dash-list-bar-fill" style="width:${Math.round(a.commits / max * 100)}%"></div></div>
  <span class="dash-list-val">${sharePct}% <span class="dash-list-meta dash-list-meta--inline">${_dashEscape(shareLabel)}</span></span>
</div>`;
    }).join('');
}
