// Montagem do módulo Conversas: provedores, serviços, rotas e trabalhadores das filas.
import type { FastifyInstance } from "fastify";
import type { Servicos } from "../../app.js";
import type { ProvedorArquivos } from "../arquivos/armazenamento.js";
import { criarServicoCanais, type RegistroProvedores, type ServicoCanais } from "./canais.servico.js";
import { rotasCanais } from "./canais.rotas.js";
import { rotasConversas } from "./conversas.rotas.js";
import { criarServicoEntrada, type ServicoEntrada } from "./entrada.servico.js";
import { criarServicoEnvio, FILAS_CONVERSAS, type ServicoEnvio } from "./envio.servico.js";
import { juntarEmTodas } from "./juntar.js";
import { provedorCloudApi } from "./provedores/cloud-api.js";
import { provedorDemonstracaoMensagens } from "./provedores/demonstracao.js";
import { provedorQr } from "./provedores/qr.js";
import { rotasRespostas } from "./respostas.rotas.js";

export async function montarConversas(app: FastifyInstance, s: Servicos, arquivos: ProvedorArquivos): Promise<{ envio: ServicoEnvio }> {
  // Provedores e serviços se referenciam (o QR entrega mensagens à entrada e o estado aos canais): liga depois.
  let entrada: ServicoEntrada | null = null;
  let canais: ServicoCanais | null = null;
  const qr = provedorQr({
    banco: s.banco,
    chave: s.config.crmChave,
    aoReceber: async (c, eventos) => entrada?.processar(c, eventos),
    aoMudarEstado: async (c, estado) => canais?.gravarEstado(c, estado),
  });
  const provedores: RegistroProvedores = {
    demonstracao: provedorDemonstracaoMensagens(),
    cloud_api: provedorCloudApi({ graphUrl: s.config.whatsappGraphUrl }),
    qr,
  };
  canais = criarServicoCanais(s, provedores);
  const envio = criarServicoEnvio(s, provedores, arquivos);
  entrada = criarServicoEntrada(s, provedores, arquivos, envio);

  await app.register(rotasCanais(s, canais, entrada));
  await app.register(rotasConversas(s, arquivos, envio));
  await app.register(rotasRespostas(s));

  const e = entrada;
  await s.jobs.trabalhar<{ empresaId: string; mensagemId: string; voz?: boolean }>(FILAS_CONVERSAS.envio, (d) => envio.processarEnvio(d));
  await s.jobs.trabalhar<{ empresaId: string; mensagemId: string }>(FILAS_CONVERSAS.midia, (d) => e.baixarMidia(d));
  await s.jobs.trabalhar<{ empresaId: string; conversaId: string; mensagemId: string }>(FILAS_CONVERSAS.followUp, (d) => envio.processarFollowUp(d));
  await s.jobs.trabalhar(FILAS_CONVERSAS.juntar, async () => {
    await juntarEmTodas(s.banco);
  });
  await s.jobs.agendar(FILAS_CONVERSAS.juntar, "37 3 * * *");

  // Conexões por QR: religam ao subir e fecham ao desligar (a sessão continua no banco).
  const c = canais;
  if (s.config.whatsappQrAtivo && !s.config.teste) app.addHook("onReady", async () => void c.reconectarQr());
  app.addHook("onClose", async () => qr.encerrarTodos());
  return { envio };
}
