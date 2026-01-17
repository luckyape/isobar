import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

const plugins = [react(), tailwindcss(), vitePluginManusRuntime()];
const meteostatProxyKey =
  process.env.METEOSTAT_API_KEY || process.env.RAPIDAPI_KEY;

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      "@cdn": path.resolve(import.meta.dirname, "cdn"),
      "react": path.resolve(import.meta.dirname, "node_modules/react"),
      "react-dom": path.resolve(import.meta.dirname, "node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port: 3002,
    strictPort: true,
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
      allow: [
        // Allow serving files from the project root (one level up from client)
        path.resolve(import.meta.dirname),
        // Allow serving from the sibling directory which seems to be linked by pnpm
        path.resolve(import.meta.dirname, "../../weather-consensus"),
      ],
    },
    proxy: meteostatProxyKey
      ? {
        "/api/observations": {
          target: "https://meteostat.p.rapidapi.com",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/observations/, "/point/hourly"),
          headers: {
            "x-rapidapi-key": meteostatProxyKey,
            "x-rapidapi-host": "meteostat.p.rapidapi.com",
          },
        },
      }
      : undefined,
  },
});
