// Administração de Conversas: canais (demonstração, API oficial, QR), automações e respostas rápidas.
import { useCallback, useEffect, useState } from "react";
import {
  NOMES_AUTOMACAO,
  NOMES_PROVEDORES_CANAL,
  NOMES_STATUS_CANAL,
  PROVEDORES_CANAL,
  type AutomacaoDto,
  type CanalDto,
  type ConexaoDto,
  type RespostaRapidaDto,
} from "@mg/shared";
import { ErroApi, get, patch, post, put } from "../../app/api";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio } from "../../ui/ui";
import { useTermos } from "../crm/comum";

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function Copiar({ rotulo, valor }: { rotulo: string; valor: string }) {
  const avisar = useAviso();
  return (
    <div className="campo">
      <span className="rotulo">{rotulo}</span>
      <div className="copiar">
        <code>{valor}</code>
        <button type="button" className="botao botao-secundario" onClick={() => void navigator.clipboard?.writeText(valor).then(() => avisar("Copiado."))}>
          Copiar
        </button>
      </div>
    </div>
  );
}

function Credenciais({ c, aoSalvar }: { c: CanalDto; aoSalvar(): void }) {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [token, setToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const { enviando, erro, enviar } = useEnvio(async () => {
    await put(`/canais/${c.id}/credenciais`, { phoneNumberId, token, appSecret });
    setToken("");
    setAppSecret("");
    aoSalvar();
  });
  return (
    <form className="item-edicao" onSubmit={enviar}>
      <p className="dica">
        No painel da Meta (WhatsApp → Configuração da API), copie o <strong>Phone number ID</strong>, gere um <strong>token permanente</strong> (usuário do sistema) e pegue a{" "}
        <strong>chave secreta do app</strong>. Elas ficam cifradas e não aparecem de novo.
      </p>
      <div className="grade-campos">
        <Campo rotulo="Phone number ID" nome={`pnid-${c.id}`} valor={phoneNumberId} aoMudar={setPhoneNumberId} obrigatorio autoComplete="off" />
        <Campo rotulo="Token de acesso" nome={`token-${c.id}`} tipo="password" valor={token} aoMudar={setToken} obrigatorio autoComplete="off" />
        <Campo rotulo="Chave secreta do app" nome={`segredo-${c.id}`} tipo="password" valor={appSecret} aoMudar={setAppSecret} obrigatorio autoComplete="off" />
      </div>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <button type="submit" className="botao" disabled={enviando}>
        Salvar credenciais
      </button>
    </form>
  );
}

function Horario({ c, aoSalvar }: { c: CanalDto; aoSalvar(): void }) {
  const [dias, setDias] = useState(c.horario.dias);
  const [inicio, setInicio] = useState(c.horario.inicio);
  const [fim, setFim] = useState(c.horario.fim);
  const { enviando, erro, enviar } = useEnvio(async () => {
    await patch(`/canais/${c.id}`, { horario: { dias, inicio, fim } });
    aoSalvar();
  });
  return (
    <form className="item-edicao" onSubmit={enviar}>
      <fieldset className="campo grupo-marcar">
        <legend>Dias de atendimento</legend>
        {DIAS.map((d, i) => (
          <label key={d} className="marcar">
            <input type="checkbox" checked={dias.includes(i + 1)} onChange={(e) => setDias((x) => (e.target.checked ? [...x, i + 1].sort() : x.filter((y) => y !== i + 1)))} />
            {d}
          </label>
        ))}
      </fieldset>
      <div className="form-linha">
        <Campo rotulo="Início" nome={`inicio-${c.id}`} tipo="time" valor={inicio} aoMudar={setInicio} obrigatorio />
        <Campo rotulo="Fim" nome={`fim-${c.id}`} tipo="time" valor={fim} aoMudar={setFim} obrigatorio />
        <button type="submit" className="botao botao-secundario" disabled={enviando}>
          Salvar horário
        </button>
      </div>
      <Mensagem tipo="erro">{erro}</Mensagem>
    </form>
  );
}

function Simulador({ c }: { c: CanalDto }) {
  const termos = useTermos();
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [texto, setTexto] = useState("");
  const avisar = useAviso();
  const { enviando, erro, enviar } = useEnvio(async () => {
    await post(`/canais/${c.id}/simular`, { telefone, nome: nome || undefined, texto });
    setTexto("");
    avisar("Mensagem simulada recebida. Veja em Conversas.");
  });
  return (
    <form className="item-edicao" onSubmit={enviar}>
      <p className="dica">Modo demonstração: simule o celular de um {termos.contato} mandando mensagem para o canal.</p>
      <div className="grade-campos">
        <Campo rotulo="Telefone do cliente" nome={`sim-tel-${c.id}`} tipo="tel" valor={telefone} aoMudar={setTelefone} obrigatorio dica="Ex.: (11) 98888-7777" />
        <Campo rotulo="Nome (opcional)" nome={`sim-nome-${c.id}`} valor={nome} aoMudar={setNome} />
        <Campo rotulo="Mensagem" nome={`sim-texto-${c.id}`} valor={texto} aoMudar={setTexto} obrigatorio />
      </div>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <button type="submit" className="botao" disabled={enviando}>
        Simular mensagem do cliente
      </button>
    </form>
  );
}

function Canal({ c, aoMudar }: { c: CanalDto; aoMudar(): void }) {
  const avisar = useAviso();
  const confirmar = useConfirmar();
  const [aberto, setAberto] = useState<"credenciais" | "horario" | "simular" | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const aplicar = (r: ConexaoDto) => {
    setQr(r.qr);
    aoMudar();
  };
  // Enquanto aguarda a leitura, cada QR novo chega pelo tempo real.
  const atualizarQr = useCallback(() => {
    get<ConexaoDto>(`/canais/${c.id}/estado`).then((r) => setQr(r.qr), () => undefined);
  }, [c.id]);
  useTempoReal(["canal.estado"], (a) => {
    if (a.entidadeId !== c.id) return;
    aoMudar();
    if (c.provedor === "qr") atualizarQr();
  });
  useEffect(() => {
    if (c.provedor === "qr" && c.status === "aguardando_qr") atualizarQr();
    if (c.status === "conectado") setQr(null);
  }, [c.provedor, c.status, atualizarQr]);

  const acao = async (caminho: string, sucesso: string) => {
    setOcupado(true);
    try {
      const r = await post<ConexaoDto>(caminho);
      aplicar(r);
      if (r.canal.status === "erro") avisar(r.canal.statusDetalhe ?? "Não foi possível conectar.", "erro");
      else avisar(sucesso);
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível concluir.", "erro");
    } finally {
      setOcupado(false);
    }
  };
  const arquivar = async () => {
    if (!(await confirmar({ titulo: "Arquivar canal", mensagem: `Arquivar ${c.nome}? Ele é desconectado e as conversas ficam guardadas.`, acao: "Arquivar", perigosa: true }))) return;
    await patch(`/canais/${c.id}`, { arquivado: !c.arquivadoEm });
    aoMudar();
  };

  return (
    <li className="item canal">
      <div className="item-principal">
        <strong>{c.nome}</strong>
        <span className="item-detalhe">
          {NOMES_PROVEDORES_CANAL[c.provedor]}
          {c.numero && ` · ${c.numero}`}
        </span>
        <span className={`selo selo-canal-${c.status}`}>{NOMES_STATUS_CANAL[c.status]}</span>
        {c.statusDetalhe && <span className="item-detalhe">{c.statusDetalhe}</span>}
      </div>
      {!c.arquivadoEm && (
        <div className="item-acoes">
          {c.status === "conectado" ? (
            <button type="button" className="botao botao-secundario" disabled={ocupado} onClick={() => void acao(`/canais/${c.id}/desconectar`, "Canal desconectado.")}>
              Desconectar
            </button>
          ) : (
            <button type="button" className="botao" disabled={ocupado || (c.provedor === "cloud_api" && !c.temCredenciais)} onClick={() => void acao(`/canais/${c.id}/conectar`, "Pedido de conexão enviado.")}>
              {ocupado ? "Conectando…" : "Conectar"}
            </button>
          )}
          {c.provedor === "cloud_api" && (
            <button type="button" className="botao botao-secundario" onClick={() => setAberto((x) => (x === "credenciais" ? null : "credenciais"))}>
              Credenciais
            </button>
          )}
          {c.provedor === "demonstracao" && c.status === "conectado" && (
            <button type="button" className="botao botao-secundario" onClick={() => setAberto((x) => (x === "simular" ? null : "simular"))}>
              Simular cliente
            </button>
          )}
          <button type="button" className="botao botao-secundario" onClick={() => setAberto((x) => (x === "horario" ? null : "horario"))}>
            Horário
          </button>
          <button type="button" className="botao botao-secundario" onClick={() => void arquivar()}>
            Arquivar
          </button>
        </div>
      )}
      {c.arquivadoEm && (
        <button type="button" className="botao botao-secundario" onClick={() => void patch(`/canais/${c.id}`, { arquivado: false }).then(aoMudar)}>
          Restaurar
        </button>
      )}
      {qr && c.provedor === "qr" && (
        <div className="item-edicao qr">
          <img src={qr} alt="QR code para conectar o WhatsApp" width={280} height={280} />
          <p>No celular: WhatsApp → Aparelhos conectados → Conectar aparelho, e aponte para este código. Ele muda a cada poucos segundos.</p>
        </div>
      )}
      {c.provedor === "cloud_api" && c.webhookUrl && c.webhookToken && (
        <div className="item-edicao">
          <p className="dica">No painel da Meta (WhatsApp → Configuração → Webhook), cadastre o endereço e o token abaixo e assine o campo “messages”.</p>
          <Copiar rotulo="URL de retorno (webhook)" valor={c.webhookUrl} />
          <Copiar rotulo="Token de verificação" valor={c.webhookToken} />
        </div>
      )}
      {aberto === "credenciais" && <Credenciais c={c} aoSalvar={() => (setAberto(null), avisar("Credenciais salvas. Clique em Conectar para testar."), aoMudar())} />}
      {aberto === "horario" && <Horario c={c} aoSalvar={() => (setAberto(null), avisar("Horário salvo."), aoMudar())} />}
      {aberto === "simular" && <Simulador c={c} />}
    </li>
  );
}

function NovoCanal({ aoCriar }: { aoCriar(): void }) {
  const [nome, setNome] = useState("");
  const [provedor, setProvedor] = useState<string>("cloud_api");
  const { enviando, erro, enviar } = useEnvio(async () => {
    await post("/canais", { nome, provedor });
    setNome("");
    aoCriar();
  });
  return (
    <form className="cartao" onSubmit={enviar}>
      <h2>Novo canal</h2>
      <div className="grade-campos">
        <Campo rotulo="Nome do canal" nome="canal-nome" valor={nome} aoMudar={setNome} obrigatorio dica="Ex.: WhatsApp Comercial" />
        <Escolha rotulo="Tipo de conexão" nome="canal-provedor" valor={provedor} aoMudar={setProvedor} opcoes={PROVEDORES_CANAL.map((p) => ({ valor: p, texto: NOMES_PROVEDORES_CANAL[p] }))} />
      </div>
      {provedor === "qr" && (
        <p className="mensagem mensagem-info">
          A conexão por QR code usa o WhatsApp Web por uma biblioteca não oficial. É prática para começar, mas vai contra os termos do WhatsApp: o número pode ser bloqueado e a conexão
          pode parar quando o WhatsApp muda. Para operação séria, prefira a API oficial.
        </p>
      )}
      <Mensagem tipo="erro">{erro}</Mensagem>
      <button type="submit" className="botao" disabled={enviando}>
        Criar canal
      </button>
    </form>
  );
}

function Automacoes() {
  const [lista, setLista] = useState<AutomacaoDto[]>([]);
  const avisar = useAviso();
  useEffect(() => {
    get<AutomacaoDto[]>("/automacoes").then(setLista, () => undefined);
  }, []);
  return (
    <section className="cartao" aria-labelledby="titulo-automacoes">
      <h2 id="titulo-automacoes">Mensagens automáticas</h2>
      <p className="dica">Variáveis: {"{nome}"}, {"{vendedor}"}, {"{produto}"}, {"{empresa}"}.</p>
      <ul className="lista">
        {lista.map((a) => (
          <AutomacaoItem key={a.tipo} a={a} aoSalvar={(n) => (setLista((l) => l.map((x) => (x.tipo === n.tipo ? n : x))), avisar("Automação salva."))} />
        ))}
      </ul>
    </section>
  );
}

function AutomacaoItem({ a, aoSalvar }: { a: AutomacaoDto; aoSalvar(a: AutomacaoDto): void }) {
  const [texto, setTexto] = useState(a.texto);
  const [ativa, setAtiva] = useState(a.ativa);
  const [horas, setHoras] = useState(String(a.horas ?? 24));
  const { enviando, erro, enviar } = useEnvio(async () => {
    aoSalvar(await put<AutomacaoDto>(`/automacoes/${a.tipo}`, { texto, ativa, horas: a.tipo === "follow_up" ? Number(horas) : null }));
  });
  const info = NOMES_AUTOMACAO[a.tipo];
  return (
    <li className="item">
      <form className="item-principal" onSubmit={enviar}>
        <strong>{info.nome}</strong>
        <span className="item-detalhe">{info.dica}</span>
        <label className="sr-only" htmlFor={`auto-${a.tipo}`}>
          Texto da mensagem {info.nome}
        </label>
        <textarea id={`auto-${a.tipo}`} rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} required maxLength={2000} />
        <div className="form-linha">
          {a.tipo === "follow_up" && <Campo rotulo="Depois de quantas horas" nome="fu-horas" tipo="number" valor={horas} aoMudar={setHoras} minimo={1} />}
          <label className="marcar">
            <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
            Ativa
          </label>
          <button type="submit" className="botao botao-secundario" disabled={enviando}>
            Salvar
          </button>
        </div>
        <Mensagem tipo="erro">{erro}</Mensagem>
      </form>
    </li>
  );
}

