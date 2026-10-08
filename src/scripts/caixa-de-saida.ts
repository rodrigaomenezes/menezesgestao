// npm run caixa-de-saida — mostra os últimos e-mails do provedor de demonstração (quando não há SMTP).
// Fica fora da API de propósito: a caixa reúne e-mails de todas as empresas.
import { carregarArquivoEnv, carregarConfig } from "../config.js";
import { criarBanco } from "../db/banco.js";

async function principal() {
  carregarArquivoEnv();
  const config = carregarConfig();
  const banco = criarBanco(config.databaseUrl);
  try {
    const { rows } = await banco.pool.query<{ para: string; assunto: string; texto: string; criado_em: Date }>(
      "SELECT para, assunto, texto, criado_em FROM aviso_saida ORDER BY criado_em DESC LIMIT 10",
    );
    if (!rows.length) console.info("Nenhum e-mail na caixa de saída de demonstração.");
    for (const r of rows.reverse()) {
      console.info(`\n— ${r.criado_em.toLocaleString("pt-BR")} · para ${r.para}\n  ${r.assunto}\n\n${r.texto}`);
    }
  } finally {
    await banco.pool.end();
  }
}

principal().catch((err) => {
  console.error("Não foi possível ler a caixa de saída:", err);
  process.exit(1);
});
