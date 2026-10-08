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
        // Dados da API não vão para o cache nesta fase (leitura offline entra na fase 7).
        runtimeCaching: [],
      },
    }),
  ],
});
