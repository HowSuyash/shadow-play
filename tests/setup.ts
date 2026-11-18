/**
 * Minimal canvas stand-in so modules that paint textures (text, glows,
 * pictograms) can be constructed in Node. Drawing calls are no-ops.
 */
const noop = () => {};
function fakeContext(canvas: { width: number; height: number }) {
  return new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'canvas') return canvas;
        if (key === 'measureText') return (s: string) => ({ width: s.length * 10 });
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop: noop });
        if (key === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        return noop;
      },
      set: () => true,
    },
  );
}

const g = globalThis as unknown as { document?: unknown };
if (!g.document) {
  g.document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') return {};
      const canvas = { width: 300, height: 150, getContext: () => fakeContext(canvas), style: {} };
      return canvas;
    },
    getElementById: () => null,
  };
}
