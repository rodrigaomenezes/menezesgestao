// Blocos de marca usados no assistente e em "Empresa e marca": cores, logo, vocabulário e domínio.
import { useCallback, useEffect, useState } from "react";
import { CONTRASTE_MINIMO, TERMOS, contrasteDaCor, corDoTextoSobre, type ConfigMarcaDto } from "@mg/shared";
import { ErroApi, enviarArquivo, get, post, put } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { useAviso } from "../../ui/sobreposicoes";
import { Campo, Mensagem, useEnvio } from "../../ui/ui";

export function useConfigMarca() {
  const [config, setConfig] = useState<ConfigMarcaDto | null>(null);
  const [erro, setErro] = useState("");
  const carregar = useCallback(() => {
    get<ConfigMarcaDto>("/empresa/marca").then(setConfig, (e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar a marca."));
  }, []);
  useEffect(carregar, [carregar]);
  return { config, setConfig, erro };
}

function Cor({ rotulo, nome, valor, aoMudar }: { rotulo: string; nome: string; valor: string; aoMudar(v: string): void }) {
  const legivel = contrasteDaCor(valor) >= CONTRASTE_MINIMO;
  return (
    <div className="campo">
      <label htmlFor={nome}>{rotulo}</label>
      <div className="cor">
        <input id={nome} type="color" value={valor} onChange={(e) => aoMudar(e.target.value)} />
        <span className="cor-amostra" style={{ background: valor, color: corDoTextoSobre(valor) }}>
          Texto de exemplo
        </span>
      </div>
      {!legivel && <small className="dica mensagem-erro">Pouco contraste: o texto ficaria difícil de ler. Escolha um tom mais escuro ou mais claro.</small>}
    </div>
  );
}

export function FormCores({ config, aoSalvar }: { config: ConfigMarcaDto; aoSalvar(c: ConfigMarcaDto): void }) {
  const { recarregar } = useSessao();
  const avisar = useAviso();
  const [nomeProduto, setNomeProduto] = useState(config.nomeProduto ?? "");
  const [corPrimaria, setCorPrimaria] = useState(config.corPrimaria);
  const [corDestaque, setCorDestaque] = useState(config.corDestaque);
  const envio = useEnvio(async () => {
    const c = await put<ConfigMarcaDto>("/empresa/marca", { nomeProduto: nomeProduto || undefined, corPrimaria, corDestaque });
    avisar("Marca salva. Já aparece para todos da empresa.");
    aoSalvar(c);
    await recarregar();
  });
  return (
    <form onSubmit={envio.enviar} aria-label="Cores e nome">
      <div className="grade-campos">
        <Campo rotulo="Nome do produto (opcional)" nome="marca-produto" valor={nomeProduto} aoMudar={setNomeProduto} dica="Aparece no topo, na aba do navegador e no app instalado." />
        <Cor rotulo="Cor principal" nome="marca-cor-primaria" valor={corPrimaria} aoMudar={setCorPrimaria} />
        <Cor rotulo="Cor de destaque" nome="marca-cor-destaque" valor={corDestaque} aoMudar={setCorDestaque} />
      </div>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        Salvar marca
      </button>
    </form>
  );
}

export function EnviarLogo({ tipo, atual, aoSalvar }: { tipo: "claro" | "escuro"; atual: string | null; aoSalvar(c: ConfigMarcaDto): void }) {
  const { recarregar } = useSessao();
  const avisar = useAviso();
  const [erro, setErro] = useState("");
  const rotulo = tipo === "claro" ? "Logo para fundo claro" : "Logo para fundo escuro (opcional)";
  const enviar = async (f: File) => {
    setErro("");
    try {
      aoSalvar(await enviarArquivo<ConfigMarcaDto>(`/empresa/marca/logo/${tipo}`, f));
      avisar("Logo atualizado.");
      await recarregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível enviar o logo.");
    }
  };
  const remover = async () => {
    aoSalvar(await post<ConfigMarcaDto>(`/empresa/marca/logo/${tipo}/remover`));
    await recarregar();
  };
  return (
    <div className="campo logo-campo">
      <label htmlFor={`logo-${tipo}`}>{rotulo}</label>
      {atual && <img src={atual} alt="" className={`logo-previa ${tipo === "escuro" ? "logo-previa-escura" : ""}`} />}
      <input id={`logo-${tipo}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => (e.target.files?.[0] ? void enviar(e.target.files[0]) : undefined)} />
      <small className="dica">PNG, JPG ou WebP, até 512 KB.</small>
      {atual && (
        <button type="button" className="link-secundario" onClick={() => void remover()}>
          Tirar o logo
        </button>
      )}
      <Mensagem tipo="erro">{erro}</Mensagem>
    </div>
  );
}

export function FormVocabulario({ config, aoSalvar }: { config: ConfigMarcaDto; aoSalvar(c: ConfigMarcaDto): void }) {
  const { recarregar } = useSessao();
  const avisar = useAviso();
  const [vocab, setVocab] = useState<Record<string, string>>(config.vocabulario);
  const envio = useEnvio(async () => {
    const limpo = Object.fromEntries(Object.entries(vocab).filter(([, v]) => v.trim()));
    aoSalvar(await put<ConfigMarcaDto>("/empresa/vocabulario", limpo));
    avisar("Vocabulário salvo. As telas já usam os novos termos.");
    await recarregar();
  });
  return (
    <form onSubmit={envio.enviar} aria-label="Vocabulário">
      <p className="dica">Como a sua empresa chama cada coisa. Deixe em branco para usar o termo padrão. Plural só se não for regular (ex.: sessão → sessões).</p>
      {TERMOS.map((t) => (
        <div key={t.chave} className="grade-campos">
          <Campo rotulo={`${t.rotulo} (padrão: ${t.padrao})`} nome={`vocab-${t.chave}`} valor={vocab[t.chave] ?? ""} aoMudar={(v) => setVocab({ ...vocab, [t.chave]: v })} />
          <Campo rotulo="Plural (opcional)" nome={`vocab-${t.chave}-plural`} valor={vocab[`${t.chave}_plural`] ?? ""} aoMudar={(v) => setVocab({ ...vocab, [`${t.chave}_plural`]: v })} />
        </div>
      ))}
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        Salvar vocabulário
      </button>
    </form>
  );
}

export function FormDominio({ config, aoSalvar }: { config: ConfigMarcaDto; aoSalvar(c: ConfigMarcaDto): void }) {
  const avisar = useAviso();
  const [dominio, setDominio] = useState(config.dominio ?? "");
  const envio = useEnvio(async () => {
    aoSalvar(await put<ConfigMarcaDto>("/empresa/dominio", { dominio: dominio.trim() || null }));
    avisar(dominio.trim() ? "Domínio salvo. Falta apontar o DNS (veja abaixo)." : "Domínio próprio removido.");
  });
  return (
    <form onSubmit={envio.enviar} aria-label="Endereço">
      {config.subdominio && (
        <p>
          Endereço da empresa: <code>https://{config.subdominio}</code>
        </p>
      )}
      <Campo rotulo="Domínio próprio (opcional)" nome="dominio" valor={dominio} aoMudar={setDominio} dica="Ex.: app.suaempresa.com.br. No seu provedor de DNS, crie um registro CNAME desse endereço apontando para o endereço do sistema." />
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        Salvar endereço
      </button>
    </form>
  );
}
