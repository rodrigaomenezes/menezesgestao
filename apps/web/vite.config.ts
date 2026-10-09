import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // O pacote @mg/shared é lido do código-fonte (condição "development") e entra no bundle.
  resolve: { conditions: ["development"] },
  server: {
    // No desenvolvimento, o front (porta 5173) conversa com o servidor (porta 3000).
    proxy: { "/api": "http://localhost:3000", "/manifest.webmanifest": "http://localhost:3000" },
  },
  plugins: [
    react(),
    VitePWA({
      // O manifesto vem do servidor (nome do produto por configuração).
      manifest: false,
      injectRegister: null,
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/manifest\.webmanifest$/],
        // Avisos no celular (push e clique no aviso).
        importScripts: ["sw-push.js"],
        // Leitura offline dos dados recentes: a rede vem primeiro; sem conexão, mostra a última resposta.
        // O cache é apagado no login e no logout (app/offline.ts). Arquivos, mídias, gravações, exportações
        // de dados pessoais e o tempo real nunca entram.
        runtimeCaching: [
          {
            urlPattern: ({ url, request, sameOrigin }) =>
              sameOrigin &&
              request.method === "GET" &&
              url.pathname.startsWith("/api/") &&
              !/(tempo-real|health|openapi|midia|gravac|dados-pessoais|exportar|arquivo|planilha|logo|icone|publico|push|duas-etapas)/.test(url.pathname),
            handler: "NetworkFirst",
            options: {
              cacheName: "mg-dados",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 300, maxAgeSeconds: 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
});
