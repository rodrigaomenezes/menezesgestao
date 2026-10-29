// Duplicados e fusão (Konecta RF-CRM-004/008). A pessoa escolhe qual cadastro fica (destino) e, campo a campo, qual
// valor fica; o resto da origem é incorporado: telefone e e-mail que não ficaram viram extras, endereços, etiquetas e
// campos vazios do destino vêm junto, e oportunidades, tarefas, conversas, ligações, vendas e o resto passam para o
// destino. A origem fica arquivada e marcada (`fundido_em_id`), e cada fusão fica registrada. Nada some.
import { and, eq, isNull } from "drizzle-orm";
import { mascararDocumento, type CampoFusao, type Escopo, type FusaoDto, type Pagina, type ParDuplicadoDto } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { contato, contatoCanal, contatoFusao, contatoParIgnorado } from "../../infra/esquema.js";
import { ErroApp, invalido, naoEncontrado } from "../../infra/erros.js";
import { iso } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import * as repo from "./fusao.repositorio.js";
import { buscarVisivel, type LinhaContato } from "./contatos.repositorio.js";
import { travarTelefone } from "./telefones.js";

type Lado = "destino" | "origem";

/** Fundir e ver duplicados é de quem cuida de uma carteira maior que a própria (gestor, supervisor, dono). */
function exigirEscopoDeGestao(escopo: Escopo) {
  if (escopo === "proprio") throw new ErroApp(403, "SEM_PERMISSAO", "Fundir cadastros é para quem cuida da carteira da equipe ou da empresa. Peça ao seu gestor.");
}

const cursorDe = (p: { a: string; b: string }) => Buffer.from(`${p.a}:${p.b}`).toString("base64url");
function lerCursorPar(cursor: string | undefined) {
  if (!cursor) return null;
  const [a, b] = Buffer.from(cursor, "base64url").toString().split(":");
  return a && b ? { a, b } : null;
}

