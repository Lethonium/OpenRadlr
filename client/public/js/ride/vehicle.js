/**
 * Shared vehicles (#55): codes, grouping, labels and per-seat energy.
 * Pure logic; no DOM, no network.
 */

import { t } from "../i18n/i18n.js";
export const VEHICLE_KINDS = Object.freeze([
  { kind: "tandem", seats: [2] },
  { kind: "beer_bike", seats: [5, 7, 9] },
]);

const KIND_NAMES = { tandem: "vehicle.tandem", beer_bike: "vehicle.beerBike" };
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/** Display name of a vehicle kind. */
export function kindName(kind) {
  return t(KIND_NAMES[kind] ?? "vehicle.generic");
}

/**
 * Cleans up a typed vehicle code.
 * @param {string} text
 * @returns {{ code: string|null, error: string|null }}
 */
export function normaliseCode(text) {
  const code = String(text ?? "").replace(/\s+/g, "").toUpperCase();
  if (/[01OI]/.test(code)) return { code: null, error: t("vehicle.code.noAmbiguous") };
  if (code.length !== CODE_LENGTH) return { code: null, error: t("vehicle.code.length") };
  if ([...code].some((c) => !CODE_ALPHABET.includes(c))) {
    return { code: null, error: t("vehicle.code.alphabet") };
  }
  return { code, error: null };
}

/**
 * Riders sitting in each vehicle. `seats` is indexed by seat number, with the
 * vehicle's full length and `null` for empty or unseen (culled) seats;
 * `captainSeat` is the rider flagged `vehicle.captain` (the captain is not always
 * seat 0 after a hand-over), else seat 0's rider, else null when none is visible.
 * Riders without a vehicle are left out.
 * @returns {Map<number, { kind: string, seats: (object|null)[], captainSeat: object|null }>}
 */
export function groupVehicles(riders) {
  const groups = new Map();
  for (const rider of riders) {
    const v = rider.vehicle;
    if (!v) continue;
    let group = groups.get(v.id);
    if (!group) {
      group = { kind: v.kind, seats: Array(v.seats).fill(null), captainSeat: null };
      groups.set(v.id, group);
    }
    group.seats[v.seat] = rider;
  }
  for (const group of groups.values()) {
    group.captainSeat = group.seats.find((r) => r?.vehicle.captain) ?? group.seats[0] ?? null;
  }
  return groups;
}

/** The rider a vehicle is drawn and labelled at: the captain, else any visible seat. */
export function vehicleAnchor(group) {
  return group.captainSeat ?? group.seats.find(Boolean) ?? null;
}

/** "Anna's beer bike", or just "Beer bike" when the captain is out of sight. */
export function groupLabel(group) {
  return group.captainSeat ? vehicleLabel(group.kind, group.captainSeat.name) : kindName(group.kind);
}

/**
 * One marker per vehicle for the 2D views, at its anchor rider.
 * @returns {{ id: number, kind: string, rider: object, label: string, mine: boolean }[]}
 */
export function vehicleMarkers(riders, myId) {
  const markers = [];
  for (const [id, group] of groupVehicles(riders)) {
    const rider = vehicleAnchor(group);
    if (rider) markers.push({ id, kind: group.kind, rider, label: groupLabel(group), mine: group.seats.some((r) => r?.id === myId) });
  }
  return markers;
}

/** Riders that are drawn on their own: everyone not sitting in a vehicle. */
export const soloRiders = (riders) => riders.filter((r) => !r.vehicle);

export function vehicleLabel(kind, captainName) {
  const inSentence = { tandem: t("vehicle.kind.tandem"), beer_bike: t("vehicle.kind.beerBike") }[kind] ?? kindName(kind).toLowerCase();
  return t("vehicle.label", { name: captainName, kind: inSentence });
}

/** "Vehicle 980 W · you 20 %", or null when `myId` is not aboard. */
export function aboardLine(vehicleState, myId) {
  const seats = vehicleState?.seats?.filter(Boolean) ?? [];
  const mine = seats.find((s) => s.rider_id === myId);
  if (!mine) return null;
  const total = Math.round(seats.reduce((sum, s) => sum + s.power, 0));
  return t("vehicle.aboardLine", { total, share: Math.round(mine.share * 100) });
}

export function isCaptain(vehicleState, myId) {
  return !!vehicleState && vehicleState.captain === myId;
}

/** Energy each rider put into the vehicle, for the end-of-ride summary. */
export class SeatEnergy {
  #entries = new Map();

  add(vehicleState, dtS) {
    for (const [index, s] of (vehicleState?.seats ?? []).entries()) {
      if (!s || !Number.isFinite(s.power) || s.power < 0 || !Number.isFinite(dtS) || dtS < 0) continue;
      let entry = this.#entries.get(s.rider_id);
      if (!entry) {
        entry = { name: s.name, isBot: !!s.is_bot, seat: index, joules: 0 };
        this.#entries.set(s.rider_id, entry);
      }
      entry.seat = index;
      entry.joules += s.power * dtS;
    }
  }

  /** @returns {{ name: string, isBot: boolean, kj: number }[]} in seat order */
  perSeat() {
    return [...this.#entries.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((e) => ({ name: e.name, isBot: e.isBot, kj: e.joules / 1000 }));
  }

  /** "Beer bike with Anna, Ben, Chris": humans only. */
  summaryLine(kind) {
    const humans = this.perSeat().filter((e) => !e.isBot).map((e) => e.name);
    return humans.length ? t("vehicle.summary", { kind: kindName(kind), names: humans.join(", ") }) : kindName(kind);
  }
}

/** The route id out of a `vehicle_elsewhere` error message (`route:<id>`), else null. */
export function elsewhereRoute(errorMessage) {
  const m = /^route:(.+)$/.exec(String(errorMessage ?? ""));
  return m ? m[1] : null;
}

/**
 * The route the start menu joins before boarding by code: the selected one,
 * or the first map route when the studio or the workout is selected (no vehicles).
 * @param {{ id: string, kind?: string }[]} routes
 * @returns {string|null}
 */
export function boardingRoute(routes, selectedId) {
  const selected = routes.find((r) => r.id === selectedId);
  if (selected && selected.kind === undefined) return selected.id;
  return routes.find((r) => r.kind === undefined)?.id ?? null;
}

const ERROR_LINES = {
  unknown_vehicle: "vehicle.error.unknown",
  vehicle_full: "vehicle.error.full",
  vehicle_rate_limited: "vehicle.error.rateLimited",
  vehicle_elsewhere: "vehicle.error.elsewhere",
  not_captain: "vehicle.error.notCaptain",
  in_event: "vehicle.error.inEvent",
  invalid_vehicle: "vehicle.error.invalid",
  already_aboard: "vehicle.error.alreadyAboard",
  in_vehicle: "vehicle.error.inVehicle",
};

/** A friendly line for a vehicle error code, or null for other codes. */
export function vehicleErrorLine(code) {
  return ERROR_LINES[code] ? t(ERROR_LINES[code]) : null;
}
