// @module Dashboard_view/widgets/widget_harness_scan
//
// AI Harness Scan widget. Consumes stats.harness_scan built by src/core/harness_scan.py:
//   { score, level, breakdown, weights, evidence, missing, scanned }
//   6 dims: instructions | harness_config | loop_engineering | memory_learning | delegation | safety_governance
//
// Size-responsive:
//   S — score number + level badge
//   M — score left + 6 subscore bars right
//   L — title bar + radar SVG (inline) + subscore bars + compact evidence/missing
//   Detail panel — hero (big radar + weakest-dim card) + dimension score rows + full evidence/gaps per dim

const _DASH_HARNESS_DIMS = [
    'instructions', 'harness_config', 'loop_engineering',
    'memory_learning', 'delegation', 'safety_governance',
];

const _DASH_HARNESS_DIM_KEYS: Record<string, string> = {
    instructions:       'dashHarnessDimInstructions',
    harness_config:     'dashHarnessDimHarnessConfig',
    loop_engineering:   'dashHarnessDimLoopEngineering',
    memory_learning:    'dashHarnessDimMemoryLearning',
    delegation:         'dashHarnessDimDelegation',
    safety_governance:  'dashHarnessDimSafetyGovernance',
};

const _DASH_HARNESS_LEVEL_KEYS: Record<string, string> = {
    none_adhoc:     'dashHarnessLevelNoneAdhoc',
    basic:          'dashHarnessLevelBasic',
    structured:     'dashHarnessLevelStructured',
    engineered:     'dashHarnessLevelEngineered',
    self_improving: 'dashHarnessLevelSelfImproving',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _dashHarnessColor(score) {
    return _dashHealthColor(score);
}

// Derive a short abbreviation from the i18n label:
//   CJK: first 2 characters; Latin: first word (up to 6 chars).
function _dashHarnessAbbr(fullLabel) {
    const s = String(fullLabel || '');
    // CJK check: first character is in a CJK range
    if (/[一-鿿぀-ヿ]/.test(s.charAt(0))) {
        return s.slice(0, 2);
    }
    const word = s.split(/[\s&\/]+/)[0] || s;
    return word.slice(0, 6);
}

// opts: { detail?: boolean, style?: string }
//   detail=true → wider 240×240 viewBox, bigger label font, full i18n names (may wrap)
//   detail=false (default) → compact 200×200, short abbrs
function _dashHarnessRadarSvg(breakdown, opts: any = {}) {
    const isDetail = !!opts.detail;
    const vbSize   = isDetail ? 240 : 200;
    const cx = vbSize / 2, cy = vbSize / 2;
    const maxR     = isDetail ? 88 : 78;
    const labelR   = isDetail ? maxR + 22 : maxR + 13;
    const labelFont = isDetail ? 9.5 : 7.5;
    const n = _DASH_HARNESS_DIMS.length;
    const angles = Array.from({ length: n }, (_, i) => -Math.PI / 2 + i * (Math.PI * 2 / n));

    const rings = [2.5, 5, 7.5, 10].map(v => {
        const r = maxR * v / 10;
        const pts = angles.map(a =>
            `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
        ).join(' ');
        return `<polygon points="${pts}" fill="none" stroke="var(--muted,#888)" stroke-width="0.5" opacity="0.35"/>`;
    }).join('');

    const axes = angles.map(a => {
        const x2 = (cx + maxR * Math.cos(a)).toFixed(1);
        const y2 = (cy + maxR * Math.sin(a)).toFixed(1);
        return `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="var(--muted,#888)" stroke-width="0.5" opacity="0.35"/>`;
    }).join('');

    const lbls = angles.map((a, i) => {
        const fullLabel = _dashT(_DASH_HARNESS_DIM_KEYS[_DASH_HARNESS_DIMS[i]] || _DASH_HARNESS_DIMS[i]);
        const displayLabel = isDetail ? fullLabel : _dashHarnessAbbr(fullLabel);
        const x = (cx + labelR * Math.cos(a)).toFixed(1);
        const y = (cy + labelR * Math.sin(a)).toFixed(1);

        if (isDetail) {
            // Split long labels into two tspan lines at the midpoint
            const words = displayLabel.split(/\s+/);
            let line1 = displayLabel, line2 = '';
            if (words.length > 1) {
                const mid = Math.ceil(words.length / 2);
                line1 = words.slice(0, mid).join(' ');
                line2 = words.slice(mid).join(' ');
            }
            if (line2) {
                return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="${labelFont}" fill="var(--fg,#ccc)" opacity="0.8">
  <tspan x="${x}" dy="-0.55em">${_dashEscape(line1)}</tspan>
  <tspan x="${x}" dy="1.1em">${_dashEscape(line2)}</tspan>
</text>`;
            }
            return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="${labelFont}" fill="var(--fg,#ccc)" opacity="0.8">${_dashEscape(displayLabel)}</text>`;
        }
        return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="${labelFont}" fill="var(--fg,#ccc)" opacity="0.65">${_dashEscape(displayLabel)}</text>`;
    }).join('');

    const bd = breakdown || {};
    const dataPts = _DASH_HARNESS_DIMS.map((dim, i) => {
        const v = Math.max(0, Math.min(10, Number(bd[dim] || 0)));
        const r = maxR * v / 10;
        return `${(cx + r * Math.cos(angles[i])).toFixed(1)},${(cy + r * Math.sin(angles[i])).toFixed(1)}`;
    }).join(' ');

    const styleAttr = opts.style ? ` style="${opts.style}"` : (isDetail ? ' style="width:100%;max-width:320px;height:auto;display:block;margin:0 auto"' : ' style="width:100%;max-width:200px;height:auto;display:block;margin:0 auto"');
    return `<svg viewBox="0 0 ${vbSize} ${vbSize}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"${styleAttr}>${rings}${axes}<polygon points="${dataPts}" fill="var(--accent-tint,rgba(100,180,255,0.18))" stroke="var(--accent,#64b4ff)" stroke-width="1.5"/>${lbls}</svg>`;
}

function _dashHarnessSubscoreBars(breakdown, weights) {
    const bd = breakdown || {};
    const wt = weights || {};
    return _DASH_HARNESS_DIMS.map(dim => {
        const v = Number(bd[dim] || 0);
        const w = Number(wt[dim] || 0);
        const pct = Math.round((v / 10) * 100);
        const c = _dashHarnessColor(v);
        const fullLabel = _dashT(_DASH_HARNESS_DIM_KEYS[dim] || dim);
        const label = _dashEscape(fullLabel);
        return `<div class="dash-kpi-bar-row">
  <span class="dash-kpi-bar-label" title="${label}">${label}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${pct}%;background:${c}"></div></div>
  <span class="dash-kpi-bar-val">${v.toFixed(1)}</span>
  <span style="font-size:0.62rem;opacity:0.4;min-width:26px;text-align:right">w${Math.round(w * 100)}%</span>
</div>`;
    }).join('');
}

// Returns true if path is resolvable in the loaded graph (same logic as _dashFindModule)
function _dashHarnessPathInGraph(filePath) {
    if (!filePath || !window.DATA) return false;
    const norm = String(filePath).replace(/\\/g, '/');
    for (const bucket of [DATA.files_by_module || {}, DATA.other_files_by_module || {}]) {
        for (const files of Object.values(bucket)) {
            if ((files || []).some((f: any) => (f.path || '').replace(/\\/g, '/') === norm)) return true;
        }
    }
    return false;
}

// Compact evidence section used in grid (L) mode — top-3 cap, inline styles
function _dashHarnessEvidenceSection(evidence, missing) {
    const ev = evidence || {};
    const ms = missing || {};
    return _DASH_HARNESS_DIMS.map(dim => {
        const items = ev[dim] || [];
        const gaps  = ms[dim] || [];
        const top3  = items.slice(0, 3);
        const more  = items.length - top3.length;
        const dimLabel = _dashEscape(_dashT(_DASH_HARNESS_DIM_KEYS[dim] || dim));

        const evRows = top3.map(e =>
            `<div style="display:flex;align-items:baseline;gap:4px;font-size:0.68rem;padding:1px 0">
  <span class="dash-arch-status-dot" style="color:var(--status-good);background:var(--status-good);flex-shrink:0;margin-top:4px"></span>
  <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_dashEscape(e.signal || '')} <span style="opacity:0.4">${_dashEscape(e.path || '')}</span></span>
  <span style="opacity:0.45;white-space:nowrap">+${Number(e.points || 0).toFixed(1)}</span>
</div>`
        ).join('');

        const moreHtml = more > 0
            ? `<div style="font-size:0.62rem;opacity:0.35;padding:1px 0 2px 14px">+${more} more</div>`
            : '';

        const msRows = gaps.slice(0, 3).map(m =>
            `<div style="display:flex;align-items:baseline;gap:4px;font-size:0.68rem;padding:1px 0">
  <span class="dash-arch-status-dot" style="color:var(--status-warn);background:var(--status-warn);flex-shrink:0;margin-top:4px"></span>
  <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.65">${_dashEscape(m)}</span>
</div>`
        ).join('');

        return `<div style="margin-bottom:8px">
  <div style="font-size:0.7rem;font-weight:600;opacity:0.6;margin-bottom:2px">${dimLabel}</div>
  ${evRows}${moreHtml}${msRows}
</div>`;
    }).join('');
}

// Full evidence section for DETAIL mode — all entries, clickable file rows, gap pills
function _dashHarnessDetailEvidenceSection(evidence, missing) {
    const ev = evidence || {};
    const ms = missing || {};
    const gapLbl = _dashEscape(_dashT('dashHarnessGapLabel'));

    return _DASH_HARNESS_DIMS.map(dim => {
        const items = ev[dim] || [];
        const gaps  = ms[dim] || [];
        const dimLabel = _dashEscape(_dashT(_DASH_HARNESS_DIM_KEYS[dim] || dim));
        const groupId = `dash-harness-ev-${dim}`;

        const evRows = items.map(e => {
            const filePath = e.path || '';
            const pts = `+${Number(e.points || 0).toFixed(1)}`;
            const signal = _dashEscape(e.signal || '');
            const pathEsc = _dashEscape(filePath);
            if (filePath && _dashHarnessPathInGraph(filePath)) {
                return `<div class="dash-harness-ev-row" data-clickable="true" title="${pathEsc}"
     data-tip="${pathEsc}"
     onclick="_dashGoToGraphFile(${_dashJson(filePath)}, null)">
  <span class="dash-arch-status-dot dash-harness-ev-dot--good"></span>
  <span class="dash-harness-ev-signal">${signal}</span>
  <span class="dash-harness-ev-path">${pathEsc}</span>
  <span class="dash-harness-ev-pts">${_dashEscape(pts)}</span>
</div>`;
            }
            return `<div class="dash-harness-ev-row" title="${pathEsc}">
  <span class="dash-arch-status-dot dash-harness-ev-dot--good"></span>
  <span class="dash-harness-ev-signal">${signal}</span>
  <span class="dash-harness-ev-path">${pathEsc}</span>
  <span class="dash-harness-ev-pts">${_dashEscape(pts)}</span>
</div>`;
        }).join('');

        const msRows = gaps.map(m =>
            `<div class="dash-harness-ev-row">
  <span class="dash-arch-status-dot dash-harness-ev-dot--gap"></span>
  <span class="dash-harness-ev-signal">${_dashEscape(m)}</span>
  <span class="dash-harness-ev-path"></span>
  <span class="dash-harness-ev-pts"><span class="dash-sev-pill dash-sev-bg-warn">${gapLbl}</span></span>
</div>`
        ).join('');

        const empty = !items.length && !gaps.length
            ? `<div style="font-size:0.72rem;opacity:0.4;padding:4px 0">—</div>`
            : '';

        return `<div class="dash-harness-ev-group" id="${groupId}">
  <div class="dash-report-section-head">
    <div class="dash-report-section-title">${dimLabel}</div>
  </div>
  <div class="dash-harness-ev-rows">${evRows}${msRows}${empty}</div>
</div>`;
    }).join('');
}

function _dashHarnessEmptyCard(container) {
    container.innerHTML = `
<div class="dash-card" style="display:flex;align-items:center;justify-content:center;height:100%;opacity:0.5">
  <div style="text-align:center;font-size:0.85rem">
    ${_dashEscape(_dashT('dashHarnessEmptyTitle'))}<br>
    <span style="font-size:0.72rem;opacity:0.6">${_dashEscape(_dashT('dashHarnessEmptyBody'))}</span>
  </div>
</div>`;
}

// ── Registration ──────────────────────────────────────────────────────────────

_dashRegisterWidget({
    id: 'harness_scan',
    labelKey: 'dashHarnessTitle',
    descriptionKey: 'dashDescHarness',
    defaultSize: 'L',

    render(container, size, stats) {
        const hs = stats.harness_scan || null;
        if (!hs) { _dashHarnessEmptyCard(container); return; }

        const score  = Number(hs.score || 0);
        const level  = hs.level || 'none_adhoc';
        const color  = _dashHarnessColor(score);
        const lvlLbl = _dashEscape(_dashT(_DASH_HARNESS_LEVEL_KEYS[level] || level));

        if (size === 'S') {
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">${_dashEscape(_dashT('dashHarnessTitle'))}</div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:4px;min-height:0">
      <span style="font-size:2.2rem;font-weight:700;color:${color};line-height:1">${score.toFixed(1)}</span>
      <span style="font-size:0.62rem;opacity:0.4">/10</span>
      <span style="font-size:0.7rem;font-weight:600;color:${color}">${lvlLbl}</span>
    </div>
  </div>
</div>`;
            return;
        }

        const bars = _dashHarnessSubscoreBars(hs.breakdown, hs.weights);

        if (size === 'M') {
            container.innerHTML = `
<div class="dash-kpi-m" style="display:flex;height:100%">
  <div class="dash-kpi-m-left" style="align-items:center;text-align:center;min-width:120px;justify-content:center">
    <div class="dash-widget-title">${_dashEscape(_dashT('dashHarnessTitle'))}</div>
    <div style="display:flex;align-items:baseline;gap:3px;justify-content:center">
      <span style="font-size:2rem;font-weight:700;color:${color}">${score.toFixed(1)}</span>
      <span style="font-size:0.78rem;opacity:0.4">/10</span>
    </div>
    <div style="font-size:0.7rem;font-weight:600;color:${color};margin-top:4px">${lvlLbl}</div>
  </div>
  <div class="dash-kpi-m-sep"></div>
  <div class="dash-kpi-m-right" style="flex:1;min-width:0;overflow-y:auto">${bars}</div>
</div>`;
            return;
        }

        // L — radar + bars + compact evidence/missing
        container.innerHTML = `
<div style="display:flex;flex-direction:column;height:100%;gap:6px;box-sizing:border-box">
  <div class="dash-card-title">
    <span class="dash-card-title-dot" style="background:${color}"></span>
    ${_dashEscape(_dashT('dashHarnessTitle'))}
    <span style="margin-left:auto;font-size:1.15rem;font-weight:700;color:${color}">${score.toFixed(1)}<span style="font-size:0.68rem;opacity:0.4">/10</span></span>
    <span style="font-size:0.7rem;font-weight:600;color:${color};margin-left:6px">${lvlLbl}</span>
  </div>
  <div style="display:flex;gap:10px;flex:1;min-height:0;overflow:hidden">
    <div style="flex:0 0 auto;display:flex;align-items:center">
      ${_dashHarnessRadarSvg(hs.breakdown)}
    </div>
    <div style="flex:1;min-width:0;overflow-y:auto;display:flex;flex-direction:column;gap:1px">
      ${bars}
    </div>
  </div>
  <div style="overflow-y:auto;max-height:110px;border-top:1px solid var(--border,rgba(255,255,255,0.08));padding-top:5px">
    <div style="font-size:0.68rem;font-weight:600;opacity:0.55;margin-bottom:4px">${_dashEscape(_dashT('dashHarnessEvidence'))}</div>
    ${_dashHarnessEvidenceSection(hs.evidence, hs.missing)}
  </div>
</div>`;
    },

    renderDetail(container, stats) {
        const hs = stats.harness_scan || null;
        if (!hs) { _dashHarnessEmptyCard(container); return; }

        const score  = Number(hs.score || 0);
        const level  = hs.level || 'none_adhoc';
        const color  = _dashHarnessColor(score);
        const lvlLbl = _dashEscape(_dashT(_DASH_HARNESS_LEVEL_KEYS[level] || level));
        const bd     = hs.breakdown || {};
        const wt     = hs.weights || {};

        // Sort dims by score ascending to find weakest
        const dimsWithScore = _DASH_HARNESS_DIMS.map(dim => ({
            dim,
            score: Number(bd[dim] || 0),
            label: _dashT(_DASH_HARNESS_DIM_KEYS[dim] || dim),
        })).sort((a, b) => a.score - b.score);
        const weakest = dimsWithScore[0];

        // Weakest dim's top 1-2 missing gaps
        const weakestGaps = ((hs.missing || {})[weakest ? weakest.dim : ''] || []).slice(0, 2);
        const weakestGapLbl = _dashEscape(_dashT('dashHarnessGapLabel'));
        const weakestGapHtml = weakestGaps.length
            ? weakestGaps.map(g => `<div class="dash-harness-weakest-gap">
  <span class="dash-arch-status-dot dash-harness-ev-dot--gap"></span>
  <span>${_dashEscape(g)}</span>
</div>`).join('')
            : `<div style="font-size:0.72rem;opacity:0.4">—</div>`;

        // Dimension score rows (sorted ascending = worst first)
        const dimRows = dimsWithScore.map(({ dim, score: v, label }) => {
            const pct = Math.round((v / 10) * 100);
            const c   = _dashHarnessColor(v);
            const lbl = _dashEscape(label);
            const groupId = `dash-harness-ev-${dim}`;
            return `<div class="dash-code-health-detail-row" data-clickable="true" title="${lbl}"
     onclick="(function(){ var el=document.getElementById(${_dashJson(groupId)}); if(el){ el.scrollIntoView({behavior:'smooth',block:'start'}); el.classList.add('dash-harness-highlight'); setTimeout(function(){ el.classList.remove('dash-harness-highlight'); }, 1200); } })()">
  <span class="dash-code-health-detail-row__name" title="${lbl}">${lbl}</span>
  <div class="dash-code-health-detail-row__track"><i style="width:${pct}%;background:${c}"></i></div>
  <span class="dash-code-health-detail-row__score" style="color:${c}">${v.toFixed(1)} / 10</span>
  <span class="dash-code-health-detail-row__meta">w ${Math.round(Number(wt[dim] || 0) * 100)}%</span>
</div>`;
        }).join('');

        const summaryText = _dashT('dashHarnessDetailSummary').replace('{level}', _dashT(_DASH_HARNESS_LEVEL_KEYS[level] || level));

        container.innerHTML = `
<div class="dash-harness-detail-panel">
  <section class="dash-code-health-detail-panel__hero">
    <div class="dash-code-health-detail-panel__copy">
      <div class="dash-code-health-detail-panel__eyebrow">${_dashEscape(_dashT('dashHarnessTitle'))}</div>
      <h2 class="dash-code-health-detail-panel__title">${_dashEscape(_dashT('dashHarnessTitle'))}</h2>
      <div class="dash-code-health-detail-panel__primary">
        <span class="dash-code-health-detail-panel__primary-value" style="color:${color}">${score.toFixed(1)}</span>
        <span class="dash-code-health-detail-panel__primary-suffix">/ 10</span>
      </div>
      <p class="dash-code-health-detail-panel__summary">${_dashEscape(summaryText)}</p>
    </div>
    <div class="dash-code-health-detail-panel__visual">
      ${_dashHarnessRadarSvg(hs.breakdown, { detail: true })}
      <div class="dash-code-health-diagnostic__status" style="color:${color}">${lvlLbl}</div>
      <div class="dash-harness-weakest-card">
        <div class="dash-harness-weakest-card__title">${_dashEscape(_dashT('dashHarnessWeakestDim'))}</div>
        <div class="dash-harness-weakest-card__dim" style="color:${_dashHarnessColor(weakest ? weakest.score : 0)}">
          ${_dashEscape(weakest ? weakest.label : '—')}
          <span class="dash-harness-weakest-card__score">${weakest ? weakest.score.toFixed(1) : '—'}</span>
        </div>
        <div class="dash-harness-weakest-card__caption">${_dashEscape(_dashT('dashHarnessWeakestCaption'))}</div>
        <div class="dash-harness-weakest-card__gaps">${weakestGapHtml}</div>
      </div>
    </div>
  </section>

  <div class="dash-code-health-detail-panel__sections">
    <section class="dash-code-health-section">
      <div class="dash-code-health-section__head">
        <div class="dash-code-health-section__title">${_dashEscape(_dashT('dashHarnessDimScores'))}</div>
      </div>
      <div class="dash-code-health-detail-rows">${dimRows}</div>
    </section>

    <section class="dash-code-health-section">
      <div class="dash-code-health-section__head">
        <div class="dash-code-health-section__title">${_dashEscape(_dashT('dashHarnessEvidence'))}</div>
      </div>
      <div class="dash-harness-evidence-body">
        ${_dashHarnessDetailEvidenceSection(hs.evidence, hs.missing)}
      </div>
    </section>
  </div>
</div>`;
    },
});
