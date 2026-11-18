"use client";
import { useState, useEffect, useCallback, type FormEvent } from "react";
import {
  Plus,
  Mail,
  ArrowUpRight,
  Download,
  Workflow,
  CheckCircle2,
  Clock3,
  TriangleAlert,
  FileSpreadsheet,
  RefreshCw,
  Search,
  ClipboardList,
  ArrowRight,
} from "lucide-react";
import { Dialog } from "./dialog";
import type { Company, Role } from "@/lib/types";
import { today } from "@/lib/domain.mjs";
export type ModuleTab = "inbox" | "reconciliation" | "erp" | "obligations";
type Entry = {
  id: string;
  company_id: string;
  subject: string;
  source?: string;
  body?: string;
  received_at?: string;
  due_at: string | null;
  status: string;
  assignee: string;
  notes: string;
  type?: string;
  reference?: string;
  created_at: string;
};
type StockItem = {
  code: string;
  fiscal_unit: string | null;
  erp_unit: string | null;
  fiscal_quantity: string | null;
  erp_quantity: string | null;
  difference: string | null;
  status: string;
};
type Comparison = {
  id: string;
  company_id: string;
  inventory_date: string;
  fiscal_filename: string;
  erp_filename: string;
  total_count: number;
  matched_count: number;
  excluded_count: number;
  created_at: string;
  items?: StockItem[];
};
type Routine = {
  id: string;
  company_id: string;
  name: string;
  system: string;
  operation: string;
  steps: string[];
  notes: string;
};
type Run = {
  id: string;
  routine_id: string;
  status: string;
  message: string;
  created_at: string;
};
const STATUS: Record<string, string> = {
  new: "Nova",
  in_review: "Em análise",
  resolved: "Resolvida",
  pending: "Pendente",
  in_progress: "Em andamento",
  done: "Concluída",
};
const STOCK: Record<string, string> = {
  matched: "Confere",
  quantity_mismatch: "Quantidade diferente",
  unit_mismatch: "Unidade diferente",
  only_fiscal: "Somente na EFD",
  only_erp: "Somente no ERP",
  negative_stock: "Estoque negativo",
};
const OPERATIONS: Record<string, string> = {
  extract: "Extração de dados",
  insert: "Inserção de dados",
  invoice: "Faturamento / DANFE",
  reconcile: "Conciliação",
};
const format = (s: string | null) =>
  s
    ? new Date(s.length === 10 ? s + "T12:00:00-03:00" : s).toLocaleDateString(
        "pt-BR",
        { timeZone: "America/Sao_Paulo" },
      )
    : "Sem prazo";
