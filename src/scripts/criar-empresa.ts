// npm run empresa:criar -- --nome "Nome da empresa" --email dono@empresa.com.br --dono "Nome do dono" [--plano completo]
// Cria a empresa com os perfis-base e envia o convite para o dono criar a senha.
import { parseArgs } from "node:util";
import { PLANOS, type Plano } from "../compartilhado/catalogo.js";
import { criarProvedorAvisos } from "../avisos/avisos.js";
import { carregarArquivoEnv, carregarConfig } from "../config.js";
import { comoSistema, criarBanco } from "../db/banco.js";
import { migrar } from "../db/migrar.js";
import { iniciarJobs } from "../jobs/jobs.js";
import { convidar } from "../nucleo/convites.js";
import { criarEmpresa } from "../nucleo/empresas.js";

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
  const jobs = await iniciarJobs(config, criarProvedorAvisos(config, banco));
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
  } finally {
    await jobs.parar();
    await banco.pool.end();
  }
}

principal().catch((err) => {
  console.error("Não foi possível criar a empresa:", err);
  process.exit(1);
});
