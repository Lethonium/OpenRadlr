/**
 * Calls out bots' moves near me in the ticker (#64): an attack, a sprint, a
 * chase after me, a turn on the front. Only the start of a move counts, by a
 * bot on my route within `BOT_CALLS.reachM`; a chase only when the bot is
 * behind me. At most one line every `everyS`, and the same bot and move at
 * most once every `repeatS`. Pure: the caller posts the lines.
 */
export const BOT_CALLS = Object.freeze({ reachM: 120, everyS: 15, repeatS: 90 });

const CALLED = new Set(["attack", "sprint", "answer", "pull"]);

export class BotCalls {
  /** Each bot's move when last seen (null while it just rides). */
  #moves = new Map();
  /** When each "bot:move" was last called out. */
  #said = new Map();
  #lastS = -Infinity;

  /**
   * @param {{riders: object[], me: ?{route: ?string, distance: number}, route: {signedGap(a: number, b: number): number}, nowS: number}} frame
   * @returns {{id: number, name: string, move: string}[]} the line to post, if any
   */
  update({ riders, me, route, nowS }) {
    const started = [];
    const seen = new Set();
    for (const rider of riders) {
      if (!rider.is_bot) continue;
      seen.add(rider.id);
      const known = this.#moves.has(rider.id);
      const before = this.#moves.get(rider.id);
      const move = rider.move ?? null;
      this.#moves.set(rider.id, move);
      // A bot first seen mid-move didn't start it in front of me.
      if (!known || !move || move === before || !CALLED.has(move)) continue;
      if (!me?.route || rider.route !== me.route) continue;
      const gap = route.signedGap(me.distance, rider.distance);
      if (Math.abs(gap) > BOT_CALLS.reachM) continue;
      if (move === "answer" && gap >= 0) continue;
      started.push({ id: rider.id, name: rider.name, move });
    }
    for (const id of this.#moves.keys()) if (!seen.has(id)) this.#moves.delete(id);
    if (nowS - this.#lastS < BOT_CALLS.everyS) return [];
    const call = started.find((c) => nowS - (this.#said.get(`${c.id}:${c.move}`) ?? -Infinity) >= BOT_CALLS.repeatS);
    if (!call) return [];
    this.#lastS = nowS;
    this.#said.set(`${call.id}:${call.move}`, nowS);
    return [call];
  }
}
