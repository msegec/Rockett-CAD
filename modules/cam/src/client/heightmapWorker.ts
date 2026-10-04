import { simulateHeightmap } from "./heightmap.js";

self.addEventListener("message", ({ data: { program, stock, cellMm } }) => {
  try {
    const map = simulateHeightmap(program, stock, cellMm);
    self.postMessage({ map }, { transfer: [map.heights.buffer] });
  } catch (error) {
    self.postMessage({ error }, { transfer: [] });
  }
});
