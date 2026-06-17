import path from "node:path";
import { builtinModules } from "node:module";
import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

const require = createRequire(import.meta.url);
const pkg = require("./package.json") as { dependencies?: Record<string, string> };

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

const dependencyNames = Object.keys(pkg.dependencies ?? {});

function isElectronMainExternal(id: string): boolean {
  if (id.startsWith(".") || path.isAbsolute(id)) return false;
  if (id === "electron" || id.startsWith("electron/")) return true;
  if (nodeBuiltins.has(id)) return true;
  for (const dep of dependencyNames) {
    if (id === dep || id.startsWith(`${dep}/`)) return true;
  }
  return false;
}

export default defineConfig({
  base: "./",
  server: {
    watch: {
      ignored: ["**/release/**", "**/node_modules/**"],
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: isElectronMainExternal,
            },
          },
        },
        onstart({ startup }) {
          startup();
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          build: {
            rollupOptions: {
              output: {
                format: "cjs",
                entryFileNames: "preload.cjs",
              },
            },
          },
        },
      },
    }),
  ],
});
