import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { DEFAULT_PORT } from "../shared/src/routes.ts";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Import shared TS source directly so Vite transpiles it.
      "@rockett/shared": path.resolve(
        import.meta.dirname,
        "../shared/src/index.ts",
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${DEFAULT_PORT}`,
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
