// npm run empresa:criar -- --nome "Nome da empresa" --email dono@empresa.com.br --dono "Nome do dono" [--plano completo]
// Em produção (Railway): node apps/api/dist/cli/criar-empresa.js --nome ... 
// Cria a empresa com os perfis-base e envia o convite para o dono criar a senha.
import { parseArgs } from "node:util";
import { PLANOS, type Plano } from "@mg/shared";
import { criarProvedorAvisos } from "../modulos/avisos/avisos.js";
import { carregarArquivoEnv, carregarConfig } from "../config.js";
import { comoSistema, criarBanco } from "../infra/banco.js";
import { migrar } from "../infra/migrar.js";
import { iniciarJobs } from "../infra/jobs.js";
import { convidar } from "../modulos/usuarios/convites.js";
import { criarEmpresa } from "../modulos/empresas/criar-empresa.js";

async function esperarLinkNaCaixa(banco: ReturnType<typeof criarBanco>, para: string): Promise<string | null> {
  for (let i = 0; i < 40; i++) {
    const { rows } = await banco.pool.query<{ texto: string }>(
      "SELECT texto FROM aviso_saida WHERE lower(para) = lower($1) ORDER BY criado_em DESC LIMIT 1",
      [para],
    );
    const link = rows[0]?.texto.match(/https?:\/\/\S+token=[\w-]+/)?.[0];
    if (link) return link;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function principal() {
  const { values } = parseArgs({
    options: {
      nome: { type: "string" },
      email: { type: "string" },
      dono: { type: "string" },
      plano: { type: "string", default: "essencial" },
    },
  });
  const planos = [...Object.keys(PLANOS), "sob_medida"];
  if (!values.nome || !values.email || !values.dono || !planos.includes(values.plano ?? "")) {
    console.error(`Uso: npm run empresa:criar -- --nome "Empresa" --email dono@empresa.com.br --dono "Nome" --plano ${planos.join("|")}`);
    process.exit(1);
  }

  carregarArquivoEnv();
  const config = carregarConfig();
  const banco = criarBanco(config.databaseUrl);
  await migrar(banco.pool);
  const avisos = criarProvedorAvisos(config, banco);
  const jobs = await iniciarJobs(config, avisos);
  try {
    const origem = { atorId: null, ip: null, dispositivo: "linha de comando" };
    const empresaId = await comoSistema(banco, async (tx) => {
      const criada = await criarEmpresa(tx, origem, { nome: values.nome!, plano: values.plano as Plano });
      await convidar(
        { banco, config, jobs },
        tx,
        { ...origem, empresaId: criada.empresaId },
        { email: values.email!, nome: values.dono!, perfilId: criada.perfis.dono, unidadeId: criada.unidadeId },
        true,
      );
      return criada.empresaId;
    });
    console.info(`Empresa criada (${empresaId}). O convite foi enviado para ${values.email}.`);
    // Sem SMTP, o e-mail fica na caixa de demonstração: mostra o link aqui mesmo, sem segundo comando.
    if (avisos.id === "demonstracao") {
      const link = await esperarLinkNaCaixa(banco, values.email!);
      console.info(link ? `\nLink para criar a senha (vale 7 dias):\n${link}` : "\nO link ainda não chegou: rode npm run caixa-de-saida em instantes.");
    }
  } finally {
    await jobs.parar();
    await banco.pool.end();
  }
}

principal().catch((err) => {
  console.error("Não foi possível criar a empresa:", err);
  process.exit(1);
});
