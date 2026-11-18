"use client";
import { useState, useEffect, useCallback, type FormEvent } from "react";
import {
  ShieldCheck,
  LayoutDashboard,
  Building2,
  Files,
  Bell,
  Workflow,
  Users,
  History,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Download,
  ChevronDown,
  Check,
  Clock3,
  TriangleAlert,
  FileCheck2,
  LogOut,
  RefreshCw,
  PanelLeftClose,
  Menu,
  CheckCircle2,
  LockKeyhole,
  FileText,
  X,
  ExternalLink,
} from "lucide-react";
import { Dialog } from "./dialog";
import type {
  Organization,
  DashboardData,
  Company,
  Certificate,
  Role,
} from "@/lib/types";
import {
  TYPES,
  RESULTS,
  STATES,
  certificateState,
  latestCertificates,
} from "@/lib/domain.mjs";
type Tab =
  | "overview"
  | "companies"
  | "certificates"
  | "alerts"
  | "jobs"
  | "team"
  | "audit";
type Modal =
  | "organization"
  | "company"
  | "certificate"
  | "job"
  | "invite"
  | null;
const NAV = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "companies", label: "Empresas", icon: Building2 },
  { id: "certificates", label: "Certidões", icon: Files },
  { id: "alerts", label: "Central de alertas", icon: Bell },
  { id: "jobs", label: "Automações", icon: Workflow },
  { id: "team", label: "Equipe e acessos", icon: Users },
  { id: "audit", label: "Histórico de ações", icon: History },
] as const;
const STATUS: Record<string, { label: string; tone: string }> = {
  regular: { label: "Válida", tone: "green" },
  expiring: { label: "A vencer", tone: "amber" },
  expired: { label: "Vencida", tone: "red" },
  irregular: { label: "Positiva", tone: "red" },
  unknown: { label: "Não verificada", tone: "gray" },
};
const ROLE: Record<Role, string> = {
  admin: "Administrador",
  operator: "Operador",
  viewer: "Visualizador",
};
const fmt = (date: string) =>
  date
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(date.length === 10 ? date + "T12:00:00-03:00" : date))
    : "—";
const typeName = (t: string) => TYPES[t as keyof typeof TYPES] || t;
const resultName = (t: string) => RESULTS[t as keyof typeof RESULTS] || t;
const cnpjFmt = (v: string) =>
  v.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, "$1.$2.$3/$4-$5");