const MODULES = [
  {
    id: "inbox",
    title: "Caixa postal fiscal",
    text: "Organize notificações, responsáveis e prazos.",
    icon: Mail,
    field: "inbox",
    action: "Ver mensagens",
  },
  {
    id: "reconciliation",
    title: "Conciliação de estoque",
    text: "Compare o inventário da EFD com o ERP.",
    icon: FileSpreadsheet,
    field: "reconciliations",
    action: "Conciliar arquivos",
  },
  {
    id: "obligations",
    title: "Obrigações e consultas",
    text: "Acompanhe ITR, ISS, SUFRAMA e outras entregas.",
    icon: ClipboardList,
    field: "obligations",
    action: "Ver obrigações",
  },
  {
    id: "erp",
    title: "Rotinas de ERP",
    text: "Documente processos de SAP e Protheus.",
    icon: Workflow,
    field: "routines",
    action: "Ver rotinas",
  },
] as const;
export function ModuleOverview({
  orgId,
  navigate,
}: {
  orgId: string;
  navigate: (tab: ModuleTab) => void;
}) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/modules/summary", {
      headers: { "x-organization-id": orgId },
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setCounts(await r.json());
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(true);
      });
    return () => controller.abort();
  }, [orgId]);
  return (
    <section className="module-overview">
      <div className="section-title module-section-title">
        <div>
          <h2>Uma operação completa, por módulos</h2>
          <p className="muted small">Escolha o que você precisa fazer agora.</p>
        </div>
      </div>
      <div className="module-grid">
        {MODULES.map((m) => (
          <button
            className="card module-card"
            key={m.id}
            onClick={() => navigate(m.id)}
          >
            <span className="module-card-icon">
              <m.icon size={22} />
            </span>
            <span className="module-card-title">{m.title}</span>
            <span className="muted small">{m.text}</span>
            <span className="module-card-footer">
              <span>
                {counts
                  ? `${counts[m.field]} ${m.id === "inbox" || m.id === "obligations" ? "pendentes" : "registros"}`
                  : error
                    ? "Contagem indisponível"
                    : "Carregando…"}
              </span>
              <ArrowRight size={16} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
export function OperationalModule({
  selected,
  orgId,
  companies,
  role,
  onChange,
  onAddCompany,
}: {
  selected: ModuleTab;
  orgId: string;
  companies: Company[];
  role: Role;
  onChange: () => Promise<void>;
  onAddCompany: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [comparisons, setComparisons] = useState<Comparison[]>([]),
    [routines, setRoutines] = useState<Routine[]>([]),
    [runs, setRuns] = useState<Run[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [formError, setFormError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [formOpen, setFormOpen] = useState(false),
    [editing, setEditing] = useState<Entry | null>(null),
    [comparison, setComparison] = useState<Comparison | null>(null),
    [routine, setRoutine] = useState<Routine | null>(null);
  const canWrite = role !== "viewer",
    companyName = (id: string) =>
      companies.find((c) => c.id === id)?.name || "Empresa";
  const api = useCallback(
    async (path: string, body?: unknown, signal?: AbortSignal) => {
      const r = await fetch("/api/modules/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "x-organization-id": orgId,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal,
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(data.error || "Não foi possível concluir a operação.");
      return data;
    },
    [orgId],
  );
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const path = selected === "reconciliation" ? "reconciliations" : selected;
      const result = await api(path, undefined, signal);
      if (signal?.aborted) return;
      if (selected === "erp") {
        setRoutines(result.routines);
        setRuns(result.runs);
      } else if (selected === "reconciliation") setComparisons(result.records);
      else setEntries(result.records);
    },
    [api, selected],
  );
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load]);
  async function read(file: FormDataEntryValue | null) {
    if (!(file instanceof File) || !file.size || file.size > 1048576)
      throw new Error("Selecione um arquivo de até 1 MB para cada origem.");
    const bytes = await file.arrayBuffer();
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    const form = new FormData(e.currentTarget);
    let fields: Record<string, unknown> = Object.fromEntries(form);
    try {
      if (selected === "reconciliation") {
        const efd = form.get("efd"),
          erp = form.get("erp");
        fields = {
          company_id: fields.company_id,
          inventory_date: fields.inventory_date,
          efd: await read(efd),
          erp: await read(erp),
          fiscal_filename: (efd as File).name,
          erp_filename: (erp as File).name,
        };
        await api("reconciliations", fields);
      } else if (selected === "erp") await api("erp/routines", fields);
      else
        await api(selected + (editing ? "/update" : ""), {
          ...fields,
          ...(editing ? { id: editing.id } : {}),
        });
      setFormOpen(false);
      setEditing(null);
      await load();
      await onChange();
      setNotice(
        selected === "reconciliation"
          ? "Conciliação processada. Abra o resultado para analisar as diferenças."
          : "Registro salvo.",
      );
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }
  async function openComparison(id: string) {
    setBusy(true);
    try {
      setComparison(await api("reconciliations/detail?id=" + id));
      setFilter("all");
      setSearch("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(path: string, name: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/modules/" + path, {
        headers: { "x-organization-id": orgId },
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function requestRun(id: string) {
    setBusy(true);
    try {
      const r = await api("erp/runs", { routine_id: id });
      setNotice(r.message);
      await load();
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const overdue = entries.filter(
    (e) =>
      e.due_at &&
      e.due_at < today() &&
      !["done", "resolved"].includes(e.status),
  );
  const pending = entries.filter(
    (e) => !["done", "resolved"].includes(e.status),
  );
  const entryMatches = (e: Entry) =>
    (filter === "all" ||
      (filter === "overdue" ? overdue.includes(e) : e.status === filter)) &&
    `${e.subject} ${e.source || e.type} ${companyName(e.company_id)} ${e.assignee}`
      .toLowerCase()
      .includes(search.toLowerCase());
  const visibleStock =
    comparison?.items?.filter(
      (i) =>
        (filter === "all" ||
          (filter === "divergent"
            ? i.status !== "matched"
            : i.status === filter)) &&
        i.code.toLowerCase().includes(search.toLowerCase()),
    ) || [];
  const title = MODULES.find((m) => m.id === selected)!.title;
  const action =
    selected === "inbox"
      ? "Registrar mensagem"
      : selected === "obligations"
        ? "Nova obrigação"
        : selected === "erp"
          ? "Nova rotina"
          : "Nova conciliação";
  return (
    <div className="operational-module">
      {error && (
        <div className="banner error" role="alert">
          <TriangleAlert size={18} />
          <span>{error}</span>
          <button
            className="text-button"
            onClick={() => {
              setLoading(true);
              load()
                .then(() => setError(""))
                .catch((e) => setError(e.message))
                .finally(() => setLoading(false));
            }}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {notice && (
        <div className="banner success" role="status">
          <CheckCircle2 size={18} />
          <span>{notice}</span>
          <button className="text-button" onClick={() => setNotice("")}>
            Fechar
          </button>
        </div>
      )}
      <div className="module-intro">
        <div>
          <span className="capability-label">
            {selected === "reconciliation"
              ? "PROCESSAMENTO DE ARQUIVOS ATIVO"
              : selected === "erp"
                ? "ROTEIROS E CONTROLE DE EXECUÇÕES"
                : "GESTÃO E ACOMPANHAMENTO ATIVOS"}
          </span>
          <p>
            {selected === "inbox"
              ? "Registre notificações recebidas e acompanhe o tratamento pela equipe. O registro não acessa o portal nem altera a ciência fiscal."
              : selected === "obligations"
                ? "Organize vencimentos, referências e responsáveis. Concluir aqui registra o controle interno, sem transmitir declarações ou consultar portais."
                : selected === "reconciliation"
                  ? "Compare saldos do H010 com o CSV do ERP na mesma data-base. O processamento é real e o resultado fica salvo para auditoria."
                  : "Cadastre roteiros de SAP ou Protheus e exporte as etapas. Sem conector ERP, nenhuma transação externa é executada."}
          </p>
        </div>
        {canWrite && (
          <button
            className="button primary"
            disabled={busy || !companies.length}
            onClick={() => {
              setEditing(null);
              setFormError("");
              setFormOpen(true);
            }}
          >
            <Plus size={17} />
            {action}
          </button>
        )}
      </div>
      {!companies.length && (
        <div className="banner">
          <ClipboardList size={18} />
          <span>Cadastre uma empresa para começar a usar este módulo.</span>
          {canWrite && (
            <button className="button secondary" onClick={onAddCompany}>
              Cadastrar empresa
            </button>
          )}
        </div>
      )}
      {(selected === "inbox" || selected === "obligations") && (
        <div className="module-stats">
          <Stat
            label="Em acompanhamento"
            value={pending.length}
            icon={<Clock3 />}
          />
          <Stat
            label="Prazo vencido"
            value={overdue.length}
            icon={<TriangleAlert />}
            warning={overdue.length > 0}
          />
          <Stat
            label={selected === "inbox" ? "Resolvidas" : "Concluídas"}
            value={entries.length - pending.length}
            icon={<CheckCircle2 />}
          />
        </div>
      )}
      {selected === "reconciliation" && (
        <div className="module-stats">
          <Stat
            label="Conciliações salvas"
            value={comparisons.length}
            icon={<FileSpreadsheet />}
          />
          <Stat
            label="Produtos analisados"
            value={comparisons.reduce((n, c) => n + c.total_count, 0)}
            icon={<ClipboardList />}
          />
          <Stat
            label="Diferenças nos históricos"
            value={comparisons.reduce(
              (n, c) => n + c.total_count - c.matched_count,
              0,
            )}
            icon={<TriangleAlert />}
          />
        </div>
      )}
      {selected === "erp" && (
        <div className="module-stats">
          <Stat
            label="Roteiros cadastrados"
            value={routines.length}
            icon={<Workflow />}
          />
          <Stat
            label="Solicitações registradas"
            value={runs.length}
            icon={<ClipboardList />}
          />
          <Stat label="Conectores ERP ativos" value={0} icon={<Clock3 />} />
        </div>
      )}
      {loading ? (
        <div className="loading">
          <RefreshCw className="spin" size={21} />
          Carregando {title.toLowerCase()}…
        </div>
      ) : (
        <>
          {(selected === "inbox" || selected === "obligations") && (
            <section className="card">
              <div className="toolbar">
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Buscar registros"
                    value={search}
                    placeholder="Buscar assunto, empresa ou responsável"
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  className="module-filter"
                  aria-label="Filtrar situação"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">Todas as situações</option>
                  <option value="overdue">Prazo vencido</option>
                  {(selected === "inbox"
                    ? ["new", "in_review", "resolved"]
                    : ["pending", "in_progress", "done"]
                  ).map((s) => (
                    <option key={s} value={s}>
                      {STATUS[s]}
                    </option>
                  ))}
                </select>
              </div>
              {entries.filter(entryMatches).length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>
                          {selected === "inbox"
                            ? "Mensagem / origem"
                            : "Obrigação / referência"}
                        </th>
                        <th>Empresa</th>
                        <th>Prazo</th>
                        <th>Responsável</th>
                        <th>Situação</th>
                        <th>
                          <span className="sr-only">Detalhes</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.filter(entryMatches).map((e) => (
                        <tr key={e.id}>
                          <td>
                            <strong>{e.subject}</strong>
                            <small>
                              {e.source || e.type}
                              {e.reference ? " · " + e.reference : ""}
                            </small>
                          </td>
                          <td>{companyName(e.company_id)}</td>
                          <td className={overdue.includes(e) ? "text-red" : ""}>
                            {format(e.due_at)}
                          </td>
                          <td>{e.assignee || "Não atribuído"}</td>
                          <td>
                            <span
                              className={
                                "badge " +
                                (["done", "resolved"].includes(e.status)
                                  ? "green"
                                  : overdue.includes(e)
                                    ? "red"
                                    : "amber")
                              }
                            >
                              <i />
                              {overdue.includes(e)
                                ? "Prazo vencido"
                                : STATUS[e.status]}
                            </span>
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={"Ver " + e.subject}
                              onClick={() => {
                                setEditing(e);
                                setFormError("");
                                setFormOpen(true);
                              }}
                            >
                              <ArrowUpRight size={18} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <ModuleEmpty
                  icon={<Mail size={29} />}
                  title={
                    search || filter !== "all"
                      ? "Nenhum registro com estes filtros"
                      : selected === "inbox"
                        ? "Sua caixa postal está organizada"
                        : "Organize suas próximas entregas"
                  }
                  text={
                    selected === "inbox"
                      ? "Cadastre mensagens recebidas nos portais e acompanhe cada prazo por aqui."
                      : "Adicione obrigações, indique o responsável e acompanhe a conclusão."
                  }
                />
              )}
              <div className="table-note">
                Até 200 registros mais recentes. Alertas são exibidos no painel;
                envio por e-mail não configurado.
              </div>
            </section>
          )}
          {selected === "reconciliation" && (
            <section className="card">
              <div className="section-title">
                <div>
                  <h2>Histórico de conciliações</h2>
                  <p className="muted small">
                    Estoque próprio em poder da empresa · IND_PROP = 0
                  </p>
                </div>
                <span className="pill subtle">EFD H010 × CSV</span>
              </div>
              {comparisons.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Empresa / arquivos</th>
                        <th>Data-base</th>
                        <th>Produtos</th>
                        <th>Conferem</th>
                        <th>Diferenças</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {comparisons.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <strong>{companyName(c.company_id)}</strong>
                            <small>
                              {c.fiscal_filename} × {c.erp_filename}
                            </small>
                          </td>
                          <td>{format(c.inventory_date)}</td>
                          <td>{c.total_count}</td>
                          <td>{c.matched_count}</td>
                          <td>
                            <span
                              className={
                                "badge " +
                                (c.total_count === c.matched_count
                                  ? "green"
                                  : "amber")
                              }
                            >
                              <i />
                              {c.total_count - c.matched_count}
                            </span>
                          </td>
                          <td>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => openComparison(c.id)}
                            >
                              Ver resultado <ArrowUpRight size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <ModuleEmpty
                  icon={<FileSpreadsheet size={29} />}
                  title="Encontre diferenças antes de elas virarem problemas"
                  text="Importe a EFD ICMS/IPI e o estoque do ERP para comparar códigos, unidades e quantidades."
                />
              )}
              <div className="table-note">
                Até 100 conciliações recentes. Não reconstrói movimentações por
                XML nem substitui uma revisão fiscal.
              </div>
            </section>
          )}
          {selected === "erp" && (
            <>
              <section className="routine-grid">
                {routines.map((r) => (
                  <article className="card routine-card" key={r.id}>
                    <div className="routine-card-head">
                      <span className="module-card-icon">
                        <Workflow size={21} />
                      </span>
                      <span className="pill subtle">{r.system}</span>
                    </div>
                    <h3>{r.name}</h3>
                    <p className="muted small">
                      {companyName(r.company_id)} · {OPERATIONS[r.operation]}
                    </p>
                    <div className="routine-steps-summary">
                      {r.steps.length} etapas documentadas{" "}
                      <span className="badge gray">Sem conector</span>
                    </div>
                    <div className="routine-card-actions">
                      <button
                        className="text-button"
                        onClick={() => setRoutine(r)}
                      >
                        Ver roteiro <ArrowRight size={15} />
                      </button>
                      {canWrite && (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => requestRun(r.id)}
                        >
                          Solicitar execução
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </section>
              {!routines.length && (
                <section className="card">
                  <ModuleEmpty
                    icon={<Workflow size={29} />}
                    title="Tire seus processos da cabeça e coloque no fluxo"
                    text="Documente as etapas do ERP para padronizar a operação e preparar a integração futura."
                  />
                </section>
              )}
              <section className="card gap-top">
                <div className="section-title">
                  <div>
                    <h2>Solicitações de execução</h2>
                    <p className="muted small">
                      Sem conector configurado, as solicitações ficam
                      bloqueadas.
                    </p>
                  </div>
                </div>
                {runs.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Rotina</th>
                          <th>Situação</th>
                          <th>Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runs.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <strong>
                                {routines.find((x) => x.id === r.routine_id)
                                  ?.name || "Rotina"}
                              </strong>
                              <small>{r.message}</small>
                            </td>
                            <td>
                              <span className="badge amber">
                                <i />
                                Bloqueada
                              </span>
                            </td>
                            <td>{format(r.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="table-note">
                    Nenhuma execução solicitada. Até 100 solicitações recentes.
                  </p>
                )}
              </section>
            </>
          )}
        </>
      )}
      {formOpen && (
        <Dialog
          title={
            editing
              ? canWrite
                ? "Atualizar acompanhamento"
                : "Detalhes do registro"
              : action
          }
          onClose={() => {
            if (!busy) setFormOpen(false);
          }}
        >
          <form onSubmit={submit}>
            {!editing && (
              <label>
                Empresa
                <select name="company_id" required defaultValue="">
                  <option value="" disabled>
                    Selecione uma empresa
                  </option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(selected === "inbox" || selected === "obligations") && (
              <>
                {editing ? (
                  <div className="record-summary">
                    <strong>{editing.subject}</strong>
                    <p className="muted small">
                      {companyName(editing.company_id)} ·{" "}
                      {editing.source || editing.type} · Prazo:{" "}
                      {format(editing.due_at)}
                    </p>
                    {editing.reference && (
                      <p className="small">Referência: {editing.reference}</p>
                    )}
                    {editing.body && (
                      <p className="message-body">{editing.body}</p>
                    )}
                  </div>
                ) : (
                  <>
                    {selected === "obligations" && (
                      <label>
                        Tipo
                        <select name="type" defaultValue="ISS">
                          <option>ISS</option>
                          <option>ITR</option>
                          <option>SUFRAMA</option>
                          <option value="OUTRA">Outra obrigação</option>
                        </select>
                      </label>
                    )}
                    <label>
                      {selected === "inbox"
                        ? "Assunto da mensagem"
                        : "Descrição da obrigação"}
                      <input
                        name="subject"
                        required
                        minLength={3}
                        maxLength={200}
                        placeholder={
                          selected === "inbox"
                            ? "Ex.: Notificação de divergência fiscal"
                            : "Ex.: Declaração mensal de serviços"
                        }
                      />
                    </label>
                    {selected === "inbox" ? (
                      <>
                        <label>
                          Origem / portal
                          <input
                            name="source"
                            required
                            minLength={2}
                            maxLength={120}
                            placeholder="Ex.: SEFAZ-SP · DEC"
                          />
                        </label>
                        <label>
                          Conteúdo
                          <textarea
                            name="body"
                            rows={4}
                            maxLength={10000}
                            placeholder="Transcreva ou resuma a mensagem recebida"
                          />
                        </label>
                        <label>
                          Recebida em
                          <input
                            name="received_at"
                            type="date"
                            max={today()}
                            defaultValue={today()}
                            required
                          />
                        </label>
                      </>
                    ) : (
                      <label>
                        Referência / protocolo
                        <input
                          name="reference"
                          maxLength={200}
                          placeholder="Ex.: Competência 11/2026"
                        />
                      </label>
                    )}
                    <label>
                      {selected === "inbox"
                        ? "Prazo de resposta (opcional)"
                        : "Vencimento"}
                      <input
                        type="date"
                        name="due_at"
                        required={selected === "obligations"}
                      />
                    </label>
                  </>
                )}
                {editing && (
                  <label>
                    Situação
                    <select
                      name="status"
                      defaultValue={editing.status}
                      disabled={!canWrite}
                    >
                      {(selected === "inbox"
                        ? ["new", "in_review", "resolved"]
                        : ["pending", "in_progress", "done"]
                      ).map((s) => (
                        <option key={s} value={s}>
                          {STATUS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Responsável (opcional)
                  <input
                    name="assignee"
                    maxLength={100}
                    defaultValue={editing?.assignee || ""}
                    disabled={!canWrite}
                    placeholder="Nome da pessoa responsável"
                  />
                </label>
                <label>
                  Notas da equipe
                  <textarea
                    name="notes"
                    rows={3}
                    maxLength={2000}
                    defaultValue={editing?.notes || ""}
                    disabled={!canWrite}
                  />
                </label>
              </>
            )}
            {selected === "reconciliation" && (
              <>
                <div className="import-guide">
                  <strong>Antes de importar</strong>
                  <p>
                    Os arquivos devem refletir a mesma data-base e o mesmo CNPJ.
                    A EFD precisa dos registros 0000, H005 e H010. São
                    considerados apenas itens de estoque próprio em poder da
                    empresa.
                  </p>
                </div>
                <label>
                  Data-base do inventário
                  <input
                    name="inventory_date"
                    type="date"
                    required
                    max={today()}
                  />
                </label>
                <label>
                  EFD ICMS/IPI (.txt)
                  <input
                    name="efd"
                    type="file"
                    accept=".txt,text/plain"
                    required
                  />
                  <small className="muted">
                    Até 1 MB · UTF-8 ou Windows-1252
                  </small>
                </label>
                <label>
                  Estoque do ERP (.csv)
                  <input
                    name="erp"
                    type="file"
                    accept=".csv,text/csv"
                    required
                  />
                  <small className="muted">
                    Até 1 MB · cabeçalhos: codigo;unidade;quantidade
                  </small>
                </label>
                <div className="csv-example">
                  <code>
                    codigo;unidade;quantidade
                    <br />
                    PROD001;UN;1200,50
                  </code>
                  <p className="small muted">
                    Quantidades sem separador de milhar, com até 6 casas
                    decimais. Códigos devem coincidir entre os arquivos;
                    unidades diferentes não são convertidas.
                  </p>
                </div>
                <a
                  href="/exemplos/estoque-erp.csv"
                  download
                  className="text-button"
                >
                  <Download size={15} />
                  Baixar modelo CSV
                </a>
              </>
            )}
            {selected === "erp" && (
              <>
                <label>
                  Nome da rotina
                  <input
                    name="name"
                    required
                    minLength={3}
                    maxLength={150}
                    placeholder="Ex.: Extrair relatório de faturamento"
                  />
                </label>
                <div className="form-columns">
                  <label>
                    Sistema
                    <select name="system" defaultValue="SAP">
                      <option>SAP</option>
                      <option>PROTHEUS</option>
                      <option value="OUTRO">Outro ERP</option>
                    </select>
                  </label>
                  <label>
                    Operação
                    <select name="operation" defaultValue="extract">
                      {Object.entries(OPERATIONS).map(([k, v]) => (
                        <option value={k} key={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Etapas do processo
                  <textarea
                    name="steps"
                    rows={5}
                    required
                    maxLength={6000}
                    placeholder={
                      "Uma etapa por linha. Ex.:\nAcessar a transação de relatório\nFiltrar o período\nExportar para CSV"
                    }
                  />
                  <small className="muted">
                    Até 20 etapas, 300 caracteres por etapa. Não inclua senhas,
                    tokens ou dados de certificados.
                  </small>
                </label>
                <label>
                  Observações
                  <textarea name="notes" rows={3} maxLength={2000} />
                </label>
              </>
            )}
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => setFormOpen(false)}
              >
                Fechar
              </button>
              {canWrite && (
                <button className="button primary" disabled={busy}>
                  {busy
                    ? "Processando…"
                    : selected === "reconciliation"
                      ? "Processar conciliação"
                      : editing
                        ? "Salvar acompanhamento"
                        : "Salvar registro"}
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          </form>
        </Dialog>
      )}
      {comparison && (
        <Dialog
          title="Resultado da conciliação"
          description={`${companyName(comparison.company_id)} · Inventário de ${format(comparison.inventory_date)}`}
          onClose={() => {
            setComparison(null);
            setSearch("");
            setFilter("all");
          }}
        >
          <div className="reconciliation-result">
            <div className="result-total">
              <strong>
                {comparison.total_count - comparison.matched_count}
              </strong>
              <span>diferenças em {comparison.total_count} produtos</span>
            </div>
            {comparison.excluded_count > 0 && (
              <p className="small muted">
                {comparison.excluded_count} registros H010 de estoque de
                terceiros ou em poder de terceiros foram excluídos desta
                comparação.
              </p>
            )}
            <div className="result-filters">
              <input
                aria-label="Buscar código de produto"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar código"
              />
              <select
                aria-label="Filtrar resultado"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">Todos</option>
                <option value="divergent">Só diferenças</option>
                {Object.entries(STOCK).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="table-scroll result-table">
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>EFD</th>
                    <th>ERP</th>
                    <th>Diferença</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStock.slice(0, 200).map((i) => (
                    <tr key={i.code}>
                      <td>
                        <strong>{i.code}</strong>
                      </td>
                      <td>
                        {i.fiscal_quantity ?? "—"}
                        <small>{i.fiscal_unit}</small>
                      </td>
                      <td>
                        {i.erp_quantity ?? "—"}
                        <small>{i.erp_unit}</small>
                      </td>
                      <td>{i.difference ?? "—"}</td>
                      <td>
                        <span
                          className={
                            "badge " +
                            (i.status === "matched" ? "green" : "amber")
                          }
                        >
                          {STOCK[i.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!visibleStock.length && (
              <p className="table-note">Nenhum produto com estes filtros.</p>
            )}
            <p className="small muted">
              Exibindo até 200 produtos por filtro. O CSV contém todos os
              resultados. Diferença = ERP − EFD.
            </p>
            <div className="dialog-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  download(
                    "reconciliations/export?id=" + comparison.id,
                    "conciliacao.csv",
                  )
                }
              >
                <Download size={16} />
                Exportar resultado completo
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {routine && (
        <Dialog
          title={routine.name}
          description={`${routine.system} · ${OPERATIONS[routine.operation]}`}
          onClose={() => setRoutine(null)}
        >
          <ol className="routine-steps">
            {routine.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {routine.notes && (
            <p className="message-body small">{routine.notes}</p>
          )}
          <div className="import-guide">
            <strong>Roteiro documentado</strong>
            <p>
              O arquivo exportado descreve o processo. Ele não executa
              transações e não contém credenciais de acesso.
            </p>
          </div>
          <div className="dialog-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                download("erp/export?id=" + routine.id, "roteiro-erp.json")
              }
            >
              <Download size={16} />
              Exportar roteiro JSON
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  icon,
  warning = false,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <div className={"card module-stat " + (warning ? "attention" : "")}>
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
function ModuleEmpty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
