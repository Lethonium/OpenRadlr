/**
 * What a kit draws for each job, and how much each instance may cost (#117).
 *
 * A wood is a few hundred trees and each face counts; ground detail is a few
 * thousand tufts and each one must be cheap, because it is repeated thousands of
 * times and only ever seen from a metre above the saddle. A pack does not know
 * that, so the roles are budgeted here: a role with a ceiling gets the cheapest
 * model the kit holds for it, under the ceiling.
 *
 * Roles are named here, beside the budget, so a kit only has to say which model
 * plays which role — never how it should be drawn.
 */

/**
 * The most triangles one instance of a role may cost. `tree` roles are unbounded
 * (they are the thing being looked at); `tuft` and `flower` are capped, since
 * thousands of them are placed and each is a few centimetres on screen.
 */
export const ROLE_BUDGET = Object.freeze({
  tufts: 40,
  flowers: 80,
});

/** The cheapest model of `role` within the budget, or the cheapest it has. */
export function cheapestWithin(kit, role, budget = Infinity) {
  const ids = kit.byRole[role];
  if (!ids || ids.length === 0) return null;
  let best = null;
  for (const id of ids) {
    const model = kit.models[id];
    const cost = model.triangles ?? Infinity;
    if (best === null || cost < best.cost) best = { id, cost };
  }
  if (best === null || best.cost > budget) {
    // Nothing is under budget: the cheapest is still the honest choice, and the
    // manifest's number is what the next commit should fix.
    return best?.id ?? null;
  }
  return best.id;
}
