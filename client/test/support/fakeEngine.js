/**
 * A stand-in for the engine that records the order of what a view asks of it.
 * Share `calls` with a recording renderer to see engine and adapter in one list.
 * @param {string[]} [calls]
 */
export function fakeEngine(calls = []) {
  return {
    calls,
    scenes: [],
    presented: [],
    rects: [],
    resizes: [],
    qualities: [],
    resize(width, height, ratio) {
      this.resizes.push([width, height, ratio]);
    },
    setQuality(settings) {
      this.qualities.push(settings);
    },
    beginFrame() {
      calls.push("beginFrame");
    },
    renderScene(scene, camera, rect) {
      calls.push("renderScene");
      this.scenes.push({ scene, camera });
      this.rects.push(rect ?? null);
    },
    present(camera, env, view) {
      calls.push("present");
      this.presented.push({ camera, env, view });
    },
  };
}
