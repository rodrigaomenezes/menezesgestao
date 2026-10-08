import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { Casca } from "./app/Casca";
import { ProvedorSessao, useSessao } from "./app/sessao";
import { ProvedorSobreposicoes } from "./ui/sobreposicoes";
import { Entrar } from "./features/acesso/Entrar";
import { EsqueciSenha } from "./features/acesso/EsqueciSenha";
import { RedefinirSenha } from "./features/acesso/RedefinirSenha";
import { AceitarConvite } from "./features/acesso/AceitarConvite";
import { Inicio } from "./features/inicio/Inicio";
import { Usuarios } from "./features/usuarios/Usuarios";
import { Equipes } from "./features/usuarios/Equipes";
import { Perfis } from "./features/permissoes/Perfis";
import { Unidades } from "./features/empresa/Unidades";
import { Empresa } from "./features/empresa/Empresa";
import { Auditoria } from "./features/auditoria/Auditoria";
import { Notificacoes } from "./features/notificacoes/Notificacoes";
import { Dispositivos } from "./features/conta/Dispositivos";
import { Contatos } from "./features/crm/Contatos";
import { Contato } from "./features/crm/Contato";
import { Funil } from "./features/crm/Funil";
import { Tarefas } from "./features/crm/Tarefas";
import { Importar } from "./features/crm/Importar";
import { ConfigCrm } from "./features/crm/ConfigCrm";
import "./app/estilos.css";

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
              <Route path="/contatos" element={<Contatos />} />
              <Route path="/contatos/:id" element={<Contato />} />
              <Route path="/funil" element={<Funil />} />
              <Route path="/tarefas" element={<Tarefas />} />
              <Route path="/importar" element={<Importar />} />
              <Route path="/crm/configuracoes" element={<ConfigCrm />} />
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
        <ProvedorSobreposicoes>
          <App />
        </ProvedorSobreposicoes>
      </ProvedorSessao>
    </BrowserRouter>
  </StrictMode>,
);
