// @module Dashboard_view/widgets/widget_entry_points
// Dedicated widget — entry points (files not imported by anyone) + isolated
// files (no edges at all). Both lists are clickable → jump to graph.

function _dashEntryRow(file, idx) {
  const short = String(file).split('/').pop();
  const fileJson = _dashJson(file);
  return `
<div class="dash-list-row" data-clickable="true" data-tip="${_dashEscape(file)}"
     onclick="_dashGoToGraphFile(${fileJson}, null)">
  <span class="dash-list-rank">${idx + 1}</span>
  <span class="dash-list-name">${_dashEscape(short)}<span class="dash-list-meta">${_dashEscape(file)}</span></span>
</div>`;
}

function _dashEntryRows(files, limit) {
  if (!files.length) return `<div class="dash-empty">${_dashEscape(_dashT('dashEntryPointsEmpty'))}</div>`;
  const slice = limit ? files.slice(0, limit) : files;
  return slice.map((f, i) => _dashEntryRow(f, i)).join('');
}

function _dashRenderEntryPoints(container, stats, opts) {
  if (!container) return;
  const entries = stats.entry_point_files || [];
  const isolated = stats.isolated_file_paths || [];
  const entryCount = stats.entry_points || entries.length;
  const isoCount = stats.isolated_files || isolated.length;

  container.innerHTML = `
<div class="dash-arch-panel">
  <div class="dash-arch-panel-header">
    <div class="dash-arch-panel-title-block">
      <div class="dash-arch-panel-title">
        <span class="dash-arch-status-dot" style="color:var(--status-good);background:var(--status-good)"></span>
        ${_dashEscape(_dashT('dashEntryPointsTitle'))}
      </div>
      <div class="dash-arch-panel-sub">${_dashEscape(_dashT('dashEntryPointsSub'))}</div>
    </div>
    <div class="dash-arch-panel-stats">
      <div class="dash-arch-mini-stat" style="padding:4px 10px">
        <div class="dash-arch-mini-stat-label">${_dashEscape(_dashT('dashIssuesEntry'))}</div>
        <div class="dash-arch-mini-stat-value" style="color:var(--status-good)">${_dashFmtNum(entryCount)}</div>
      </div>
      <div class="dash-arch-mini-stat" style="padding:4px 10px">
        <div class="dash-arch-mini-stat-label">${_dashEscape(_dashT('dashEntryPointsIsolated'))}</div>
        <div class="dash-arch-mini-stat-value" style="color:var(--muted)">${_dashFmtNum(isoCount)}</div>
      </div>
    </div>
  </div>
  <div class="dash-arch-panel-body">
    <div class="dash-grid dash-grid-2" style="height:100%;min-height:0">
      <div class="dash-card" style="display:flex;flex-direction:column;min-height:0">
        <div class="dash-card-title">
          <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashIssuesEntry'))}
        </div>
        <div class="dash-list" style="flex:1;overflow-y:auto;min-height:0;padding-right:4px">${_dashEntryRows(entries, 0)}</div>
      </div>
      <div class="dash-card" style="display:flex;flex-direction:column;min-height:0">
        <div class="dash-card-title">
          <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashEntryPointsIsolated'))}
        </div>
        <div class="dash-list" style="flex:1;overflow-y:auto;min-height:0;padding-right:4px">${_dashEntryRows(isolated, 0)}</div>
      </div>
    </div>
  </div>
</div>`;
}

