// @module Dashboard_view/dashboard_charts
// Chart.js helpers shared by every widget that draws a chart. Owns the
// _dashCharts registry so charts can be destroyed / recreated on re-render.
//
// Token-driven colour rules (DASHBOARD_DESIGN_SPEC.md §4):
//   • Single-accent: every chart's primary colour resolves to var(--accent)
//   • Multi-series: use _dashAccentTint(alpha) ladders, or var(--muted-series)
//   • No widget-specific hex literals — always go through these helpers

const _dashCharts = {};   // canvas-id → Chart instance

// Read a CSS custom property from :root. Trim because getComputedStyle
// returns the value with leading whitespace.
function _dashCssVar(name, fallback) {
    if (typeof document === 'undefined') return fallback || '';
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    const out = (v || '').trim();
    return out || (fallback || '');
}

function _dashHexToRgb(hex) {
    let h = String(hex || '').trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return { r: 223, g: 167, b: 69 };
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
    };
}

// Returns rgba(...) string for var(--accent) at the given alpha.
// alpha defaults to 1 (= solid accent).
function _dashAccentTint(alpha) {
    const a = (alpha == null) ? 1 : Math.max(0, Math.min(1, alpha));
    const { r, g, b } = _dashHexToRgb(_dashCssVar('--accent', '#dfa745'));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Same idea for muted gray (var(--muted)) — used where a true grey-out is
// needed (axis ticks, background series, "other" buckets in pies).
function _dashMutedTint(alpha) {
    const a = (alpha == null) ? 1 : Math.max(0, Math.min(1, alpha));
    const { r, g, b } = _dashHexToRgb(_dashCssVar('--muted', '#93918b'));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Faded border colour — for chart gridlines / axis lines.
function _dashBorderTint(alpha) {
    const a = (alpha == null) ? 1 : Math.max(0, Math.min(1, alpha));
    const { r, g, b } = _dashHexToRgb(_dashCssVar('--border', '#2e302b'));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Generate N categorical fills derived from accent. For N=1 → solid accent.
// For larger N, alpha steps from 1.0 down to 0.30 across the series.
function _dashAccentSeries(n) {
    if (!n || n < 1) return [];
    if (n === 1) return [_dashAccentTint(1)];
    const out = [];
    const top = 1.0;
    const bot = 0.30;
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        out.push(_dashAccentTint(top - t * (top - bot)));
    }
    return out;
}

function _dashApplyChartDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color           = _dashCssVar('--muted', '#93918b');
    Chart.defaults.borderColor     = _dashCssVar('--border', '#2e302b');
    Chart.defaults.font.family     = "'Segoe UI', system-ui, sans-serif";
    Chart.defaults.font.size       = 11;
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.padding  = 14;
    Chart.defaults.plugins.tooltip.backgroundColor = _dashCssVar('--surface-elevated', '#22241f');
    Chart.defaults.plugins.tooltip.borderColor     = _dashCssVar('--border', '#2e302b');
    Chart.defaults.plugins.tooltip.borderWidth     = 1;
    Chart.defaults.plugins.tooltip.titleColor      = _dashCssVar('--text', '#eae8e3');
    Chart.defaults.plugins.tooltip.bodyColor       = _dashCssVar('--muted', '#93918b');
    Chart.defaults.plugins.tooltip.padding         = 10;
}

function _dashMkChart(canvas, type, data, options) {
    if (!canvas || typeof Chart === 'undefined') return null;
    const id = canvas.id || ('dash-chart-' + Math.random().toString(36).slice(2, 8));
    canvas.id = id;
    if (_dashCharts[id]) {
        try { _dashCharts[id].destroy(); } catch (_) { /* ignore */ }
        delete _dashCharts[id];
    }
    const ctx = canvas.getContext('2d');
    _dashCharts[id] = new Chart(ctx, { type, data, options });
    return _dashCharts[id];
}

function _dashDestroyAllCharts() {
    Object.keys(_dashCharts).forEach(id => {
        try { _dashCharts[id]?.destroy(); } catch (_) { /* ignore */ }
        delete _dashCharts[id];
    });
}

// ─── Chart-type toggle (per-widget) ───────────────────────────────────────
// Each chart widget that supports multiple types registers a re-render
// handler keyed by widgetKey. State is kept in-memory across re-renders
// within the same dashboard session; full reload resets to defaults.

const _dashChartTypeState = {};      // widgetKey → currently-selected type
const _dashChartSwitchHandlers = {}; // widgetKey → fn(newType) re-renderer

const _DASH_CHART_TYPE_ICONS = {
    bar:      '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="4"  y="11" width="3" height="9"/><rect x="10" y="6"  width="3" height="14"/><rect x="16" y="14" width="3" height="6"/></svg>',
    pie:      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4 L12 12 L20 12" stroke-width="2"/></svg>',
    radar:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12,3 21,9 18,20 6,20 3,9"/><polygon points="12,8 17,11 16,17 8,17 7,11" fill="currentColor" fill-opacity="0.4"/></svg>',
    doughnut: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg>',
    line:     '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,17 9,11 14,14 20,5"/></svg>',
};

function _dashChartTypeIcon(type) {
    return _DASH_CHART_TYPE_ICONS[type] || type;
}

// Render the toggle button group HTML. The widget includes this inside its
// card-title element. Active button reflects the currently-selected type.
function _dashChartToggleHTML(widgetKey, supportedTypes, defaultType) {
    if (!_dashChartTypeState[widgetKey]) {
        _dashChartTypeState[widgetKey] = defaultType;
    }
    const current = _dashChartTypeState[widgetKey];
    const buttonsHTML = supportedTypes.map(t => `
<button class="dash-chart-toggle-btn ${t === current ? 'active' : ''}" data-type="${t}" type="button" aria-label="${t}">
  ${_dashChartTypeIcon(t)}
</button>`).join('');
    return `<div class="dash-chart-toggle" data-widget="${widgetKey}">${buttonsHTML}</div>`;
}

function _dashChartCurrentType(widgetKey, defaultType) {
    return _dashChartTypeState[widgetKey] || defaultType;
}

function _dashRegisterChartSwitch(widgetKey, handler) {
    _dashChartSwitchHandlers[widgetKey] = handler;
}

// One delegated click handler for every toggle group on the dashboard.
// Bound once at module load — the listener survives widget re-renders.
function _dashHandleChartToggleClick(e) {
    const btn = e.target.closest('.dash-chart-toggle-btn');
    if (!btn) return;
    const wrap = btn.closest('.dash-chart-toggle');
    if (!wrap) return;
    const widgetKey = wrap.dataset.widget;
    const newType   = btn.dataset.type;
    if (!widgetKey || !newType) return;
    if (_dashChartTypeState[widgetKey] === newType) return;
    _dashChartTypeState[widgetKey] = newType;
    const handler = _dashChartSwitchHandlers[widgetKey];
    if (typeof handler === 'function') handler(newType);
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', _dashHandleChartToggleClick);
}
