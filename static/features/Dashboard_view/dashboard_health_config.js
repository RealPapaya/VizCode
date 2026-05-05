// @module Dashboard_view/dashboard_health_config
// Visual config for the Code Health widget. Tune labels / colours / threshold
// bands here without touching widget rendering code. The numerical formula
// and weights live on the backend in src/core/code_health.py.

const _DASH_HEALTH_BANDS = {
    red:   4,    // score < 4   → red
    amber: 7,    // score < 7   → amber
    // anything >= 7 → green
};

const _DASH_HEALTH_COLORS = {
    red:   '#f87171',
    amber: '#fbbf24',
    green: '#34d399',
};

// Display order + labels + bar colour for the per-sub-score breakdown panel.
// Keys must match keys returned by code_health.py:compute_code_health.
const _DASH_HEALTH_SUBSCORES = [
    { key: 'complexity',  label: 'dashHealthComplexity',  color: '#a78bfa' },
    { key: 'coupling',    label: 'dashHealthCoupling',    color: '#f87171' },
    { key: 'dead_code',   label: 'dashHealthDeadCode',    color: '#94a3b8' },
    { key: 'duplication', label: 'dashHealthDuplication', color: '#fb923c' },
    { key: 'cohesion',    label: 'dashHealthCohesion',    color: '#60a5fa' },
];

function _dashHealthColor(score) {
    if (score < _DASH_HEALTH_BANDS.red)   return _DASH_HEALTH_COLORS.red;
    if (score < _DASH_HEALTH_BANDS.amber) return _DASH_HEALTH_COLORS.amber;
    return _DASH_HEALTH_COLORS.green;
}
