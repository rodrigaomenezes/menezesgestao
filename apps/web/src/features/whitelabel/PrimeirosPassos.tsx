// Assistente de primeiro acesso em 5 passos: empresa e marca → segmento → equipe → canais → contatos.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PASSOS_ASSISTENTE, SEGMENTOS, type OnboardingDto } from "@mg/shared";
import { ErroApi, get, post } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { useAviso } from "../../ui/sobreposicoes";
import { Campo, Escolha, Mensagem, Titulo, useEnvio } from "../../ui/ui";
import { EnviarLogo, FormCores, useConfigMarca } from "./Marca";

function PassoMarca({ aoSeguir }: { aoSeguir(): void }) {
  const { config, setConfig, erro } = useConfigMarca();
  if (erro) return <Mensagem tipo="erro">{erro}</Mensagem>;
  if (!config) return <p className="carregando">Carregando…</p>;
  return (
    <>
      <p>Escolha as cores e, se tiver, envie o logo. Dá para mudar depois em “Empresa e marca”.</p>
      <FormCores config={config} aoSalvar={setConfig} />
      <EnviarLogo tipo="claro" atual={config.logoClaro} aoSalvar={setConfig} />
      <button type="button" className="botao botao-largo" onClick={aoSeguir}>
        Continuar
      </button>
    </>
  );
}

function PassoSegmento({ aoSeguir }: { aoSeguir(o: OnboardingDto): void }) {
  const { recarregar } = useSessao();
  const [segmento, setSegmento] = useState("");
  const envio = useEnvio(async () => {
    const o = await post<OnboardingDto>("/primeiros-passos/segmento", { segmento });
    await recarregar();
    aoSeguir(o);
  });
  return (
    <form onSubmit={envio.enviar} aria-label="Segmento">
      <p>Qual é o seu negócio? Isso já deixa o funil, os termos (ex.: “aluno”, “paciente”) e os motivos de perda prontos.</p>
      <div className="segmentos" role="radiogroup" aria-label="Segmento">
        {SEGMENTOS.map((s) => (
          <label key={s.id} className={`segmento ${segmento === s.id ? "escolhido" : ""}`}>
            <input type="radio" name="segmento" value={s.id} checked={segmento === s.id} onChange={() => setSegmento(s.id)} required />
            <strong>{s.nome}</strong>
            <span className="item-detalhe">{s.descricao}</span>
          </label>
        ))}
      </div>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao botao-largo" disabled={envio.enviando || !segmento}>
        Aplicar e continuar
      </button>
    </form>
  );
}

function PassoEquipe({ aoSeguir }: { aoSeguir(): void }) {
  const avisar = useAviso();
  const [perfis, setPerfis] = useState<{ id: string; nome: string }[]>([]);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [perfilId, setPerfilId] = useState("");
  const [convidados, setConvidados] = useState<string[]>([]);
  useEffect(() => {
    get<{ perfis: { id: string; nome: string }[] }>("/usuarios/opcoes").then((o) => {
      setPerfis(o.perfis);
      setPerfilId(o.perfis.find((p) => /vendedor/i.test(p.nome))?.id ?? o.perfis[0]?.id ?? "");
    }, () => undefined);
  }, []);
  const envio = useEnvio(async () => {
    await post("/convites", { nome, email, perfilId });
    setConvidados([...convidados, email]);
    avisar(`Convite enviado para ${email}.`);
    setNome("");
    setEmail("");
  });
  return (
    <>
      <p>Convide quem vai usar o sistema. Cada pessoa recebe um e-mail para criar a senha.</p>
      <form onSubmit={envio.enviar} aria-label="Convidar pessoa">
        <div className="grade-campos">
          <Campo rotulo="Nome" nome="convite-nome" valor={nome} aoMudar={setNome} obrigatorio />
          <Campo rotulo="E-mail" nome="convite-email" tipo="email" valor={email} aoMudar={setEmail} obrigatorio />
          <Escolha rotulo="Perfil" nome="convite-perfil" valor={perfilId} aoMudar={setPerfilId} opcoes={perfis.map((p) => ({ valor: p.id, texto: p.nome }))} />
        </div>
        <Mensagem tipo="erro">{envio.erro}</Mensagem>
        <button type="submit" className="botao botao-secundario" disabled={envio.enviando}>
          Convidar
        </button>
      </form>
      {convidados.length > 0 && <p className="dica">Convidados: {convidados.join(", ")}</p>}
      <button type="button" className="botao botao-largo" onClick={aoSeguir}>
        {convidados.length ? "Continuar" : "Pular por enquanto"}
      </button>
    </>
  );
}

function PassoCanais({ aoSeguir }: { aoSeguir(): void }) {
  const avisar = useAviso();
  const [criado, setCriado] = useState(false);
  const envio = useEnvio(async () => {
    const c = await post<{ id: string }>("/canais", { nome: "WhatsApp de demonstração", provedor: "demonstracao" });
    await post(`/canais/${c.id}/conectar`);
    setCriado(true);
    avisar("Canal de demonstração conectado.");
  });
  return (
    <>
      <p>
        Para conversar pelo WhatsApp, conecte o número da empresa em <Link to="/conversas/canais">Canais e automações</Link> (pela API oficial ou pelo QR code). Quer
        testar antes? Use o canal de demonstração.
      </p>
      {!criado && (
        <button type="button" className="botao botao-secundario" disabled={envio.enviando} onClick={() => void envio.enviar()}>
          Criar canal de demonstração
        </button>
      )}
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="button" className="botao botao-largo" onClick={aoSeguir}>
        {criado ? "Continuar" : "Pular por enquanto"}
      </button>
    </>
  );
}

