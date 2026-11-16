import { KITS_OF } from "./public/js/view3d/scenery/load.js";
import { CAMERA_MODES } from "./public/js/view3d/chaseCamera.js";

/** Revision data when the benchmark has a repository; null in a partial container mount. */
export function benchMetadata(run) {
  try {
    const commit = run(["rev-parse", "HEAD"]).trim();
    const dirty = run(["status", "--porcelain"]).trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}

/** Parse one fixed-camera scenery benchmark invocation. */
export function parseBenchArgs(argv) {
  const opts = {
    url: "http://localhost:8080",
    route: null,
    at: 6490,
    camera: "chase",
    scenery: "models",
    biome: "temperate",
    quality: "high",
    width: 1280,
    height: 720,
    warmup: 30,
    frames: 300,
    out: null,
  };
  const numeric = new Set(["at", "width", "height", "warmup", "frames"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = arg.startsWith("--") ? arg.slice(2) : null;
    if (!key) throw new Error(`Unexpected argument: ${arg}`);
    if (!(key in opts)) throw new Error(`Unknown option: ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    opts[key] = numeric.has(key) ? Number(value) : value;
  }
  if (!Number.isFinite(opts.at) || opts.at < 0) throw new Error("Invalid --at");
  for (const key of ["width", "height", "warmup", "frames"]) {
    if (!Number.isInteger(opts[key]) || opts[key] < 0) throw new Error(`Invalid --${key}`);
  }
  if (opts.frames < 2 || opts.frames > 300) throw new Error("--frames must be in 2..300 (the FPS meter's window)");
  if (!(opts.camera in CAMERA_MODES)) throw new Error(`Invalid --camera "${opts.camera}"`);
  if (!(opts.scenery in KITS_OF)) throw new Error(`Invalid --scenery "${opts.scenery}"`);
  if (!["high", "low"].includes(opts.quality)) throw new Error(`Invalid --quality "${opts.quality}"`);
  return opts;
}
