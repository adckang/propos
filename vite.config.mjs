import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { handleNodeHaRequest } from "./server/haApiHandlers.js";

function haProxyPlugin() {
  const attachMiddleware = server => {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith("/api/ha/")) {
        next();
        return;
      }
      handleNodeHaRequest(req, res);
    });
  };

  return {
    name: "ha-proxy-middleware",
    configureServer: attachMiddleware,
    configurePreviewServer: attachMiddleware,
  };
}

export default defineConfig({
  plugins: [react(), haProxyPlugin()],
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
