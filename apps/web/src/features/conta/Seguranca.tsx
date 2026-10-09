// Segurança da conta: login em duas etapas (app autenticador ou e-mail) e códigos de recuperação.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  METODOS_DUAS_ETAPAS,
  NOMES_METODOS_DUAS_ETAPAS,
  type CodigosRecuperacaoDto,
  type DuasEtapasDto,
  type IniciarDuasEtapasDto,
  type MetodoDuasEtapas,
} from "@mg/shared";
import { ErroApi, get, post } from "../../app/api";
import { useDataHora, useSessao } from "../../app/sessao";
import { useAviso } from "../../ui/sobreposicoes";
import { Campo, Mensagem, Titulo, useEnvio } from "../../ui/ui";

/** Mostra os códigos de recuperação uma única vez. */
function CodigosRecuperacao({ codigos, aoFechar }: { codigos: string[]; aoFechar(): void }) {
  const avisar = useAviso();
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigos.join("\n"));
      avisar("Códigos copiados.");
    } catch {
      avisar("Não foi possível copiar. Anote os códigos à mão.", "erro");
    }
  };
  return (
    <section className="cartao destaque" aria-labelledby="titulo-codigos">
      <h2 id="titulo-codigos">Guarde seus códigos de recuperação</h2>
      <p>Cada código entra uma vez, se você ficar sem o celular ou sem o e-mail. Eles não aparecem de novo.</p>
      <ul className="codigos-recuperacao">
        {codigos.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <div className="acoes-linha">
        <button type="button" className="botao botao-secundario" onClick={() => void copiar()}>
          Copiar
        </button>
        <button type="button" className="botao" onClick={aoFechar}>
          Já guardei
        </button>
      </div>
    </section>
  );
}

