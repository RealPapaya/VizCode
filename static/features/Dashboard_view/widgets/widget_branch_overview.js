// @module Dashboard_view/widgets/widget_branch_overview

_dashRegisterWidget({
    id: 'branch_overview',
    labelKey: 'dashBranchOverviewTitle',
    descriptionKey: 'dashDescBranchOverview',
    defaultSize: 'L',
    sizeTiers: { M: { w: 2, h: 1 }, L: { w: 4, h: 2 } },

    render(container, size, stats) {
        console.log('[branch_overview] render called, size=', size, 'branch_analysis=', stats.branch_analysis ? 'present' : 'null');
        const branchData = stats.branch_analysis || null;
        if (size === 'L') {
            _dashRenderBranchLarge(container, stats, branchData);
        } else {
            _dashRenderBranchMedium(container, stats, branchData);
        }
    },

    renderDetail(container, stats) {
        _dashRenderBranchLarge(container, stats, stats.branch_analysis || null, { detail: true });
    },
});

// ── Shared data loader ────────────────────────────────────────────────────────

function _dashBranchLoad(container, stats, onData) {
    const cached = stats.branch_analysis;
    if (cached) { onData(cached); return; }

    const jobId = (typeof DATA !== 'undefined' && DATA.job_id) ? DATA.job_id : '';
    const url   = '/api/branches' + (jobId ? `?job_id=${encodeURIComponent(jobId)}` : '');
    console.log('[branch_overview] fetching', url);

    fetch(url)
        .then(r => r.json())
        .then(data => {
            console.log('[branch_overview] API response:', JSON.stringify(data).slice(0, 300));
            if (data && data.branches) {
                if (typeof DATA !== 'undefined') DATA.stats.branch_analysis = data;
                onData(data);
            } else {
                _dashBranchShowError(container, data.error || _dashT('dashBranchNoData'));
            }
        })
        .catch(err => {
            console.error('[branch_overview] fetch error:', err);
            _dashBranchShowError(container, _dashT('dashBranchNoData'));
        });
}

function _dashBranchShowError(container, msg) {
    const body = container.querySelector('.dash-bf-body')
        || container.querySelector('#dash-branch-list-l')
        || container.querySelector('#dash-branch-diff-panel')
        || container;
    body.innerHTML = `<div class="dash-empty">${_dashEscape(msg)}</div>`;
}

// ── M size (2×1): compact branch list ────────────────────────────────────────

function _dashRenderBranchMedium(container, stats, branchData) {
    container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashBranchOverviewTitle'))}
</div>
<div class="dash-list dash-bf-body" id="dash-branch-list-m"></div>`;

    _dashBranchLoad(container, stats, data => {
        const el = container.querySelector('#dash-branch-list-m') || container.querySelector('.dash-bf-body');
        if (!el) return;
        const branches = data.branches || [];
        if (!branches.length) { el.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashBranchNoData'))}</div>`; return; }

        el.innerHTML = branches.slice(0, 6).map(b => _dashBranchRowCompact(b, data.base_branch)).join('');
    });
}

function _dashBranchRowCompact(b, base) {
    const name     = _dashEscape(b.name || '');
    const isCur    = b.is_current;
    const ahead    = b.ahead || 0;
    const behind   = b.behind || 0;
    const hotCount = (b.touches_hotspots || []).length;

    return `
<div class="dash-list-row" style="display:flex;align-items:center;gap:6px;padding:4px 4px">
  <span style="width:6px;height:6px;border-radius:50%;background:${isCur ? 'var(--status-good)' : 'var(--panel-border-color)'};flex-shrink:0"></span>
  <span class="dash-list-label" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.78rem;${isCur ? 'font-weight:600' : ''}">${name}</span>
  ${ahead ? `<span class="dash-pill" style="font-size:0.68rem;padding:1px 5px;background:rgba(164,181,91,0.25);color:var(--status-good)">↑${ahead}</span>` : ''}
  ${behind ? `<span class="dash-pill" style="font-size:0.68rem;padding:1px 5px;background:rgba(224,90,90,0.2);color:var(--status-bad)">↓${behind}</span>` : ''}
  ${hotCount ? `<span class="dash-pill" style="font-size:0.68rem;padding:1px 5px;background:rgba(223,167,69,0.25);color:var(--status-warn)" title="${_dashEscape(_dashT('dashBranchHotspots'))}">⚠ ${hotCount}</span>` : ''}
</div>`;
}

