/**
 * The files of a past ride, made again from its ride stream (ride/rideStream.js) with the
 * recorder's own exporters, under the rules of the finish screen: no files for phone
 * paddle rides, no GPX for the studio (it has no positions), the studio's FIT marked indoor.
 */

import { RideRecorder, rideFileName } from "../ride/rideRecorder.js";
import { routeName } from "./profilePage.js";

const TYPES = { fit: "application/vnd.ant.fit", tcx: "application/vnd.garmin.tcx+xml", gpx: "application/gpx+xml" };

/** The formats a ride record offers, in the order the finish screen shows them. */
export function rideFileFormats(record) {
  if (record.kind === "workout" || record.device === "paddle") return [];
  return record.routeId === null || record.routeId === undefined ? ["fit", "tcx"] : ["fit", "tcx", "gpx"];
}

/**
 * One file of a ride: `{bytes, type, name}`.
 * @param {"fit" | "tcx" | "gpx"} format
 * @param {object} record the ride's history record
 * @param {{samples: object[], pauses?: object[], intervalMs?: number}} recording its stream, decoded
 * @param {{id: string, name: string}[]} routes the server's routes, for the ride's name
 */
export function rideFile(format, record, recording, routes) {
  if (!rideFileFormats(record).includes(format)) throw new Error(`this ride has no ${format} file`); // i18n-ok
  const recorder = RideRecorder.from(recording);
  const studio = record.routeId === null || record.routeId === undefined;
  const splits = record.splits ?? [];
  const name = `OpenRadlr · ${routeName(record.routeId, routes)}`;
  const bytes =
    format === "fit"
      ? recorder.toFit({ indoor: studio, splits })
      : new TextEncoder().encode(format === "tcx" ? recorder.toTcx({ name, splits }) : recorder.toGpx({ name }));
  // The studio's rides have no route; the finish names their files after the studio's id.
  return { bytes, type: TYPES[format], name: rideFileName(record.startedAt, record.routeId ?? "spin-studio", format) };
}
