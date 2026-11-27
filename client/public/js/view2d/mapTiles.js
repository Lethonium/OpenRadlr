/**
 * The map's ground in tiles: 64 m squares painted once at 6 px/m and kept in an LRU of 32. A tile holds the
 * ground (from the sampler), rivers, roads (the world's own road mesh), hedges and walls, and the scenery as
 * sprites. The ground (the costly part) is kept in a canvas of its own; a tile records the sprites it drew (or
 * missed) and, when the store has a better one, only redraws the scenery over the kept ground. The ground is
 * repainted when the season, the time of day or the (coarsely quantised) sun changes.
 */
import { ROAD_KIND } from "../world/plan/roadStrips.js";
import { css, toSrgb } from "./look2d.js";
import { drawSprite } from "./drawSprite.js";
import { HOUSE_YAWS, BUILDING_SPRITES, spriteJobs } from "./sprites/catalog.js";

export const MAP_TILE_M = 64;
export const MAP_TILE_PPM = 6;
export const MAP_TILE_CACHE = 32;
/** Ground pixels are worked out every this many pixels, then filled square. */
const STEP = 2;
/** Scenery this far outside a tile is still drawn into it, so crowns reach over the seams. */
const MARGIN_M = 12;
const TAU = Math.PI * 2;
/** The sun's direction is rounded to this step per component for the ground's light, so every tile of a view is lit alike and the ground is not repainted for a sun that has barely moved (about every ten minutes in `auto`). */
const SUN_STEP = 0.05;
const quantisedSun = (sun) => sun.map((v) => Math.round(v / SUN_STEP) * SUN_STEP);

/** After dark the ground loses this much of its colour before the night tint (which is blue) multiplies it, so it reads blue like the road. */
const NIGHT_DESATURATE = 0.7;
const NIGHT_BRIGHTEN = 1.5;
const HEDGE = [0.2, 0.38, 0.18];
const HEDGE_BARE = [0.36, 0.3, 0.24];
const WALL = [0.7, 0.67, 0.6];
const VINE = [0.34, 0.5, 0.2];
const FLAMME = "#d8262b";
/** Road quads, drawn in this order (first underneath). The gravel verge, bank and ruts are left to the ground's own paint. */
const ROAD_ORDER = Object.freeze([ROAD_KIND.pavement, ROAD_KIND.asphalt, ROAD_KIND.edge, ROAD_KIND.marking]);
/** Lane dividers are one dashed row per lane line; the map keeps the centre one. A road narrower than this keeps all. */
const NARROW_ROAD_M = 3;
const CENTRE_TOLERANCE_M = 0.5;
const EDGE_SEARCH_M = 20;
const EDGE_CELL_M = 8;

/** Triangles of a mesh by the tiles their box touches: `Map<"tx,tz", number[]>` of index offsets. */
function bucketTriangles(positions, indices, only = null) {
  const buckets = new Map();
  for (const k of only ?? Array.from({ length: indices.length / 3 }, (_, n) => n * 3)) {
    const xs = [positions[indices[k] * 3], positions[indices[k + 1] * 3], positions[indices[k + 2] * 3]];
    const zs = [positions[indices[k] * 3 + 2], positions[indices[k + 1] * 3 + 2], positions[indices[k + 2] * 3 + 2]];
    const [i0, i1] = [Math.floor(Math.min(...xs) / MAP_TILE_M), Math.floor(Math.max(...xs) / MAP_TILE_M)];
    const [j0, j1] = [Math.floor(Math.min(...zs) / MAP_TILE_M), Math.floor(Math.max(...zs) / MAP_TILE_M)];
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const key = `${i},${j}`;
        const list = buckets.get(key);
        if (list) list.push(k);
        else buckets.set(key, [k]);
      }
    }
  }
  return buckets;
}

/**
 * The road mesh's triangles by tile, without the lane dividers away from the road's middle: a marking triangle is kept
 * when it lies about midway between the road's two edge lines (or the road is narrow).
 */
