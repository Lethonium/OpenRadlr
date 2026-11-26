/**
 * The 2D views' sprites, baked a few at a time. A view asks for what it will draw (`want`, with a priority:
 * lower is nearer) and draws what is ready (`get`, `rider`); once a frame `pump` bakes the most wanted
 * jobs until the time budget is spent. Pure but for the injected `bake` and `now`.
 *
 * Night: a day sprite has a night variant when `spriteJobs({view, night: true})` has a job with the same key
 * but for the `-night` view prefix. While night is on, `get` returns the night sprite if it is baked,
 * else the day one; asking for a day job also asks for its night variant.
 * Riders: a look not baked yet is drawn with `DEFAULT_LOOK`'s sprite (which is baked first).
 */
import { lookOf } from "../../view3d/assets/riders/look.js";
import { riderJob, spriteJobs } from "./catalog.js";

/** The look a rider is drawn with until their own is baked. */
export const DEFAULT_LOOK = lookOf(0);
/** Priority of the default look's sprite, ahead of any rider; and the one riders get unless the caller says. */
const DEFAULT_LOOK_PRIORITY = -1;
const RIDER_PRIORITY = 10;

const isRider = (job) => job.id === "cyclist";
/** A day key's night key: only the view prefix differs. */
const nightKeyOf = (key) => key.replace(":", "-night:");

/**
 * @param {{bake: (job: object) => {frames: object[], ox: number, oy: number, ppm: number, bytes: number}, now: () => number, budgetMs?: number, maxBytes?: number}} options
 */
export function createSpriteStore({ bake, now, budgetMs = 6, maxBytes = 40e6 }) {
  const pending = new Map(); // key -> {job, priority, seq}
  const baked = new Map(); // key -> {sprite, job, used}
  const failedKeys = [];
  const nightJobs = new Map(); // night key -> job, for the views seen
  const nightViews = new Set();
  const dayJobs = new Map(); // key -> job, every day job asked for
  let night = false;
  let seq = 0;
  let tick = 0;
  let total = 0;

  function enqueue(job, priority) {
    if (baked.has(job.key) || failedKeys.includes(job.key)) return;
    const queued = pending.get(job.key);
    if (queued) queued.priority = Math.min(queued.priority, priority);
    else pending.set(job.key, { job, priority, seq: seq++ });
  }

  function nightVariant(job) {
    if (job.night || isRider(job)) return null;
    if (!nightViews.has(job.view)) {
      nightViews.add(job.view);
      for (const variant of spriteJobs({ view: job.view, night: true })) nightJobs.set(variant.key, variant);
    }
    return nightJobs.get(nightKeyOf(job.key)) ?? null;
  }

  function want(job, priority) {
    enqueue(job, priority);
    if (job.night) return;
    dayJobs.set(job.key, { job, priority });
    const variant = night ? nightVariant(job) : null;
    if (variant) enqueue(variant, priority);
  }

  function get(key) {
    if (night) {
      const lit = baked.get(nightKeyOf(key));
      if (lit) {
        lit.used = ++tick;
        return lit.sprite;
      }
    }
    const entry = baked.get(key);
    if (!entry) return null;
    entry.used = ++tick;
    return entry.sprite;
  }

  function rider(look, view, priority = RIDER_PRIORITY) {
    const job = riderJob(look, view);
    const own = get(job.key);
    if (own) return own;
    want(job, priority);
    const fallback = riderJob(DEFAULT_LOOK, view);
    want(fallback, DEFAULT_LOOK_PRIORITY);
    return get(fallback.key);
  }

  function setNight(on) {
    night = on;
    if (!on) return;
    for (const { job, priority } of dayJobs.values()) {
      const variant = nightVariant(job);
      if (variant) enqueue(variant, priority);
    }
  }

  /** The next job: lowest priority number, then the current light (so the baker re-lights rarely), then asked first. */
  function next() {
    let best = null;
    for (const item of pending.values()) {
      if (!best) best = item;
      else if (item.priority !== best.priority) best = item.priority < best.priority ? item : best;
      else if (item.job.night !== best.job.night) best = item.job.night === night ? item : best;
      else if (item.seq < best.seq) best = item;
    }
    return best;
  }

  const protectedKeys = () => new Set(["side", "top"].map((view) => riderJob(DEFAULT_LOOK, view).key));

  /** Drop least recently used sprites, riders before scenery, until under the cap; never the newest. */
  function evict(keep) {
    if (total <= maxBytes) return;
    const spare = protectedKeys();
    const order = [...baked.entries()]
      .filter(([key]) => key !== keep && !spare.has(key))
      .sort(([, a], [, b]) => Number(isRider(b.job)) - Number(isRider(a.job)) || a.used - b.used);
    for (const [key, entry] of order) {
      if (total <= maxBytes) break;
      baked.delete(key);
      total -= entry.sprite.bytes;
    }
  }

  function pump() {
    const start = now();
    let count = 0;
    while (pending.size > 0 && now() - start < budgetMs) {
      const { job } = next();
      pending.delete(job.key);
      try {
        const sprite = bake(job);
        baked.set(job.key, { sprite, job, used: ++tick });
        total += sprite.bytes;
        count += 1;
        evict(job.key);
      } catch (error) {
        failedKeys.push(job.key);
        console.warn(`sprite ${job.key} failed to bake`, error); // i18n-ok: developer log
      }
    }
    return count;
  }

  return { want, get, rider, pump, setNight, bytes: () => total, failed: () => [...failedKeys] };
}
