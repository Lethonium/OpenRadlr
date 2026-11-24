/**
 * Quads collected into typed arrays, for the road and river strips: every
 * quad has its own four vertices (flat faces, no shared edges), so a layer can
 * cut the list into chunks by quad count and a worker can transfer it whole.
 */

/** A growing typed array. */
class Growing {
  constructor(Type) {
    this.Type = Type;
    this.data = new Type(1024);
    this.length = 0;
  }

  push(...values) {
    if (this.length + values.length > this.data.length) {
      const grown = new this.Type(Math.max(this.data.length * 2, this.length + values.length));
      grown.set(this.data.subarray(0, this.length));
      this.data = grown;
    }
    for (const value of values) this.data[this.length++] = value;
  }

  done() {
    return this.data.slice(0, this.length);
  }
}

/**
 * @typedef {object} Strips
 * @property {Float32Array} positions x, y, z per vertex
 * @property {Float32Array} uvs u, v per vertex
 * @property {Uint8Array} kinds what each vertex belongs to (the owner's table)
 * @property {Float32Array} shades brightness factor per vertex
 * @property {Uint32Array} indices six per quad (two triangles, wound to face `facing`)
 */

/** An empty list of quads. */
export function createStrips() {
  const positions = new Growing(Float32Array);
  const uvs = new Growing(Float32Array);
  const kinds = new Growing(Uint8Array);
  const shades = new Growing(Float32Array);
  const indices = new Growing(Uint32Array);
  let vertices = 0;
  return {
    /**
     * Adds quad a-b-c-d (in order around it), wound so that it faces `facing`.
     * @param {number[][]} corners four [x, y, z]
     * @param {{kind: number, shade?: number, uv: number[][], facing?: number[]}} options
     */
    quad(corners, { kind, shade = 1, uv, facing = [0, 1, 0] }) {
      const [a, b, c] = corners;
      const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const flip = nx * facing[0] + ny * facing[1] + nz * facing[2] < 0;
      corners.forEach((p, i) => {
        positions.push(p[0], p[1], p[2]);
        uvs.push(uv[i][0], uv[i][1]);
        kinds.push(kind);
        shades.push(shade);
      });
      const v = vertices;
      if (flip) indices.push(v, v + 2, v + 1, v, v + 3, v + 2);
      else indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
      vertices += 4;
    },
    /** @returns {Strips} */
    build() {
      return { positions: positions.done(), uvs: uvs.done(), kinds: kinds.done(), shades: shades.done(), indices: indices.done() };
    },
  };
}

/** One list of quads from several (indices shifted). @param {Strips[]} list @returns {Strips} */
export function mergeStrips(list) {
  const total = (key) => list.reduce((sum, strips) => sum + strips[key].length, 0);
  const merged = {
    positions: new Float32Array(total("positions")),
    uvs: new Float32Array(total("uvs")),
    kinds: new Uint8Array(total("kinds")),
    shades: new Float32Array(total("shades")),
    indices: new Uint32Array(total("indices")),
  };
  const at = { positions: 0, uvs: 0, kinds: 0, shades: 0, indices: 0 };
  let vertices = 0;
  for (const strips of list) {
    for (const key of ["positions", "uvs", "kinds", "shades"]) {
      merged[key].set(strips[key], at[key]);
      at[key] += strips[key].length;
    }
    for (let i = 0; i < strips.indices.length; i += 1) merged.indices[at.indices + i] = strips.indices[i] + vertices;
    at.indices += strips.indices.length;
    vertices += strips.kinds.length;
  }
  return merged;
}
