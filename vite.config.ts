import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export function publicDirectoryForMode(mode: string): string | false {
  return mode === "desktop" ? false : "public";
}

export function webBasePath(value = process.env.SCADMILL_WEB_BASE_PATH): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "/";
  if (/[?#]/u.test(trimmed) || trimmed.includes("://")) {
    throw new Error("SCADMILL_WEB_BASE_PATH must be an absolute URL path without query or hash.");
  }
  const path = `/${trimmed.replace(/^\/+|\/+$/gu, "")}/`;
  return path === "//" ? "/" : path;
}

export default defineConfig(({ mode }) => ({
  base: mode === "desktop" ? "/" : webBasePath(),
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
