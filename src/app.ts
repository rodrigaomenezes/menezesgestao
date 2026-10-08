import Fastify from "fastify";

// Monta o app sem abrir porta, para os testes usarem app.inject().
export function criarApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  app.get("/api/health", async () => ({ ok: true, time: new Date().toISOString() }));
  return app;
}
