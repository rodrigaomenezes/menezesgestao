// Configuração da telefonia (administrador): SIP, gravação e retenção, ramais, resultados de ligação e tipos de base.
import { useCallback, useEffect, useState } from "react";
import {
  ACOES_RESULTADO,
  NOMES_ACOES_RESULTADO,
  type Pagina,
  type RamalDto,
  type ResultadoLigacaoDto,
  type TelefoniaConfigDto,
  type TipoBaseDto,
} from "@mg/shared";
import { ErroApi, get, patch, post, put } from "../../app/api";
import { useAviso } from "../../ui/sobreposicoes";
import { Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio } from "../../ui/ui";

function Configuracao() {
  const avisar = useAviso();
  const [c, setC] = useState<TelefoniaConfigDto | null>(null);
  useEffect(() => {
    get<TelefoniaConfigDto>("/telefonia/config").then(setC, () => undefined);
  }, []);
  const { enviando, erro, enviar } = useEnvio(async () => {
    if (!c) return;
    setC(await put<TelefoniaConfigDto>("/telefonia/config", { ...c, sipServidor: c.sipServidor || null, sipDominio: c.sipDominio || null }));
    avisar("Configuração salva.");
  });
  if (!c) return <p className="carregando">Carregando…</p>;
  const mudar = (campo: keyof TelefoniaConfigDto, valor: unknown) => setC({ ...c, [campo]: valor });
  return (
    <form className="cartao" onSubmit={enviar} aria-labelledby="titulo-config-tel">
      <h2 id="titulo-config-tel">Telefone pelo navegador e gravação</h2>
      <p className="dica">
        Sem servidor SIP, a equipe liga pelo celular (o sistema registra) ou no modo treino. Com SIP, cada pessoa precisa de um ramal abaixo.
      </p>
      <div className="grade-campos">
        <Campo rotulo="Servidor SIP (WebSocket seguro)" nome="sip-servidor" valor={c.sipServidor ?? ""} aoMudar={(v) => mudar("sipServidor", v)} dica="Ex.: wss://pabx.suaempresa.com.br:8089/ws" />
        <Campo rotulo="Domínio SIP" nome="sip-dominio" valor={c.sipDominio ?? ""} aoMudar={(v) => mudar("sipDominio", v)} dica="Ex.: pabx.suaempresa.com.br" />
        <Campo rotulo="Guardar gravações por (dias)" nome="retencao" tipo="number" valor={String(c.retencaoDias)} aoMudar={(v) => mudar("retencaoDias", Number(v))} />
      </div>
      <label className="marcar">
        <input type="checkbox" checked={c.gravacaoAtiva} onChange={(e) => mudar("gravacaoAtiva", e.target.checked)} />
        Permitir gravar ligações (só pelo navegador, depois do aviso ao cliente)
      </label>
      <div className="campo">
        <label htmlFor="aviso-gravacao">Aviso que a pessoa lê ao cliente antes de gravar</label>
        <textarea id="aviso-gravacao" rows={2} maxLength={300} value={c.avisoGravacao} onChange={(e) => mudar("avisoGravacao", e.target.value)} />
      </div>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <button type="submit" className="botao" disabled={enviando}>
        Salvar
      </button>
    </form>
  );
}

