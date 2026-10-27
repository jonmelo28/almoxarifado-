import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Boxes, ArrowRight, ShieldCheck } from "lucide-react";
import { useAuth } from "../contexts/Auth";
import { Field, Notice } from "../components/UI";
import { errorText } from "../services/api";
export default function Login() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, senha);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-screen">
      <section className="login-story">
        <Boxes size={52} />
        <div className="eyebrow">ALMOX · GESTÃO & OPERAÇÕES</div>
        <h1>
          Tudo no lugar.
          <br />
          Sua equipe em movimento.
        </h1>
        <p>
          Estoque sob controle, tarefas organizadas e cada operação com seu
          histórico.
        </p>
        <div className="login-note">
          <ShieldCheck size={22} /> Acesso seguro ao seu espaço de trabalho
        </div>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <span className="eyebrow">BEM-VINDO AO ALMOX</span>
          <h2>Acesse sua conta</h2>
          <p>Entre com suas credenciais corporativas.</p>
          <Notice error>{error}</Notice>
          <Field
            label="Email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            label="Senha"
            type="password"
            required
            maxLength={72}
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
          <button className="primary" disabled={busy}>
            {busy ? "Entrando…" : "Entrar no sistema"}
            <ArrowRight size={18} />
          </button>
          <small>Precisa de acesso? Solicite ao administrador.</small>
        </form>
      </section>
    </div>
  );
}