// ── L size (4×2): branch list + diff panel ────────────────────────────────────

function _dashRenderBranchLarge(container, stats, branchData, opts) {
    const isDetail = !!(opts && opts.detail);
    if (isDetail) {
        container.innerHTML = _dashReportSection({
            title: _dashT('dashBranchOverviewTitle'),
            body: _dashReportGrid([
                _dashReportSection({
                    title: _dashT('dashBranchOverviewTitle'),
                    body: _dashReportList('', { id: 'dash-branch-list-l' }),
                }),
                _dashReportSection({
                    title: 'Branch Diff',
                    body: `<div id="dash-branch-diff-panel" class="dash-report-list" style="font-size:0.78rem"></div>`,
                }),
            ], { columns: 2 }),
        });
    } else {
    container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashBranchOverviewTitle'))}
</div>
<div class="dash-bf-body" style="display:flex;gap:0.75rem;flex:1;min-height:0;overflow:hidden">
  <div id="dash-branch-list-l" class="dash-list" style="flex:0 0 44%;overflow-y:auto;border-right:1px solid var(--panel-border-color);padding-right:0.5rem"></div>
  <div id="dash-branch-diff-panel" class="" style="flex:1;overflow-y:auto;font-size:0.78rem"></div>
</div>`;
    }

    _dashBranchLoad(container, stats, data => {
        const listEl = container.querySelector('#dash-branch-list-l');
        const diffEl = container.querySelector('#dash-branch-diff-panel');
        if (!listEl) return;

        const branches = data.branches || [];
        if (!branches.length) {
            listEl.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashBranchNoData'))}</div>`;
            return;
        }

        function selectBranch(b) {
            listEl.querySelectorAll('.dash-branch-row').forEach(r => r.classList.remove('dash-branch-row--active'));
            const row = listEl.querySelector(`[data-branch="${CSS.escape(b.name)}"]`);
            if (row) row.classList.add('dash-branch-row--active');
            _dashBranchShowDiff(diffEl, b, data.base_branch, stats);
        }

        listEl.innerHTML = branches.map(b => _dashBranchRowFull(b, data.base_branch)).join('');
        listEl.querySelectorAll('.dash-branch-row').forEach(row => {
            row.addEventListener('click', () => {
                const name = row.dataset.branch;
                const b = branches.find(x => x.name === name);
                if (b) selectBranch(b);
            });
        });

        // Auto-select current branch
        const cur = branches.find(b => b.is_current) || branches[0];
        if (cur) selectBranch(cur);
    });
}

function _dashBranchRowFull(b, base) {
    const name     = _dashEscape(b.name || '');
    const isCur    = b.is_current;
    const ahead    = b.ahead || 0;
    const behind   = b.behind || 0;
    const author   = _dashEscape((b.author || '').split(' ')[0]);
    const date     = _dashEscape(b.date || '');
    const hotCount = (b.touches_hotspots || []).length;
    const cx       = b.avg_complexity_touched != null ? b.avg_complexity_touched.toFixed(1) : null;

    return `
<div class="dash-branch-row dash-list-row" data-branch="${name}"
     style="display:flex;flex-direction:column;gap:3px;padding:6px 4px;cursor:pointer;${isCur ? 'border-left:2px solid var(--status-good);padding-left:6px' : ''}">
  <div style="display:flex;align-items:center;gap:5px">
    <span style="font-size:0.8rem;font-weight:${isCur ? '600' : '400'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1" title="${name}">${name}</span>
    ${isCur ? `<span class="dash-pill" style="font-size:0.65rem;padding:0 4px;background:var(--status-good);color:#000">HEAD</span>` : ''}
  </div>
  <div style="display:flex;align-items:center;gap:5px;opacity:0.65;font-size:0.7rem">
    <span>${author}</span>
    <span style="opacity:0.5">·</span>
    <span>${date}</span>
    ${ahead  ? `<span style="color:var(--status-good)">↑${ahead}</span>` : ''}
    ${behind ? `<span style="color:var(--status-bad)">↓${behind}</span>`  : ''}
    ${hotCount ? `<span style="color:var(--status-warn)">⚠${hotCount}</span>` : ''}
    ${cx ? `<span style="color:${_dashHealthColor(10 - Math.min(cx, 10))}">cx:${cx}</span>` : ''}
  </div>
</div>`;
}