export function criarServicoFusao(s: Servicos) {
  const { banco } = s;

  async function pares(ctx: ContextoEmpresa, escopo: Escopo, cursor: string | undefined, limite: number): Promise<Pagina<ParDuplicadoDto>> {
    exigirEscopoDeGestao(escopo);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await repo.pares(tx, ctx.empresaId, ctx, escopo, lerCursorPar(cursor), limite);
      const pagina = linhas.slice(0, limite);
      // Um resumo por contato da página (uma consulta para todos), não uma por linha.
      const ids = [...new Set(pagina.flatMap((p) => [p.a, p.b]))];
      const { rows } = await tx.cliente.query<{ id: string; nome: string; telefone: string | null; email: string | null; responsavelNome: string | null; criadoEm: Date }>(
        `SELECT c.id, c.nome, c.telefone, c.email, u.nome AS "responsavelNome", c.criado_em AS "criadoEm"
           FROM contato c LEFT JOIN usuario u ON u.id = c.responsavel_id WHERE c.empresa_id = $1 AND c.id = ANY($2::uuid[])`,
        [ctx.empresaId, ids],
      );
      const resumo = new Map(rows.map((r) => [r.id, { ...r, criadoEm: iso(r.criadoEm) }]));
      return {
        itens: pagina.map((p) => ({ a: resumo.get(p.a)!, b: resumo.get(p.b)!, motivos: p.motivos })),
        proximoCursor: linhas.length > limite ? cursorDe(pagina[pagina.length - 1]!) : null,
      };
    });
  }

  async function ignorarPar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, um: string, outro: string): Promise<void> {
    exigirEscopoDeGestao(escopo);
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      for (const id of [um, outro]) if (!(await buscarVisivel(tx, ctx.empresaId, ctx, escopo, id))) throw naoEncontrado("Contato");
      const [contatoA, contatoB] = [um, outro].sort() as [string, string];
      await tx.db.insert(contatoParIgnorado).values({ empresaId: ctx.empresaId, contatoA, contatoB, usuarioId: ctx.usuarioId }).onConflictDoNothing();
      await registrar(tx, origem, { acao: "contato.duplicidade_descartada", entidade: "contato", entidadeId: contatoA, silencioso: true, depois: { contatoA, contatoB } });
    });
  }

  async function carregarParaFundir(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, id: string): Promise<LinhaContato> {
    const c = await buscarVisivel(tx, ctx.empresaId, ctx, escopo, id);
    if (!c) throw naoEncontrado("Contato");
    if (c.anonimizadoEm) throw invalido(`${c.nome}: cadastro anonimizado (LGPD) não entra em fusão.`);
    if (c.fundidoEmId) throw invalido(`${c.nome} já foi fundido em outro cadastro.`);
    if (c.arquivadoEm) throw invalido(`${c.nome} está na lixeira. Restaure antes de fundir.`);
    return c;
  }

  async function fundir(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origemAtor: Origem,
    destinoId: string,
    entrada: { origemId: string; manter: Partial<Record<CampoFusao, Lado>> },
  ): Promise<FusaoDto> {
    exigirEscopoDeGestao(escopo);
    const { origemId, manter } = entrada;
    if (origemId === destinoId) throw invalido("Escolha dois cadastros diferentes.");
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await repo.travarContatos(tx, ctx.empresaId, [origemId, destinoId]);
      const destino = await carregarParaFundir(tx, ctx, escopo, destinoId);
      const origem = await carregarParaFundir(tx, ctx, escopo, origemId);
      for (const t of [destino.telefone, origem.telefone].filter((x): x is string => Boolean(x)).sort()) await travarTelefone(tx, ctx.empresaId, t);

      // O lado escolhido; se ele estiver vazio, fica o do outro (nunca se perde um valor por escolher o lado vazio).
      const lado = (campo: CampoFusao): Lado => manter[campo] ?? "destino";
      const escolher = <T>(campo: CampoFusao, noDestino: T | null, naOrigem: T | null): T | null =>
        lado(campo) === "origem" ? (naOrigem ?? noDestino) : (noDestino ?? naOrigem);

      const telefone = escolher("telefone", destino.telefone, origem.telefone);
      const email = escolher("email", destino.email?.toLowerCase() ?? null, origem.email?.toLowerCase() ?? null);
      const docDestino = destino.documentoTipo ? "destino" : null;
      const docOrigem = origem.documentoTipo ? "origem" : null;
      const documentoDe = escolher("documento", docDestino, docOrigem);
      const documentoOrigem = await repo.colunasDocumento(tx, ctx.empresaId, origemId);
      let organizacaoId = escolher("organizacao", destino.organizacaoId, origem.organizacaoId);
      if (organizacaoId === destinoId || organizacaoId === origemId) organizacaoId = null;

      // 1) A origem larga o que é único na empresa (telefone, documento) e vai para o arquivo, marcada.
      await tx.db
        .update(contato)
        .set({
          telefone: null,
          ...(documentoDe === "origem" ? { documentoTipo: null, documentoFinal: null, documentoCifrado: null, documentoHash: null } : {}),
          arquivadoEm: new Date(),
          fundidoEmId: destinoId,
          atualizadoEm: new Date(),
        })
        .where(and(eq(contato.id, origemId), eq(contato.empresaId, ctx.empresaId)));

      // 2) O destino recebe o que foi escolhido; campos personalizados vazios dele vêm da origem.
      await tx.db
        .update(contato)
        .set({
          nome: escolher("nome", destino.nome, origem.nome)!,
          tipo: escolher("tipo", destino.tipo, origem.tipo)!,
          telefone,
          email,
          origem: escolher("origem", destino.origem, origem.origem),
          responsavelId: escolher("responsavel", destino.responsavelId, origem.responsavelId),
          organizacaoId,
          campos: { ...(origem.campos ?? {}), ...(destino.campos ?? {}) },
          // Pedido de não ser contatado em qualquer um dos dois vale para o cadastro que fica (LGPD).
          naoContatar: destino.naoContatar || origem.naoContatar,
          consentimentoEm: destino.consentimentoEm ?? origem.consentimentoEm,
          ...(documentoDe === "origem" ? documentoOrigem : {}),
          atualizadoEm: new Date(),
        })
        .where(and(eq(contato.id, destinoId), eq(contato.empresaId, ctx.empresaId)));

      // 3) Telefone e e-mail que não ficaram como principais viram extras do destino; os extras da origem vêm junto.
      const extras: { tipo: "telefone" | "email"; valor: string }[] = [];
      for (const t of [destino.telefone, origem.telefone]) if (t && t !== telefone) extras.push({ tipo: "telefone", valor: t });
      const canaisOrigem = await repo.moverCanais(tx, ctx.empresaId, origemId, destinoId, email ? [email] : []);
      const emailsDoDestino = new Set(
        (await tx.db.select({ valor: contatoCanal.valor }).from(contatoCanal).where(and(eq(contatoCanal.contatoId, destinoId), eq(contatoCanal.tipo, "email"), isNull(contatoCanal.arquivadoEm))))
          .map((c) => c.valor),
      );
      for (const e of [destino.email?.toLowerCase(), origem.email?.toLowerCase()]) {
        if (e && e !== email && !emailsDoDestino.has(e) && !extras.some((x) => x.valor === e)) extras.push({ tipo: "email", valor: e });
      }
      if (extras.length) {
        await tx.db.insert(contatoCanal).values(extras.map((x) => ({ empresaId: ctx.empresaId, contatoId: destinoId, ...x, criadoPor: ctx.usuarioId })));
      }

      // 4) Endereços, etiquetas e tudo o que aponta para a origem passam para o destino.
      const enderecos = await repo.moverEnderecos(tx, ctx.empresaId, origemId, destinoId);
      const etiquetas = await repo.somarEtiquetas(tx, ctx.empresaId, origemId, destinoId);
      const movidos = await repo.transferir(tx, ctx.empresaId, origemId, destinoId);

      const escolhas = Object.fromEntries((["nome", "tipo", "telefone", "email", "documento", "origem", "responsavel", "organizacao"] as const).map((c) => [c, lado(c)]));
      const incorporados = {
        novosExtras: extras.map((x) => x.valor),
        canaisDaOrigem: canaisOrigem.movidos,
        enderecos,
        etiquetas,
        camposPersonalizados: Object.keys(origem.campos ?? {}).filter((k) => !(k in (destino.campos ?? {}))),
        documento: documentoDe === "origem",
        // O documento do destino que deu lugar ao da origem fica registrado (só mascarado).
        documentoSubstituido:
          documentoDe === "origem" && destino.documentoTipo && destino.documentoFinal ? mascararDocumento(destino.documentoTipo, destino.documentoFinal) : null,
      };
      const origemResumo = {
        nome: origem.nome,
        telefone: origem.telefone,
        email: origem.email,
        documento: origem.documentoTipo && origem.documentoFinal ? mascararDocumento(origem.documentoTipo, origem.documentoFinal) : null,
        responsavelId: origem.responsavelId,
        criadoEm: iso(origem.criadoEm),
      };
      const [{ id }] = await tx.db
        .insert(contatoFusao)
        .values({ empresaId: ctx.empresaId, origemId, destinoId, usuarioId: ctx.usuarioId, origemResumo, escolhas, incorporados, movidos })
        .returning({ id: contatoFusao.id });
      await registrar(tx, origemAtor, {
        acao: "contato.fundido",
        entidade: "contato",
        entidadeId: destinoId,
        contatoId: destinoId,
        responsavelId: escolher("responsavel", destino.responsavelId, origem.responsavelId),
        antes: origemResumo,
        depois: { fusaoId: id, origemId, escolhas, incorporados, movidos },
        dados: { origemNome: origem.nome, origemId, movidos },
      });
      return { id, destinoId, origemId, movidos, incorporados };
    });
  }

  return { pares, ignorarPar, fundir };
}

/** Restaurar um cadastro fundido o separaria do destino sem devolver o que foi movido: recusa e aponta o destino. */
export function erroRestaurarFundido(): ErroApp {
  return invalido("Este cadastro foi fundido em outro. Abra o cadastro que ficou: o histórico dos dois está lá.");
}
