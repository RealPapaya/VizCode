// @ts-nocheck -- JS->TS migration: deferred (leaf widget renderer). Curate later.
// @module Dashboard_view/widgets/widget_health_trend

_dashRegisterWidget({
    id: 'health_trend',
    labelKey: 'dashHealthTrendTitle',
    descriptionKey: 'dashDescHealthTrend',
    defaultSize: 'M',

    render(container, size, stats) {
        console.log('[health_trend] render called, size=', size, 'history length=', (stats.health_history || []).length);
        const history = stats.health_history || [];
        const canvasId = 'dash-chart-health-trend-' + (container.dataset.dashWidgetSeq || Math.random().toString(36).slice(2, 6));
        container.dataset.dashWidgetSeq = canvasId;

        container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashHealthTrendTitle'))}
</div>
<div class="dash-chart-wrap" style="flex:1;min-height:0"><canvas id="${canvasId}"></canvas></div>`;

        if (history.length < 2) {
            const wrap = container.querySelector('.dash-chart-wrap');
            if (wrap) {
                if (history.length === 1) {
                    const h = history[0];
                    const s = Number(h.score || 0);
                    const col = _dashHealthColor(s);
                    wrap.innerHTML = `<div style="padding:0.6rem 0.5rem;display:flex;align-items:center;gap:0.75rem">
  <div style="font-size:2.2rem;font-weight:700;color:${col};line-height:1">${s.toFixed(1)}</div>
  <div style="font-size:0.72rem;opacity:0.6;line-height:1.6">
    <div>${_dashEscape(h.date || (h.ts || '').slice(0, 10))}</div>
    <div style="opacity:0.75">${_dashEscape(_dashT('dashHealthTrendEmpty'))}</div>
  </div>
</div>`;
                } else {
                    wrap.innerHTML = `<div class="dash-empty" style="padding:1rem 0.5rem;font-size:0.8rem;opacity:0.55">${_dashEscape(_dashT('dashHealthTrendEmpty'))}</div>`;
                }
            }
            return;
        }

        const recent = history.slice(-20);
        const labels = _dashHealthTrendLabels(recent);
        const scores = recent.map(h => Number(h.score || 0));

        const canvas = document.getElementById(canvasId);
        if (!canvas || typeof Chart === 'undefined') return;

        if (size === 'L') {
            _dashDrawHealthTrendLarge(canvas, recent, labels, scores);
        } else {
            _dashDrawHealthTrendMain(canvas, labels, scores);
        }
    },

    renderDetail(container, stats) {
        _dashRenderHealthDetail(container, stats.health_history || []);
    },
});

// Build x-axis labels: use HH:MM when all entries are on the same calendar date.
function _dashHealthTrendLabels(recent) {
    const dates = recent.map(h => h.date || (h.ts || '').slice(0, 10));
    const allSameDate = new Set(dates).size === 1 && recent.length > 1;
    if (allSameDate) {
        return recent.map(h => {
            const ts = h.ts || '';
            return ts.length >= 16 ? ts.slice(11, 16) : (h.date || ts.slice(0, 10));
        });
    }
    return dates;
}

function _dashDrawHealthTrendMain(canvas, labels, scores) {
    _dashMkChart(canvas, 'line', {
        labels,
        datasets: [{
            label: _dashT('dashCodeHealthTitle'),
            data: scores,
            borderColor: _dashAccentStop(2),
            backgroundColor: _dashAccentTint(0.15),
            borderWidth: 2.5,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: scores.map(s => _dashHealthColor(s)),
            fill: true,
        }],
    }, {
        plugins: { legend: { display: false } },
        scales: {
            x: { ticks: { maxTicksLimit: 6, maxRotation: 0 } },
            y: { min: 0, max: 10, ticks: { stepSize: 2 } },
        },
    });
}

// ── Detail panel renderer + backfill UI ──────────────────────────────────────

// Module-level backfill state persists across detail panel open/close cycles.
const _dashBfState = { token: null, timer: null, mode: null, finished: false, newCount: 0 };

function _dashRenderHealthDetail(container, history) {
    const latest  = history[history.length - 1] || null;
    const prev    = history.length > 1 ? history[history.length - 2] : null;
    const score   = latest ? Number(latest.score || 0) : null;
    const col     = score != null ? _dashHealthColor(score) : 'var(--muted)';
    const delta   = (latest && prev) ? (score - Number(prev.score || 0)) : null;
    const deltaStr = delta == null ? '' : (delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1));
    const deltaCol = delta == null ? 'inherit'
                   : delta > 0 ? 'var(--status-good)'
                   : delta < 0 ? 'var(--status-bad)' : 'var(--muted)';

    const subKeys   = ['complexity', 'coupling', 'dead_code', 'duplication', 'cohesion'];
    const subLabels = [
        _dashT('dashHealthComplexity'), _dashT('dashHealthCoupling'),
        _dashT('dashHealthDeadCode'),   _dashT('dashHealthDuplication'),
        _dashT('dashHealthCohesion'),
    ];
    const bd = (latest && latest.breakdown) || {};

    // ── Summary strip ────────────────────────────────────────────────────────
    const summaryHtml = score != null ? `
<section class="dash-report-section">
  <div class="dash-detail-stat-row">
    <div>
      <span style="font-size:2rem;font-weight:700;color:${col}">${score.toFixed(1)}</span>
      <span style="font-size:0.85rem;opacity:0.45">&nbsp;/ 10</span>
    </div>
    ${delta != null ? `<span style="font-size:1rem;font-weight:600;color:${deltaCol}">${deltaStr}</span>` : ''}
    <div style="flex:1"></div>
    <div style="font-size:0.72rem;opacity:0.45;text-align:right">
      <div>${_dashEscape(latest.date || (latest.ts || '').slice(0, 10))}</div>
      <div style="margin-top:2px">${history.length} data point${history.length !== 1 ? 's' : ''}</div>
    </div>
  </div>
  <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:10px">
    ${subKeys.map((k, i) => {
        const v = Number(bd[k] || 0);
        const c = _dashHealthColor(v);
        return `<div style="font-size:0.75rem;padding:3px 8px;border-radius:4px;background:var(--surface-elevated)">
          <span style="color:${c};font-weight:600">${v.toFixed(1)}</span>
          <span style="opacity:0.5;margin-left:3px">${_dashEscape(subLabels[i])}</span>
        </div>`;
    }).join('')}
  </div>
</section>` : '';

    // ── Chart area ───────────────────────────────────────────────────────────
    const canvasId  = 'dash-chart-ht-detail';
    const chartHtml = history.length >= 2 ? `
<div class="dash-report-chart dash-report-chart--lg">
  <canvas id="${canvasId}" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
</div>` : `
<div class="dash-empty" style="display:flex;align-items:center;justify-content:center;font-size:0.82rem;opacity:0.5">
  ${_dashEscape(_dashT('dashHealthTrendEmpty'))}
</div>`;

    // ── Backfill panel ───────────────────────────────────────────────────────
    const bfHtml = `<div id="dash-ht-bf-panel" style="flex-shrink:0"></div>`;

    container.innerHTML = `
${summaryHtml}
${_dashReportSection({ title: _dashT('dashHealthTrendTitle'), body: chartHtml })}
${_dashReportSection({ title: 'Backfill', body: bfHtml })}`;

    // Draw chart
    if (history.length >= 2) {
        requestAnimationFrame(() => {
            const canvas = document.getElementById(canvasId);
            if (!canvas || typeof Chart === 'undefined') return;
            const recent = history.slice(-30);
            _dashDrawHealthTrendLarge(canvas, recent, _dashHealthTrendLabels(recent),
                                      recent.map(h => Number(h.score || 0)));
        });
    }

    // Render backfill panel
    _dashRenderBfPanel(container);
}

// ── Backfill panel sub-renderer ───────────────────────────────────────────────

function _dashRenderBfPanel(detailContainer) {
    const el = detailContainer.querySelector('#dash-ht-bf-panel');
    if (!el) return;

    // Running: show live progress
    if (_dashBfState.token && !_dashBfState.finished) {
        _dashBfShowProgress(el, detailContainer);
        return;
    }

    // Already finished: restore the done state
    if (_dashBfState.finished) {
        _dashBfShowDone(_dashBfState.newCount, el, detailContainer);
        return;
    }

    // Fresh: auto-kick sampled, show transient label + daily backfill option
    el.innerHTML = `
<div class="dash-report-section" style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
  <span style="font-size:0.72rem;opacity:0.45;flex:1;min-width:0">Starting sampled history analysis...</span>
  <button class="dash-btn dash-btn--ghost" onclick="_dashBfRunFull(this)">
    Full <span style="opacity:0.5;font-size:0.68rem">1/day / 90 days</span>
  </button>
</div>`;
    _dashBfStart('sample', null);
}

function _dashBfStart(mode, btn) {
    if (btn) btn.disabled = true;
    const jobId = (typeof DATA !== 'undefined' && DATA.job_id) ? DATA.job_id : '';
    const stats = (typeof DATA !== 'undefined' && DATA.stats) ? DATA.stats : {};
    const days = mode === 'commits'
        ? Math.max(7, Math.min(365, Number(stats.window_days || 90)))
        : 90;
    const body  = JSON.stringify({ mode, days, job_id: jobId });

    fetch('/api/health-backfill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        .then(r => r.json())
        .then(data => {
            if (data.error) { _dashBfShowError(data.error); return; }
            _dashBfState.token    = data.token;
            _dashBfState.mode     = mode;
            _dashBfState.finished = false;
            const panel = typeof _dashGetDetailBody === 'function'
                ? _dashGetDetailBody()
                : document.getElementById('dash-detail-body');
            const bfEl  = panel && panel.querySelector('#dash-ht-bf-panel');
            if (bfEl) _dashBfShowProgress(bfEl, panel);
        })
        .catch(err => _dashBfShowError(String(err)));
}

function _dashBfShowProgress(bfEl, detailContainer) {
    bfEl.innerHTML = `
<div class="dash-report-section">
  <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:8px">
    <div class="dash-spinner" style="width:14px;height:14px;border:2px solid var(--panel-border-color);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>
    <span style="font-size:0.78rem;font-weight:600">Analyzing git history…</span>
  </div>
  <div id="dash-ht-bf-bar-wrap" style="height:5px;background:var(--panel-border-color);border-radius:3px;overflow:hidden;margin-bottom:6px">
    <div id="dash-ht-bf-bar" style="height:100%;width:0%;background:var(--accent);border-radius:3px;transition:width 0.3s"></div>
  </div>
  <div id="dash-ht-bf-label" style="font-size:0.72rem;opacity:0.55">Starting…</div>
</div>`;

    // Add spinner keyframe once
    if (!document.getElementById('dash-spin-style')) {
        const s = document.createElement('style');
        s.id = 'dash-spin-style';
        s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(s);
    }

    if (_dashBfState.timer) clearInterval(_dashBfState.timer);
    _dashBfState.timer = setInterval(() => _dashBfPoll(bfEl, detailContainer), 1500);
}

function _dashBfPoll(bfEl, detailContainer) {
    if (!_dashBfState.token) { clearInterval(_dashBfState.timer); return; }

    fetch(`/api/health-backfill-status?token=${_dashBfState.token}`)
        .then(r => r.json())
        .then(prog => {
            const bar   = bfEl.querySelector('#dash-ht-bf-bar');
            const label = bfEl.querySelector('#dash-ht-bf-label');
            const pct   = prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;

            if (bar)   bar.style.width = pct + '%';
            if (label) label.textContent =
                prog.current_date
                    ? `${prog.done}/${prog.total} · ${prog.current_date} (${prog.current_sha})`
                    : `${prog.skipped || 0} already cached`;

            if (prog.finished) {
                clearInterval(_dashBfState.timer);
                _dashBfState.finished = true;

                if (prog.error) {
                    _dashBfShowError(prog.error, bfEl);
                    return;
                }

                // Update history in DATA and re-render the detail
                if (prog.history && prog.history.length) {
                    if (typeof DATA !== 'undefined' && DATA.stats) {
                        DATA.stats.health_history = prog.history;
                    }
                }
                _dashBfState.newCount = prog.new_count || 0;
                _dashBfShowDone(_dashBfState.newCount, bfEl, detailContainer);
            }
        })
        .catch(() => {});
}

function _dashBfShowDone(count, bfEl, detailContainer) {
    const showFull = _dashBfState.mode === 'sample';
    bfEl.innerHTML = `
<div class="dash-report-section" style="border:1px solid color-mix(in srgb,var(--status-good) 30%,transparent)">
  <div style="font-size:0.78rem;color:var(--status-good);font-weight:600;margin-bottom:8px">
    Added ${count} historical data point${count !== 1 ? 's' : ''}
  </div>
  <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
    <button class="dash-btn" onclick="_dashBfRefresh(this)">Refresh chart</button>
    ${showFull ? `<button class="dash-btn dash-btn--ghost" onclick="_dashBfRunFull(this)">
      Full <span style="opacity:0.5;font-size:0.68rem">1/day / 90 days</span>
    </button>` : ''}
  </div>
</div>`;
}

function _dashBfRefresh(btn) {
    if (btn) btn.disabled = true;
    const history = (typeof DATA !== 'undefined' && DATA.stats && DATA.stats.health_history) || [];
    const body = document.getElementById('dash-detail-report-details')
        || (typeof _dashGetDetailBody === 'function' ? _dashGetDetailBody() : document.getElementById('dash-detail-body'));
    if (body) _dashRenderHealthDetail(body, history);
}

function _dashBfRunFull(btn) {
    _dashBfState.token    = null;
    _dashBfState.finished = false;
    _dashBfState.newCount = 0;
    _dashBfStart('full', btn);
}

function _dashBfShowError(msg, bfEl) {
    const el = bfEl || document.querySelector('#dash-ht-bf-panel');
    if (el) el.innerHTML = `
<div class="dash-report-section">
  <div style="font-size:0.75rem;color:var(--status-bad)">⚠ Backfill failed: ${_dashEscape(msg)}</div>
</div>`;
}

// ── Chart helpers ─────────────────────────────────────────────────────────────

function _dashDrawHealthTrendLarge(canvas, recent, labels, scores) {
    const subKeys   = ['complexity', 'coupling', 'dead_code', 'duplication', 'cohesion'];
    const subLabels = ['dashHealthComplexity', 'dashHealthCoupling', 'dashHealthDeadCode', 'dashHealthDuplication', 'dashHealthCohesion'];
    const subColors = ['#7ec8e3', '#c57429', '#e05a5a', '#a4b55b', '#9b7fe8'];

    const subDatasets = subKeys.map((key, i) => ({
        label: _dashT(subLabels[i]),
        data: recent.map(h => Number((h.breakdown || {})[key] || 0)),
        borderColor: subColors[i],
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderDash: [4, 3],
        tension: 0.3,
        pointRadius: 3,
        fill: false,
    }));

    _dashMkChart(canvas, 'line', {
        labels,
        datasets: [
            {
                label: _dashT('dashCodeHealthTitle'),
                data: scores,
                borderColor: _dashAccentStop(2),
                backgroundColor: _dashAccentTint(0.12),
                borderWidth: 3,
                tension: 0.3,
                pointRadius: 5,
                pointBackgroundColor: scores.map(s => _dashHealthColor(s)),
                fill: true,
                order: 0,
            },
            ...subDatasets,
        ],
    }, {
        plugins: {
            legend: {
                display: true,
                position: 'bottom',
                labels: { boxWidth: 14, font: { size: 11 }, padding: 10 },
            },
        },
        scales: {
            x: { ticks: { maxTicksLimit: 8, maxRotation: 0, font: { size: 11 } } },
            y: { min: 0, max: 10, ticks: { stepSize: 2, font: { size: 11 } } },
        },
    });
}