function Badge({ state }: { state: string }) {
  const s = STATUS[state] || STATUS.unknown;
  return (
    <span className={"badge " + s.tone}>
      <i />
      {s.label}
    </span>
  );
}
function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Files size={27} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Dashboard({ email }: { email: string }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]),
    [orgId, setOrgId] = useState(""),
    [data, setData] = useState<DashboardData | null>(null),
    [tab, setTab] = useState<Tab>("overview"),
    [modal, setModal] = useState<Modal>(null),
    [detail, setDetail] = useState<Certificate | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [formError, setFormError] = useState(""),
    [notice, setNotice] = useState(""),
    [mobile, setMobile] = useState(false),
    [inviteToken, setInviteToken] = useState(""),
    [inviteUrl, setInviteUrl] = useState(""),
    [documentUrl, setDocumentUrl] = useState(""),
    [team, setTeam] = useState<{
      members: { user_id: string; role: Role }[];
      invitations: {
        id: string;
        role: Role;
        expires_at: string;
        accepted_at: string | null;
      }[];
    } | null>(null);
  const organization = organizations.find((o) => o.id === orgId),
    canWrite = organization?.role !== "viewer";
  const api = useCallback(
    async (path: string, body?: unknown, org = orgId, signal?: AbortSignal) => {
      const r = await fetch("/api/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          "x-organization-id": org,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal,
      });
      const result = await r.json();
      if (!r.ok)
        throw new Error(
          result.error || "Não foi possível concluir a operação.",
        );
      return result;
    },
    [orgId],
  );
  const loadOrganizations = useCallback(async (select?: string) => {
    const r = await fetch("/api/me");
    const result = await r.json();
    if (!r.ok) throw new Error(result.error);
    setOrganizations(result.organizations);
    setOrgId((prev) => select || prev || result.organizations[0]?.id || "");
    setLoading(false);
  }, []);
  useEffect(() => {
    let active = true;
    loadOrganizations().catch((e) => {
      if (active) {
        setError(e.message);
        setLoading(false);
      }
    });
    const token = new URLSearchParams(window.location.search).get("invite");
    if (token) setInviteToken(token);
    return () => {
      active = false;
    };
  }, [loadOrganizations]);
  const refresh = useCallback(async () => {
    if (!orgId) return;
    const r = await api("dashboard");
    setData(r);
  }, [api, orgId]);
  useEffect(() => {
    if (!orgId) return;
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setTeam(null);
    setError("");
    setDetail(null);
    setModal(null);
    api("dashboard", undefined, orgId, controller.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [orgId, api]);
  useEffect(() => {
    if (tab !== "team" || !orgId || organization?.role !== "admin") return;
    const controller = new AbortController();
    api("team", undefined, orgId, controller.signal)
      .then(setTeam)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [tab, orgId, api, organization?.role]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  function navigate(next: Tab) {
    setTab(next);
    setSearch("");
    setFilter("all");
    setMobile(false);
    setError("");
  }
  function open(next: Modal) {
    setFormError("");
    setInviteUrl("");
    setModal(next);
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    const form = e.currentTarget,
      fields = Object.fromEntries(new FormData(form));
    try {
      if (modal === "organization") {
        const created = await api("organizations", fields);
        await loadOrganizations(created.id);
        setModal(null);
        setNotice("Ambiente criado. Cadastre a primeira empresa.");
        return;
      }
      if (modal === "invite") {
        const r = await api("invitations", fields);
        setInviteUrl(r.url);
        const updated = await api("team");
        setTeam(updated);
        return;
      }
      let payload: Record<string, unknown> = { ...fields };
      if (modal === "certificate") {
        const file = new FormData(form).get("file");
        delete payload.file;
        if (file instanceof File && file.size) {
          const upload = new FormData();
          upload.set("file", file);
          const r = await fetch("/api/documents", {
            method: "POST",
            headers: { "x-organization-id": orgId },
            body: upload,
          });
          const result = await r.json();
          if (!r.ok) throw new Error(result.error);
          payload.document_path = result.document_path;
        }
      }
      const path =
        modal === "company"
          ? "companies"
          : modal === "certificate"
            ? "certificates"
            : "jobs";
      await api(path, payload);
      await refresh();
      setModal(null);
      setNotice(
        modal === "job"
          ? "Solicitação registrada como bloqueada: nenhum conector está configurado."
          : "Registro salvo com sucesso.",
      );
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }
  async function exportCsv() {
    setBusy(true);
    try {
      const r = await fetch("/api/export", {
        headers: { "x-organization-id": orgId },
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "certidoes.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao exportar.");
    } finally {
      setBusy(false);
    }
  }
  async function acceptInvite() {
    setBusy(true);
    try {
      const r = await api("invitations/accept", { token: inviteToken });
      setInviteToken("");
      window.history.replaceState({}, "", "/");
      await loadOrganizations(r.organization_id);
      setNotice("Você entrou no ambiente.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Convite inválido.");
    } finally {
      setBusy(false);
    }
  }
  async function signout() {
    setBusy(true);
    try {
      await api("signout", {});
      window.location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao sair.");
      setBusy(false);
    }
  }
  async function viewDocument() {
    if (!detail) return;
    setBusy(true);
    try {
      const r = await api("documents?id=" + detail.id);
      setDocumentUrl(r.url);
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : "Falha ao abrir o documento.",
      );
    } finally {
      setBusy(false);
    }
  }
  const companies = data?.companies || [],
    certificates = data?.certificates || [];
  const current = latestCertificates(certificates) as Certificate[];
  const counts = {
    regular: 0,
    expiring: 0,
    expired: 0,
    irregular: 0,
    unknown: 0,
  };
  current.forEach((c) => {
    counts[certificateState(c, data?.today) as keyof typeof counts]++;
  });
  const alerts = current.filter(
    (c) => certificateState(c, data?.today) !== "regular",
  );
  const company = (id: string) => companies.find((c) => c.id === id);
  const noDocuments = companies.filter(
    (c) => !current.some((cert) => cert.company_id === c.id),
  );
  const matching = (c: Certificate) => {
    const state = certificateState(c, data?.today);
    return (
      (filter === "all" || filter === state) &&
      (
        company(c.company_id)?.name +
        " " +
        company(c.company_id)?.cnpj +
        " " +
        typeName(c.type)
      )
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  };
  function certTable(records: Certificate[]) {
    return records.length ? (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Empresa / CNPJ</th>
              <th>Certidão</th>
              <th>Situação</th>
              <th>Validade</th>
              <th>
                <span className="sr-only">Detalhes</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{company(c.company_id)?.name || "Empresa"}</strong>
                  <small>{cnpjFmt(company(c.company_id)?.cnpj || "")}</small>
                </td>
                <td>
                  <span className="file-type">
                    <FileText size={16} />
                    {typeName(c.type)}
                  </span>
                  <small>{resultName(c.result)}</small>
                </td>
                <td>
                  <Badge state={certificateState(c, data?.today)} />
                </td>
                <td>
                  <span
                    className={
                      certificateState(c, data?.today) === "expired"
                        ? "text-red"
                        : ""
                    }
                  >
                    {fmt(c.expires_at)}
                  </span>
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={
                      "Ver certidão de " + company(c.company_id)?.name
                    }
                    onClick={() => {
                      setDetail(c);
                      setFormError("");
                      setDocumentUrl("");
                    }}
                  >
                    <ArrowUpRight size={19} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty
        title="Nenhuma certidão encontrada"
        text={
          search || filter !== "all"
            ? "Ajuste os filtros para encontrar o que procura."
            : "Registre a primeira certidão para acompanhar o resultado e a validade."
        }
        action={
          canWrite && !search && filter === "all" ? (
            <button
              className="button secondary"
              disabled={!companies.length}
              onClick={() => open("certificate")}
            >
              <Plus size={16} /> Registrar certidão
            </button>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobile ? "mobile-open" : "")}>
        <a className="brand" href="/">
          <span className="brand-mark">
            <ShieldCheck size={23} />
          </span>
          certifica<span className="brand-dot">.</span>
        </a>
        <button
          className="mobile-close icon-button"
          onClick={() => setMobile(false)}
          aria-label="Fechar menu"
        >
          <X />
        </button>
        <div className="workspace-label">AMBIENTE DE TRABALHO</div>
        <div className="workspace-select">
          <span className="workspace-icon">
            <Building2 size={18} />
          </span>
          <select
            aria-label="Selecionar cliente"
            value={orgId}
            onChange={(e) => {
              if (e.target.value === "new") open("organization");
              else setOrgId(e.target.value);
            }}
          >
            {!organizations.length && (
              <option value="">Seu primeiro cliente</option>
            )}
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
            <option value="new">+ Criar ambiente</option>
          </select>
          <ChevronDown size={14} />
        </div>
        <nav aria-label="Menu principal">
          {NAV.filter(
            (n) => n.id !== "team" || organization?.role === "admin",
          ).map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? "nav-item selected" : "nav-item"}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === "alerts" && alerts.length > 0 && (
                <b className="nav-count">{alerts.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connector-note">
            <div>
              <span className="mini-dot amber-dot" />
              <strong>Conectores pendentes</strong>
            </div>
            <p>
              Configure as integrações para habilitar consultas automáticas.
            </p>
            <button onClick={() => navigate("jobs")}>
              Ver integrações <ArrowRight size={14} />
            </button>
          </div>
          <div className="profile">
            <span className="avatar">{email.slice(0, 2).toUpperCase()}</span>
            <div>
              <strong title={email}>{email}</strong>
              <small>
                {organization ? ROLE[organization.role] : "Sua conta"}
              </small>
            </div>
            <button
              className="icon-button"
              title="Sair"
              aria-label="Sair da conta"
              disabled={busy}
              onClick={signout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <div className="mobile-backdrop" onClick={() => setMobile(false)} />
      )}
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir menu"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span>/</span>
            <strong>{NAV.find((n) => n.id === tab)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="pill subtle">MVP · REGISTROS MANUAIS</span>
            <button
              className="icon-button notification-button"
              aria-label="Abrir alertas"
              onClick={() => navigate("alerts")}
            >
              <Bell size={20} />
              {alerts.length > 0 && <i />}
            </button>
            <span className="avatar small-avatar">
              {email.slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {organization?.name || "SEU NOVO ESPAÇO FISCAL"}
              </div>
              <h1>
                {tab === "overview"
                  ? "Sua operação, em dia."
                  : NAV.find((n) => n.id === tab)?.label}
              </h1>
              <p className="muted">
                {tab === "overview"
                  ? "Uma visão clara das certidões e dos próximos passos da sua carteira."
                  : tab === "companies"
                    ? "Organize os CNPJs que fazem parte deste ambiente."
                    : tab === "certificates"
                      ? "Resultados, documentos e validades em um só lugar."
                      : tab === "alerts"
                        ? "Priorize documentos vencidos, pendências e próximas renovações."
                        : tab === "jobs"
                          ? "Acompanhe as solicitações e a disponibilidade das integrações."
                          : tab === "team"
                            ? "Compartilhe este ambiente com as permissões adequadas."
                            : "Rastreabilidade das alterações e consultas deste ambiente."}
              </p>
            </div>
            <div className="heading-actions">
              {orgId && (
                <button
                  className="button secondary"
                  disabled={busy || !data}
                  onClick={exportCsv}
                >
                  <Download size={16} /> Exportar CSV
                </button>
              )}
              {canWrite && orgId && (
                <button
                  className="button primary"
                  onClick={() =>
                    open(
                      tab === "companies"
                        ? "company"
                        : tab === "jobs"
                          ? "job"
                          : tab === "team"
                            ? "invite"
                            : "certificate",
                    )
                  }
                  disabled={
                    tab !== "companies" && tab !== "team" && !companies.length
                  }
                >
                  <Plus size={17} />
                  {tab === "companies"
                    ? "Nova empresa"
                    : tab === "jobs"
                      ? "Solicitar consulta"
                      : tab === "team"
                        ? "Convidar pessoa"
                        : "Registrar certidão"}
                </button>
              )}
            </div>
          </div>
          {error && (
            <div className="banner error" role="alert">
              <TriangleAlert size={19} />
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dispensar erro"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {inviteToken && (
            <div className="banner">
              <Users size={20} />
              <span>
                Você recebeu um convite para participar de um ambiente.
              </span>
              <button
                className="button secondary"
                disabled={busy}
                onClick={acceptInvite}
              >
                Aceitar convite
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading">
              <RefreshCw className="spin" size={23} /> Carregando seu ambiente…
            </div>
          ) : !orgId ? (
            <section className="card onboarding">
              <span className="welcome-icon">
                <ShieldCheck size={35} />
              </span>
              <span className="eyebrow">COMECE POR AQUI</span>
              <h2>Um espaço para cada cliente.</h2>
              <p>
                Crie seu primeiro ambiente. Empresas, documentos e permissões
                ficam separados dos outros clientes da sua operação.
              </p>
              <button
                className="button primary"
                onClick={() => open("organization")}
              >
                <Plus size={17} /> Criar primeiro ambiente
              </button>
              <div className="onboarding-steps">
                <span>
                  <b>01</b> Crie um ambiente
                </span>
                <span>
                  <b>02</b> Cadastre os CNPJs
                </span>
                <span>
                  <b>03</b> Registre as certidões
                </span>
              </div>
            </section>
          ) : data ? (
            <>
              {tab === "overview" && (
                <>
                  <div className="metric-grid">
                    <Metric
                      label="Empresas na carteira"
                      value={companies.length}
                      sub="CNPJs neste ambiente"
                      icon={<Building2 />}
                      tone="purple"
                    />
                    <Metric
                      label="Certidões válidas"
                      value={counts.regular}
                      sub="Negativas ou com efeitos de negativa"
                      icon={<FileCheck2 />}
                      tone="green"
                    />
                    <Metric
                      label="A vencer em até 30 dias"
                      value={counts.expiring}
                      sub="Planeje as próximas renovações"
                      icon={<Clock3 />}
                      tone="amber"
                    />
                    <Metric
                      label="Precisam de atenção"
                      value={counts.expired + counts.irregular + counts.unknown}
                      sub="Vencidas, positivas ou não verificadas"
                      icon={<TriangleAlert />}
                      tone="red"
                    />
                  </div>
                  <div className="overview-grid">
                    <section className="card portfolio-card">
                      <div className="section-title">
                        <div>
                          <h2>Panorama da carteira</h2>
                          <p className="muted small">
                            Último registro de cada tipo por empresa
                          </p>
                        </div>
                        <span className="pill subtle">
                          {current.length} certidões
                        </span>
                      </div>
                      <div className="portfolio-body">
                        <div
                          className="donut"
                          style={{
                            background: current.length
                              ? `conic-gradient(#8b75ee 0deg ${(counts.regular / current.length) * 360}deg, #f4bb58 ${(counts.regular / current.length) * 360}deg ${((counts.regular + counts.expiring) / current.length) * 360}deg, #ef7c8e ${((counts.regular + counts.expiring) / current.length) * 360}deg 360deg)`
                              : "#272932",
                          }}
                        >
                          <div>
                            <strong>
                              {current.length
                                ? Math.round(
                                    (counts.regular / current.length) * 100,
                                  ) + "%"
                                : "—"}
                            </strong>
                            <span>válidas</span>
                          </div>
                        </div>
                        <div className="legend">
                          {[
                            ["Válidas", counts.regular, "purple"],
                            ["A vencer", counts.expiring, "amber"],
                            [
                              "Atenção",
                              counts.expired +
                                counts.irregular +
                                counts.unknown,
                              "red",
                            ],
                          ].map(([label, count, tone]) => (
                            <div key={label}>
                              <span>
                                <i className={"legend-dot " + tone} />
                                {label}
                              </span>
                              <strong>{count}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="card-foot">
                        <ShieldCheck size={15} />
                        <span>
                          O painel considera os registros cadastrados; não
                          atesta regularidade fiscal completa.
                        </span>
                      </div>
                    </section>
                    <section className="card next-card">
                      <div className="section-title">
                        <div>
                          <h2>Seu próximo passo</h2>
                          <p className="muted small">
                            Uma operação organizada começa aqui
                          </p>
                        </div>
                        <span className="step-icon">
                          <ArrowUpRight size={19} />
                        </span>
                      </div>
                      <div className="next-steps">
                        <button onClick={() => navigate("companies")}>
                          <span
                            className={
                              "step-number " + (companies.length ? "done" : "")
                            }
                          >
                            {companies.length ? <Check size={15} /> : "1"}
                          </span>
                          <span>
                            <strong>Cadastre suas empresas</strong>
                            <small>
                              {companies.length
                                ? companies.length + " CNPJs cadastrados"
                                : "Adicione matriz e filiais ao ambiente"}
                            </small>
                          </span>
                          <ArrowRight size={16} />
                        </button>
                        <button onClick={() => navigate("certificates")}>
                          <span
                            className={
                              "step-number " +
                              (certificates.length ? "done" : "")
                            }
                          >
                            {certificates.length ? <Check size={15} /> : "2"}
                          </span>
                          <span>
                            <strong>Organize as certidões</strong>
                            <small>
                              {certificates.length
                                ? certificates.length +
                                  " registros no histórico"
                                : "Registre documentos e datas de validade"}
                            </small>
                          </span>
                          <ArrowRight size={16} />
                        </button>
                        <button onClick={() => navigate("jobs")}>
                          <span className="step-number">3</span>
                          <span>
                            <strong>Prepare as integrações</strong>
                            <small>Escolha os portais fiscais do piloto</small>
                          </span>
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </section>
                  </div>
                  <section className="card">
                    <div className="section-title">
                      <div>
                        <h2>Certidões em acompanhamento</h2>
                        <p className="muted small">
                          Últimos documentos de cada empresa e tipo
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => navigate("certificates")}
                      >
                        Ver todas <ArrowRight size={15} />
                      </button>
                    </div>
                    {certTable(current.slice(0, 6))}
                  </section>
                  <div className="bottom-note">
                    <LockKeyhole size={14} /> Dados deste ambiente acessíveis
                    apenas à equipe autorizada.
                  </div>
                </>
              )}
              {tab === "companies" && (
                <section className="card">
                  <Toolbar
                    search={search}
                    setSearch={setSearch}
                    placeholder="Buscar empresa ou CNPJ"
                    count={companies.length}
                  />
                  {companies.length ? (
                    <div className="company-grid">
                      {companies
                        .filter((c) =>
                          (c.name + " " + c.cnpj)
                            .toLowerCase()
                            .includes(
                              search.toLowerCase().replace(/[.\/-]/g, ""),
                            ),
                        )
                        .map((c) => (
                          <article className="company-card" key={c.id}>
                            <div className="company-head">
                              <span className="company-icon">
                                <Building2 size={21} />
                              </span>
                              <span className="pill subtle">{c.state}</span>
                            </div>
                            <h3>{c.name}</h3>
                            <p className="mono muted">{cnpjFmt(c.cnpj)}</p>
                            <p className="muted small">
                              {c.city} · {c.state}
                            </p>
                            <div className="company-card-foot">
                              <span>
                                {
                                  current.filter(
                                    (cert) => cert.company_id === c.id,
                                  ).length
                                }{" "}
                                tipos registrados
                              </span>
                              <button
                                className="text-button"
                                onClick={() => {
                                  navigate("certificates");
                                  setSearch(c.cnpj);
                                }}
                              >
                                Ver certidões <ArrowUpRight size={15} />
                              </button>
                            </div>
                          </article>
                        ))}
                    </div>
                  ) : (
                    <Empty
                      title="Sua carteira começa aqui"
                      text="Cadastre o primeiro CNPJ para organizar certidões e acompanhar os vencimentos."
                      action={
                        canWrite ? (
                          <button
                            className="button primary"
                            onClick={() => open("company")}
                          >
                            <Plus size={16} /> Cadastrar empresa
                          </button>
                        ) : undefined
                      }
                    />
                  )}
                </section>
              )}
              {tab === "certificates" && (
                <section className="card">
                  <Toolbar
                    search={search}
                    setSearch={setSearch}
                    placeholder="Buscar empresa, CNPJ ou certidão"
                    count={certificates.length}
                  >
                    <select
                      aria-label="Filtrar situação"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">Todas as situações</option>
                      {Object.entries(STATUS).map(([key, s]) => (
                        <option key={key} value={key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </Toolbar>
                  <div className="table-note">
                    Histórico completo: um novo registro preserva os documentos
                    anteriores.
                  </div>
                  {certTable(certificates.filter(matching))}
                </section>
              )}
              {tab === "alerts" && (
                <>
                  <div className="banner">
                    <Bell size={19} />
                    <span>
                      Alertas exibidos neste painel. Envio automático por e-mail
                      ainda não configurado.
                    </span>
                  </div>
                  <section className="card">
                    <div className="section-title">
                      <div>
                        <h2>Documentos que precisam de atenção</h2>
                        <p className="muted small">
                          Último registro de cada tipo por empresa
                        </p>
                      </div>
                      <span className="pill subtle">
                        {alerts.length} alertas
                      </span>
                    </div>
                    {alerts.length ? (
                      certTable(alerts)
                    ) : (
                      <Empty
                        title="Sem alertas de documentos"
                        text={
                          current.length
                            ? "As certidões registradas não apresentam alertas no momento."
                            : "Cadastre certidões para que o sistema identifique os vencimentos e as pendências."
                        }
                      />
                    )}
                  </section>
                  {noDocuments.length > 0 && (
                    <section className="card gap-top">
                      <div className="section-title">
                        <div>
                          <h2>Empresas sem certidões</h2>
                          <p className="muted small">
                            Ausência de documentos não significa regularidade.
                          </p>
                        </div>
                        <span className="pill subtle">
                          {noDocuments.length}
                        </span>
                      </div>
                      {noDocuments.map((c) => (
                        <div className="list-row" key={c.id}>
                          <Building2 size={18} />
                          <strong>{c.name}</strong>
                          <Badge state="unknown" />
                        </div>
                      ))}
                    </section>
                  )}
                </>
              )}
              {tab === "jobs" && (
                <>
                  <div className="banner warning">
                    <Workflow size={20} />
                    <span>
                      <strong>Nenhum conector fiscal está ativo.</strong> As
                      solicitações são registradas como bloqueadas, sem
                      consultar portais ou alterar resultados.
                    </span>
                  </div>
                  <div className="integration-grid">
                    {Object.entries(TYPES).map(([key, label]) => (
                      <div className="card integration" key={key}>
                        <span className="integration-icon">
                          <Workflow size={22} />
                        </span>
                        <h3>{label}</h3>
                        <span className="badge gray">
                          <i />
                          Não configurado
                        </span>
                        <p className="muted small">
                          Integração pendente de seleção e validação do provedor
                          ou portal.
                        </p>
                      </div>
                    ))}
                  </div>
                  <section className="card gap-top">
                    <div className="section-title">
                      <div>
                        <h2>Histórico de solicitações</h2>
                        <p className="muted small">
                          Até 100 registros mais recentes
                        </p>
                      </div>
                    </div>
                    {data.jobs.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Empresa</th>
                              <th>Tipo</th>
                              <th>Resultado da execução</th>
                              <th>Data</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.jobs.map((j) => (
                              <tr key={j.id}>
                                <td>
                                  <strong>{company(j.company_id)?.name}</strong>
                                </td>
                                <td>{typeName(j.type)}</td>
                                <td>
                                  <span className="badge amber">
                                    <i />
                                    Bloqueada
                                  </span>
                                  <small>{j.message}</small>
                                </td>
                                <td>{fmt(j.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="Sem solicitações por enquanto"
                        text="O histórico mostrará cada tentativa, inclusive as que não puderem ser executadas."
                      />
                    )}
                  </section>
                </>
              )}
              {tab === "team" && (
                <section className="card">
                  <div className="section-title">
                    <div>
                      <h2>Equipe deste ambiente</h2>
                      <p className="muted small">
                        Convites de uso único, válidos por 48 horas
                      </p>
                    </div>
                  </div>
                  {team ? (
                    <>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Identificador do usuário</th>
                              <th>Perfil</th>
                            </tr>
                          </thead>
                          <tbody>
                            {team.members.map((m) => (
                              <tr key={m.user_id}>
                                <td className="mono">{m.user_id}</td>
                                <td>{ROLE[m.role]}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="section-title border-top">
                        <h2>Convites</h2>
                      </div>
                      {team.invitations.length ? (
                        team.invitations.map((i) => (
                          <div className="list-row" key={i.id}>
                            <Users size={18} />
                            <strong>{ROLE[i.role]}</strong>
                            <span className="muted small">
                              {i.accepted_at
                                ? "Aceito"
                                : new Date(i.expires_at) < new Date()
                                  ? "Expirado"
                                  : "Pendente"}{" "}
                              · validade {fmt(i.expires_at)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="table-note">Nenhum convite criado.</div>
                      )}
                    </>
                  ) : (
                    <div className="loading">Carregando equipe…</div>
                  )}
                </section>
              )}
              {tab === "audit" && (
                <section className="card">
                  <div className="section-title">
                    <div>
                      <h2>Trilha de auditoria</h2>
                      <p className="muted small">
                        Até 100 ações mais recentes · registros gerados pelo
                        banco
                      </p>
                    </div>
                  </div>
                  {data.events.length ? (
                    <div className="timeline">
                      {data.events.map((event) => (
                        <div className="timeline-row" key={event.id}>
                          <span className="timeline-icon">
                            <History size={16} />
                          </span>
                          <div>
                            <strong>{event.action}</strong>
                            <p className="muted small">{event.subject}</p>
                          </div>
                          <time>
                            {fmt(event.created_at)} ·{" "}
                            {new Date(event.created_at).toLocaleTimeString(
                              "pt-BR",
                              {
                                timeZone: "America/Sao_Paulo",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </time>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="Nenhuma ação registrada"
                      text="Os próximos cadastros e solicitações aparecerão aqui."
                    />
                  )}
                </section>
              )}
            </>
          ) : !error ? (
            <Empty
              title="Não foi possível carregar o ambiente"
              text="Tente atualizar a página."
            />
          ) : null}
        </main>
        <footer className="main-footer">
          <span>Certifica · Regularidade fiscal</span>
          <span>Feito para uma operação mais tranquila.</span>
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {notice}
          <button
            className="icon-button"
            aria-label="Fechar aviso"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <Dialog
          title={
            modal === "organization"
              ? "Novo ambiente"
              : modal === "company"
                ? "Cadastrar empresa"
                : modal === "certificate"
                  ? "Registrar certidão"
                  : modal === "job"
                    ? "Solicitar consulta"
                    : "Convidar pessoa"
          }
          description={
            modal === "organization"
              ? "Crie um espaço separado para os dados de um cliente."
              : modal === "certificate"
                ? "Registro manual. Confira os dados diretamente no documento."
                : modal === "job"
                  ? "Sem conector configurado, a consulta será registrada como bloqueada."
                  : modal === "invite"
                    ? "Compartilhe o link apenas com a pessoa que deve receber este acesso."
                    : undefined
          }
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          <form onSubmit={submit}>
            {modal === "organization" && (
              <label>
                Nome do ambiente
                <input
                  name="name"
                  placeholder="Ex.: Contabilidade Horizonte"
                  required
                  minLength={2}
                  maxLength={100}
                />
              </label>
            )}
            {modal === "company" && (
              <>
                <label>
                  Razão social
                  <input
                    name="name"
                    placeholder="Nome da empresa"
                    required
                    minLength={2}
                    maxLength={150}
                  />
                </label>
                <label>
                  CNPJ
                  <input
                    name="cnpj"
                    placeholder="00.000.000/0000-00"
                    required
                    maxLength={18}
                    autoCapitalize="characters"
                  />
                  <small className="muted">
                    Aceita CNPJ numérico e alfanumérico.
                  </small>
                </label>
                <div className="form-columns">
                  <label>
                    Estado
                    <select name="state" required defaultValue="">
                      <option value="" disabled>
                        Selecione
                      </option>
                      {STATES.map((s: string) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Município
                    <input
                      name="city"
                      required
                      minLength={2}
                      maxLength={100}
                      placeholder="Cidade"
                    />
                  </label>
                </div>
              </>
            )}
            {(modal === "certificate" || modal === "job") && (
              <>
                <label>
                  Empresa
                  <select name="company_id" required defaultValue="">
                    <option value="" disabled>
                      Selecione uma empresa
                    </option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {cnpjFmt(c.cnpj)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tipo de certidão
                  <select name="type" required defaultValue="federal">
                    {Object.entries(TYPES).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {modal === "certificate" && (
              <>
                <label>
                  Resultado do documento
                  <select name="result" required defaultValue="nao_verificada">
                    {Object.entries(RESULTS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-columns">
                  <label>
                    Data de emissão
                    <input
                      type="date"
                      name="issued_at"
                      required
                      max={data?.today}
                    />
                  </label>
                  <label>
                    Válida até
                    <input type="date" name="expires_at" required />
                  </label>
                </div>
                <label>
                  Número ou referência
                  <input
                    name="reference"
                    placeholder="Número de controle da certidão"
                    required
                    maxLength={200}
                  />
                </label>
                <label>
                  Documento PDF <span className="muted">(opcional)</span>
                  <input
                    type="file"
                    name="file"
                    accept="application/pdf,.pdf"
                  />
                  <small className="muted">
                    Até 4 MB. Armazenamento privado.
                  </small>
                </label>
                <label>
                  Observações <span className="muted">(opcional)</span>
                  <textarea
                    name="notes"
                    rows={3}
                    maxLength={2000}
                    placeholder="Informações úteis para a equipe"
                  />
                </label>
              </>
            )}
            {modal === "invite" && (
              <>
                <label>
                  Perfil de acesso
                  <select name="role" defaultValue="viewer">
                    <option value="viewer">
                      Visualizador — apenas leitura
                    </option>
                    <option value="operator">
                      Operador — leitura e cadastros
                    </option>
                  </select>
                </label>
                {inviteUrl && (
                  <div className="invite-result">
                    <strong>Convite criado</strong>
                    <p className="small muted">
                      Copie e compartilhe este link. Ele permite entrada no
                      ambiente e só aparece nesta tela.
                    </p>
                    <input
                      aria-label="Link do convite"
                      value={inviteUrl}
                      readOnly
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      className="button secondary"
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(inviteUrl);
                          setNotice("Link copiado.");
                        } catch {
                          setFormError("Selecione e copie o link manualmente.");
                        }
                      }}
                    >
                      Copiar link
                    </button>
                  </div>
                )}
              </>
            )}
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Fechar
              </button>
              {!inviteUrl && (
                <button className="button primary" disabled={busy}>
                  {busy
                    ? "Salvando…"
                    : modal === "invite"
                      ? "Gerar convite"
                      : modal === "job"
                        ? "Registrar solicitação"
                        : modal === "organization"
                          ? "Criar ambiente"
                          : "Salvar registro"}
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          </form>
        </Dialog>
      )}
      {detail && (
        <Dialog
          title="Detalhes da certidão"
          description={company(detail.company_id)?.name}
          onClose={() => setDetail(null)}
        >
          <div className="detail-heading">
            <span className="file-type">
              <FileText size={21} />
              {typeName(detail.type)}
            </span>
            <Badge state={certificateState(detail, data?.today)} />
          </div>
          <dl className="details">
            <div>
              <dt>Resultado informado</dt>
              <dd>{resultName(detail.result)}</dd>
            </div>
            <div>
              <dt>Emissão</dt>
              <dd>{fmt(detail.issued_at)}</dd>
            </div>
            <div>
              <dt>Validade</dt>
              <dd>{fmt(detail.expires_at)}</dd>
            </div>
            <div>
              <dt>Número / referência</dt>
              <dd>{detail.reference}</dd>
            </div>
            <div>
              <dt>Origem</dt>
              <dd>Registro manual</dd>
            </div>
            <div>
              <dt>Registrada em</dt>
              <dd>{fmt(detail.created_at)}</dd>
            </div>
            {detail.notes && (
              <div>
                <dt>Observações</dt>
                <dd>{detail.notes}</dd>
              </div>
            )}
          </dl>
          {detail.document_path ? (
            <div className="dialog-actions">
              {documentUrl ? (
                <a
                  className="button primary"
                  href={documentUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir PDF <ExternalLink size={16} />
                </a>
              ) : (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={viewDocument}
                >
                  Gerar acesso ao PDF <LockKeyhole size={16} />
                </button>
              )}
              <small className="muted">
                Link de acesso válido por 60 segundos.
              </small>
            </div>
          ) : (
            <p className="small muted">Nenhum PDF anexado a este registro.</p>
          )}
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <section className="card metric">
      <div className="metric-top">
        <span>{label}</span>
        <span className={"metric-icon " + tone}>{icon}</span>
      </div>
      <strong className="metric-value">
        {value.toString().padStart(2, "0")}
      </strong>
      <p className="muted">{sub}</p>
    </section>
  );
}
function Toolbar({
  search,
  setSearch,
  placeholder,
  count,
  children,
}: {
  search: string;
  setSearch: (s: string) => void;
  placeholder: string;
  count: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="toolbar">
      <label className="search">
        <Search size={17} />
        <input
          aria-label={placeholder}
          placeholder={placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="toolbar-right">
        {children}
        <span className="muted small">{count} registros</span>
      </div>
    </div>
  );
}