_dashRegisterWidget({
  id: 'entry_points',
  labelKey: 'dashEntryPointsTitle',
  defaultSize: 'M',

  render(container, size, stats) {
    const entries = stats.entry_point_files || [];
    const isolated = stats.isolated_file_paths || [];
    const entryCount = stats.entry_points || entries.length;
    const isoCount = stats.isolated_files || isolated.length;

    if (size === 'S') {
      const pills = entries.slice(0, 3).map(f => ({
        label: String(f).split('/').pop(),
        value: '',
        title: f,
        onclick: `_dashGoToGraphFile(${_dashJson(f)}, null)`,
      }));
      container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-arch-stat-row" style="gap:6px">
      <span class="dash-arch-status-dot" style="color:var(--status-good);background:var(--status-good)"></span>
      <div class="dash-widget-title">${_dashEscape(_dashT('dashEntryPointsTitle'))}</div>
    </div>
    <div class="dash-widget-stat" style="color:var(--status-good)">${_dashFmtNum(entryCount)}</div>
    <div class="dash-widget-sub">${isoCount} ${_dashEscape(_dashT('dashIssuesIsolated'))}</div>
    ${_dashMiniPills(pills, { empty: _dashT('dashEntryPointsEmpty') })}
  </div>
</div>`;
      return;
    }

    if (size === 'M') {
      container.innerHTML = `
<div class="dash-arch-panel">
  <div class="dash-arch-panel-header">
    <div class="dash-arch-panel-title-block">
      <div class="dash-arch-panel-title">
        <span class="dash-arch-status-dot" style="color:var(--status-good);background:var(--status-good)"></span>
        ${_dashEscape(_dashT('dashEntryPointsTitle'))}
      </div>
      <div class="dash-arch-panel-sub">${entryCount} ${_dashEscape(_dashT('dashIssuesEntry'))} · ${isoCount} ${_dashEscape(_dashT('dashIssuesIsolated'))}</div>
    </div>
  </div>
  <div class="dash-arch-panel-body">
    <div class="dash-list" style="flex:1;overflow-y:auto;min-height:0;padding-right:4px">${_dashEntryRows(entries, 8)}</div>
  </div>
</div>`;
      return;
    }

    _dashRenderEntryPoints(container, stats);
  },

  renderDetail(container, stats) {
    const entries    = stats.entry_point_files || [];
    const isolated   = stats.isolated_file_paths || [];
    const entryCount = stats.entry_points || entries.length;
    const isoCount   = stats.isolated_files || isolated.length;

    // Hero visual: two stat boxes
    const heroVisual = `
<div class="dash-entry-detail-hero-stats">
  <div class="dash-entry-detail-hero-stat">
    <span class="dash-entry-detail-hero-stat__value" style="color:var(--status-good)">${_dashFmtNum(entryCount)}</span>
    <span class="dash-entry-detail-hero-stat__label">${_dashEscape(_dashT('dashIssuesEntry'))}</span>
  </div>
  <div class="dash-entry-detail-hero-stat">
    <span class="dash-entry-detail-hero-stat__value" style="color:var(--muted)">${_dashFmtNum(isoCount)}</span>
    <span class="dash-entry-detail-hero-stat__label">${_dashEscape(_dashT('dashIssuesIsolated'))}</span>
  </div>
</div>`;

    const summaryText = entryCount === 0
      ? 'No entry points detected in this codebase.'
      : `${entryCount} file${entryCount !== 1 ? 's' : ''} not imported anywhere${isoCount > 0 ? `, ${isoCount} fully isolated` : ''}.`;

    // Entry point rows
    const entryRows = entries.length
      ? entries.map((file, i) => {
          const short    = String(file).split('/').pop();
          const fileJson = _dashJson(file);
          return `<div class="dash-kpi-detail-row" data-clickable="true" title="${_dashEscape(file)}"
              onclick="_dashGoToGraphFile(${fileJson}, null)">
              <span class="dash-kpi-detail-row__rank">${i + 1}</span>
              <span class="dash-kpi-detail-row__name">${_dashEscape(short)}<span class="dash-kpi-detail-row__meta">${_dashEscape(file)}</span></span>
          </div>`;
        }).join('')
      : `<div class="dash-empty">${_dashEscape(_dashT('dashEntryPointsEmpty'))}</div>`;

    // Isolated file rows
    const isoRows = isolated.length
      ? isolated.map((file, i) => {
          const short    = String(file).split('/').pop();
          const fileJson = _dashJson(file);
          return `<div class="dash-kpi-detail-row" data-clickable="true" title="${_dashEscape(file)}"
              onclick="_dashGoToGraphFile(${fileJson}, null)">
              <span class="dash-kpi-detail-row__rank">${i + 1}</span>
              <span class="dash-kpi-detail-row__name">${_dashEscape(short)}<span class="dash-kpi-detail-row__meta">${_dashEscape(file)}</span></span>
          </div>`;
        }).join('')
      : `<div class="dash-empty">${_dashEscape(_dashT('dashEntryPointsEmpty'))}</div>`;

    container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--entry-points">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Graph reachability</div>
      <h2 class="dash-kpi-detail__title">${_dashEscape(_dashT('dashEntryPointsTitle'))}</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value" style="color:var(--status-good)">${_dashFmtNum(entryCount)}</span>
        <span class="dash-kpi-detail__primary-suffix">entry points</span>
      </div>
      <p class="dash-kpi-detail__summary">${_dashEscape(summaryText)}</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">${heroVisual}</div>
  </section>
  <div class="dash-kpi-detail__sections">
${_dashKpiDetailSectionHTML({
    title: 'Snapshot',
    body: _dashKpiDetailStatsHTML([
        { value: String(entryCount), label: 'entry points',   color: 'var(--status-good)' },
        { value: String(isoCount),   label: 'isolated files', color: isoCount > 0 ? 'var(--muted)' : undefined },
    ]),
})}
${_dashKpiDetailSectionHTML({
    title: `Entry Points (${entryCount})`,
    body: `<div class="dash-entry-detail-list">${entryRows}</div>`,
})}
${isoCount > 0 ? _dashKpiDetailSectionHTML({
    title: `Isolated Files (${isoCount})`,
    body: `<div class="dash-entry-detail-list">${isoRows}</div>`,
}) : ''}
  </div>
</div>`;
  },
});
