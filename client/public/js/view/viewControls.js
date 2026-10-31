// What the View popover offers on this ride: cameras, layouts, 3D/2D and time
// of day. Pure: no DOM; labels come translated from i18n.
import { t } from "../i18n/i18n.js";
import { CAMERA_MODES } from "../view3d/chaseCamera.js";
import { TIME_MODES } from "../view3d/lighting.js";
import { STUDIO_CAMERAS } from "../view3d/studioScene.js";
import { LAYOUT_CHOICES, LAYOUT_LABELS } from "./hud.js";

const CAMERA_KEYS = {
  chase: "camera.chase", close: "camera.close", drone: "camera.drone", side: "camera.side",
  seat: "camera.seat", wide: "camera.wide", coach: "camera.coach",
};
const TIME_KEYS = { auto: "viewPopover.timeAuto", day: "drawer.timeDay", golden: "drawer.timeGolden", dusk: "drawer.timeDusk" };

const option = (id, label) => ({ id, label });

/**
 * `{ cameras, layouts, modes, showTime, times }`. The spin studio has its own
 * cameras, no layouts, only a 3D view and no time of day.
 */
export function viewControls({ studio }) {
  const cameraIds = studio ? STUDIO_CAMERAS : Object.keys(CAMERA_MODES);
  return {
    cameras: cameraIds.map((id) => option(id, t(CAMERA_KEYS[id]))),
    layouts: studio ? null : LAYOUT_CHOICES.map((id) => option(id, LAYOUT_LABELS[id])),
    modes: studio ? [] : [option("3d", "3D"), option("2d", "2D")],
    showTime: !studio,
    times: studio ? [] : TIME_MODES.map((id) => option(id, t(TIME_KEYS[id]))),
  };
}
