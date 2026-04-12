import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    commonjsOptions: {
      include: [
        /node_modules/,
        /src\/application\//,
        /src\/domain\//,
        /src\/infrastructure\//,
        /src\/config\//,
      ],
    },
  },
});
