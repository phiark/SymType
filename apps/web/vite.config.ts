import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // npm may install plugin-react against the root Vite used by Vitest while this
  // workspace retains its Safari-compatible Vite major. The runtime plugin API
  // is compatible; bridge only the duplicate package identities here.
  plugins: [react() as unknown as PluginOption],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4173"
    }
  },
  build: {
    target: ["es2022", "safari16.4"],
    sourcemap: true,
    chunkSizeWarningLimit: 800
  }
});
