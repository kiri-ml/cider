import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const wranglerPort = process.env.WRANGLER_PORT || "8788";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${wranglerPort}`,
        changeOrigin: true,
      },
    },
  },
});
