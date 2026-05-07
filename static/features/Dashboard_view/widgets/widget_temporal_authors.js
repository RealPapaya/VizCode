// @module Dashboard_view/widgets/widget_temporal_authors
// Phase 2 — Author Activity (per-author commits / additions / deletions
// over the analysed git window). Read-only ranking, no drill-through.

function _dashRenderTemporalAuthors(container, stats) {
    if (!container) return;

    const items = stats.author_activity || [];
    container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot" style="background:#22d3ee"></span>${_dashEscape(_dashT('dashTemporalAuthors'))}
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
  <span class="dash-list-name">${_dashEscape(a.author)}<span style="color:#64748b;font-size:11px;margin-left:6px">${a.commits} ${_dashEscape(_dashT('dashTemporalCommits'))} · <span style="color:#60a5fa">+${adds}</span> / <span style="color:#f87171">-${dels}</span></span></span>
  <div class="dash-list-bar" style="width:${Math.round(a.commits / max * 60)}px;background:#22d3ee"></div>
  <span class="dash-list-val" style="color:#22d3ee">${sharePct}% <span style="color:#64748b;font-size:10px;font-weight:400">${_dashEscape(shareLabel)}</span></span>
</div>`;
    }).join('');
}
