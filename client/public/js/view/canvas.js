/** Shared canvas helpers. */

/** Resizes the backing store to the element size × devicePixelRatio. */
export function prepareCanvas(canvas) {
  const ratio = globalThis.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

/** Reads the theme colours from CSS custom properties once per frame. */
export function themeColors(element = document.documentElement) {
  const css = getComputedStyle(element);
  const read = (name) => css.getPropertyValue(name).trim();
  return {
    text: read("--text"),
    muted: read("--muted"),
    grid: read("--grid"),
    road: read("--road"),
    terrain: read("--terrain"),
    terrainEdge: read("--terrain-edge"),
    me: read("--me"),
    human: read("--human"),
    bot: read("--bot"),
    climb: read("--climb"),
    sprint: read("--sprint"),
  };
}

export function riderColor(rider, myId, colors) {
  if (rider.id === myId) return colors.me;
  return rider.is_bot ? colors.bot : colors.human;
}
