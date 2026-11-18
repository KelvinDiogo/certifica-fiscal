import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const A = "00000000-0000-4000-a000-000000000001",
  B = "00000000-0000-4000-a000-000000000002",
  V = "00000000-0000-4000-a000-000000000003",
  O = "00000000-0000-4000-a000-000000000004";
test("actual Postgres RLS, grants, RPCs, triggers and storage isolate tenants", async (t) => {
  const db = await PGlite.create();
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;grant execute on function storage.foldername(text) to authenticated;insert into auth.users values('${A}'),('${B}'),('${V}'),('${O}');`,
  );
  const migrationDir = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(migrationDir))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(new URL(file, migrationDir), "utf8"));
  const as = async (user) =>
    db.exec(
      `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${user}',false)`,
    );
  const scalar = async (sql, params = []) =>
    Object.values((await db.query(sql, params)).rows[0])[0];
  await as(A);
  const orgA = await scalar(
    "select public.fiscal_create_organization('Cliente A')",
  );
  await as(B);
  const orgB = await scalar(
    "select public.fiscal_create_organization('Cliente B')",
  );
  let companyA, companyB;
  await t.test("members see only their own organizations", async () => {
    await as(A);
    assert.equal(
      await scalar("select count(*) from public.fiscal_organizations"),
      1,
    );
    assert.equal(
      await scalar("select name from public.fiscal_organizations"),
      "Cliente A",
    );
  });
  await t.test(
    "valid CNPJ inserts produce an immutable audit event",
    async () => {
      await as(A);
      companyA = await scalar(
        "insert into public.fiscal_companies(organization_id,name,cnpj,state,city) values($1,'Empresa A','11222333000181','SP','São Paulo') returning id",
        [orgA],
      );
      assert.equal(
        await scalar(
          "select count(*) from public.fiscal_audit_events where action='Empresa cadastrada'",
        ),
        1,
      );
      await assert.rejects(
        db.exec(
          "insert into public.fiscal_audit_events(organization_id,action,subject) values('" +
            orgA +
            "','Forged','fake')",
        ),
        /permission denied/,
      );
    },
  );
  await t.test(
    "a second tenant can use the same CNPJ without crossing data",
    async () => {
      await as(B);
      companyB = await scalar(
        "insert into public.fiscal_companies(organization_id,name,cnpj,state,city) values($1,'Empresa B','11222333000181','RJ','Rio de Janeiro') returning id",
        [orgB],
      );
      assert.equal(
        await scalar("select count(*) from public.fiscal_companies"),
        1,
      );
      assert.equal(
        await scalar("select name from public.fiscal_companies"),
        "Empresa B",
      );
    },
  );
  await t.test("cross-tenant reads and inserts are denied", async () => {
    await as(A);
    assert.equal(
      await scalar("select count(*) from public.fiscal_companies where id=$1", [
        companyB,
      ]),
      0,
    );
    await assert.rejects(
      db.query(
        "insert into public.fiscal_companies(organization_id,name,cnpj,state,city) values($1,'Evil','11222333000181','SP','São Paulo')",
        [orgB],
      ),
      /row-level security/,
    );
  });
  await t.test(
    "cross-tenant parent references are rejected by a composite foreign key",
    async () => {
      await as(A);
      await assert.rejects(
        db.query(
          "insert into public.fiscal_certificates(organization_id,company_id,type,result,issued_at,expires_at,reference) values($1,$2,'federal','negativa','2026-01-01','2027-01-01','x')",
          [orgA, companyB],
        ),
        /foreign key/,
      );
    },
  );
  await t.test(
    "invalid CNPJ is rejected through direct database access",
    async () => {
      await as(A);
      await assert.rejects(
        db.query(
          "insert into public.fiscal_companies(organization_id,name,cnpj,state,city) values($1,'Invalid','11222333000180','SP','São Paulo')",
          [orgA],
        ),
        /check constraint/,
      );
    },
  );
  await t.test(
    "negative and CPEN certificates are stored and audited",
    async () => {
      await as(A);
      await db.query(
        "insert into public.fiscal_certificates(organization_id,company_id,type,result,issued_at,expires_at,reference) values($1,$2,'federal','positiva_efeitos_negativa','2026-01-01','2027-01-01','RFB-123')",
        [orgA, companyA],
      );
      assert.equal(
        await scalar(
          "select count(*) from public.fiscal_audit_events where action='Certidão registrada manualmente'",
        ),
        1,
      );
    },
  );
  await t.test(
    "queries are blocked and clients cannot forge successful executions",
    async () => {
      await as(A);
      await db.query(
        "insert into public.fiscal_consultation_jobs(organization_id,company_id,type) values($1,$2,'federal')",
        [orgA, companyA],
      );
      assert.equal(
        await scalar("select status from public.fiscal_consultation_jobs"),
        "blocked",
      );
      await assert.rejects(
        db.query(
          "insert into public.fiscal_consultation_jobs(organization_id,company_id,type,status) values($1,$2,'federal','success')",
          [orgA, companyA],
        ),
        /permission denied/,
      );
    },
  );
  let viewerToken;
  await t.test(
    "invitation hash is not readable and token redemption grants the selected role",
    async () => {
      await as(A);
      viewerToken = await scalar(
        "select public.fiscal_create_invitation($1,'viewer')",
        [orgA],
      );
      assert.equal(viewerToken.length, 64);
      await assert.rejects(
        db.exec("select token_hash from public.fiscal_invitations"),
        /permission denied/,
      );
      await as(V);
      assert.equal(
        await scalar("select public.fiscal_accept_invitation($1)", [
          viewerToken,
        ]),
        orgA,
      );
      assert.equal(
        await scalar("select count(*) from public.fiscal_companies"),
        1,
      );
    },
  );
  await t.test(
    "viewers cannot write records, invite admins or grant themselves roles",
    async () => {
      await as(V);
      await assert.rejects(
        db.query(
          "insert into public.fiscal_companies(organization_id,name,cnpj,state,city) values($1,'Forbidden','12345678000195','SP','São Paulo')",
          [orgA],
        ),
        /row-level security/,
      );
      await assert.rejects(
        db.query("select public.fiscal_create_invitation($1,'operator')", [
          orgA,
        ]),
        /Administrator required/,
      );
      await assert.rejects(
        db.query(
          "update public.fiscal_memberships set role='admin' where user_id=$1",
          [V],
        ),
        /permission denied/,
      );
    },
  );
  await t.test(
    "a token is single use and cannot be replayed by another identity",
    async () => {
      await as(O);
      await assert.rejects(
        db.query("select public.fiscal_accept_invitation($1)", [viewerToken]),
        /already used/,
      );
    },
  );
  await t.test(
    "operators can register records but cannot invite people",
    async () => {
      await as(A);
      const token = await scalar(
        "select public.fiscal_create_invitation($1,'operator')",
        [orgA],
      );
      await as(O);
      await scalar("select public.fiscal_accept_invitation($1)", [token]);
      await db.query(
        "insert into public.fiscal_companies(organization_id,name,cnpj,state,city) values($1,'Operador','12ABC34501DE35','SP','São Paulo')",
        [orgA],
      );
      await assert.rejects(
        db.query("select public.fiscal_create_invitation($1,'viewer')", [orgA]),
        /Administrator required/,
      );
    },
  );
  await t.test("private PDFs are isolated by organization", async () => {
    await as(A);
    await db.query(
      "insert into storage.objects(bucket_id,name) values('fiscal-certificates',$1)",
      [orgA + "/test.pdf"],
    );
    await as(B);
    assert.equal(await scalar("select count(*) from storage.objects"), 0);
    await assert.rejects(
      db.query(
        "insert into storage.objects(bucket_id,name) values('fiscal-certificates',$1)",
        [orgA + "/evil.pdf"],
      ),
      /row-level security/,
    );
  });
  let inboxId, obligationId, routineId;
  await t.test(
    "module records enforce tenant parents and audit changes",
    async () => {
      await as(A);
      inboxId = await scalar(
        "insert into public.fiscal_inbox_messages(organization_id,company_id,subject,source,received_at,due_at) values($1,$2,'Notificação de teste','SEFAZ','2026-01-01','2026-01-30') returning id",
        [orgA, companyA],
      );
      obligationId = await scalar(
        "insert into public.fiscal_obligations(organization_id,company_id,type,subject,due_at) values($1,$2,'ISS','Declaração mensal','2026-02-01') returning id",
        [orgA, companyA],
      );
      await db.query(
        "update public.fiscal_inbox_messages set status='in_review',assignee='Equipe' where id=$1",
        [inboxId],
      );
      assert.equal(
        await scalar(
          "select count(*) from public.fiscal_audit_events where action='Caixa postal atualizada'",
        ),
        1,
      );
      await assert.rejects(
        db.query(
          "update public.fiscal_inbox_messages set organization_id=$1 where id=$2",
          [orgB, inboxId],
        ),
        /permission denied/,
      );
      await assert.rejects(
        db.query(
          "insert into public.fiscal_obligations(organization_id,company_id,type,subject,due_at) values($1,$2,'ITR','Referência cruzada','2026-02-01')",
          [orgA, companyB],
        ),
        /foreign key/,
      );
    },
  );
  await t.test(
    "reconciliation summaries are calculated by Postgres and records are immutable",
    async () => {
      await as(A);
      const reconciliationId = await scalar(
        "insert into public.fiscal_reconciliations(organization_id,company_id,inventory_date,fiscal_filename,erp_filename,items) values($1,$2,'2026-01-01','efd.txt','erp.csv',$3::jsonb) returning id",
        [
          orgA,
          companyA,
          JSON.stringify([
            { code: "A", status: "matched" },
            { code: "B", status: "quantity_mismatch" },
          ]),
        ],
      );
      assert.equal(
        await scalar(
          "select total_count from public.fiscal_reconciliations where id=$1",
          [reconciliationId],
        ),
        2,
      );
      assert.equal(
        await scalar(
          "select matched_count from public.fiscal_reconciliations where id=$1",
          [reconciliationId],
        ),
        1,
      );
      await assert.rejects(
        db.query(
          "update public.fiscal_reconciliations set items='[]'::jsonb where id=$1",
          [reconciliationId],
        ),
        /permission denied/,
      );
    },
  );
  await t.test("ERP run requests cannot execute or forge success", async () => {
    await as(A);
    routineId = await scalar(
      "insert into public.fiscal_erp_routines(organization_id,company_id,name,system,operation,steps) values($1,$2,'Extrair relatório','SAP','extract','[\"Exportar dados\"]'::jsonb) returning id",
      [orgA, companyA],
    );
    await db.query(
      "insert into public.fiscal_erp_runs(organization_id,routine_id) values($1,$2)",
      [orgA, routineId],
    );
    assert.equal(
      await scalar("select status from public.fiscal_erp_runs"),
      "blocked",
    );
    await assert.rejects(
      db.query(
        "insert into public.fiscal_erp_runs(organization_id,routine_id,status) values($1,$2,'success')",
        [orgA, routineId],
      ),
      /permission denied/,
    );
  });
  await t.test("viewers cannot modify messages or obligations", async () => {
    await as(V);
    assert.equal(
      await scalar("select count(*) from public.fiscal_inbox_messages"),
      1,
    );
    const result = await db.query(
      "update public.fiscal_inbox_messages set status='resolved' where id=$1 returning id",
      [inboxId],
    );
    assert.equal(result.rows.length, 0);
    const obligationResult = await db.query(
      "update public.fiscal_obligations set status='done' where id=$1 returning id",
      [obligationId],
    );
    assert.equal(obligationResult.rows.length, 0);
    await assert.rejects(
      db.query(
        "insert into public.fiscal_erp_runs(organization_id,routine_id) values($1,$2)",
        [orgA, routineId],
      ),
      /row-level security/,
    );
  });
  await t.test(
    "outsiders cannot read any operational module or attach an ERP run across tenants",
    async () => {
      await as(B);
      for (const table of [
        "fiscal_inbox_messages",
        "fiscal_obligations",
        "fiscal_reconciliations",
        "fiscal_erp_routines",
        "fiscal_erp_runs",
      ])
        assert.equal(
          await scalar("select count(*) from public." + table),
          0,
          table,
        );
      assert.equal(
        (
          await db.query(
            "update public.fiscal_inbox_messages set status='resolved' where id=$1 returning id",
            [inboxId],
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        db.query(
          "insert into public.fiscal_erp_runs(organization_id,routine_id) values($1,$2)",
          [orgB, routineId],
        ),
        /foreign key/,
      );
    },
  );
  await t.test(
    "unauthenticated users cannot read records or bootstrap organizations",
    async () => {
      await db.exec(
        "reset role;set role anon;select set_config('request.jwt.claim.sub','',false)",
      );
      await assert.rejects(
        db.exec("select * from public.fiscal_companies"),
        /permission denied/,
      );
      await assert.rejects(
        db.exec("select public.fiscal_create_organization('Forged')"),
        /permission denied/,
      );
    },
  );
  await db.close();
});
