const _DASH_HEALTH_BANDS = {
  red: 4,
  // score < 4   → red
  amber: 7
  // score < 7   → amber
  // anything >= 7 → green
};
const _DASH_HEALTH_COLORS = {
  red: "var(--status-bad)",
  amber: "var(--status-warn)",
  green: "var(--status-good)"
};
const _DASH_HEALTH_SUBSCORES = [
  { key: "complexity", label: "dashHealthComplexity" },
  { key: "coupling", label: "dashHealthCoupling" },
  { key: "dead_code", label: "dashHealthDeadCode" },
  { key: "duplication", label: "dashHealthDuplication" },
  { key: "cohesion", label: "dashHealthCohesion" }
];
function _dashHealthColor(score) {
  if (score < _DASH_HEALTH_BANDS.red) return _DASH_HEALTH_COLORS.red;
  if (score < _DASH_HEALTH_BANDS.amber) return _DASH_HEALTH_COLORS.amber;
  return _DASH_HEALTH_COLORS.green;
}
