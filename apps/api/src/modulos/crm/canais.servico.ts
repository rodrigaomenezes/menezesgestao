// Telefones, e-mails e endereços extras do contato (Konecta RF-CRM-002). O telefone e o e-mail principais ficam no
// próprio contato; aqui ficam os outros. Telefone extra segue a mesma regra do principal: E.164 e de um contato só
// na empresa (telefones.ts). Nada some: tirar um extra arquiva a linha; toda mudança fica no histórico.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  MAX_CANAIS_POR_CONTATO,
  MAX_ENDERECOS_POR_CONTATO,
  type CanalContatoDto,
  type EnderecoContatoDto,
  type Escopo,
} from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { contato, contatoCanal, contatoEndereco } from "../../infra/esquema.js";
import { invalido, naoEncontrado } from "../../infra/erros.js";
import { iso } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import * as repo from "./canais.repositorio.js";
import { buscarVisivel } from "./contatos.repositorio.js";
import { erroTelefoneRepetido, telefoneOuErro } from "./contatos.servico.js";
import { donoDoTelefone, travarTelefone } from "./telefones.js";

type Rotulo = CanalContatoDto["rotulo"];
export interface DadosCanal {
  tipo: "telefone" | "email";
  valor: string;
  rotulo: Rotulo;
}
export interface DadosEndereco {
  rotulo: EnderecoContatoDto["rotulo"];
  cep: string | null;
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  principal: boolean;
}

const Email = z.email().max(200);
const campo = (nome: string, mensagem: string) => invalido(mensagem, { campos: [{ campo: nome, mensagem }] });

const canalDto = (c: Awaited<ReturnType<typeof repo.canaisDe>>[number]): CanalContatoDto => ({ ...c, criadoEm: iso(c.criadoEm) });
const enderecoDto = (e: repo.LinhaEndereco): EnderecoContatoDto => ({ ...e, criadoEm: iso(e.criadoEm), atualizadoEm: iso(e.atualizadoEm) });

