import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Local dev outside compose: the api listens on 3000.
    proxy: { "/api": "http://localhost:3000" },
  },
});
