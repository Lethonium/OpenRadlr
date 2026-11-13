/**
 * Hands the page over from its 2D frame loop to an XR frame source, and back
 * when the source ends by itself (the headset is taken off, the system menu
 * ends the session) or fails to start.
 */

/**
 * @param {import("./xrFrame.js").XrFrameSource} source
 * @param {{stop2d: () => void, start2d: () => void, onFrame: (frame: import("./xrFrame.js").XrFrame) => void}} hooks
 * @returns {Promise<boolean>} whether the source started
 */
export async function switchToXr(source, { stop2d, start2d, onFrame }) {
  let back = false;
  const restart = () => {
    if (back) return;
    back = true;
    start2d();
  };
  const ended = source.onEnd;
  source.onEnd = () => {
    ended?.();
    restart();
  };
  stop2d();
  try {
    await source.start(onFrame);
    return true;
  } catch (error) {
    console.error(error);
    restart();
    return false;
  }
}
