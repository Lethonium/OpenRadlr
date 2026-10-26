/**
 * Collects flat-shaded triangles (position, face normal, RGBA colour).
 * Alpha is used as a "tint mask": 1 = paint with the rider's jersey colour.
 */
import { add, cross, normalize, scale, sub, transformPoint } from "./math.js";

/**
 * A growing list of numbers in a Float32Array: the world of a 180 km route
 * has millions of vertices, too many for plain arrays of doubles.
 */
export class FloatBuffer {
  data = new Float32Array(256);
  length = 0;

  push(...values) {
    this.#reserve(values.length);
    for (let i = 0; i < values.length; i += 1) this.data[this.length + i] = values[i];
    this.length += values.length;
  }

  /** Appends `source[from, to)`. */
  pushRange(source, from, to) {
    this.#reserve(to - from);
    for (let i = from; i < to; i += 1) this.data[this.length++] = source[i];
  }

  /** The numbers so far, as a trimmed copy. */
  toFloat32() {
    return this.data.slice(0, this.length);
  }

  /** Gives the memory back (the builder is done). */
  release() {
    this.data = new Float32Array(0);
    this.length = 0;
  }

  #reserve(extra) {
    if (this.length + extra <= this.data.length) return;
    const grown = new Float32Array(Math.max(this.data.length * 2, this.length + extra));
    grown.set(this.data.subarray(0, this.length));
    this.data = grown;
  }
}

export class MeshBuilder {
  positions = new FloatBuffer();
  normals = new FloatBuffer();
  colors = new FloatBuffer();

  get vertexCount() {
    return this.positions.length / 3;
  }

  triangle(a, b, c, color) {
    const n = normalize(cross(sub(b, a), sub(c, a)));
    for (const p of [a, b, c]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
      this.colors.push(color[0], color[1], color[2], color[3] ?? 0);
    }
  }

  /** Triangle whose front face points along `direction` (winding is fixed up if needed). */
  triangleFacing(a, b, c, color, direction) {
    const n = cross(sub(b, a), sub(c, a));
    if (n[0] * direction[0] + n[1] * direction[1] + n[2] * direction[2] < 0) this.triangle(a, c, b, color);
    else this.triangle(a, b, c, color);
  }

  /** Quad a-b-c-d in counter-clockwise order (seen from the front). */
  quad(a, b, c, d, color) {
    this.triangle(a, b, c, color);
    this.triangle(a, c, d, color);
  }

  /**
   * Box spanned by an origin and three edge vectors (u, v, w), centred on `center`.
   * Faces point outwards when (u, v, w) is right-handed.
   */
  orientedBox(center, u, v, w, color) {
    const hu = scale(u, 0.5);
    const hv = scale(v, 0.5);
    const hw = scale(w, 0.5);
    const corner = (su, sv, sw) => add(add(add(center, scale(hu, su)), scale(hv, sv)), scale(hw, sw));
    const p = {};
    for (const su of [-1, 1]) for (const sv of [-1, 1]) for (const sw of [-1, 1]) p[`${su}${sv}${sw}`] = corner(su, sv, sw);
    const f = (k) => p[k];
    this.quad(f("1-1-1"), f("11-1"), f("111"), f("1-11"), color); // +u
    this.quad(f("-1-1-1"), f("-1-11"), f("-111"), f("-11-1"), color); // -u
    this.quad(f("-11-1"), f("-111"), f("111"), f("11-1"), color); // +v
    this.quad(f("-1-1-1"), f("1-1-1"), f("1-11"), f("-1-11"), color); // -v
    this.quad(f("-1-11"), f("1-11"), f("111"), f("-111"), color); // +w
    this.quad(f("-1-1-1"), f("-11-1"), f("11-1"), f("1-1-1"), color); // -w
  }

  /** Axis-aligned box. */
  box(center, [sx, sy, sz], color) {
    this.orientedBox(center, [sx, 0, 0], [0, sy, 0], [0, 0, sz], color);
  }

  /**
   * Box from `start` to `end` (a limb or tube), with the given width along X
   * and thickness perpendicular to the segment in the YZ plane.
   */
  segment(start, end, width, thickness, color) {
    const axis = sub(end, start);
    const side = [1, 0, 0];
    const normal = scale(normalize(cross(side, axis)), thickness);
    const center = scale(add(start, end), 0.5);
    this.orientedBox(center, scale(side, width), axis, normal, color);
  }

