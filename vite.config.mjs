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
  // ── dev/preview 서버: 0.0.0.0 바인딩 + 고정 포트 ──
  // host:true → localhost 외 네트워크/VSCode 터널 포워딩으로도 접속 가능
  // strictPort → 포트 점유 시 다른 포트로 튀지 않고 실패(포워딩 포트 고정)
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
  },
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
