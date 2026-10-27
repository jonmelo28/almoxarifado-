import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  Boxes,
  LayoutDashboard,
  Package,
  ArrowLeftRight,
  Users,
  CalendarDays,
  BarChart3,
  ShieldCheck,
  Settings,
  LogOut,
  Menu,
  Link as LinkIcon,
} from "lucide-react";
import { useAuth } from "../contexts/Auth";
import { api, errorText } from "../services/api";
import { Modal, Notice } from "../components/UI";
export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(null);
  const [error, setError] = useState("");
  const links = [
    ["/", "Visão geral", LayoutDashboard],
    ["/materiais", "Materiais", Package],
    ["/movimentacoes", "Movimentações", ArrowLeftRight],
    ["/tarefas", "Agenda de tarefas", CalendarDays],
    ...(user.papel !== "COLABORADOR"
      ? [
          ["/usuarios", "Colaboradores", Users],
          ["/tarefas/planejamento", "Planejamento diário", CalendarDays],
          ["/relatorios", "Relatórios", BarChart3],
        ]
      : []),
    ...(user.papel === "ADM"
      ? [
          ["/auditoria", "Auditoria", ShieldCheck],
          ["/configuracoes", "Configurações", Settings],
          ["/permissoes-bot", "Permissões do bot", ShieldCheck],
        ]
      : []),
  ];
  async function link() {
    try {
      setToken((await api.post("/auth/telegram-token")).data.token);
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-icon">
            <Boxes size={28} />
          </div>
          <div>
            Almox<span>GESTÃO & OPERAÇÕES</span>
          </div>
        </div>
        <div className="nav-label">ESPAÇO DE TRABALHO</div>
        <nav>
          {links.map(([to, label, Icon]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setOpen(false)}
            >
              <Icon size={19} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-dot" /> Ambiente local{" "}
          <small>Dados integrados em tempo real</small>
        </div>
      </aside>
      <div className="main-shell">
        <header>
          <div className="header-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir menu"
              onClick={() => setOpen(!open)}
            >
              <Menu />
            </button>
            <span>
              Workspace <b>/ Operações</b>
            </span>
          </div>
          <div className="profile">
            <div className="avatar">{user.nome.slice(0, 1)}</div>
            <div>
              <strong>{user.nome}</strong>
              <small>{user.papel}</small>
            </div>
            <button
              className="icon-button"
              title="Vincular Telegram"
              aria-label="Vincular Telegram"
              onClick={link}
            >
              <LinkIcon size={18} />
            </button>
            <button
              className="icon-button"
              title="Sair"
              aria-label="Sair"
              onClick={() => logout().catch((e) => setError(errorText(e)))}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main>
          <Notice error>{error}</Notice>
          <Outlet />
        </main>
        <footer>Almox · Controle, rastreabilidade e organização.</footer>
      </div>
      {token && (
        <Modal title="Vincular Telegram" onClose={() => setToken(null)}>
          <p>
            No chat privado do seu bot, envie o comando abaixo. O token vale por
            10 minutos e pode ser usado uma vez. Copie e envie o comando
            completo; clicar apenas em /vincular no Telegram não envia o código.
          </p>
          <code className="token">/vincular {token}</code>
          <button
            onClick={() =>
              navigator.clipboard
                .writeText(`/vincular ${token}`)
                .catch(() => setError("Copie o comando manualmente."))
            }
          >
            Copiar comando
          </button>
        </Modal>
      )}
    </div>
  );
}
