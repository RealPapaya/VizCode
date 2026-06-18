// @module Dashboard_view/widgets/widget_circular_deps
// Dedicated widget — circular dependencies with severity tier, expandable
// file chain, per-file graph jump, and a "view all" overlay. S/M/L sizes.

function _dashCircSeverity(len) {
  if (len >= 10) return { tier: 'critical', labelKey: 'dashIssuesSevCritical' };
  if (len >= 5)  return { tier: 'warn',     labelKey: 'dashIssuesSevWarn' };
  return { tier: 'info', labelKey: 'dashIssuesSevInfo' };
}

function _dashCircSummary(cycle) {
  return cycle.map(f => String(f).split('/').pop()).join(' ↔ ');
}

function _dashCircChainHTML(cycle, expanded) {
  const total = cycle.length;
  const visible = expanded ? cycle : cycle.slice(0, 3);
  const parts = visible.map(file => {
    const short = String(file).split('/').pop();
    const fileJson = _dashJson(file);
    return `<span class="dash-cycle-file" title="${_dashEscape(file)}"
                  onclick="event.stopPropagation();_dashGoToGraphFile(${fileJson}, null)">${_dashEscape(short)}</span>`;
  });
  const joined = parts.join('<span class="dash-cycle-arrow">→</span>');
  if (!expanded && total > visible.length) {
    return `${joined}<span class="dash-cycle-arrow">→</span><span class="dash-cycle-more">+${total - visible.length} more</span>`;
  }
  return joined;
}

function _dashCircCard(cycle, idx) {
  const len = cycle.length;
  const sev = _dashCircSeverity(len);
  const cycleJson = _dashJson(cycle);
  const titleJson = _dashJson(`Circular #${idx + 1} (${len} files)`);
  const sevLabel  = _dashT(sev.labelKey);
  return `
<div class="dash-cycle-card sev-${sev.tier}" id="dash-circ-${idx}">
  <div class="dash-cycle-head">
    <span class="dash-list-rank">${idx + 1}</span>
    <span class="dash-cycle-count">${len} files</span>
    <span class="dash-sev-pill dash-sev-bg-${sev.tier}">
      <span class="dash-sev-dot dash-sev-${sev.tier}"></span>${_dashEscape(sevLabel)}
    </span>
  </div>
  <div class="dash-cycle-chain" data-circ-idx="${idx}" data-expanded="0">
    ${_dashCircChainHTML(cycle, false)}
  </div>
  <div class="dash-cycle-actions">
    <span class="dash-cycle-action" data-circ-toggle="${idx}"
          onclick="_dashCircToggle(${idx})">${_dashEscape(_dashT('dashIssuesExpandChain'))}</span>
    <span class="dash-cycle-action"
          onclick="_dashOpenFileGroupDrilldown(${titleJson}, ${cycleJson})">${_dashEscape(_dashT('dashIssuesViewInGraph'))}</span>
  </div>
</div>`;
}

function _dashCircToggle(idx) {
  const stats: any = (window.DATA && window.DATA.stats) || {};
  const cycles = stats.top_circular_deps || [];
  const cycle = cycles[idx];
  if (!cycle) return;
  const chain = document.querySelector(`.dash-cycle-chain[data-circ-idx="${idx}"]`);
  const toggle = document.querySelector(`[data-circ-toggle="${idx}"]`);
  if (!chain || !toggle) return;
  const expanded = chain.getAttribute('data-expanded') === '1';
  const next = !expanded;
  chain.setAttribute('data-expanded', next ? '1' : '0');
  chain.innerHTML = _dashCircChainHTML(cycle, next);
  toggle.textContent = _dashT(next ? 'dashIssuesCollapseChain' : 'dashIssuesExpandChain');
}
window._dashCircToggle = _dashCircToggle;

// ── Detail panel: chip-flow chain ─────────────────────────────────────────────
function _dashCircChainFlowHTML(cycle, expanded, idx) {
  const total   = cycle.length;
  const visible = expanded ? cycle : cycle.slice(0, 4);
  const first   = String(cycle[0] || '').split('/').pop();
  const parts   = [];
  visible.forEach((file, i) => {
    const short    = String(file).split('/').pop();
    const fileJson = _dashJson(file);
    parts.push(
      `<span class="dash-circ-chip" title="${_dashEscape(file)}"` +
      ` onclick="event.stopPropagation();_dashGoToGraphFile(${fileJson},null)">${_dashEscape(short)}</span>`
    );
    if (i < visible.length - 1) {
      parts.push('<span class="dash-circ-arrow" aria-hidden="true"></span>');
    }
  });
  if (!expanded && total > visible.length) {
    parts.push('<span class="dash-circ-arrow" aria-hidden="true"></span>');
    parts.push(
      `<span class="dash-circ-more"` +
      ` onclick="event.stopPropagation();_dashCircDetailToggle(${idx})">+${total - visible.length} more</span>`
    );
  }
  parts.push(
    `<span class="dash-circ-return" title="loops back to ${_dashEscape(first)}">\u21a9</span>`
  );
  return parts.join('');
}

