/**
 * A stand-in for Three's WebGLRenderer that records what it is asked to do,
 * so the adapter and the engine can be tested without WebGL.
 * @returns {object} the fake; `calls` holds what it saw
 */
export function fakeRenderer() {
  const calls = { clears: [], renders: [], viewports: [], scissors: [], targets: [], renderTargets: [], sizes: [], disposed: 0, cameras: [], scenes: [] };
  const state = { scissorTest: false, scissor: null, viewport: null, target: null };
  return {
    calls,
    autoClear: true,
    shadowMap: { enabled: false, type: 0 },
    toneMapping: 0,
    toneMappingExposure: 1,
    setPixelRatio() {},
    setSize(width, height) {
      calls.sizes.push([width, height]);
    },
    setClearColor() {},
    getRenderTarget() {
      return state.target;
    },
    setRenderTarget(target) {
      state.target = target;
      calls.targets.push(target);
    },
    setViewport(x, y, width, height) {
      state.viewport = [x, y, width, height];
      calls.viewports.push(state.viewport);
    },
    setScissor(x, y, width, height) {
      state.scissor = [x, y, width, height];
      calls.scissors.push(state.scissor);
    },
    setScissorTest(on) {
      state.scissorTest = on;
    },
    clear() {
      calls.clears.push({ scissorTest: state.scissorTest, scissor: state.scissor, viewport: state.viewport, target: state.target });
    },
    render(scene, camera) {
      calls.renders.push(scene.children.map((child) => child.name));
      calls.renderTargets.push(state.target);
      calls.scenes.push(scene);
      calls.cameras.push(camera);
    },
    dispose() {
      calls.disposed += 1;
    },
  };
}
