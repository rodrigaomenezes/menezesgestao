// Tema por empresa: as cores da marca viram variáveis CSS; o texto sobre elas tem contraste verificado.
import { corDoTextoSobre, type Marca } from "@mg/shared";

export function aplicarMarca(marca: Marca & { nomeProduto?: string }): void {
  const raiz = document.documentElement.style;
  raiz.setProperty("--cor-primaria", marca.corPrimaria);
  raiz.setProperty("--cor-primaria-texto", corDoTextoSobre(marca.corPrimaria));
  raiz.setProperty("--cor-destaque", marca.corDestaque);
  raiz.setProperty("--cor-destaque-texto", corDoTextoSobre(marca.corDestaque));
  if (marca.nomeProduto) document.title = marca.nomeProduto;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", marca.corPrimaria);
}
