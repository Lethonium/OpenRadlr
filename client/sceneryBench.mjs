// Fixed-camera WebGL cost of a real, worker-built scene (#117).
//
//   node sceneryBench.mjs --at 6490 --camera chase --scenery models --frames 300
//   node sceneryBench.mjs --at 7562 --camera drone --scenery off --out village.png
//
// Run against the real server. JSON goes to stdout; screenshots belong in
// ~/.cache/openradlr/, not the repository. This is ad-hoc hardware measurement,
// not part of the plain-node test suite.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";
import { benchMetadata, parseBenchArgs } from "./sceneryBenchArgs.mjs";

export async function runSceneryBench(opts) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
    const benchmarkUrl = new URL("/__scenery-bench", opts.url).href;
    await page.route(benchmarkUrl, (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body style='margin:0;background:#000'><div id='root'></div></body></html>",
    }));
    await page.goto(benchmarkUrl);
    const result = await page.evaluate(async (options) => {
      const [
        { RouteGeometry },
        { buildScene },
        { sceneStats },
        { fetchMapNeighbours, fetchMapNetwork },
        { loadScenery },
        { Renderer, createContext },
        { View3D },
        { CAMERA_MODES, cameraPose },
        { FpsMeter },
      ] = await Promise.all([
        import("/js/route/geometry.js"),
        import("/js/view3d/worldScene.js"),
        import("/js/view3d/sceneStats.js"),
        import("/js/route/worldMap.js"),
        import("/js/view3d/scenery/load.js"),
        import("/js/view3d/renderer.js"),
        import("/js/view3d/view3d.js"),
        import("/js/view3d/chaseCamera.js"),
        import("/js/view/fpsMeter.js"),
      ]);
      const fetchJson = async (path) => {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`${path}: ${response.status}`);
        return response.json();
      };
      const routeFile = await fetchJson(options.route ? `/api/route?id=${encodeURIComponent(options.route)}` : "/api/route");
      const info = await fetchJson("/api/info");
      const listed = Array.isArray(info.routes) ? info.routes : info.route ? [info.route] : [];
      const route = new RouteGeometry(routeFile);
      if (options.at > route.length) throw new Error(`--at ${options.at} exceeds the ${route.length} m route`);
      const [others, network, scenes] = await Promise.all([
        fetchMapNeighbours(route, listed, (id) => fetchJson(`/api/route?id=${encodeURIComponent(id)}`)),
        fetchMapNetwork(route, (id) => fetchJson(`/api/map?id=${encodeURIComponent(id)}`)),
        loadScenery(options.scenery),
      ]);

      const buildStarted = performance.now();
      const scene = await buildScene(routeFile, others, { network, biome: options.biome, scenes });
      const buildMs = performance.now() - buildStarted;
      const stats = sceneStats(scene);

      const canvas = globalThis.document.createElement("canvas");
      canvas.style.width = `${options.width}px`;
      canvas.style.height = `${options.height}px`;
      const labels = globalThis.document.createElement("div");
      globalThis.document.querySelector("#root").append(canvas, labels);
      const gl = createContext(canvas);
      if (!gl) throw new Error("WebGL 2 is not available");

      const cleanCounter = () => ({ calls: 0, vertices: 0 });
      const passes = { setup: cleanCounter(), shadow: cleanCounter(), opaque: cleanCounter() };
      let pass = "setup";
      let bufferBytes = 0;
      let bufferUploads = 0;
      const count = (vertices) => {
        passes[pass].calls += 1;
        passes[pass].vertices += vertices;
      };
      const originalBufferData = gl.bufferData.bind(gl);
      gl.bufferData = (target, data, usage) => {
        bufferBytes += typeof data === "number" ? data : data?.byteLength ?? 0;
        bufferUploads += 1;
        return originalBufferData(target, data, usage);
      };
      const originalDrawArrays = gl.drawArrays.bind(gl);
      gl.drawArrays = (mode, first, vertices) => {
        count(vertices);
        return originalDrawArrays(mode, first, vertices);
      };
      const originalDrawArraysInstanced = gl.drawArraysInstanced.bind(gl);
      gl.drawArraysInstanced = (mode, first, vertices, instances) => {
        count(vertices * instances);
        return originalDrawArraysInstanced(mode, first, vertices, instances);
      };
      const originalDrawElements = gl.drawElements.bind(gl);
      gl.drawElements = (mode, vertices, type, offset) => {
        count(vertices);
        return originalDrawElements(mode, vertices, type, offset);
      };
      const originalDrawElementsInstanced = gl.drawElementsInstanced.bind(gl);
      gl.drawElementsInstanced = (mode, vertices, type, offset, instances) => {
        count(vertices * instances);
        return originalDrawElementsInstanced(mode, vertices, type, offset, instances);
      };

      const renderer = new Renderer(gl);
      const beginShadows = renderer.beginShadows.bind(renderer);
      renderer.beginShadows = (...args) => {
        pass = "shadow";
        return beginShadows(...args);
      };
      const endShadows = renderer.endShadows.bind(renderer);
      renderer.endShadows = (...args) => {
        const result = endShadows(...args);
        pass = "opaque";
        return result;
      };

      const uploadStarted = performance.now();
      const view = new View3D(canvas, labels, route, scene, { renderer });
      const uploadSubmitMs = performance.now() - uploadStarted;
      view.setTimeMode("day");
      view.setQuality(options.quality);
      const pose = cameraPose(route, options.at, 0, CAMERA_MODES[options.camera]);
      view.camera.eye = pose.eye;
      view.camera.target = pose.target;

      const draw = () => view.render({ riders: [], myId: null, timeS: 12, colors: { me: "#fff", human: "#fff", bot: "#fff" } });
      const nextFrame = () => new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
      for (let i = 0; i < options.warmup; i += 1) {
        await nextFrame();
        draw();
      }

      const fps = new FpsMeter();
      const cpuMs = [];
      let rendered = null;
      for (let i = 0; i <= options.frames; i += 1) {
        const now = await nextFrame();
        fps.frame(now / 1000);
        const before = { shadow: { ...passes.shadow }, opaque: { ...passes.opaque } };
        const started = performance.now();
        draw();
        cpuMs.push(performance.now() - started);
        rendered = {
          shadow: { calls: passes.shadow.calls - before.shadow.calls, vertices: passes.shadow.vertices - before.shadow.vertices },
          opaque: { calls: passes.opaque.calls - before.opaque.calls, vertices: passes.opaque.vertices - before.opaque.vertices },
        };
      }
      const reading = fps.read();
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        route: routeFile.id,
        map: routeFile.map?.id ?? null,
        scenery: options.scenery,
        biome: options.biome,
        quality: options.quality,
        at: options.at,
        camera: options.camera,
        viewport: { width: options.width, height: options.height, devicePixelRatio: globalThis.devicePixelRatio },
        neighbours: others.length,
        network: Boolean(network),
        buildMs,
        uploadSubmitMs,
        rawBufferBytes: bufferBytes,
        rawBufferUploads: bufferUploads,
        stats,
        fps: reading,
        meanRenderCpuMs: cpuMs.reduce((sum, ms) => sum + ms, 0) / cpuMs.length,
        rendered,
        browser: navigator.userAgent,
        gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    }, opts);

    const metadata = benchMetadata((args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    const report = { ...result, ...metadata };
    if (opts.out) {
      mkdirSync(dirname(opts.out), { recursive: true });
      await page.screenshot({ path: opts.out });
      report.screenshot = opts.out;
    }
    return report;
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseBenchArgs(process.argv.slice(2));
  const report = await runSceneryBench(opts);
  console.log(JSON.stringify(report, null, 2));
}