function PassoContatos({ estado, aoMudar, aoConcluir }: { estado: OnboardingDto; aoMudar(o: OnboardingDto): void; aoConcluir(): void }) {
  const avisar = useAviso();
  const exemplos = useEnvio(async () => {
    aoMudar(await post<OnboardingDto>("/primeiros-passos/exemplos"));
    avisar("Exemplos criados: veja no funil. Quando quiser, apague com um clique.");
  });
  return (
    <>
      <p>
        Traga seus contatos de uma planilha em <Link to="/importar">Importar planilha</Link> (a mesma planilha duas vezes não duplica ninguém) — ou comece com dados de
        exemplo.
      </p>
      {!estado.temExemplos && (
        <button type="button" className="botao botao-secundario" disabled={exemplos.enviando} onClick={() => void exemplos.enviar()}>
          Usar dados de exemplo
        </button>
      )}
      <Mensagem tipo="erro">{exemplos.erro}</Mensagem>
      <button type="button" className="botao botao-largo" onClick={aoConcluir}>
        Concluir
      </button>
    </>
  );
}

export function PrimeirosPassos() {
  const navegar = useNavigate();
  const avisar = useAviso();
  const [estado, setEstado] = useState<OnboardingDto | null>(null);
  const [passo, setPasso] = useState(1);
  const [erro, setErro] = useState("");
  useEffect(() => {
    get<OnboardingDto>("/primeiros-passos").then(
      (o) => {
        setEstado(o);
        setPasso(Math.min(5, Math.max(1, o.passo)));
      },
      (e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar."),
    );
  }, []);
  const avancar = async (para: number) => {
    try {
      setEstado(await post<OnboardingDto>("/primeiros-passos/avancar", { passo: para }));
      if (para >= 6) {
        avisar("Tudo pronto! Bom trabalho.");
        navegar("/");
      } else setPasso(para);
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível salvar.", "erro");
    }
  };
  if (erro) return <Mensagem tipo="erro">{erro}</Mensagem>;
  if (!estado) return <p className="carregando">Carregando…</p>;
  return (
    <>
      <Titulo>Primeiros passos</Titulo>
      <ol className="passos" aria-label="Passos">
        {PASSOS_ASSISTENTE.map((p, i) => (
          <li key={p} className={i + 1 === passo ? "atual" : i + 1 < passo ? "feito" : ""} aria-current={i + 1 === passo ? "step" : undefined}>
            <span>{i + 1}</span> {p}
          </li>
        ))}
      </ol>
      <section className="cartao" aria-label={`Passo ${passo}: ${PASSOS_ASSISTENTE[passo - 1]}`}>
        <h2>
          {passo}. {PASSOS_ASSISTENTE[passo - 1]}
        </h2>
        {passo === 1 && <PassoMarca aoSeguir={() => void avancar(2)} />}
        {passo === 2 &&
          (estado.segmento ? (
            <>
              <p>Segmento aplicado: {SEGMENTOS.find((s) => s.id === estado.segmento)?.nome}.</p>
              <button type="button" className="botao botao-largo" onClick={() => void avancar(3)}>
                Continuar
              </button>
            </>
          ) : (
            <PassoSegmento aoSeguir={(o) => (setEstado(o), setPasso(3))} />
          ))}
        {passo === 3 && <PassoEquipe aoSeguir={() => void avancar(4)} />}
        {passo === 4 && <PassoCanais aoSeguir={() => void avancar(5)} />}
        {passo === 5 && <PassoContatos estado={estado} aoMudar={setEstado} aoConcluir={() => void avancar(6)} />}
        {passo > 1 && (
          <button type="button" className="link-secundario" onClick={() => setPasso(passo - 1)}>
            Voltar
          </button>
        )}
      </section>
    </>
  );
}

/** Aviso no Início enquanto o assistente não terminou; e o botão de apagar os exemplos. */
export function AvisoPrimeirosPassos() {
  const { pode } = useSessao();
  const avisar = useAviso();
  const [estado, setEstado] = useState<OnboardingDto | null>(null);
  useEffect(() => {
    if (pode("configuracoes", "ver")) get<OnboardingDto>("/primeiros-passos").then(setEstado, () => undefined);
  }, [pode]);
  if (!estado || (estado.concluido && !estado.temExemplos)) return null;
  const limpar = async () => {
    try {
      setEstado(await post<OnboardingDto>("/primeiros-passos/exemplos/limpar"));
      avisar("Exemplos apagados (estão na lixeira, se precisar).");
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível apagar.", "erro");
    }
  };
  return (
    <section className="cartao destaque" aria-label="Configuração inicial">
      {!estado.concluido && (
        <p>
          Falta pouco para deixar tudo pronto. <Link to="/primeiros-passos">Continuar a configuração</Link>
        </p>
      )}
      {estado.temExemplos && pode("configuracoes", "administrar") && (
        <p>
          Você está com dados de exemplo.{" "}
          <button type="button" className="link-secundario" onClick={() => void limpar()}>
            Apagar os exemplos
          </button>
        </p>
      )}
    </section>
  );
}
