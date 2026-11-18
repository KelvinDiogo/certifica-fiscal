import { NextRequest, NextResponse } from "next/server";
import { sameOrigin } from "@/lib/request-origin.mjs";
import { createClient, isConfigured } from "@/lib/supabase/server";
import {
  TYPES,
  RESULTS,
  STATES,
  validCnpj,
  cleanCnpj,
  validDate,
  today,
  certificateState,
  csvCell,
} from "@/lib/domain.mjs";
export const dynamic = "force-dynamic";
const response = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new ApiError(status, message);
};
const str = (value: unknown, min = 1, max = 200) => {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    fail(400, `Informe um texto entre ${min} e ${max} caracteres.`);
  return (value as string).trim();
};
const uuid = (value: unknown) => {
  const s = str(value, 36, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  )
    fail(400, "Identificador inválido.");
  return s;
};
const check = (error: { code?: string; message: string } | null) => {
  if (!error) return;
  if (error.code === "23505") fail(409, "Este registro já existe no ambiente.");
  if (error.code === "42501")
    fail(403, "Você não tem permissão para esta operação.");
  if (["22023", "23514", "23503"].includes(error.code || ""))
    fail(
      400,
      "Confira os dados. O registro ou convite pode ser inválido, expirado ou já utilizado.",
    );
  console.error("Database operation failed:", error.code);
  fail(
    503,
    "Não foi possível acessar os dados. Confira a configuração do banco ou tente novamente.",
  );
};
async function parse(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 20000) fail(413, "Solicitação muito grande.");
  try {
    return JSON.parse(raw);
  } catch {
    fail(400, "JSON inválido.");
  }
}
async function handle(req: NextRequest) {
  try {
    if (!isConfigured()) fail(503, "Configure o Supabase para começar.");
    const path = req.nextUrl.pathname.replace("/api/", ""),
      method = req.method;
    if (method === "POST") {
      if (!sameOrigin(req.headers.get("origin"), req.headers.get("host")))
        fail(403, "Origem da solicitação inválida.");
      if (Number(req.headers.get("content-length")) > 4400000)
        fail(413, "Arquivo muito grande.");
      if (
        path !== "documents" &&
        !req.headers.get("content-type")?.startsWith("application/json")
      )
        fail(415, "Formato de solicitação inválido.");
    }
    const sb = await createClient();
    const {
      data: { user },
      error: authError,
    } = await sb.auth.getUser();
    // Auth endpoints do not assume an existing session.
    if (path === "auth" && method === "POST") {
      const b = await parse(req),
        email = str(b.email, 3, 254);
      if (
        typeof b.password !== "string" ||
        b.password.length > 128 ||
        b.password.length < (b.mode === "register" ? 12 : 1)
      )
        fail(
          400,
          "Confira a senha. Novas contas exigem pelo menos 12 caracteres.",
        );
      const password = b.password;
      if (b.mode === "register") {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: req.headers.get("origin") + "/auth/callback",
          },
        });
        if (error)
          return response(
            {
              error:
                error.code === "over_email_send_rate_limit"
                  ? "Limite de envio atingido. Aguarde antes de tentar novamente."
                  : "Não foi possível criar a conta. Verifique os dados ou tente entrar.",
            },
            400,
          );
        return response({
          signed_in: Boolean(data.session),
          message:
            "Se o cadastro puder ser concluído, você receberá um e-mail de confirmação. Verifique também o spam. Após confirmar, volte aqui para entrar.",
        });
      }
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error)
        fail(401, "E-mail ou senha inválidos, ou e-mail ainda não confirmado.");
      return response({ signed_in: true });
    }
    if (authError || !user)
      fail(401, "Entre com sua conta para acessar o ambiente.");
    if (path === "signout" && method === "POST") {
      const { error } = await sb.auth.signOut();
      check(error);
      return response({ ok: true });
    }
    if (path === "me" && method === "GET") {
      const { data, error } = await sb
        .from("fiscal_memberships")
        .select(
          "organization_id,role,organizations:fiscal_organizations(id,name)",
        )
        .eq("user_id", user!.id);
      check(error);
      return response({
        organizations: (data || []).map((m) => ({
          ...m.organizations,
          role: m.role,
        })),
      });
    }
    if (path === "organizations" && method === "POST") {
      const b = await parse(req),
        name = str(b.name, 2, 100);
      const { data, error } = await sb.rpc("fiscal_create_organization", {
        org_name: name,
      });
      check(error);
      return response({ id: data, name, role: "admin" }, 201);
    }
    if (path === "invitations/accept" && method === "POST") {
      const b = await parse(req);
      const { data, error } = await sb.rpc("fiscal_accept_invitation", {
        token: str(b.token, 64, 64),
      });
      check(error);
      return response({ organization_id: data });
    }
    const org = uuid(req.headers.get("x-organization-id"));
    const { data: membership, error: membershipError } = await sb
      .from("fiscal_memberships")
      .select("role")
      .eq("organization_id", org)
      .eq("user_id", user!.id)
      .maybeSingle();
    check(membershipError);
    if (!membership) fail(403, "Você não tem acesso a este ambiente.");
    const role = membership!.role;
    const write = () => {
      if (!["admin", "operator"].includes(role))
        fail(403, "Seu perfil permite apenas visualizar os dados.");
    };
    if (path === "dashboard" && method === "GET") {
      const results = await Promise.all([
        sb
          .from("fiscal_companies")
          .select("*")
          .eq("organization_id", org)
          .order("name")
          .limit(1000),
        sb
          .from("fiscal_certificates")
          .select("*")
          .eq("organization_id", org)
          .order("created_at", { ascending: false })
          .limit(5000),
        sb
          .from("fiscal_consultation_jobs")
          .select("*")
          .eq("organization_id", org)
          .order("created_at", { ascending: false })
          .limit(100),
        sb
          .from("fiscal_audit_events")
          .select("id,action,subject,created_at")
          .eq("organization_id", org)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      results.forEach((r) => check(r.error));
      const keys = ["companies", "certificates", "jobs", "events"];
      return response({
        ...Object.fromEntries(results.map((r, i) => [keys[i], r.data])),
        role,
        today: today(),
      });
    }
    if (path === "companies" && method === "POST") {
      write();
      const b = await parse(req),
        cnpj = cleanCnpj(b.cnpj),
        state = str(b.state, 2, 2);
      if (!validCnpj(cnpj))
        fail(400, "CNPJ inválido. Confira os dígitos verificadores.");
      if (!STATES.includes(state)) fail(400, "UF inválida.");
      const { data, error } = await sb
        .from("fiscal_companies")
        .insert({
          organization_id: org,
          name: str(b.name, 2, 150),
          cnpj,
          state,
          city: str(b.city, 2, 100),
        })
        .select("id")
        .single();
      check(error);
      return response(data, 201);
    }
    if (["certificates", "jobs"].includes(path) && method === "POST") {
      write();
      const b = await parse(req),
        company_id = uuid(b.company_id);
      if (!Object.hasOwn(TYPES, b.type))
        fail(400, "Tipo de certidão inválido.");
      const { data: company, error: companyError } = await sb
        .from("fiscal_companies")
        .select("id")
        .eq("organization_id", org)
        .eq("id", company_id)
        .maybeSingle();
      check(companyError);
      if (!company) fail(404, "Empresa não encontrada neste ambiente.");
      if (path === "jobs") {
        const { data, error } = await sb
          .from("fiscal_consultation_jobs")
          .insert({ organization_id: org, company_id, type: b.type })
          .select("id,status,message")
          .single();
        check(error);
        return response(data, 201);
      }
      if (!Object.hasOwn(RESULTS, b.result)) fail(400, "Resultado inválido.");
      if (
        !validDate(b.issued_at) ||
        !validDate(b.expires_at) ||
        b.expires_at < b.issued_at ||
        b.issued_at > today()
      )
        fail(400, "Confira as datas de emissão e validade.");
      let document_path: string | null = null;
      if (b.document_path) {
        document_path = str(b.document_path, 1, 300);
        if (!document_path.startsWith(org + "/"))
          fail(400, "Documento de outro ambiente.");
      }
      const { data, error } = await sb
        .from("fiscal_certificates")
        .insert({
          organization_id: org,
          company_id,
          type: b.type,
          result: b.result,
          issued_at: b.issued_at,
          expires_at: b.expires_at,
          reference: str(b.reference, 1, 200),
          notes: str(b.notes || "", 0, 2000),
          document_path,
        })
        .select("id")
        .single();
      check(error);
      return response(data, 201);
    }
    if (path === "documents" && method === "POST") {
      write();
      const b = await req.formData(),
        file = b.get("file");
      if (!(file instanceof File) || file.size > 4194304 || file.size < 5)
        fail(400, "Selecione um PDF de até 4 MB.");
      const pdf = file as File,
        bytes = new Uint8Array(await pdf.arrayBuffer());
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
        fail(400, "O arquivo não é um PDF válido.");
      const document_path = org + "/" + crypto.randomUUID() + ".pdf";
      const { error } = await sb.storage
        .from("fiscal_certificates")
        .upload(document_path, bytes, {
          contentType: "application/pdf",
          upsert: false,
        });
      check(error);
      return response({ document_path }, 201);
    }
    if (path === "documents" && method === "GET") {
      const certId = uuid(req.nextUrl.searchParams.get("id"));
      const { data: certificate, error } = await sb
        .from("fiscal_certificates")
        .select("document_path")
        .eq("organization_id", org)
        .eq("id", certId)
        .maybeSingle();
      check(error);
      if (!certificate?.document_path)
        fail(404, "Esta certidão não possui PDF anexado.");
      const { data, error: signedError } = await sb.storage
        .from("fiscal_certificates")
        .createSignedUrl(certificate!.document_path!, 60);
      check(signedError);
      return response({ url: data!.signedUrl });
    }
    if (path === "team" && method === "GET") {
      if (role !== "admin") fail(403, "Acesso restrito a administradores.");
      const [members, invites] = await Promise.all([
        sb
          .from("fiscal_memberships")
          .select("user_id,role")
          .eq("organization_id", org),
        sb
          .from("fiscal_invitations")
          .select("id,role,expires_at,accepted_at,created_at")
          .eq("organization_id", org)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      check(members.error);
      check(invites.error);
      return response({ members: members.data, invitations: invites.data });
    }
    if (path === "invitations" && method === "POST") {
      if (role !== "admin")
        fail(403, "Apenas administradores podem convidar pessoas.");
      const b = await parse(req);
      if (!["operator", "viewer"].includes(b.role))
        fail(400, "Perfil inválido.");
      const { data, error } = await sb.rpc("fiscal_create_invitation", {
        org,
        invite_role: b.role,
      });
      check(error);
      return response(
        {
          url:
            req.headers.get("origin") + "/?invite=" + encodeURIComponent(data),
          expires_in_hours: 48,
        },
        201,
      );
    }
    if (path === "export" && method === "GET") {
      const { data, error } = await sb
        .from("fiscal_certificates")
        .select("*,companies:fiscal_companies(name,cnpj)")
        .eq("organization_id", org)
        .order("created_at", { ascending: false })
        .limit(5000);
      check(error);
      const rows = [
        [
          "Empresa",
          "CNPJ",
          "Tipo",
          "Resultado",
          "Emissão",
          "Validade",
          "Referência",
          "Situação",
        ],
        ...(data || []).map((c) => [
          c.companies?.name,
          c.companies?.cnpj,
          TYPES[c.type as keyof typeof TYPES],
          RESULTS[c.result as keyof typeof RESULTS],
          c.issued_at,
          c.expires_at,
          c.reference,
          certificateState(c),
        ]),
      ];
      return new Response(
        "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n"),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="certidoes.csv"',
            "Cache-Control": "private, no-store",
          },
        },
      );
    }
    fail(404, "Recurso não encontrado.");
  } catch (error) {
    if (error instanceof ApiError)
      return response({ error: error.message }, error.status);
    console.error(
      "API failed",
      error instanceof Error ? error.name : "Unknown",
    );
    return response(
      { error: "Não foi possível concluir a operação. Tente novamente." },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
