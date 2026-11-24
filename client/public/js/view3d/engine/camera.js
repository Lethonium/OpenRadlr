/**
 * Camera set-up shared by the engine and the adapter.
 */

/**
 * Makes a camera follow a view and a projection matrix (column-major, as the
 * rest of the app keeps them) without letting Three recompute either.
 * @param {import("../../three.js").Camera} camera
 * @param {ArrayLike<number>} view
 * @param {ArrayLike<number>} projection
 */
export function cameraFromMatrices(camera, view, projection) {
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  camera.matrixWorldInverse.fromArray(view);
  camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
  camera.projectionMatrix.fromArray(projection);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
