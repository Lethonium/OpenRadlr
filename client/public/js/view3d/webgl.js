/**
 * Whether this browser can run the 3D world, without loading it: the menu and
 * 2D-only devices ask before the renderer is imported.
 */

/**
 * True if this browser can run the 3D world: WebGL 2 that can render into
 * the engine's half-float scene target (WebGL 2 alone does not promise it).
 */
export function isWebGl2Available(doc = globalThis.document) {
  try {
    const gl = doc.createElement("canvas").getContext("webgl2");
    return Boolean(gl?.getExtension("EXT_color_buffer_float"));
  } catch {
    return false;
  }
}
