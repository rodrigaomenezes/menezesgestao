// Markdown simples dos documentos legais (títulos, parágrafos, listas, tabelas e **negrito**), montado como elementos
// React: nada de innerHTML, então o texto nunca vira código na página.
import { Fragment, type ReactNode } from "react";

function emLinha(texto: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) => (parte.startsWith("**") && parte.endsWith("**") ? <strong key={i}>{parte.slice(2, -2)}</strong> : <Fragment key={i}>{parte}</Fragment>));
}

const celulas = (linha: string) =>
  linha
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function Markdown({ texto }: { texto: string }) {
  const blocos: ReactNode[] = [];
  const linhas = texto.split("\n");
  for (let i = 0; i < linhas.length; ) {
    const l = linhas[i]!;
    if (!l.trim()) {
      i++;
    } else if (l.startsWith("# ")) {
      blocos.push(<h1 key={i}>{emLinha(l.slice(2))}</h1>);
      i++;
    } else if (l.startsWith("## ")) {
      blocos.push(<h2 key={i}>{emLinha(l.slice(3))}</h2>);
      i++;
    } else if (l.startsWith("- ")) {
      const itens: string[] = [];
      const inicio = i;
      while (i < linhas.length && linhas[i]!.startsWith("- ")) itens.push(linhas[i++]!.slice(2));
      blocos.push(
        <ul key={inicio}>
          {itens.map((t, k) => (
            <li key={k}>{emLinha(t)}</li>
          ))}
        </ul>,
      );
    } else if (l.startsWith("|")) {
      const tabela: string[][] = [];
      const inicio = i;
      while (i < linhas.length && linhas[i]!.startsWith("|")) {
        if (!/^\|[\s|:-]+\|$/.test(linhas[i]!.trim())) tabela.push(celulas(linhas[i]!));
        i++;
      }
      const [cabecalho, ...corpo] = tabela;
      blocos.push(
        <div key={inicio} className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                {cabecalho?.map((c, k) => (
                  <th key={k}>{emLinha(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corpo.map((linha, r) => (
                <tr key={r}>
                  {linha.map((c, k) => (
                    <td key={k}>{emLinha(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else {
      const partes: string[] = [];
      const inicio = i;
      while (i < linhas.length && linhas[i]!.trim() && !/^(#|- |\|)/.test(linhas[i]!)) partes.push(linhas[i++]!);
      blocos.push(<p key={inicio}>{emLinha(partes.join(" "))}</p>);
    }
  }
  return <div className="documento">{blocos}</div>;
}
