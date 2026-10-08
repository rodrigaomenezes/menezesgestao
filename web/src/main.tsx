import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { Casca } from "./componentes/Casca";
import { ProvedorSessao, useSessao } from "./sessao";
import { Entrar } from "./paginas/Entrar";
import { EsqueciSenha } from "./paginas/EsqueciSenha";
import { RedefinirSenha } from "./paginas/RedefinirSenha";
import { AceitarConvite } from "./paginas/AceitarConvite";
import { Inicio } from "./paginas/Inicio";
import { Usuarios } from "./paginas/Usuarios";
import { Equipes } from "./paginas/Equipes";
import { Perfis } from "./paginas/Perfis";
import { Unidades } from "./paginas/Unidades";
import { Empresa } from "./paginas/Empresa";
import { Auditoria } from "./paginas/Auditoria";
import { Notificacoes } from "./paginas/Notificacoes";
import { Dispositivos } from "./paginas/Dispositivos";
import "./estilos.css";

function App() {
  const { eu, carregando } = useSessao();
  if (carregando) return <p className="carregando">Carregando…</p>;

  // Telas abertas (convite e senha) funcionam com ou sem sessão.
  const abertas = [
    <Route key="convite" path="/convite" element={<AceitarConvite />} />,
    <Route key="redefinir" path="/redefinir-senha" element={<RedefinirSenha />} />,
  ];

  if (!eu) {
    return (
      <Routes>
        {abertas}
        <Route path="/esqueci-senha" element={<EsqueciSenha />} />
        <Route path="*" element={<Entrar />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {abertas}
      <Route
        path="*"
        element={
          <Casca>
            <Routes>
              <Route path="/" element={<Inicio />} />
              <Route path="/usuarios" element={<Usuarios />} />
              <Route path="/equipes" element={<Equipes />} />
              <Route path="/perfis" element={<Perfis />} />
              <Route path="/unidades" element={<Unidades />} />
              <Route path="/empresa" element={<Empresa />} />
              <Route path="/auditoria" element={<Auditoria />} />
              <Route path="/notificacoes" element={<Notificacoes />} />
              <Route path="/dispositivos" element={<Dispositivos />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Casca>
        }
      />
    </Routes>
  );
}

registerSW({ immediate: true });

const raiz = document.getElementById("raiz");
if (!raiz) throw new Error("Elemento #raiz não encontrado");
createRoot(raiz).render(
  <StrictMode>
    <BrowserRouter>
      <ProvedorSessao>
        <App />
      </ProvedorSessao>
    </BrowserRouter>
  </StrictMode>,
);
