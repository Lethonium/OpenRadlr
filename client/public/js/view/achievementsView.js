/**
 * The profile's Achievements page (#27): a pure builder of the cards, from the
 * latched earned dates. main.js writes them into the markup with textContent.
 */

import { t } from "../i18n/i18n.js";
import { ACHIEVEMENTS } from "../profile/achievements.js";

function earnedDate(ms, locale) {
  const format = { day: "numeric", month: "short", year: "numeric" };
  const when = new Date(ms);
  try {
    return when.toLocaleDateString(locale, format);
  } catch {
    // A malformed browser locale (e.g. "en-US@posix") throws a RangeError
    return when.toLocaleDateString(undefined, format);
  }
}

/** Earned newest first, then locked in list order, then the secret ones still locked. */
export function achievementCards(state, { locale }) {
  const card = (a) => {
    const at = state.earned[a.id];
    if (at !== undefined) return { id: a.id, state: "earned", name: t(`achievement.${a.id}.name`), hint: t(`achievement.${a.id}.hint`), date: earnedDate(at, locale) };
    if (a.secret) return { id: a.id, state: "secret", name: "???", hint: "", date: null };
    return { id: a.id, state: "locked", name: t(`achievement.${a.id}.name`), hint: t(`achievement.${a.id}.hint`), date: null };
  };
  const earned = ACHIEVEMENTS.filter((a) => a.id in state.earned).sort((a, b) => state.earned[b.id] - state.earned[a.id]);
  const locked = ACHIEVEMENTS.filter((a) => !(a.id in state.earned));
  const cards = [...earned, ...locked.filter((a) => !a.secret), ...locked.filter((a) => a.secret)].map(card);
  return { count: t("achievements.count", { earned: earned.length, total: ACHIEVEMENTS.length }), cards };
}
