import { criarApp } from "./app.js";

// Falha cedo: em produção o servidor não sobe sem os segredos obrigatórios.
const OBRIGATORIAS = ["SESSION_SECRET", "CRM_CHAVE", "DATABASE_URL"];
if (process.env.NODE_ENV === "production") {
  const faltando = OBRIGATORIAS.filter((v) => !process.env[v]);
  if (faltando.length) {
    console.error(`[CONFIG] Defina no ambiente: ${faltando.join(", ")}`);
    process.exit(1);
  }
}

const app = criarApp();
const port = Number(process.env.PORT) || 3000;
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