export function roadTriangles(mesh) {
  const { positions, indices, kinds } = mesh;
  const centre = (k) => {
    const [a, b, c] = [indices[k] * 3, indices[k + 1] * 3, indices[k + 2] * 3];
    return [(positions[a] + positions[b] + positions[c]) / 3, (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3];
  };
  const edges = new Map();
  for (let k = 0; k < indices.length; k += 3) {
    if (kinds[indices[k]] !== ROAD_KIND.edge) continue;
    const [x, z] = centre(k);
    const key = `${Math.floor(x / EDGE_CELL_M)},${Math.floor(z / EDGE_CELL_M)}`;
    const list = edges.get(key);
    if (list) list.push([x, z]);
    else edges.set(key, [[x, z]]);
  }
  const near = (x, z) => {
    const found = [];
    const reach = Math.ceil(EDGE_SEARCH_M / EDGE_CELL_M);
    for (let i = -reach; i <= reach; i += 1) {
      for (let j = -reach; j <= reach; j += 1) {
        for (const e of edges.get(`${Math.floor(x / EDGE_CELL_M) + i},${Math.floor(z / EDGE_CELL_M) + j}`) ?? []) {
          const d = Math.hypot(e[0] - x, e[1] - z);
          if (d <= EDGE_SEARCH_M) found.push({ e, d });
        }
      }
    }
    return found.sort((p, q) => p.d - q.d);
  };
  const keep = [];
  for (let k = 0; k < indices.length; k += 3) {
    if (kinds[indices[k]] !== ROAD_KIND.marking) {
      keep.push(k);
      continue;
    }
    const [x, z] = centre(k);
    const found = near(x, z);
    if (found.length === 0) continue;
    const first = found[0];
    const opposite = found.find(({ e }) => (e[0] - x) * (first.e[0] - x) + (e[1] - z) * (first.e[1] - z) < 0);
    if (!opposite) continue;
    if (first.d + opposite.d < NARROW_ROAD_M || Math.abs(first.d - opposite.d) < CENTRE_TOLERANCE_M) keep.push(k);
  }
  return keep;
}

/** The turn (the world's rotation.y) the 3D layers give a building baked unturned; the map rotates by its negative. */
function buildingTurn(item) {
  const yaw = item.yaw ?? 0;
  if (item.layer === "farm") return Math.PI / 2 - yaw;
  if (item.layer === "cafe") return yaw + Math.PI;
  if (item.layer === "landmark") return item.id === "turbine" ? yaw + Math.PI / 2 : yaw;
  return 0;
}

/** The top-view job each item draws as: `{ job, scale }`, or null. Built once from the catalog. */
function spriteIndex() {
  const byId = new Map();
  const houses = new Map();
  for (const job of spriteJobs({ view: "top" })) {
    if (job.id === "house") houses.set(`${job.options.style}:${Math.round((job.yaw / TAU) * HOUSE_YAWS)}`, job);
    else if (!byId.has(job.id)) byId.set(job.id, job);
  }
  const named = (name) => byId.get(BUILDING_SPRITES[name] ?? name) ?? null;
  return {
    named,
    plant: (id) => byId.get(id) ?? null,
    house(item) {
      const yaw = Math.atan2(item.facing?.[0] ?? 0, item.facing?.[1] ?? 1);
      const k = ((Math.round((yaw / TAU) * HOUSE_YAWS) % HOUSE_YAWS) + HOUSE_YAWS) % HOUSE_YAWS;
      return houses.get(`${item.id}:${k}`) ?? houses.get(`cottage:${k}`) ?? null;
    },
    /** The sprite job of a static scenery item. */
    of(item) {
      switch (item.layer) {
        case "tree":
        case "roadside":
        case "row":
          return this.plant(item.id);
        case "house":
          return this.house(item);
        case "farm":
        case "cafe":
        case "lamp":
          return named(item.layer);
        case "landmark":
          return named(item.id);
        case "arch":
          return item.id === "arch" ? this.plant("route-arch") : null;
        default:
          return null;
      }
    },
  };
}

/**
 * @param {{scene: object, index: {query: Function}, sampler: {color: Function, water: number}, store: {want: Function, get: Function}, createCanvas: (w: number, h: number) => object}} deps
 */
export function createMapTiles({ scene, index, sampler, store, createCanvas }) {
  const tiles = new Map(); // key -> {canvas, ground, used: Map<jobKey, sprite|null>, signature}
  const sprites = spriteIndex();
  const roadBuckets = bucketTriangles(scene.roads.strips.positions, scene.roads.strips.indices, roadTriangles(scene.roads.strips));
  const riverBuckets = bucketTriangles(scene.rivers.strips.positions, scene.rivers.strips.indices);
  const roadColors = roadPalette(scene.roads.style);
  const size = MAP_TILE_M * MAP_TILE_PPM;

  function paintGround(ctx, tx, tz, sun, night) {
    const image = ctx.createImageData(size, size);
    for (let py = 0; py < size; py += STEP) {
      for (let px = 0; px < size; px += STEP) {
        let [r, g, b] = sampler.color(tx * MAP_TILE_M + px / MAP_TILE_PPM, tz * MAP_TILE_M + py / MAP_TILE_PPM, sun);
        if (night) {
          const grey = (r + g + b) / 3;
          [r, g, b] = [r, g, b].map((v) => Math.min(1, (v + (grey - v) * NIGHT_DESATURATE) * NIGHT_BRIGHTEN));
        }
        for (let oy = 0; oy < STEP; oy += 1) {
          for (let ox = 0; ox < STEP; ox += 1) {
            const k = ((py + oy) * size + px + ox) * 4;
            image.data[k] = r * 255;
            image.data[k + 1] = g * 255;
            image.data[k + 2] = b * 255;
            image.data[k + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  function paintTriangles(ctx, mesh, list, filter = null) {
    ctx.beginPath();
    for (const k of list) {
      if (filter && !filter(mesh.indices[k])) continue;
      const [a, b, c] = [mesh.indices[k] * 3, mesh.indices[k + 1] * 3, mesh.indices[k + 2] * 3];
      ctx.moveTo(mesh.positions[a], mesh.positions[a + 2]);
      ctx.lineTo(mesh.positions[b], mesh.positions[b + 2]);
      ctx.lineTo(mesh.positions[c], mesh.positions[c + 2]);
    }
    ctx.fill();
  }

  function paintWater(ctx, key) {
    const list = riverBuckets.get(key);
    if (!list) return;
    ctx.fillStyle = css(scene.rivers.style.color.map(toSrgb), 1);
    paintTriangles(ctx, scene.rivers.strips, list);
  }

  function paintRoads(ctx, key) {
    const list = roadBuckets.get(key);
    if (!list) return;
    const mesh = scene.roads.strips;
    for (const kind of ROAD_ORDER) {
      ctx.fillStyle = roadColors[kind];
      paintTriangles(ctx, mesh, list, (vertex) => mesh.kinds[vertex] === kind);
    }
  }

  function paintEdges(ctx, items, look) {
    ctx.lineCap = "round";
    for (const e of items) {
      if (e.layer !== "edge") continue;
      const hedge = e.id === "hedge";
      ctx.strokeStyle = css(hedge ? (look.season === "winter" ? HEDGE_BARE : HEDGE) : WALL);
      ctx.lineWidth = hedge ? 1.6 : 0.6;
      const [hx, hz] = [Math.cos(e.yaw) * e.len * 0.5, Math.sin(e.yaw) * e.len * 0.5];
      ctx.beginPath();
      ctx.moveTo(e.x - hx, e.z - hz);
      ctx.lineTo(e.x + hx, e.z + hz);
      ctx.stroke();
    }
  }

  /** The flamme rouge has no asset: a red bar across the road with a pennant. */
  function paintFlamme(ctx, item) {
    ctx.save();
    ctx.translate(item.x, item.z);
    ctx.rotate(-item.yaw);
    ctx.fillStyle = FLAMME;
    ctx.fillRect(-(item.w ?? 8) / 2, -0.35, item.w ?? 8, 0.7);
    ctx.beginPath();
    ctx.moveTo(-(item.w ?? 8) / 2, -0.35);
    ctx.lineTo(-(item.w ?? 8) / 2, -3.5);
    ctx.lineTo(-(item.w ?? 8) / 2 + 2.4, -2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function paintScenery(ctx, tx, tz, look, used, priority) {
    const items = index.query(tx * MAP_TILE_M - MARGIN_M, tz * MAP_TILE_M - MARGIN_M, (tx + 1) * MAP_TILE_M + MARGIN_M, (tz + 1) * MAP_TILE_M + MARGIN_M);
    paintEdges(ctx, items, look);
    const things = [];
    for (const item of items) {
      if (item.layer === "arch" && item.id === "flammeRouge") {
        paintFlamme(ctx, item);
        continue;
      }
      if (item.layer === "row" && item.id === "vine") {
        ctx.fillStyle = css(VINE);
        ctx.beginPath();
        ctx.arc(item.x, item.z, 0.55, 0, TAU);
        ctx.fill();
        continue;
      }
      const job = sprites.of(item);
      if (!job) continue;
      store.want(job, priority);
      const sprite = store.get(job.key);
      used.set(job.key, sprite);
      if (sprite) things.push({ item, sprite });
    }
    // Low things first, so crowns fall over their neighbours' shadows.
    things.sort((a, b) => a.item.z - b.item.z);
    for (const { item, sprite } of things) {
      const turn = item.layer === "arch" ? item.yaw : buildingTurn(item);
      if (item.layer === "arch") {
        ctx.save();
        ctx.translate(item.x, item.z);
        ctx.rotate(-turn);
        drawSprite(ctx, sprite, 0, 0, 1);
        ctx.restore();
      } else if (turn) {
        ctx.save();
        ctx.translate(item.x, item.z);
        ctx.rotate(-turn);
        drawSprite(ctx, sprite, 0, 0, item.s || 1);
        ctx.restore();
      } else drawSprite(ctx, sprite, item.x, item.z, item.s || 1);
    }
  }

  /** The scenery drawn over the kept ground into the tile's canvas; records the sprites it used. */
  function compose(tile, tx, tz, look, priority) {
    const ctx = tile.canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(tile.ground, 0, 0);
    ctx.setTransform(MAP_TILE_PPM, 0, 0, MAP_TILE_PPM, -tx * MAP_TILE_M * MAP_TILE_PPM, -tz * MAP_TILE_M * MAP_TILE_PPM);
    tile.used.clear();
    paintScenery(ctx, tx, tz, look, tile.used, priority);
  }

  function make(tx, tz, look, priority) {
    const ground = createCanvas(size, size);
    const ctx = ground.getContext("2d");
    paintGround(ctx, tx, tz, quantisedSun(look.sun), look.night);
    ctx.setTransform(MAP_TILE_PPM, 0, 0, MAP_TILE_PPM, -tx * MAP_TILE_M * MAP_TILE_PPM, -tz * MAP_TILE_M * MAP_TILE_PPM);
    paintWater(ctx, `${tx},${tz}`);
    paintRoads(ctx, `${tx},${tz}`);
    const tile = { canvas: createCanvas(size, size), ground, used: new Map(), signature: signatureOf(look) };
    compose(tile, tx, tz, look, priority);
    return tile;
  }

  const signatureOf = (look) => `${look.season}|${look.time}|${quantisedSun(look.sun).map((v) => v.toFixed(2))}`;
  /** A sprite the tile missed (or drew as the day's) is there now; a sprite since evicted does not count, or the tile would ask for it again and again. */
  const gainedSprite = (tile) => [...tile.used].some(([key, sprite]) => {
    const now = store.get(key);
    return now && now !== sprite;
  });

  return {
    /** The tile's canvas, made if needed (its ground remade when the look changed, its scenery redrawn when a sprite it lacked has been baked). `priority`: its distance from the rider, metres. */
    tile(tx, tz, look, priority = 0) {
      const key = `${tx},${tz}`;
      let tile = tiles.get(key);
      if (tile && tile.signature === signatureOf(look)) {
        if (gainedSprite(tile)) compose(tile, tx, tz, look, priority);
        tiles.delete(key);
        tiles.set(key, tile); // most recent last
        return tile.canvas;
      }
      tile = make(tx, tz, look, priority);
      tiles.delete(key);
      tiles.set(key, tile);
      while (tiles.size > MAP_TILE_CACHE) tiles.delete(tiles.keys().next().value);
      return tile.canvas;
    },
    clear() {
      tiles.clear();
    },
    count: () => tiles.size,
  };
}

/** Road colours by quad kind, as css. */
function roadPalette(style) {
  const colors = [];
  const set = (kind, rgb) => (colors[kind] = css(rgb.map(toSrgb)));
  set(ROAD_KIND.asphalt, style.surface);
  set(ROAD_KIND.verge, style.verge);
  set(ROAD_KIND.marking, style.marking);
  set(ROAD_KIND.bank, style.bank?.color ?? style.verge);
  set(ROAD_KIND.rut, style.rut?.color ?? style.surface);
  set(ROAD_KIND.edge, style.edge);
  set(ROAD_KIND.pavement, style.pavement ?? style.verge);
  return colors;
}