function Ramais() {
  const avisar = useAviso();
  const [ramais, setRamais] = useState<RamalDto[]>([]);
  const [pessoas, setPessoas] = useState<{ usuarioId: string; nome: string }[]>([]);
  const [usuarioId, setUsuarioId] = useState("");
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const carregar = useCallback(() => {
    get<RamalDto[]>("/telefonia/ramais").then(setRamais, () => undefined);
  }, []);
  useEffect(() => {
    carregar();
    get<Pagina<{ usuarioId: string; nome: string }>>("/usuarios?limite=100").then((p) => setPessoas(p.itens), () => undefined);
  }, [carregar]);
  const { enviando, erro, enviar } = useEnvio(async () => {
    await put(`/telefonia/ramais/${usuarioId}`, { login, senha: senha || null, ativo: true });
    setSenha("");
    avisar("Ramal salvo.");
    carregar();
  });
  const desativar = async (r: RamalDto) => {
    try {
      await put(`/telefonia/ramais/${r.usuarioId}`, { login: r.login, ativo: !r.ativo });
      carregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível alterar.", "erro");
    }
  };
  return (
    <section className="cartao" aria-labelledby="titulo-ramais">
      <h2 id="titulo-ramais">Ramais SIP</h2>
      {!ramais.length && <ListaVazia>Nenhum ramal cadastrado.</ListaVazia>}
      <ul className="lista">
        {ramais.map((r) => (
          <li key={r.usuarioId} className="item">
            <div className="item-principal">
              <strong>{r.usuarioNome}</strong>
              <span className="item-detalhe">
                Ramal {r.login} · {r.ativo ? "ativo" : "desativado"}
              </span>
            </div>
            <button type="button" className="botao botao-secundario" onClick={() => void desativar(r)}>
              {r.ativo ? "Desativar" : "Ativar"}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={enviar}>
        <div className="grade-campos">
          <Escolha rotulo="Pessoa" nome="ramal-pessoa" valor={usuarioId} aoMudar={setUsuarioId} opcoes={pessoas.map((p) => ({ valor: p.usuarioId, texto: p.nome }))} vazio="Escolha…" obrigatorio />
          <Campo rotulo="Usuário do ramal" nome="ramal-login" valor={login} aoMudar={setLogin} obrigatorio autoComplete="off" />
          <Campo rotulo="Senha do ramal" nome="ramal-senha" tipo="password" valor={senha} aoMudar={setSenha} autoComplete="new-password" dica="Fica cifrada; deixe vazio para manter a atual" />
        </div>
        <Mensagem tipo="erro">{erro}</Mensagem>
        <button type="submit" className="botao" disabled={enviando}>
          Salvar ramal
        </button>
      </form>
    </section>
  );
}

function Resultados() {
  const avisar = useAviso();
  const [lista, setLista] = useState<ResultadoLigacaoDto[]>([]);
  const [nome, setNome] = useState("");
  const [acao, setAcao] = useState<string>("reagendar");
  const [horas, setHoras] = useState("");
  const [atendida, setAtendida] = useState(false);
  const carregar = useCallback(() => {
    get<ResultadoLigacaoDto[]>("/telefonia/resultados").then(setLista, () => undefined);
  }, []);
  useEffect(carregar, [carregar]);
  const criar = useEnvio(async () => {
    await post("/telefonia/resultados", { nome, acao, horas: acao === "reagendar" && horas ? Number(horas) : null, atendida, ordem: lista.length * 10 });
    setNome("");
    setHoras("");
    avisar("Resultado criado.");
    carregar();
  });
  return (
    <section className="cartao" aria-labelledby="titulo-resultados">
      <h2 id="titulo-resultados">Resultados de ligação</h2>
      <p className="dica">Cada resultado tem uma ação na fila. “Ligar de novo” sem horas pede a data na hora.</p>
      <ul className="lista">
        {lista.map((r) => (
          <li key={r.id} className="item">
            <div className="item-principal">
              <strong>{r.nome}</strong>
              <span className="item-detalhe">
                {NOMES_ACOES_RESULTADO[r.acao]}
                {r.acao === "reagendar" && (r.horas ? ` em ${r.horas} h` : " (escolhe a data)")}
                {r.atendida && " · conta como atendida"}
                {r.arquivadoEm && " · arquivado"}
              </span>
            </div>
            <button type="button" className="botao botao-secundario" onClick={() => void patch(`/telefonia/resultados/${r.id}`, { arquivado: !r.arquivadoEm }).then(carregar)}>
              {r.arquivadoEm ? "Restaurar" : "Arquivar"}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={criar.enviar}>
        <div className="grade-campos">
          <Campo rotulo="Nome" nome="res-nome" valor={nome} aoMudar={setNome} obrigatorio />
          <Escolha rotulo="Ação na fila" nome="res-acao" valor={acao} aoMudar={setAcao} opcoes={ACOES_RESULTADO.map((a) => ({ valor: a, texto: NOMES_ACOES_RESULTADO[a] }))} />
          {acao === "reagendar" && <Campo rotulo="Em quantas horas (vazio = escolher)" nome="res-horas" tipo="number" valor={horas} aoMudar={setHoras} />}
        </div>
        <label className="marcar">
          <input type="checkbox" checked={atendida} onChange={(e) => setAtendida(e.target.checked)} />
          Conta como ligação atendida
        </label>
        <Mensagem tipo="erro">{criar.erro}</Mensagem>
        <button type="submit" className="botao" disabled={criar.enviando}>
          Criar resultado
        </button>
      </form>
    </section>
  );
}

function TiposBase() {
  const [lista, setLista] = useState<TipoBaseDto[]>([]);
  const [nome, setNome] = useState("");
  const carregar = useCallback(() => {
    get<TipoBaseDto[]>("/tipos-base").then(setLista, () => undefined);
  }, []);
  useEffect(carregar, [carregar]);
  const criar = useEnvio(async () => {
    await post("/tipos-base", { nome });
    setNome("");
    carregar();
  });
  return (
    <section className="cartao" aria-labelledby="titulo-tipos">
      <h2 id="titulo-tipos">Tipos de base das filas</h2>
      <ul className="lista">
        {lista.map((t) => (
          <li key={t.id} className="item">
            <div className="item-principal">
              <strong>{t.nome}</strong>
              {t.arquivadoEm && <span className="item-detalhe">Arquivado</span>}
            </div>
            <button type="button" className="botao botao-secundario" onClick={() => void patch(`/tipos-base/${t.id}`, { nome: t.nome, arquivado: !t.arquivadoEm }).then(carregar)}>
              {t.arquivadoEm ? "Restaurar" : "Arquivar"}
            </button>
          </li>
        ))}
      </ul>
      <form className="form-linha" onSubmit={criar.enviar}>
        <Campo rotulo="Novo tipo de base" nome="tipo-nome" valor={nome} aoMudar={setNome} obrigatorio dica="Ex.: Ex-alunos, Indicações" />
        <button type="submit" className="botao" disabled={criar.enviando}>
          Criar
        </button>
      </form>
      <Mensagem tipo="erro">{criar.erro}</Mensagem>
    </section>
  );
}

export function ConfigTelefonia() {
  return (
    <>
      <Titulo>Configurar telefonia</Titulo>
      <Configuracao />
      <Ramais />
      <Resultados />
      <TiposBase />
    </>
  );
}
