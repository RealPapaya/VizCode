// @module Dashboard_view/widgets/widget_temporal_authors
// Phase 2 — Author Activity (per-author commits / additions / deletions
// over the analysed git window). Read-only ranking, no drill-through.

function _dashRenderTemporalAuthors(container, stats) {
    if (!container) return;

    const items = stats.author_activity || [];
    container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashTemporalAuthors'))}
</div>
<div class="dash-list" id="dash-temporal-authors-list"></div>`;

    const list = document.getElementById('dash-temporal-authors-list');
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
<div class="dash-list-row" data-tip="${_dashEscape(a.author)}">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(a.author)}<span class="dash-list-meta">${a.commits} ${_dashEscape(_dashT('dashTemporalCommits'))} · <span class="dash-diff-add">+${adds}</span> / <span class="dash-diff-del">-${dels}</span></span></span>
  <div class="dash-list-bar" style="width:${Math.round(a.commits / max * 60)}px"></div>
  <span class="dash-list-val">${sharePct}% <span class="dash-list-meta dash-list-meta--inline">${_dashEscape(shareLabel)}</span></span>
</div>`;
    }).join('');
}
