/** Goal controls and progress. The ride owns the model and supplies its totals. */
import { t } from "../i18n/i18n.js";
import { getUnits, formatDuration, formatDistanceWithUnit, formatNumber } from "../util/format.js";
import { goalTarget, goalUnit } from "../ride/rideGoal.js";

export function createRideGoalView({ root, pill, goal, read, notify, onChange }) {
  const find = (id) => root.querySelector(`#${id}`);
  const kind = find("goal-kind");
  const input = find("goal-target");
  const status = find("goal-status");
  const bar = find("goal-progress");
  const error = find("goal-error");
  const syncUnit = () => {
    find("goal-unit").textContent = goalUnit(kind.value, getUnits());
  };
  const amount = (value) => goal.kind === "time" ? formatDuration(value) : goal.kind === "distance" ? formatDistanceWithUnit(value, 1) : `${formatNumber(value / (getUnits() === "imperial" ? 0.3048 : 1), 0)} ${goalUnit("climbing", getUnits())}`;
  const render = () => {
    syncUnit();
    pill.hidden = bar.hidden = status.hidden = !goal.kind;
    find("goal-clear").hidden = !goal.kind;
    if (!goal.kind) return;
    const progress = t(goal.completed ? "goal.reached" : "goal.progress", { current: amount(goal.current), target: amount(goal.target) });
    status.textContent = pill.textContent = progress;
    bar.value = goal.progress;
    bar.setAttribute("aria-valuetext", progress);
  };
  const update = () => {
    if (goal.update(read())) {
      notify(t("goal.reached", { target: amount(goal.target) }));
      onChange();
    }
    render();
  };
  kind.addEventListener("change", () => { input.value = ""; error.hidden = true; syncUnit(); });
  find("goal-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const target = goalTarget(kind.value, input.valueAsNumber, getUnits());
    if (!Number.isFinite(target) || target <= 0) { error.hidden = false; return; }
    goal.set(kind.value, target);
    error.hidden = true;
    update();
    onChange();
  });
  find("goal-clear").addEventListener("click", () => { goal.clear(); render(); onChange(); });
  if (goal.kind) {
    kind.value = goal.kind;
    input.value = goal.target / goalTarget(goal.kind, 1, getUnits());
  }
  render();
  return { update };
}