  /** Disc (wheel) around the X axis: an n-sided prism. */
  wheel(center, radius, width, color, sides = 10) {
    const [cx, cy, cz] = center;
    const hw = width / 2;
    for (let i = 0; i < sides; i += 1) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const y0 = cy + Math.cos(a0) * radius;
      const z0 = cz + Math.sin(a0) * radius;
      const y1 = cy + Math.cos(a1) * radius;
      const z1 = cz + Math.sin(a1) * radius;
      this.quad([cx - hw, y0, z0], [cx - hw, y1, z1], [cx + hw, y1, z1], [cx + hw, y0, z0], color);
      this.triangle([cx + hw, cy, cz], [cx + hw, y0, z0], [cx + hw, y1, z1], color);
      this.triangle([cx - hw, cy, cz], [cx - hw, y1, z1], [cx - hw, y0, z0], color);
    }
  }

  /** Cone with its base centred on `base` (a stylised tree crown). */
  cone(base, radius, height, color, sides = 7, rotation = 0) {
    const tip = [base[0], base[1] + height, base[2]];
    for (let i = 0; i < sides; i += 1) {
      const a0 = rotation + (i / sides) * Math.PI * 2;
      const a1 = rotation + ((i + 1) / sides) * Math.PI * 2;
      const p0 = [base[0] + Math.cos(a0) * radius, base[1], base[2] + Math.sin(a0) * radius];
      const p1 = [base[0] + Math.cos(a1) * radius, base[1], base[2] + Math.sin(a1) * radius];
      this.triangle(p0, tip, p1, color);
      this.triangle(p0, p1, base, color);
    }
  }

  /**
   * Low-poly ellipsoid (UV sphere), e.g. a leafy crown, a bush or a cloud puff.
   * @param {number[]} radii [rx, ry, rz]
   */
  ellipsoid(center, [rx, ry, rz], color, rings = 4, segments = 7, rotation = 0) {
    const point = (ring, segment) => {
      const phi = (ring / rings) * Math.PI;
      const theta = rotation + (segment / segments) * Math.PI * 2;
      return [center[0] + rx * Math.sin(phi) * Math.cos(theta), center[1] + ry * Math.cos(phi), center[2] + rz * Math.sin(phi) * Math.sin(theta)];
    };
    for (let ring = 0; ring < rings; ring += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const a = point(ring, segment);
        const b = point(ring + 1, segment);
        const c = point(ring + 1, segment + 1);
        const d = point(ring, segment + 1);
        if (ring > 0) this.triangle(a, d, c, color);
        if (ring < rings - 1) this.triangle(a, c, b, color);
      }
    }
  }

  /** Flat ellipse on the XZ plane facing up (soft shadow blobs), rotated by `yaw`. */
  disc(center, [rx, rz], color, sides = 12, yaw = 0) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const at = (angle) => {
      const x = Math.cos(angle) * rx;
      const z = Math.sin(angle) * rz;
      return [center[0] + x * c - z * s, center[1], center[2] + x * s + z * c];
    };
    for (let i = 0; i < sides; i += 1) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      this.triangle(center, at(a1), at(a0), color);
    }
  }

  /** Vertical cylinder (or cone frustum when `topRadius` differs), e.g. a silo or a tower. */
  cylinder(base, radius, height, color, sides = 10, topRadius = radius, capped = true) {
    const ring = (y, r, angle) => [base[0] + Math.cos(angle) * r, base[1] + y, base[2] + Math.sin(angle) * r];
    const top = [base[0], base[1] + height, base[2]];
    for (let i = 0; i < sides; i += 1) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      this.quad(ring(0, radius, a0), ring(height, topRadius, a0), ring(height, topRadius, a1), ring(0, radius, a1), color);
      if (capped) this.triangle(top, ring(height, topRadius, a1), ring(height, topRadius, a0), color);
    }
  }

  /**
   * Appends a built mesh transformed by a model matrix (rotation, uniform
   * scale, translation). Lets features be modelled once and placed many times.
   */
  append(mesh, matrix) {
    const { positions, normals, colors } = mesh;
    for (let i = 0; i < positions.length; i += 3) {
      const p = transformPoint(matrix, [positions[i], positions[i + 1], positions[i + 2]]);
      const nx = normals[i];
      const ny = normals[i + 1];
      const nz = normals[i + 2];
      const n = normalize([
        matrix[0] * nx + matrix[4] * ny + matrix[8] * nz,
        matrix[1] * nx + matrix[5] * ny + matrix[9] * nz,
        matrix[2] * nx + matrix[6] * ny + matrix[10] * nz,
      ]);
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
    }
    this.colors.pushRange(colors, 0, colors.length);
  }

  /** Frees the collected vertices; call after the last build(). */
  release() {
    this.positions.release();
    this.normals.release();
    this.colors.release();
  }

  build() {
    return {
      positions: this.positions.toFloat32(),
      normals: this.normals.toFloat32(),
      colors: this.colors.toFloat32(),
      vertexCount: this.vertexCount,
    };
  }
}
