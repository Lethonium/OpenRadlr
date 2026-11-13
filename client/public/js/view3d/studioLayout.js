/** Where things stand in the studio: room, stage and seats (local frame: riders face −Z, up is +Y). */

export const ROOM = Object.freeze({ halfWidth: 7.5, front: -9.5, back: 6.5, height: 4.6 });
export const ROW_GAP = 2.6;
export const SEAT_GAP = 1.4;
export const RISER = 0.35;
export const STAGE = Object.freeze({ z: -5.4, height: 0.55, halfWidth: 2.4, depth: 2.6 });

/** The instructor: id 0 (riders start at 1), on the stage, facing the room. */
export const INSTRUCTOR = Object.freeze({ id: 0, name: "Coach Lemon", position: [0, STAGE.height, STAGE.z], yaw: Math.PI }); // i18n-ok (English id label; the UI translates by mode)

/** Seat 0–7: front row from left to right, 8–15: back row on a riser. */
export function seatPosition(seat) {
  const row = seat < 8 ? 0 : 1;
  const column = seat % 8;
  return [(column - 3.5) * SEAT_GAP, row * RISER, row * ROW_GAP];
}