function _dashCircCardDetail(cycle, idx) {
  const len      = cycle.length;
  const sev      = _dashCircSeverity(len);
  const cycleJson = _dashJson(cycle);
  const titleJson = _dashJson(`Circular #${idx + 1} (${len} files)`);
  const sevLabel  = _dashT(sev.labelKey);
  const expandBtn = len > 4
    ? `<button class="dash-circ-toggle-btn" data-circ-d-toggle="${idx}" title="${_dashEscape(_dashT('dashIssuesExpandChain'))}"
          onclick="event.stopPropagation();_dashCircDetailToggle(${idx})">+</button>`
    : '';
  return `
<div class="dash-circ-card-detail sev-${sev.tier}" id="dash-circ-d-${idx}">
  <div class="dash-circ-card-detail__head">
    <span class="dash-list-rank">${idx + 1}</span>
    <span class="dash-sev-pill dash-sev-bg-${sev.tier}">
      <span class="dash-sev-dot dash-sev-${sev.tier}"></span>${_dashEscape(sevLabel)}
    </span>
    <span class="dash-circ-card-detail__len">${len} files</span>
    <button class="dash-circ-graph-btn" title="${_dashEscape(_dashT('dashIssuesViewInGraph'))}"
          onclick="event.stopPropagation();_dashOpenFileGroupDrilldown(${titleJson},${cycleJson})">&#x2197;</button>
  </div>
  <div class="dash-circ-chain-wrap" data-circ-d-idx="${idx}" data-expanded="0">
    <div class="dash-circ-flow">${_dashCircChainFlowHTML(cycle, false, idx)}</div>
  </div>
  ${expandBtn}
</div>`;
}

function _dashCircDetailToggle(idx) {
  const stats: any  = (window.DATA && window.DATA.stats) || {};
  const cycles = stats.top_circular_deps || [];
  const cycle  = cycles[idx];
  if (!cycle) return;
  const wrap   = document.querySelector(`.dash-circ-chain-wrap[data-circ-d-idx="${idx}"]`);
  const toggle = document.querySelector(`[data-circ-d-toggle="${idx}"]`);
  if (!wrap) return;
  const expanded = wrap.getAttribute('data-expanded') === '1';
  const next     = !expanded;
  wrap.setAttribute('data-expanded', next ? '1' : '0');
  const flow = wrap.querySelector('.dash-circ-flow');
  if (flow) flow.innerHTML = _dashCircChainFlowHTML(cycle, next, idx);
  if (toggle) toggle.textContent = next ? '\u2212' : '+';
}
window._dashCircDetailToggle = _dashCircDetailToggle;


function _dashCircStatusColor(count) {
  return count > 0 ? 'var(--status-warn)' : 'var(--status-good)';
}

