// Command-line parsing for screenshot.mjs, kept separate so it can be unit tested.

export const DEFAULT_URL = "http://localhost:8080";

export function parseArgs(argv) {
  const opts = { url: null, out: null, width: 1280, height: 800, wait: 2500 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--width" || arg === "--height") opts[arg.slice(2)] = Number(argv[++i]);
    else if (arg === "--wait") opts.wait = Number(argv[++i]);
    else if (opts.url === null) opts.url = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  opts.url ??= DEFAULT_URL;
  for (const key of ["width", "height", "wait"]) {
    if (!Number.isFinite(opts[key]) || opts[key] < 0) throw new Error(`Invalid --${key}`);
  }
  return opts;
}
