// npm run dados:exemplo — cria duas empresas fictícias de segmentos diferentes, com uma pessoa por perfil.
// A senha de todas vem de SENHA_EXEMPLO (nada de senha padrão no código).
import { readFile } from "node:fs/promises";
import { carregarArquivoEnv, carregarConfig } from "../config.js";
import { criarBanco } from "../db/banco.js";
import { migrar } from "../db/migrar.js";
import { semearEmpresa, type DescricaoEmpresa } from "../nucleo/semear.js";
import { gerarHashSenha, SENHA_MINIMO } from "../seguranca/senha.js";

async function principal() {
  carregarArquivoEnv();
  const config = carregarConfig();
  const senha = process.env.SENHA_EXEMPLO ?? "";
  if (senha.length < SENHA_MINIMO) {
    console.error(`Defina SENHA_EXEMPLO (pelo menos ${SENHA_MINIMO} caracteres) no .env: será a senha de todas as pessoas de exemplo.`);
    process.exit(1);
  }
  const arquivo = new URL("../../dados/exemplo.json", import.meta.url);
  const { empresas } = JSON.parse(await readFile(arquivo, "utf8")) as { empresas: DescricaoEmpresa[] };

  const banco = criarBanco(config.databaseUrl);
  try {
    await migrar(banco.pool);
    const hash = await gerarHashSenha(senha);
    for (const d of empresas) {
      const { rows } = await banco.pool.query("SELECT 1 FROM empresa WHERE nome = $1", [d.nome]);
      if (rows.length) {
        console.info(`- ${d.nome}: já existe, mantida como está.`);
        continue;
      }
      await semearEmpresa(banco, d, hash);
      console.info(`- ${d.nome}: criada. Pessoas: ${d.pessoas.map((p) => `${p.email} (${p.perfil})`).join(", ")}`);
    }
  } finally {
    await banco.pool.end();
  }
}

principal().catch((err) => {
  console.error("Não foi possível criar os dados de exemplo:", err);
  process.exit(1);
});
