"use client";
import { useState, type FormEvent } from "react";
import {
  ShieldCheck,
  ArrowRight,
  Check,
  LockKeyhole,
  Building2,
  FileCheck2,
} from "lucide-react";
export function AuthScreen({ configured }: { configured: boolean }) {
  const [mode, setMode] = useState<"login" | "register">("login"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    const b = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...b, mode }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (d.signed_in) window.location.reload();
      else setMessage(d.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao entrar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <a className="brand" href="/">
          <span className="brand-mark">
            <ShieldCheck size={24} />
          </span>
          certifica<span className="brand-dot">.</span>
        </a>
        <div className="story-content">
          <span className="eyebrow">REGULARIDADE FISCAL, COM CLAREZA</span>
          <h1>
            Mais controle.
            <br />
            Menos surpresas.
          </h1>
          <p>
            Acompanhe empresas, organize certidões e enxergue o que precisa de
            atenção em um único lugar.
          </p>
          <div className="story-points">
            <span>
              <Check /> Ambientes separados para cada cliente
            </span>
            <span>
              <Check /> Vencimentos sempre à vista
            </span>
            <span>
              <Check /> Histórico de ações da equipe
            </span>
          </div>
          <div className="story-visual">
            <div>
              <Building2 />
              <span>Sua carteira de empresas</span>
              <span className="mini-dot" />
            </div>
            <div>
              <FileCheck2 />
              <span>Documentos organizados</span>
              <Check size={17} />
            </div>
            <div>
              <LockKeyhole />
              <span>Acesso por permissão</span>
              <Check size={17} />
            </div>
          </div>
        </div>
        <small>Informação organizada para decisões mais seguras.</small>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <span className="pill">CERTIFICA · PRIMEIRA VERSÃO</span>
          <h2>
            {configured
              ? mode === "login"
                ? "Bem-vindo de volta"
                : "Comece sua operação"
              : "Seu ambiente está sendo preparado"}
          </h2>
          <p className="muted">
            {configured
              ? mode === "login"
                ? "Entre para acompanhar sua carteira fiscal."
                : "Crie sua conta e organize o primeiro cliente."
              : "A aplicação está instalada. Falta conectar o projeto Supabase para habilitar contas e dados reais."}
          </p>
          {configured ? (
            <>
              <div className="auth-tabs">
                <button
                  className={mode === "login" ? "active" : ""}
                  onClick={() => {
                    setMode("login");
                    setError("");
                    setMessage("");
                  }}
                >
                  Entrar
                </button>
                <button
                  className={mode === "register" ? "active" : ""}
                  onClick={() => {
                    setMode("register");
                    setError("");
                    setMessage("");
                  }}
                >
                  Criar conta
                </button>
              </div>
              <form onSubmit={submit}>
                <label>
                  E-mail
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="voce@empresa.com.br"
                    maxLength={254}
                    required
                  />
                </label>
                <label>
                  Senha
                  <input
                    name="password"
                    type="password"
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    minLength={mode === "register" ? 12 : 1}
                    maxLength={128}
                    placeholder={
                      mode === "register"
                        ? "No mínimo 12 caracteres"
                        : "Sua senha"
                    }
                    required
                  />
                </label>
                {error && (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                )}
                {message && (
                  <p role="status" className="form-success">
                    {message}
                  </p>
                )}
                <button className="button primary full" disabled={busy}>
                  {busy
                    ? "Aguarde…"
                    : mode === "login"
                      ? "Acessar meu ambiente"
                      : "Criar minha conta"}
                  <ArrowRight size={17} />
                </button>
              </form>
              <p className="small muted">
                O cadastro pode exigir confirmação por e-mail. Convites de
                equipe devem ser abertos após entrar na conta.
              </p>
            </>
          ) : (
            <div className="setup-card">
              <LockKeyhole />
              <div>
                <strong>Conexão pendente</strong>
                <p>
                  O acesso será liberado quando a configuração do banco estiver
                  concluída.
                </p>
              </div>
            </div>
          )}
          <div className="auth-foot">
            <ShieldCheck size={15} /> Dados protegidos por autenticação e
            permissões de acesso
          </div>
        </div>
      </section>
    </main>
  );
}
