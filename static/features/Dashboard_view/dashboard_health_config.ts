// @ts-nocheck -- JS->TS migration: renamed to .ts, type-curation pending. Remove this line and fix errors to enable checking.
// @module Dashboard_view/dashboard_health_config
// Visual config for the Code Health widget. Tune labels / colours / threshold
// bands here without touching widget rendering code. The numerical formula
// and weights live on the backend in src/core/code_health.py.

const _DASH_HEALTH_BANDS = {
    red:   4,    // score < 4   → red
    amber: 7,    // score < 7   → amber
    // anything >= 7 → green
};

// Status traffic-light → semantic CSS tokens (themes.css).
// These are the only non-accent colours allowed beside accent on the dashboard.
const _DASH_HEALTH_COLORS = {
    red:   'var(--status-bad)',
    amber: 'var(--status-warn)',
    green: 'var(--status-good)',
};

// Display order + label keys for the per-sub-score breakdown panel.
// All sub-score bars derive their fill from var(--accent) at decreasing alpha
// (see widget_code_health.js); the previous per-key hex literals violated
// DASHBOARD_DESIGN_SPEC.md §5 rule 2.
const _DASH_HEALTH_SUBSCORES = [
    { key: 'complexity',  label: 'dashHealthComplexity'  },
    { key: 'coupling',    label: 'dashHealthCoupling'    },
    { key: 'dead_code',   label: 'dashHealthDeadCode'    },
    { key: 'duplication', label: 'dashHealthDuplication' },
    { key: 'cohesion',    label: 'dashHealthCohesion'    },
];

function _dashHealthColor(score) {
    if (score < _DASH_HEALTH_BANDS.red)   return _DASH_HEALTH_COLORS.red;
    if (score < _DASH_HEALTH_BANDS.amber) return _DASH_HEALTH_COLORS.amber;
    return _DASH_HEALTH_COLORS.green;
}
