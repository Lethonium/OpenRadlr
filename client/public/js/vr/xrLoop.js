/**
 * Hands the page over from its 2D frame loop to an XR frame source, and back
 * when the source ends by itself (the headset is taken off, the system menu
 * ends the session), is left on purpose, or fails to start. Only the source
 * the page is currently handed to may bring the 2D loop back, and only once:
 * a late "end" of an earlier source never tears down a newer one.
 */

/**
 * @param {{stop2d: () => void, start2d: () => void, onFrame: (frame: import("./xrFrame.js").XrFrame) => void}} hooks
 */
export function xrLoop({ stop2d, start2d, onFrame }) {
  let active = null;
  return {
    /** The source the page is handed to now, or null while the 2D loop runs. */
    get active() {
      return active;
    },
    /**
     * @param {import("./xrFrame.js").XrFrameSource} source
     * @returns {Promise<boolean>} whether the source started
     */
    async enter(source) {
      active = source;
      const restore = () => {
        if (active !== source) return;
        active = null;
        start2d();
      };
      const ended = source.onEnd;
      source.onEnd = () => {
        ended?.();
        restore();
      };
      stop2d();
      try {
        await source.start(onFrame);
        return true;
      } catch (error) {
        console.error(error);
        restore();
        return false;
      }
    },
    /** Stops the active source and brings the 2D loop back; its later "end" does nothing more. */
    leave() {
      const source = active;
      if (!source) return;
      active = null;
      source.stop();
      start2d();
    },
  };
}

/**
 * @param {import("./xrFrame.js").XrFrameSource} source
 * @returns {Promise<boolean>} whether the source started
 */
export function switchToXr(source, hooks) {
  return xrLoop(hooks).enter(source);
}
