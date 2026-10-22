// npm run duas-etapas:desligar -- --email pessoa@empresa.com.br
// Suporte: quem perdeu o celular e os códigos de recuperação. Só no terminal do servidor; fica na auditoria.
import { parseArgs } from "node:util";
import { carregarArquivoEnv, carregarConfig } from "../config.js";
import { comoSistema, criarBanco } from "../infra/banco.js";
import { auditar } from "../modulos/auditoria/registro.js";
import { desligarDuasEtapasDe } from "../modulos/auth/duas-etapas.servico.js";

async function principal() {
  const { values } = parseArgs({ options: { email: { type: "string" } } });
  if (!values.email) throw new Error("Informe --email da pessoa.");
  carregarArquivoEnv();
  const config = carregarConfig();
  const banco = criarBanco(config.databaseUrl);
  try {
    const id = await comoSistema(banco, async (tx) => {
      const { rows } = await tx.cliente.query<{ id: string }>("SELECT id FROM usuario WHERE lower(email) = lower($1)", [values.email]);
      if (!rows[0]) return null;
      await desligarDuasEtapasDe(tx, rows[0].id);
      await auditar(tx, { empresaId: null, atorId: null, ip: null, dispositivo: "terminal" }, { acao: "duas_etapas.desligada_suporte", entidade: "usuario", entidadeId: rows[0].id });
      return rows[0].id;
    });
    console.info(id ? "Duas etapas desligadas e sessões encerradas. Peça para a pessoa entrar e configurar de novo." : "Nenhuma pessoa com esse e-mail.");
  } finally {
    await banco.pool.end();
  }
}

principal().catch((err) => {
  console.error("Não foi possível desligar:", (err as Error).message);
  process.exit(1);
});
