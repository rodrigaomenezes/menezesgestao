// Interface de armazenamento de arquivos (Prompt Mestre §53). O domínio nunca fala com disco ou S3 direto.
// Provedor inicial "banco": guarda o conteúdo no PostgreSQL (tabela arquivo, isolada por empresa).
// Funciona no Railway sem volume nem conta externa; S3 entra quando houver mídia pesada (fase 2/3).
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { comEmpresa, type Banco } from "../../infra/banco.js";
import { arquivo } from "../../infra/esquema.js";
import { naoEncontrado } from "../../infra/erros.js";

export interface NovoArquivo {
  nome: string;
  tipoMime: string;
  conteudo: Buffer;
  criadoPor: string | null;
}

export interface ProvedorArquivos {
  readonly id: "banco";
  gravar(empresaId: string, a: NovoArquivo): Promise<{ id: string }>;
  ler(empresaId: string, id: string): Promise<{ nome: string; tipoMime: string; conteudo: Buffer }>;
}

export function provedorArquivosBanco(banco: Banco): ProvedorArquivos {
  return {
    id: "banco",
    async gravar(empresaId, a) {
      const id = randomUUID();
      await comEmpresa(banco, empresaId, (tx) =>
        tx.db.insert(arquivo).values({
          id,
          empresaId,
          nome: a.nome,
          tipoMime: a.tipoMime,
          tamanho: a.conteudo.length,
          provedor: "banco",
          conteudo: a.conteudo,
          criadoPor: a.criadoPor,
        }),
      );
      return { id };
    },
    async ler(empresaId, id) {
      const [linha] = await comEmpresa(banco, empresaId, (tx) =>
        tx.db
          .select({ nome: arquivo.nome, tipoMime: arquivo.tipoMime, conteudo: arquivo.conteudo })
          .from(arquivo)
          .where(and(eq(arquivo.id, id), eq(arquivo.empresaId, empresaId))),
      );
      if (!linha?.conteudo) throw naoEncontrado("Arquivo");
      return { nome: linha.nome, tipoMime: linha.tipoMime, conteudo: linha.conteudo };
    },
  };
}
