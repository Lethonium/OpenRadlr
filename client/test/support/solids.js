/**
 * The points of a few solids (boxes, limbs, ellipsoids), for tests that measure a pose against the body's old shapes
 * (support/riderMeshes.js), called like the old mesh builder with a colour that is ignored. `build()` gives `{positions}`: the corners of each box and the rings of each ellipsoid.
 */
import { add, cross, normalize, scale, sub } from "../../public/js/view3d/math.js";

export class Solids {
  #points = [];

  /** Box spanned by three edge vectors around `center`. */
  orientedBox(center, u, v, w) {
    for (const su of [-0.5, 0.5]) for (const sv of [-0.5, 0.5]) for (const sw of [-0.5, 0.5]) this.#points.push(add(add(add(center, scale(u, su)), scale(v, sv)), scale(w, sw)));
  }

  box(center, [sx, sy, sz]) {
    this.orientedBox(center, [sx, 0, 0], [0, sy, 0], [0, 0, sz]);
  }

  /** Box from `start` to `end`, `width` along x and `thickness` across the limb. */
  segment(start, end, width, thickness) {
    const axis = sub(end, start);
    this.orientedBox(scale(add(start, end), 0.5), [width, 0, 0], axis, scale(normalize(cross([1, 0, 0], axis)), thickness));
  }

  ellipsoid(center, [rx, ry, rz], _color, rings = 4, segments = 7) {
    for (let ring = 0; ring <= rings; ring += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const phi = (ring / rings) * Math.PI;
        const theta = (segment / segments) * Math.PI * 2;
        this.#points.push([center[0] + rx * Math.sin(phi) * Math.cos(theta), center[1] + ry * Math.cos(phi), center[2] + rz * Math.sin(phi) * Math.sin(theta)]);
      }
    }
  }

  build() {
    return { positions: Float32Array.from(this.#points.flat()) };
  }
}