// ── L / detail layout with prominent panel header ──
function _dashRenderCircularDeps(container, stats, opts?) {
  if (!container) return;
  const cycles = stats.top_circular_deps || [];
  const count = stats.circular_dependencies || 0;
  const color = _dashCircStatusColor(count);
  const sevCounts = cycles.reduce((acc, c) => {
    const t = _dashCircSeverity(c.length).tier;
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const cyclesHTML = cycles.length
    ? cycles.map((c, i) => _dashCircCard(c, i)).join('')
    : `<div class="dash-empty">✅ ${_dashEscape(_dashT('dashIssuesNoCycles'))}</div>`;


  container.innerHTML = `
<div class="dash-arch-panel">
  <div class="dash-arch-panel-header">
    <div class="dash-arch-panel-title-block">
      <div class="dash-arch-panel-title">
        <span class="dash-arch-status-dot" style="color:${color};background:${color}"></span>
        ${_dashEscape(_dashT('dashCircularDepsTitle'))}
      </div>
      <div class="dash-arch-panel-sub">${count} ${_dashEscape(_dashT('dashCircularDepsSub'))}</div>
    </div>
    <div class="dash-arch-panel-stats">
      <span class="dash-sev-pill dash-sev-bg-critical"><span class="dash-sev-dot dash-sev-critical"></span>${sevCounts.critical || 0}</span>
      <span class="dash-sev-pill dash-sev-bg-warn"><span class="dash-sev-dot dash-sev-warn"></span>${sevCounts.warn || 0}</span>
      <span class="dash-sev-pill dash-sev-bg-info"><span class="dash-sev-dot dash-sev-info"></span>${sevCounts.info || 0}</span>
    </div>
  </div>
  <div class="dash-arch-panel-body">
    <div class="dash-arch-cycles-list">${cyclesHTML}</div>
  </div>
</div>`;
}

_dashRegisterWidget({
  id: 'circular_deps',
  labelKey: 'dashCircularDepsTitle',
      descriptionKey: 'dashDescCircularDeps',
  defaultSize: 'M',

  render(container, size, stats) {
    const cycles = stats.top_circular_deps || [];
    const count = stats.circular_dependencies || 0;
    const color = _dashCircStatusColor(count);

    if (size === 'S') {
      const pills = cycles.slice(0, 3).map((c, i) => {
        const sev = _dashCircSeverity(c.length);
        return {
          label: `${c.length}f`,
          value: '',
          title: `#${i + 1} · ${_dashCircSummary(c)}`,
          onclick: `_dashOpenFileGroupDrilldown(${_dashJson(`Circular #${i + 1}`)}, ${_dashJson(c)})`,
          muted: sev.tier === 'info',
        };
      });
      container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-arch-stat-row" style="gap:6px">
      <span class="dash-arch-status-dot" style="color:${color};background:${color}"></span>
      <div class="dash-widget-title">${_dashEscape(_dashT('dashCircularDepsTitle'))}</div>
    </div>
    <div class="dash-widget-stat" style="color:${color}">${_dashFmtNum(count)}</div>
    <div class="dash-widget-sub">${count > 0 ? _dashEscape(_dashT('dashCircularDepsSub')) : _dashEscape(_dashT('dashIssuesNoCycles'))}</div>
    ${_dashMiniPills(pills, { empty: _dashT('dashIssuesNoCycles') })}
  </div>
</div>`;
      return;
    }

    if (size === 'M') {
      const cyclesHTML = cycles.length
        ? cycles.slice(0, 3).map((c, i) => _dashCircCard(c, i)).join('')
        : `<div class="dash-empty">✅ ${_dashEscape(_dashT('dashIssuesNoCycles'))}</div>`;
      container.innerHTML = `
<div class="dash-arch-panel">
  <div class="dash-arch-panel-header">
    <div class="dash-arch-panel-title-block">
      <div class="dash-arch-panel-title">
        <span class="dash-arch-status-dot" style="color:${color};background:${color}"></span>
        ${_dashEscape(_dashT('dashCircularDepsTitle'))}
      </div>
      <div class="dash-arch-panel-sub">${count} ${_dashEscape(_dashT('dashCircularDepsSub'))}</div>
    </div>
  </div>
  <div class="dash-arch-panel-body">
    <div class="dash-arch-cycles-list">${cyclesHTML}</div>
  </div>
</div>`;
      return;
    }

    _dashRenderCircularDeps(container, stats);
  },

  renderDetail(container, stats) {
    const cycles      = stats.top_circular_deps || [];
    const count       = stats.circular_dependencies || 0;
    const color       = _dashCircStatusColor(count);
    const sevCounts   = { critical: 0, warn: 0, info: 0 };
    cycles.forEach(c => { sevCounts[_dashCircSeverity(c.length).tier]++; });
    const affectedFiles = new Set(cycles.flat()).size;

    const heroVisual = `
<div class="dash-circ-detail-sev">
  ${[
    { tier: 'critical', label: _dashT('dashIssuesSevCritical'), color: '#d35454' },
    { tier: 'warn',     label: _dashT('dashIssuesSevWarn'),     color: 'var(--status-warn)' },
    { tier: 'info',     label: _dashT('dashIssuesSevInfo'),     color: 'var(--muted)' },
  ].map(s => `
  <div class="dash-circ-detail-sev__item">
    <span class="dash-sev-pill dash-sev-bg-${s.tier}">
      <span class="dash-sev-dot dash-sev-${s.tier}"></span>${_dashEscape(s.label)}
    </span>
    <span class="dash-circ-detail-sev__value" style="color:${s.color}">${sevCounts[s.tier]}</span>
  </div>`).join('')}
</div>`;

    const summaryText = count === 0
      ? 'No circular dependencies detected.'
      : `${count} cycle${count !== 1 ? 's' : ''} detected across ${affectedFiles} file${affectedFiles !== 1 ? 's' : ''}.`;

    const cyclesHTML = cycles.length
      ? cycles.map((c, i) => _dashCircCardDetail(c, i)).join('')
      : `<div class="dash-empty">\u2705 ${_dashEscape(_dashT('dashIssuesNoCycles'))}</div>`;

    container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--circular">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Dependency risk</div>
      <h2 class="dash-kpi-detail__title">${_dashEscape(_dashT('dashCircularDepsTitle'))}</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value" style="color:${color}">${_dashFmtNum(count)}</span>
        <span class="dash-kpi-detail__primary-suffix">cycles</span>
      </div>
      <p class="dash-kpi-detail__summary">${_dashEscape(summaryText)}</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">${heroVisual}</div>
  </section>
  <div class="dash-kpi-detail__sections">
${_dashKpiDetailSectionHTML({
    title: 'Snapshot',
    body: _dashKpiDetailStatsHTML([
      { value: String(count),              label: 'total cycles',  color },
      { value: String(affectedFiles),      label: 'files affected' },
      { value: String(sevCounts.critical), label: 'critical', color: sevCounts.critical > 0 ? '#d35454' : undefined },
      { value: String(sevCounts.warn),     label: 'warning',  color: sevCounts.warn > 0 ? 'var(--status-warn)' : undefined },
    ]),
})}
${_dashKpiDetailSectionHTML({
    title: count > 0 ? `All Cycles (${count})` : 'Cycles',
    body: `<div class="dash-circ-detail-list">${cyclesHTML}</div>`,
})}
  </div>
</div>`;
  },
});