export function criarServicoCanais(s: Servicos) {
  const { banco } = s;

  /** O contato, se a pessoa o vê; alterar exige que não esteja anonimizado. */
  async function contatoVisivel(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, id: string, paraAlterar: boolean) {
    const c = await buscarVisivel(tx, ctx.empresaId, ctx, escopo, id);
    if (!c) throw naoEncontrado("Contato");
    if (paraAlterar && c.anonimizadoEm) throw invalido("{Este contato} foi anonimizad{o|a:contato} (LGPD) e não recebe novos dados.");
    return c;
  }

  const historico = (tx: Tx, origem: Origem, c: { id: string; responsavelId: string | null }, acao: string, dados: Record<string, unknown>, antes?: unknown) =>
    registrar(tx, origem, { acao, entidade: "contato", entidadeId: c.id, contatoId: c.id, responsavelId: c.responsavelId, antes, depois: dados, dados });

  // Telefones e e-mails ------------------------------------------------------------------------------------------

  async function listarCanais(ctx: ContextoEmpresa, escopo: Escopo, contatoId: string): Promise<CanalContatoDto[]> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await contatoVisivel(tx, ctx, escopo, contatoId, false);
      return (await repo.canaisDe(tx, ctx.empresaId, contatoId)).map(canalDto);
    });
  }

  async function adicionarCanal(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, contatoId: string, d: DadosCanal): Promise<CanalContatoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await contatoVisivel(tx, ctx, escopo, contatoId, true);
      if ((await repo.quantosCanais(tx, ctx.empresaId, contatoId)) >= MAX_CANAIS_POR_CONTATO) {
        throw invalido(`{Este contato} já tem ${MAX_CANAIS_POR_CONTATO} telefones e e-mails extras. Tire um que não se usa mais antes de incluir outro.`);
      }
      let valor: string;
      if (d.tipo === "telefone") {
        try {
          valor = telefoneOuErro(d.valor)!;
        } catch {
          throw campo("valor", "Telefone inválido. Use DDD + número, por exemplo (11) 98765-4321.");
        }
        // Sob a trava do número: ele não pode ser de outro contato (principal ou extra) nem repetir neste.
        await travarTelefone(tx, ctx.empresaId, valor);
        const dono = await donoDoTelefone(tx, ctx.empresaId, valor);
        if (dono?.contatoId === contatoId) throw campo("valor", "Este número já está n{este contato}.");
        if (dono) throw await erroTelefoneRepetido(tx, ctx, escopo, valor);
      } else {
        const email = Email.safeParse(d.valor.trim().toLowerCase());
        if (!email.success) throw campo("valor", "E-mail inválido. Confira, por exemplo nome@empresa.com.br.");
        valor = email.data;
        const repetido = c.email?.toLowerCase() === valor || (await repo.canaisDe(tx, ctx.empresaId, contatoId)).some((x) => x.tipo === "email" && x.valor === valor);
        if (repetido) throw campo("valor", "Este e-mail já está n{este contato}.");
      }
      const [{ id }] = await tx.db
        .insert(contatoCanal)
        .values({ empresaId: ctx.empresaId, contatoId, tipo: d.tipo, valor, rotulo: d.rotulo, criadoPor: ctx.usuarioId })
        .returning({ id: contatoCanal.id });
      await historico(tx, origem, c, "contato.canal_adicionado", { tipo: d.tipo, valor, rotulo: d.rotulo });
      return canalDto((await repo.canal(tx, ctx.empresaId, contatoId, id))!);
    });
  }

  async function alterarCanal(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, contatoId: string, canalId: string, rotulo: Rotulo): Promise<CanalContatoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await contatoVisivel(tx, ctx, escopo, contatoId, true);
      const antes = await repo.canal(tx, ctx.empresaId, contatoId, canalId);
      if (!antes) throw naoEncontrado("Telefone ou e-mail");
      if (antes.rotulo === rotulo) return canalDto(antes);
      await tx.db.update(contatoCanal).set({ rotulo }).where(and(eq(contatoCanal.id, canalId), eq(contatoCanal.empresaId, ctx.empresaId)));
      await historico(tx, origem, c, "contato.canal_alterado", { tipo: antes.tipo, valor: antes.valor, rotulo }, { rotulo: antes.rotulo });
      return canalDto({ ...antes, rotulo });
    });
  }

  async function arquivarCanal(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, contatoId: string, canalId: string): Promise<void> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await contatoVisivel(tx, ctx, escopo, contatoId, true);
      const antes = await repo.canal(tx, ctx.empresaId, contatoId, canalId);
      if (!antes) throw naoEncontrado("Telefone ou e-mail");
      await tx.db.update(contatoCanal).set({ arquivadoEm: new Date() }).where(and(eq(contatoCanal.id, canalId), eq(contatoCanal.empresaId, ctx.empresaId)));
      await historico(tx, origem, c, "contato.canal_removido", { tipo: antes.tipo, valor: antes.valor, rotulo: antes.rotulo });
    });
  }

  /** Troca: o extra vira o principal e o principal de antes vira extra (ou o extra sai, se não havia principal). */
  async function tornarPrincipal(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, contatoId: string, canalId: string): Promise<void> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await contatoVisivel(tx, ctx, escopo, contatoId, true);
      const extra = await repo.canal(tx, ctx.empresaId, contatoId, canalId);
      if (!extra) throw naoEncontrado("Telefone ou e-mail");
      const coluna = extra.tipo === "telefone" ? "telefone" : "email";
      const anterior = c[coluna];
      if (extra.tipo === "telefone") {
        // Mesma ordem de travas para os dois números em qualquer troca: duas trocas cruzadas não se travam.
        for (const t of [extra.valor, anterior].filter((x): x is string => Boolean(x)).sort()) await travarTelefone(tx, ctx.empresaId, t);
      }
      await tx.db
        .update(contato)
        .set({ [coluna]: extra.valor, atualizadoEm: new Date() })
        .where(and(eq(contato.id, contatoId), eq(contato.empresaId, ctx.empresaId)));
      await tx.db
        .update(contatoCanal)
        .set(anterior ? { valor: anterior } : { arquivadoEm: new Date() })
        .where(and(eq(contatoCanal.id, canalId), eq(contatoCanal.empresaId, ctx.empresaId)));
      await historico(tx, origem, c, "contato.canal_principal", { tipo: extra.tipo, principal: extra.valor, anterior }, { [coluna]: anterior });
    });
  }

  // Endereços ----------------------------------------------------------------------------------------------------

  async function listarEnderecos(ctx: ContextoEmpresa, escopo: Escopo, contatoId: string): Promise<EnderecoContatoDto[]> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await contatoVisivel(tx, ctx, escopo, contatoId, false);
      return (await repo.enderecosDe(tx, ctx.empresaId, contatoId)).map(enderecoDto);
    });
  }

  async function adicionarEndereco(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, contatoId: string, d: DadosEndereco): Promise<EnderecoContatoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await contatoVisivel(tx, ctx, escopo, contatoId, true);
      const atuais = await repo.enderecosDe(tx, ctx.empresaId, contatoId);
      if (atuais.length >= MAX_ENDERECOS_POR_CONTATO) {
        throw invalido(`{Este contato} já tem ${MAX_ENDERECOS_POR_CONTATO} endereços. Tire um que não se usa mais antes de incluir outro.`);
      }
      // O primeiro endereço é o principal; marcar outro como principal desmarca o anterior.
      const principal = d.principal || atuais.length === 0;
      if (principal) await repo.desmarcarPrincipal(tx, ctx.empresaId, contatoId);
      const [{ id }] = await tx.db
        .insert(contatoEndereco)
        .values({ ...d, principal, empresaId: ctx.empresaId, contatoId, criadoPor: ctx.usuarioId })
        .returning({ id: contatoEndereco.id });
      const novo = (await repo.endereco(tx, ctx.empresaId, contatoId, id))!;
      await historico(tx, origem, c, "contato.endereco_adicionado", resumoEndereco(novo));
      return enderecoDto(novo);
    });
  }

  async function alterarEndereco(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, contatoId: string, enderecoId: string, d: DadosEndereco): Promise<EnderecoContatoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await contatoVisivel(tx, ctx, escopo, contatoId, true);
      const antes = await repo.endereco(tx, ctx.empresaId, contatoId, enderecoId);
      if (!antes) throw naoEncontrado("Endereço");
      // Desmarcar o principal não deixa o contato sem principal: só marcar outro tira a marca deste.
      const principal = d.principal || antes.principal;
      if (principal && !antes.principal) await repo.desmarcarPrincipal(tx, ctx.empresaId, contatoId);
      await tx.db
        .update(contatoEndereco)
        .set({ ...d, principal, atualizadoEm: new Date() })
        .where(and(eq(contatoEndereco.id, enderecoId), eq(contatoEndereco.empresaId, ctx.empresaId)));
      const depois = (await repo.endereco(tx, ctx.empresaId, contatoId, enderecoId))!;
      await historico(tx, origem, c, "contato.endereco_alterado", resumoEndereco(depois), resumoEndereco(antes));
      return enderecoDto(depois);
    });
  }

  async function arquivarEndereco(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, contatoId: string, enderecoId: string): Promise<void> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await contatoVisivel(tx, ctx, escopo, contatoId, true);
      const antes = await repo.endereco(tx, ctx.empresaId, contatoId, enderecoId);
      if (!antes) throw naoEncontrado("Endereço");
      await tx.db
        .update(contatoEndereco)
        .set({ arquivadoEm: new Date(), principal: false, atualizadoEm: new Date() })
        .where(and(eq(contatoEndereco.id, enderecoId), eq(contatoEndereco.empresaId, ctx.empresaId)));
      // Saiu o principal: o mais antigo que sobrou assume (o contato com endereço sempre tem um principal).
      if (antes.principal) {
        const [proximo] = await repo.enderecosDe(tx, ctx.empresaId, contatoId);
        if (proximo) await tx.db.update(contatoEndereco).set({ principal: true, atualizadoEm: new Date() }).where(eq(contatoEndereco.id, proximo.id));
      }
      await historico(tx, origem, c, "contato.endereco_removido", resumoEndereco(antes));
    });
  }

  return { listarCanais, adicionarCanal, alterarCanal, arquivarCanal, tornarPrincipal, listarEnderecos, adicionarEndereco, alterarEndereco, arquivarEndereco };
}

/** O que vai para o histórico de um endereço: o suficiente para reconhecê-lo. */
function resumoEndereco(e: repo.LinhaEndereco) {
  return { rotulo: e.rotulo, endereco: [e.logradouro, e.numero, e.bairro].filter(Boolean).join(", "), cidade: `${e.cidade}/${e.uf}`, principal: e.principal };
}
