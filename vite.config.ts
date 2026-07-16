import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export function publicDirectoryForMode(mode: string): string | false {
  return mode === "desktop" ? false : "public";
}

export default defineConfig(({ mode }) => ({
  publicDir: publicDirectoryForMode(mode),
  plugins: [react()],
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src/desktop-shell/src-tauri/target/**"],
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
  },
}));
