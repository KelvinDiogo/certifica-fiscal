import { NextRequest, NextResponse } from "next/server";
import { createClient, isConfigured } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/request-origin.mjs";
import { validDate, today, csvCell } from "@/lib/domain.mjs";
import { reconcileStock, ImportError } from "@/lib/reconciliation.mjs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new RequestError(status, message);
};
const text = (value: unknown, min = 1, max = 200) => {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    fail(400, `Informe um texto entre ${min} e ${max} caracteres.`);
  return (value as string).trim();
};
const uuid = (value: unknown) => {
  const s = text(value, 36, 36);
  if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(s))
    fail(400, "Identificador inválido.");
  return s;
};
const checked = (error: { code?: string; message: string } | null) => {
  if (!error) return;
  if (error.code === "42501")
    fail(403, "Você não tem permissão para esta operação.");
  if (["23503", "23514", "22023", "22P02"].includes(error.code || ""))
    fail(400, "Confira os dados informados.");
  console.error("Module database error", error.code);
  fail(503, "Não foi possível acessar os dados deste módulo.");
};
async function handle(req: NextRequest) {
  try {
    if (!isConfigured()) fail(503, "Supabase não configurado.");
    const method = req.method,
      path = req.nextUrl.pathname.replace("/api/modules/", "");
    if (method === "POST") {
      if (!sameOrigin(req.headers.get("origin"), req.headers.get("host")))
        fail(403, "Origem da solicitação inválida.");
      if (!req.headers.get("content-type")?.startsWith("application/json"))
        fail(415, "Envie os dados em JSON.");
      if (Number(req.headers.get("content-length")) > 3000000)
        fail(413, "O envio deve ter no máximo 2 MB de arquivos.");
    }
    const sb = await createClient();
    const {
      data: { user },
      error: authError,
    } = await sb.auth.getUser();
    if (authError || !user) fail(401, "Entre com sua conta.");
    const org = uuid(req.headers.get("x-organization-id"));
    const { data: member, error: memberError } = await sb
      .from("fiscal_memberships")
      .select("role")
      .eq("organization_id", org)
      .eq("user_id", user!.id)
      .maybeSingle();
    checked(memberError);
    if (!member) fail(403, "Você não tem acesso a este ambiente.");
    let b: Record<string, unknown> = {};
    if (method === "POST") {
      if (!["admin", "operator"].includes(member!.role))
        fail(403, "Seu perfil permite apenas visualizar os dados.");
      const raw = await req.text();
      if (raw.length > 2500000)
        fail(413, "Os arquivos excedem o limite de importação.");
      try {
        b = JSON.parse(raw);
      } catch {
        fail(400, "JSON inválido.");
      }
      if (!b || Array.isArray(b) || typeof b !== "object")
        fail(400, "Dados inválidos.");
    }
    const company = async (value: unknown) => {
      const companyId = uuid(value);
      const { data, error } = await sb
        .from("fiscal_companies")
        .select("id,cnpj")
        .eq("organization_id", org)
        .eq("id", companyId)
        .maybeSingle();
      checked(error);
      if (!data) fail(404, "Empresa não encontrada neste ambiente.");
      return data!;
    };
    if (path === "summary" && method === "GET") {
      const [inbox, obligations, reconciliations, routines] = await Promise.all(
        [
          sb
            .from("fiscal_inbox_messages")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", org)
            .neq("status", "resolved"),
          sb
            .from("fiscal_obligations")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", org)
            .neq("status", "done"),
          sb
            .from("fiscal_reconciliations")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", org),
          sb
            .from("fiscal_erp_routines")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", org),
        ],
      );
      [inbox, obligations, reconciliations, routines].forEach((r) =>
        checked(r.error),
      );
      return json({
        inbox: inbox.count,
        obligations: obligations.count,
        reconciliations: reconciliations.count,
        routines: routines.count,
      });
    }
    if (["inbox", "obligations"].includes(path) && method === "GET") {
      const { data, error } = await sb
        .from(path === "inbox" ? "fiscal_inbox_messages" : "fiscal_obligations")
        .select("*")
        .eq("organization_id", org)
        .order("created_at", { ascending: false })
        .limit(200);
      checked(error);
      return json({ records: data, today: today() });
    }
    if (["inbox", "obligations"].includes(path) && method === "POST") {
      const c = await company(b.company_id);
      const shared = {
        organization_id: org,
        company_id: c.id,
        subject: text(b.subject, 3, 200),
        assignee: text(b.assignee || "", 0, 100),
        notes: text(b.notes || "", 0, 2000),
      };
      if (b.due_at && !validDate(b.due_at))
        fail(400, "Data de vencimento inválida.");
      let record: Record<string, unknown>;
      if (path === "inbox") {
        if (!validDate(b.received_at) || String(b.received_at) > today())
          fail(400, "Informe uma data de recebimento válida, até hoje.");
        if (b.due_at && String(b.due_at) < String(b.received_at))
          fail(400, "O prazo não pode ser anterior ao recebimento.");
        record = {
          ...shared,
          source: text(b.source, 2, 120),
          body: text(b.body || "", 0, 10000),
          received_at: b.received_at,
          due_at: b.due_at || null,
        };
      } else {
        if (
          !["ITR", "ISS", "SUFRAMA", "OUTRA"].includes(String(b.type)) ||
          !validDate(b.due_at)
        )
          fail(400, "Informe o tipo e o vencimento da obrigação.");
        record = {
          ...shared,
          type: b.type,
          reference: text(b.reference || "", 0, 200),
          due_at: b.due_at,
        };
      }
      const { data, error } = await sb
        .from(path === "inbox" ? "fiscal_inbox_messages" : "fiscal_obligations")
        .insert(record)
        .select("id")
        .single();
      checked(error);
      return json(data, 201);
    }
    if (
      ["inbox/update", "obligations/update"].includes(path) &&
      method === "POST"
    ) {
      const inbox = path === "inbox/update",
        allowed = inbox
          ? ["new", "in_review", "resolved"]
          : ["pending", "in_progress", "done"];
      if (!allowed.includes(String(b.status))) fail(400, "Situação inválida.");
      const { data, error } = await sb
        .from(inbox ? "fiscal_inbox_messages" : "fiscal_obligations")
        .update({
          status: b.status,
          assignee: text(b.assignee || "", 0, 100),
          notes: text(b.notes || "", 0, 2000),
        })
        .eq("organization_id", org)
        .eq("id", uuid(b.id))
        .select("id")
        .maybeSingle();
      checked(error);
      if (!data) fail(404, "Registro não encontrado.");
      return json(data);
    }
    if (path === "reconciliations" && method === "GET") {
      const { data, error } = await sb
        .from("fiscal_reconciliations")
        .select(
          "id,company_id,inventory_date,fiscal_filename,erp_filename,total_count,matched_count,excluded_count,created_at",
        )
        .eq("organization_id", org)
        .order("created_at", { ascending: false })
        .limit(100);
      checked(error);
      return json({ records: data });
    }
    if (path === "reconciliations" && method === "POST") {
      const c = await company(b.company_id);
      if (
        typeof b.efd !== "string" ||
        typeof b.erp !== "string" ||
        new TextEncoder().encode(b.efd).byteLength > 1048576 ||
        new TextEncoder().encode(b.erp).byteLength > 1048576
      )
        fail(413, "Cada arquivo pode ter no máximo 1 MB.");
      const result = reconcileStock({
        efd: b.efd,
        erp: b.erp,
        cnpj: c.cnpj,
        inventoryDate: b.inventory_date,
      });
      const { data, error } = await sb
        .from("fiscal_reconciliations")
        .insert({
          organization_id: org,
          company_id: c.id,
          inventory_date: result.inventory_date,
          items: result.items,
          excluded_count: result.excluded_count,
          fiscal_filename: text(b.fiscal_filename, 1, 200),
          erp_filename: text(b.erp_filename, 1, 200),
        })
        .select("id")
        .single();
      checked(error);
      return json(data, 201);
    }
    if (
      ["reconciliations/detail", "reconciliations/export"].includes(path) &&
      method === "GET"
    ) {
      const { data, error } = await sb
        .from("fiscal_reconciliations")
        .select("*")
        .eq("organization_id", org)
        .eq("id", uuid(req.nextUrl.searchParams.get("id")))
        .maybeSingle();
      checked(error);
      if (!data) fail(404, "Conciliação não encontrada.");
      if (path.endsWith("/detail")) return json(data);
      const rows = [
        [
          "Código",
          "Unidade EFD",
          "Unidade ERP",
          "Quantidade EFD",
          "Quantidade ERP",
          "Diferença ERP - EFD",
          "Situação",
        ],
        ...data!.items.map((i: Record<string, unknown>) => [
          i.code,
          i.fiscal_unit,
          i.erp_unit,
          i.fiscal_quantity,
          i.erp_quantity,
          i.difference,
          i.status,
        ]),
      ];
      return new Response(
        "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n"),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="conciliacao.csv"',
            "Cache-Control": "private, no-store",
          },
        },
      );
    }
    if (path === "erp" && method === "GET") {
      const [routines, runs] = await Promise.all([
        sb
          .from("fiscal_erp_routines")
          .select("*")
          .eq("organization_id", org)
          .order("created_at", { ascending: false })
          .limit(200),
        sb
          .from("fiscal_erp_runs")
          .select("*")
          .eq("organization_id", org)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      checked(routines.error);
      checked(runs.error);
      return json({ routines: routines.data, runs: runs.data });
    }
    if (path === "erp/routines" && method === "POST") {
      const c = await company(b.company_id);
      if (
        !["SAP", "PROTHEUS", "OUTRO"].includes(String(b.system)) ||
        !["extract", "insert", "invoice", "reconcile"].includes(
          String(b.operation),
        )
      )
        fail(400, "Sistema ou operação inválidos.");
      const steps = text(b.steps, 1, 6000)
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (
        !steps.length ||
        steps.length > 20 ||
        steps.some((s) => s.length > 300)
      )
        fail(400, "Informe até 20 etapas com no máximo 300 caracteres cada.");
      const { data, error } = await sb
        .from("fiscal_erp_routines")
        .insert({
          organization_id: org,
          company_id: c.id,
          name: text(b.name, 3, 150),
          system: b.system,
          operation: b.operation,
          steps,
          notes: text(b.notes || "", 0, 2000),
        })
        .select("id")
        .single();
      checked(error);
      return json(data, 201);
    }
    if (path === "erp/runs" && method === "POST") {
      const { data, error } = await sb
        .from("fiscal_erp_runs")
        .insert({ organization_id: org, routine_id: uuid(b.routine_id) })
        .select("id,status,message")
        .single();
      checked(error);
      return json(data, 201);
    }
    if (path === "erp/export" && method === "GET") {
      const { data, error } = await sb
        .from("fiscal_erp_routines")
        .select("name,system,operation,steps,notes")
        .eq("organization_id", org)
        .eq("id", uuid(req.nextUrl.searchParams.get("id")))
        .maybeSingle();
      checked(error);
      if (!data) fail(404, "Rotina não encontrada.");
      return new Response(
        JSON.stringify(
          { format_version: 1, execution_enabled: false, ...data },
          null,
          2,
        ),
        {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": 'attachment; filename="roteiro-erp.json"',
            "Cache-Control": "private, no-store",
          },
        },
      );
    }
    fail(404, "Recurso não encontrado.");
  } catch (error) {
    if (error instanceof RequestError)
      return json({ error: error.message }, error.status);
    if (error instanceof ImportError)
      return json({ error: error.message }, 400);
    console.error(
      "Module request failed",
      error instanceof Error ? error.name : "Unknown",
    );
    return json({ error: "Não foi possível concluir a operação." }, 500);
  }
}
export const GET = handle;
export const POST = handle;