function _dashBranchShowDiff(panel, b, base, stats) {
    if (!panel) return;

    if (b.name === base) {
        panel.innerHTML = `<div style="opacity:0.5;padding:1rem 0.5rem;font-size:0.8rem">${_dashEscape(_dashT('dashBranchIsBase'))}</div>`;
        return;
    }

    panel.innerHTML = `<div style="opacity:0.5;padding:0.5rem;font-size:0.78rem">${_dashEscape(_dashT('dashBranchLoading'))}</div>`;

    const jobId = (typeof DATA !== 'undefined' && DATA.job_id) ? DATA.job_id : '';
    const url = '/api/branch-diff?branch=' + encodeURIComponent(b.name) + (jobId ? `&job_id=${encodeURIComponent(jobId)}` : '');

    fetch(url)
        .then(r => r.json())
        .then(diff => {
            if (diff.error) { panel.innerHTML = `<div class="dash-empty">${_dashEscape(diff.error)}</div>`; return; }
            _dashBranchRenderDiff(panel, b, diff, stats);
        })
        .catch(() => { panel.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashBranchNoData'))}</div>`; });
}

function _dashBranchRenderDiff(panel, b, diff, stats) {
    const hotspotSet = new Set((stats.hotspot_files || []).map(h => h.file));
    const files = diff.files || [];

    const adds = diff.additions || 0;
    const dels = diff.deletions || 0;
    const commits = diff.commits || [];

    panel.innerHTML = `
<div style="display:flex;gap:0.5rem;margin-bottom:0.6rem;flex-wrap:wrap">
  <span class="dash-pill" style="font-size:0.72rem">${files.length} ${_dashEscape(_dashT('dashBranchFiles'))}</span>
  <span class="dash-pill" style="background:rgba(164,181,91,0.2);color:var(--status-good);font-size:0.72rem">+${adds}</span>
  <span class="dash-pill" style="background:rgba(224,90,90,0.2);color:var(--status-bad);font-size:0.72rem">-${dels}</span>
  <span class="dash-pill" style="font-size:0.72rem">${commits.length} ${_dashEscape(_dashT('dashBranchCommits'))}</span>
</div>
<div style="margin-bottom:0.5rem">
${files.slice(0, 20).map(f => {
    const fname  = String(f).split('/').pop();
    const isHot  = hotspotSet.has(f);
    return `<div style="display:flex;align-items:center;gap:5px;padding:2px 0;font-size:0.75rem;white-space:nowrap;overflow:hidden">
  ${isHot ? '<span title="hotspot" style="color:var(--status-warn)">⚠</span>' : '<span style="opacity:0"> </span>'}
  <span style="overflow:hidden;text-overflow:ellipsis;flex:1" title="${_dashEscape(f)}">${_dashEscape(fname)}</span>
</div>`;
}).join('')}
${files.length > 20 ? `<div style="opacity:0.5;font-size:0.72rem;padding-top:2px">+ ${files.length - 20} ${_dashEscape(_dashT('dashBranchMore'))}</div>` : ''}
</div>
${commits.length ? `<div style="opacity:0.55;font-size:0.7rem;border-top:1px solid var(--panel-border-color);padding-top:0.4rem">
${commits.slice(0, 5).map(c => `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 0">${_dashEscape(c)}</div>`).join('')}
${commits.length > 5 ? `<div style="opacity:0.6">+ ${commits.length - 5} more</div>` : ''}
</div>` : ''}`;
}