function Respostas() {
  const [lista, setLista] = useState<RespostaRapidaDto[]>([]);
  const [atalho, setAtalho] = useState("");
  const [texto, setTexto] = useState("");
  const carregar = useCallback(() => {
    get<RespostaRapidaDto[]>("/respostas-rapidas").then(setLista, () => undefined);
  }, []);
  useEffect(carregar, [carregar]);
  const criar = useEnvio(async () => {
    await post("/respostas-rapidas", { atalho, texto });
    setAtalho("");
    setTexto("");
    carregar();
  });
  return (
    <section className="cartao" aria-labelledby="titulo-respostas">
      <h2 id="titulo-respostas">Respostas rápidas</h2>
      <p className="dica">Na conversa, digite / e o atalho. As variáveis {"{nome}"}, {"{vendedor}"}, {"{produto}"} e {"{empresa}"} são preenchidas sozinhas.</p>
      {!lista.length && <ListaVazia>Nenhuma resposta rápida ainda.</ListaVazia>}
      <ul className="lista">
        {lista.map((r) => (
          <li key={r.id} className="item">
            <div className="item-principal">
              <strong>/{r.atalho}</strong>
              <span className="texto-livre item-detalhe">{r.texto}</span>
              {r.arquivadoEm && <span className="item-detalhe">Arquivada</span>}
            </div>
            <button type="button" className="botao botao-secundario" onClick={() => void patch(`/respostas-rapidas/${r.id}`, { arquivado: !r.arquivadoEm }).then(carregar)}>
              {r.arquivadoEm ? "Restaurar" : "Arquivar"}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={criar.enviar}>
        <div className="grade-campos">
          <Campo rotulo="Atalho" nome="resp-atalho" valor={atalho} aoMudar={setAtalho} obrigatorio dica="Ex.: preco" />
        </div>
        <div className="campo">
          <label htmlFor="resp-texto">Texto</label>
          <textarea id="resp-texto" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} required maxLength={2000} />
        </div>
        <Mensagem tipo="erro">{criar.erro}</Mensagem>
        <button type="submit" className="botao" disabled={criar.enviando}>
          Criar resposta
        </button>
      </form>
    </section>
  );
}

export function Canais() {
  const [canais, setCanais] = useState<CanalDto[]>([]);
  const [erro, setErro] = useState("");
  const avisar = useAviso();
  const carregar = useCallback(() => {
    get<CanalDto[]>("/canais").then(
      (l) => (setCanais(l), setErro("")),
      (e: unknown) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar os canais."),
    );
  }, []);
  useEffect(carregar, [carregar]);
  const juntar = async () => {
    const r = await post<{ juntadas: number }>("/conversas/juntar-duplicadas");
    avisar(r.juntadas ? `${r.juntadas} conversa(s) duplicada(s) juntada(s).` : "Nenhuma conversa duplicada encontrada.");
  };
  const ativos = canais.filter((c) => !c.arquivadoEm);
  const arquivados = canais.filter((c) => c.arquivadoEm);

  return (
    <>
      <Titulo>Canais e automações</Titulo>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <section className="cartao" aria-labelledby="titulo-canais">
        <h2 id="titulo-canais">Canais</h2>
        {!ativos.length && <ListaVazia>Nenhum canal. Crie um abaixo — para testar sem número real, use o modo demonstração.</ListaVazia>}
        <ul className="lista">
          {ativos.map((c) => (
            <Canal key={c.id} c={c} aoMudar={carregar} />
          ))}
        </ul>
        {arquivados.length > 0 && (
          <details>
            <summary>Arquivados ({arquivados.length})</summary>
            <ul className="lista">
              {arquivados.map((c) => (
                <Canal key={c.id} c={c} aoMudar={carregar} />
              ))}
            </ul>
          </details>
        )}
      </section>
      <NovoCanal aoCriar={carregar} />
      <Automacoes />
      <Respostas />
      <section className="cartao">
        <h2>Conversas duplicadas</h2>
        <p className="dica">Junta conversas antigas do mesmo cliente (por exemplo, com e sem o nono dígito). Roda sozinho toda madrugada; nada é apagado.</p>
        <button type="button" className="botao botao-secundario" onClick={() => void juntar()}>
          Juntar agora
        </button>
      </section>
    </>
  );
}
