/**
 * Which vehicles to draw and where their seated riders' labels go. Pure
 * logic, so the WebGL side of view3d.js stays thin.
 */
import { groupVehicles, vehicleAnchor } from "../ride/vehicle.js";
import { vehicleLayout } from "./vehicleModel.js";

/**
 * Riders sharing a `vehicle.id` are one vehicle, at the place of its captain
 * (else any visible seat; the server puts all seats at one place).
 * @param {{rider: object, position: number[], forward: number[]}[]} placed riders with their road position
 * @returns {{id: number, kind: string, seats: (object|null)[], at: object}[]}
 */
export function placedVehicles(placed) {
  const byRider = new Map(placed.map((p) => [p.rider.id, p]));
  const vehicles = [];
  for (const [id, group] of groupVehicles(placed.map((p) => p.rider))) {
    const anchor = vehicleAnchor(group);
    if (anchor) vehicles.push({ id, kind: group.kind, seats: group.seats, at: byRider.get(anchor.id) });
  }
  return vehicles;
}

const layouts = new Map();

/** The layout of a vehicle (`{kind, seats}`), or null for a kind or seat count the models don't have. */
export function layoutOf(kind, seats) {
  const key = `${kind}:${seats}`;
  if (!layouts.has(key)) {
    try {
      layouts.set(key, vehicleLayout(kind, seats));
    } catch {
      layouts.set(key, null);
    }
  }
  return layouts.get(key);
}

/** Cranks turn at the rider's own cadence: the server's, else a guess from the power. */
export const seatCadence = (rider) => rider.cadence ?? (rider.power > 0 ? 85 : 0);
