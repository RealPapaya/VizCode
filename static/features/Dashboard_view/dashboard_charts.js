// @module Dashboard_view/dashboard_charts
// Chart.js helpers shared by every widget. Owns the _dashCharts registry so
// charts can be destroyed / recreated on re-render.
//
// COLOR RULES:
//   • _DASH_ACCENT_SCALE — the canonical 5-stop warm gold palette
//   • _dashAccentStop(i) — pick by index (wraps at 5)
//   • _dashAccentForSlices(n) — returns n distinct stops for pie/donut
//     (if n > 5 the caller must pre-group small slices into "Others")
//   • Commit delta colours: #A4B55B (add) / #E05A5A (del) — ONLY exception
//   • Single-metric charts (bar, sparkline, progress ring) may use
//     _dashAccentTint(alpha) for fill intensity variation

const _dashCharts = {};   // canvas-id → Chart instance

const _DASH_ACCENT_SCALE = ['#eedcbc', '#DFA745', '#c57429', '#955223', '#673606'];
// Commit-delta exceptions (not accent-derived)
const _DASH_COLOR_ADD = '#A4B55B';
const _DASH_COLOR_DEL = '#E05A5A';

function _dashAccentStop(i) {
    return _DASH_ACCENT_SCALE[((i % 5) + 5) % 5];
}

// For pie / donut: return the first n stops from the scale.
// If n > 5, caller is responsible for grouping tail slices into "Others"
// and using _dashAccentStop(4) = #673606 for that bucket.
function _dashAccentForSlices(n) {
    const count = Math.min(n, 5);
    return _DASH_ACCENT_SCALE.slice(0, count);
}

// Read a CSS custom property from :root.
function _dashCssVar(name, fallback) {
    if (typeof document === 'undefined') return fallback || '';
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v || '').trim() || (fallback || '');
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

// Returns rgba(...) for the main accent (#DFA745) at the given alpha.
// For single-metric charts where alpha variation conveys intensity.
function _dashAccentTint(alpha) {
    const a = (alpha == null) ? 1 : Math.max(0, Math.min(1, alpha));
    const { r, g, b } = _dashHexToRgb('#DFA745');
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Muted gray for axis ticks, background series.
function _dashMutedTint(alpha) {
    const a = (alpha == null) ? 1 : Math.max(0, Math.min(1, alpha));
    const { r, g, b } = _dashHexToRgb(_dashCssVar('--muted', '#93918b'));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Faded border colour for chart gridlines / axis lines.
function _dashBorderTint(alpha) {
    const a = (alpha == null) ? 1 : Math.max(0, Math.min(1, alpha));
    const { r, g, b } = _dashHexToRgb(_dashCssVar('--border', '#2e302b'));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Multi-bar/category alpha-stepped fills (for bar charts; bars are
// distinguishable by position, so single-hue alpha stepping is OK).
function _dashAccentSeries(n) {
    if (!n || n < 1) return [];
    if (n === 1) return [_dashAccentTint(1)];
    const out = [];
    const top = 1.0, bot = 0.30;
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        out.push(_dashAccentTint(top - t * (top - bot)));
    }
    return out;
}

function _dashApplyChartDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color                               = _dashCssVar('--muted', '#93918b');
    Chart.defaults.borderColor                         = _dashCssVar('--border', '#2e302b');
    Chart.defaults.font.family                         = "'Segoe UI', system-ui, sans-serif";
    Chart.defaults.font.size                           = 11;
    Chart.defaults.plugins.legend.labels.boxWidth      = 10;
    Chart.defaults.plugins.legend.labels.padding       = 14;
    Chart.defaults.plugins.tooltip.backgroundColor     = _dashCssVar('--surface-elevated', '#22241f');
    Chart.defaults.plugins.tooltip.borderColor         = _dashCssVar('--border', '#2e302b');
    Chart.defaults.plugins.tooltip.borderWidth         = 1;
    Chart.defaults.plugins.tooltip.titleColor          = _dashCssVar('--text', '#eae8e3');
    Chart.defaults.plugins.tooltip.bodyColor           = _dashCssVar('--muted', '#93918b');
    Chart.defaults.plugins.tooltip.padding             = 10;
    // Bar defaults — rounded tops, 300ms grow animation
    Chart.defaults.datasets.bar = Chart.defaults.datasets.bar || {};
    Chart.defaults.datasets.bar.borderRadius = 6;
    Chart.defaults.animation = { duration: 300, easing: 'easeOutQuart' };
}

function _dashMkChart(canvas, type, data, options) {
    if (!canvas || typeof Chart === 'undefined') return null;
    const id = canvas.id || ('dash-chart-' + Math.random().toString(36).slice(2, 8));
    canvas.id = id;
    if (_dashCharts[id]) {
        try { _dashCharts[id].destroy(); } catch (_) {}
        delete _dashCharts[id];
    }
    const ctx = canvas.getContext('2d');
    _dashCharts[id] = new Chart(ctx, { type, data, options });
    return _dashCharts[id];
}

function _dashDestroyAllCharts() {
    Object.keys(_dashCharts).forEach(id => {
        try { _dashCharts[id]?.destroy(); } catch (_) {}
        delete _dashCharts[id];
    });
}

// ─── Chart-type toggle (per-widget) ──────────────────────────────────────

const _dashChartTypeState    = {};
const _dashChartSwitchHandlers = {};

const _DASH_CHART_TYPE_ICONS = {
    bar:      '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="4"  y="11" width="3" height="9"/><rect x="10" y="6"  width="3" height="14"/><rect x="16" y="14" width="3" height="6"/></svg>',
    pie:      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4 L12 12 L20 12" stroke-width="2"/></svg>',
    radar:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12,3 21,9 18,20 6,20 3,9"/><polygon points="12,8 17,11 16,17 8,17 7,11" fill="currentColor" fill-opacity="0.4"/></svg>',
    doughnut: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg>',
    line:     '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,17 9,11 14,14 20,5"/></svg>',
};

function _dashChartTypeIcon(type) { return _DASH_CHART_TYPE_ICONS[type] || type; }

function _dashChartToggleHTML(widgetKey, supportedTypes, defaultType) {
    if (!_dashChartTypeState[widgetKey]) _dashChartTypeState[widgetKey] = defaultType;
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
    // Update active button
    wrap.querySelectorAll('.dash-chart-toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === newType);
    });
    const handler = _dashChartSwitchHandlers[widgetKey];
    if (typeof handler === 'function') handler(newType);
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', _dashHandleChartToggleClick);
}

// ─── Grouped-slice helper for pie/donut charts ─────────────────────────────
// Call this before passing data to _dashMkChart for pie/donut types.
// If items.length > 5, tail items are merged into a single "Others" bucket.
// Returns { labels, data, colors }.
function _dashGroupedSlices(labels, values) {
    if (labels.length <= 5) {
        return {
            labels,
            data:   values,
            colors: _dashAccentForSlices(labels.length),
        };
    }
    // Take top 4 by value, group the rest
    const indexed = labels.map((l, i) => ({ l, v: values[i] }));
    indexed.sort((a, b) => b.v - a.v);
    const top = indexed.slice(0, 4);
    const rest = indexed.slice(4);
    const othersVal = rest.reduce((s, x) => s + x.v, 0);
    const othersLabel = _dashT('dashOthers') || 'Others';
    return {
        labels: [...top.map(x => x.l), othersLabel],
        data:   [...top.map(x => x.v), othersVal],
        colors: [..._DASH_ACCENT_SCALE.slice(0, 4), '#673606'],
    };
}
