/**
 * A fake 2D canvas: `canvas.getContext()` is a proxy that counts drawing calls and
 * records what was set. `calls` counts `lineTo, fill, fillRect, stroke, arc, fillText`;
 * `fills`, `strokes` and `alphas` list every value assigned to `fillStyle`, `strokeStyle`
 * and `globalAlpha`; `images` lists every `drawImage(image, ...args)` as `{ image, args }`; `transforms` lists every `setTransform(...)`'s arguments and `fonts` every `font` assigned; `createImageData` gives a real pixel array.
 */
export function fakeCanvas(width = 800, height = 600) {
  const calls = { lineTo: 0, fill: 0, fillRect: 0, stroke: 0, arc: 0, fillText: 0 };
  const fills = [];
  const strokes = [];
  const alphas = [];
  const images = [];
  const transforms = [];
  const fonts = [];
  const ctx = new Proxy(
    {},
    {
      get: (_, name) => {
        if (name === "measureText") return () => ({ width: 20 });
        if (name === "setTransform") return (...args) => transforms.push(args);
        if (name === "drawImage") return (image, ...args) => images.push({ image, args });
        if (name === "createImageData") return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        if (name === "createLinearGradient" || name === "createRadialGradient") return () => ({ addColorStop() {} });
        if (name in calls) return () => (calls[name] += 1);
        return () => {};
      },
      set: (_, name, value) => {
        if (name === "fillStyle") fills.push(value);
        if (name === "strokeStyle") strokes.push(value);
        if (name === "globalAlpha") alphas.push(value);
        if (name === "font") fonts.push(value);
        return true;
      },
    },
  );
  return { canvas: { clientWidth: width, clientHeight: height, width: 0, height: 0, style: {}, getContext: () => ctx }, calls, fills, strokes, alphas, images, transforms, fonts };
}