function Configurar({ aoLigar }: { aoLigar(codigos: string[]): void }) {
  const [metodo, setMetodo] = useState<MetodoDuasEtapas>("totp");
  const [inicio, setInicio] = useState<IniciarDuasEtapasDto | null>(null);
  const [codigo, setCodigo] = useState("");
  const iniciar = useEnvio(async () => {
    setInicio(await post<IniciarDuasEtapasDto>("/conta/duas-etapas/iniciar", { metodo }));
    setCodigo("");
  });
  const confirmar = useEnvio(async () => {
    const r = await post<CodigosRecuperacaoDto>("/conta/duas-etapas/confirmar", { codigo });
    aoLigar(r.codigos);
  });

  if (!inicio) {
    return (
      <form onSubmit={iniciar.enviar} aria-label="Escolher método">
        <fieldset>
          <legend>Como você quer confirmar que é você?</legend>
          {METODOS_DUAS_ETAPAS.map((m) => (
            <label key={m} className="marcar">
              <input type="radio" name="metodo" value={m} checked={metodo === m} onChange={() => setMetodo(m)} />
              <span>
                <strong>{NOMES_METODOS_DUAS_ETAPAS[m]}</strong>
                <span className="item-detalhe">
                  {m === "totp"
                    ? " — Google Authenticator, Microsoft Authenticator, Authy… Funciona sem internet no celular."
                    : " — um código chega no seu e-mail a cada entrada."}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <Mensagem tipo="erro">{iniciar.erro}</Mensagem>
        <button type="submit" className="botao" disabled={iniciar.enviando}>
          Continuar
        </button>
      </form>
    );
  }
  return (
    <form onSubmit={confirmar.enviar} aria-label="Confirmar código">
      {inicio.metodo === "totp" ? (
        <>
          <p>1. No app autenticador, adicione uma conta lendo este QR code:</p>
          {inicio.qr && <img src={inicio.qr} alt="QR code para o app autenticador" className="qr-duas-etapas" width={240} height={240} />}
          <p className="dica">
            Não consegue ler? Digite a chave: <code className="chave-totp">{inicio.segredo}</code>
          </p>
          <p>2. Digite o código de 6 dígitos que o app mostra:</p>
        </>
      ) : (
        <p>Enviamos um código para {inicio.destino}. Digite abaixo (vale por 10 minutos).</p>
      )}
      <Campo rotulo="Código" nome="codigo-config" valor={codigo} aoMudar={setCodigo} obrigatorio minimo={6} autoComplete="one-time-code" />
      <Mensagem tipo="erro">{confirmar.erro}</Mensagem>
      <div className="acoes-linha">
        <button type="submit" className="botao" disabled={confirmar.enviando}>
          Ligar
        </button>
        <button type="button" className="botao botao-secundario" onClick={() => setInicio(null)}>
          Voltar
        </button>
      </div>
    </form>
  );
}

function PedirSenha({ acao, perigosa, aoConfirmar, aoCancelar }: { acao: string; perigosa?: boolean; aoConfirmar(senha: string): Promise<void>; aoCancelar(): void }) {
  const [senha, setSenha] = useState("");
  const envio = useEnvio(() => aoConfirmar(senha));
  return (
    <form onSubmit={envio.enviar} aria-label={acao}>
      <Campo rotulo="Sua senha" nome="senha-confirmacao" tipo="password" valor={senha} aoMudar={setSenha} obrigatorio autoComplete="current-password" />
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <div className="acoes-linha">
        <button type="submit" className={`botao ${perigosa ? "botao-perigo" : ""}`} disabled={envio.enviando}>
          {acao}
        </button>
        <button type="button" className="botao botao-secundario" onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function Seguranca() {
  const { eu, recarregar } = useSessao();
  const dataHora = useDataHora();
  const avisar = useAviso();
  const [estado, setEstado] = useState<DuasEtapasDto | null>(null);
  const [erro, setErro] = useState("");
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [modo, setModo] = useState<"" | "configurar" | "desligar" | "codigos">("");
  const carregar = useCallback(() => {
    get<DuasEtapasDto>("/conta/duas-etapas").then(setEstado, (e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar."));
  }, []);
  useEffect(carregar, [carregar]);

  if (erro) return <Mensagem tipo="erro">{erro}</Mensagem>;
  if (!estado) return <p className="carregando">Carregando…</p>;
  return (
    <>
      <Titulo>Segurança da conta</Titulo>
      {eu?.duasEtapas.pendente && !codigos && (
        <Mensagem tipo="info">A empresa exige o login em duas etapas. Configure abaixo para liberar o sistema.</Mensagem>
      )}
      {codigos && (
        <CodigosRecuperacao
          codigos={codigos}
          aoFechar={() => {
            setCodigos(null);
            void recarregar();
          }}
        />
      )}
      <section className="cartao" aria-labelledby="titulo-duas-etapas">
        <h2 id="titulo-duas-etapas">Login em duas etapas</h2>
        <p className="dica">Além da senha, um código no celular ou no e-mail. Se a senha vazar, ninguém entra sem o código.</p>
        {estado.ativa && estado.metodo ? (
          <p>
            <span className="selo selo-ganha">Ligado</span> {NOMES_METODOS_DUAS_ETAPAS[estado.metodo]}
            {estado.ativadaEm && ` desde ${dataHora(estado.ativadaEm)}`} · {estado.codigosRestantes} código(s) de recuperação
            {estado.obrigatoria && " · exigido pela empresa"}
          </p>
        ) : (
          <p>
            <span className="selo">Desligado</span>
          </p>
        )}

        {modo === "configurar" && (
          <Configurar
            aoLigar={(c) => {
              setCodigos(c);
              setModo("");
              carregar();
              avisar("Login em duas etapas ligado.");
            }}
          />
        )}
        {modo === "codigos" && (
          <PedirSenha
            acao="Gerar novos códigos"
            aoCancelar={() => setModo("")}
            aoConfirmar={async (senha) => {
              setCodigos((await post<CodigosRecuperacaoDto>("/conta/duas-etapas/novos-codigos", { senha })).codigos);
              setModo("");
              carregar();
            }}
          />
        )}
        {modo === "desligar" && (
          <PedirSenha
            acao="Desligar"
            perigosa
            aoCancelar={() => setModo("")}
            aoConfirmar={async (senha) => {
              await post("/conta/duas-etapas/desligar", { senha });
              setModo("");
              carregar();
              avisar("Login em duas etapas desligado.");
            }}
          />
        )}
        {!modo && (
          <div className="acoes-linha">
            <button type="button" className="botao" onClick={() => setModo("configurar")}>
              {estado.ativa ? "Trocar de método" : "Ligar duas etapas"}
            </button>
            {estado.ativa && (
              <button type="button" className="botao botao-secundario" onClick={() => setModo("codigos")}>
                Novos códigos de recuperação
              </button>
            )}
            {estado.ativa && !estado.obrigatoria && (
              <button type="button" className="botao botao-secundario" onClick={() => setModo("desligar")}>
                Desligar
              </button>
            )}
          </div>
        )}
      </section>
      {!eu?.duasEtapas.pendente && (
        <p>
          <Link to="/dispositivos">Ver e encerrar os dispositivos conectados</Link>
        </p>
      )}
    </>
  );
}
