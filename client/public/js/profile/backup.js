/**
 * Backing a rider up to their account (ADR 0032, phase 1: one way).
 *
 * A rider is linked once: the account service sends a challenge, the rider key
 * signs it, and the service remembers the key under a rider id, which is kept
 * in the rider's own storage. A backup then sends the snapshot (profile, goals,
 * progress, settings, best laps; see localData.backupSnapshot) and every saved
 * ride the account doesn't have yet. Nothing is deleted at the service.
 *
 * Runs never overlap: one asked for while another runs is folded into a single
 * run after it. A run never throws; it says how far it got.
 */

import { linkMessage } from "./riderKey.js";

/** The rider's id at the account service (a rider key). */
export const ACCOUNT_RIDER_KEY = "openradlr.account.rider";
/** When the last complete backup finished, in ms (a rider key). */
export const BACKED_UP_KEY = "openradlr.account.backedUp";
/** The ids of the rides the account holds, as last seen (a rider key): the ride list marks them. */
export const BACKED_UP_RIDES_KEY = "openradlr.account.rides";

const codeOf = (error) => error?.code ?? "failed";

export class Backup {
  #running = null;
  #again = false;

  /**
   * @param {{
   *   account: import("../net/account.js").AccountClient,
   *   storage: Storage,
   *   sign: (message: string, publicKey?: string) => Promise<string | null>,
   *   history: {list: () => Promise<any[]>},
   *   snapshot: () => Promise<object>,
   *   now?: () => number,
   * }} deps
   */
  constructor({ account, storage, sign, history, snapshot, now = Date.now }) {
    Object.assign(this, { account, storage, sign, history, snapshot, now });
  }

  /** The rider's id at the service, or null before linking. */
  riderId() {
    return this.storage.getItem(ACCOUNT_RIDER_KEY);
  }

  /** When the last full backup finished (ms), or null. */
  backedUpAt() {
    const value = Number(this.storage.getItem(BACKED_UP_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  /** The ids of the rides the account held after the last run. */
  backedUpRides() {
    try {
      const ids = JSON.parse(this.storage.getItem(BACKED_UP_RIDES_KEY) ?? "[]");
      return new Set(Array.isArray(ids) ? ids.map(String) : []);
    } catch {
      return new Set();
    }
  }

  /** Whether `me` (the signed-in account) holds this rider. */
  linkedTo(me) {
    const id = this.riderId();
    return Boolean(id && me?.riders?.some((rider) => rider.rider_id === id));
  }

  /** Links the rider key to the signed-in account; resolves with the rider's id. */
  async link({ name, publicKey }) {
    if (!publicKey) throw Object.assign(new Error("no_key"), { code: "no_key" });
    const challenge = await this.account.riderChallenge();
    const signature = await this.sign(linkMessage(challenge), publicKey);
    if (!signature) throw Object.assign(new Error("no_key"), { code: "no_key" });
    const riderId = await this.account.linkRider({ publicKey, challenge, signature, name });
    this.storage.setItem(ACCOUNT_RIDER_KEY, riderId);
    return riderId;
  }

  /** Forgets the link on this device (signed out, or the account was deleted). */
  forget() {
    this.storage.removeItem(ACCOUNT_RIDER_KEY);
    this.storage.removeItem(BACKED_UP_KEY);
    this.storage.removeItem(BACKED_UP_RIDES_KEY);
  }

  /** @returns {Promise<{ok: boolean, rides: number, reason?: string}>} */
  run() {
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }
    this.#running = (async () => {
      let result;
      do {
        this.#again = false;
        result = await this.#once();
      } while (this.#again);
      this.#running = null;
      return result;
    })();
    return this.#running;
  }

  async #once() {
    const riderId = this.riderId();
    if (!riderId) return { ok: false, rides: 0, reason: "not_linked" };
    let sent = 0;
    let failure = null;
    let held = null;
    try {
      // A snapshot the account refuses (too large, full) doesn't hold the rides back.
      try {
        await this.account.putSnapshot(riderId, await this.snapshot());
      } catch (error) {
        if (codeOf(error) === "offline" || error?.status === 401) throw error;
        failure = codeOf(error);
      }
      held = new Set((await this.account.rideIds(riderId)).map(String));
      const missing = (await this.history.list()).filter((record) => record?.id !== undefined && !held.has(String(record.id)));
      for (const record of missing) {
        try {
          await this.account.putRide(riderId, String(record.id), record);
          held.add(String(record.id));
          sent += 1;
        } catch (error) {
          // One ride the service refuses (too large, say) doesn't stop the others.
          failure ??= codeOf(error);
          if (codeOf(error) === "offline" || error?.status === 401) break;
        }
      }
    } catch (error) {
      return { ok: false, rides: sent, reason: codeOf(error) };
    } finally {
      if (held) this.#remember(held);
    }
    if (failure) return { ok: false, rides: sent, reason: failure };
    this.storage.setItem(BACKED_UP_KEY, String(this.now()));
    return { ok: true, rides: sent };
  }

  #remember(held) {
    try {
      this.storage.setItem(BACKED_UP_RIDES_KEY, JSON.stringify([...held]));
    } catch {
      // Without storage the ride list just shows no cloud marks.
    }
  }
}
