-- Additive modules in the shared Nacena project. Existing objects are preserved.
create table public.fiscal_inbox_messages (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.fiscal_organizations(id),
 company_id uuid not null,
 subject text not null check(char_length(trim(subject)) between 3 and 200),
 source text not null check(char_length(trim(source)) between 2 and 120),
 body text not null default '' check(char_length(body)<=10000),
 received_at date not null,
 due_at date check(due_at is null or due_at>=received_at),
 status text not null default 'new' check(status in ('new','in_review','resolved')),
 assignee text not null default '' check(char_length(assignee)<=100),
 notes text not null default '' check(char_length(notes)<=2000),
 created_at timestamptz not null default now(),
 foreign key(company_id,organization_id) references public.fiscal_companies(id,organization_id)
);
create index fiscal_inbox_org_idx on public.fiscal_inbox_messages(organization_id,due_at);
create index fiscal_inbox_company_idx on public.fiscal_inbox_messages(company_id,organization_id);
create table public.fiscal_obligations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.fiscal_organizations(id),
 company_id uuid not null,
 type text not null check(type in ('ITR','ISS','SUFRAMA','OUTRA')),
 subject text not null check(char_length(trim(subject)) between 3 and 200),
 reference text not null default '' check(char_length(reference)<=200),
 due_at date not null,
 status text not null default 'pending' check(status in ('pending','in_progress','done')),
 assignee text not null default '' check(char_length(assignee)<=100),
 notes text not null default '' check(char_length(notes)<=2000),
 created_at timestamptz not null default now(),
 foreign key(company_id,organization_id) references public.fiscal_companies(id,organization_id)
);
create index fiscal_obligations_org_idx on public.fiscal_obligations(organization_id,due_at);
create index fiscal_obligations_company_idx on public.fiscal_obligations(company_id,organization_id);
create table public.fiscal_reconciliations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.fiscal_organizations(id),
 company_id uuid not null,
 inventory_date date not null,
 fiscal_filename text not null check(char_length(fiscal_filename) between 1 and 200),
 erp_filename text not null check(char_length(erp_filename) between 1 and 200),
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 10000),
 excluded_count integer not null default 0 check(excluded_count>=0),
 total_count integer generated always as (jsonb_array_length(items)) stored,
 matched_count integer generated always as (jsonb_array_length(jsonb_path_query_array(items,'$[*] ? (@.status == "matched")'))) stored,
 created_at timestamptz not null default now(),
 foreign key(company_id,organization_id) references public.fiscal_companies(id,organization_id)
);
create index fiscal_reconciliations_org_idx on public.fiscal_reconciliations(organization_id,created_at desc);
create index fiscal_reconciliations_company_idx on public.fiscal_reconciliations(company_id,organization_id);
create table public.fiscal_erp_routines (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.fiscal_organizations(id),
 company_id uuid not null,
 name text not null check(char_length(trim(name)) between 3 and 150),
 system text not null check(system in ('SAP','PROTHEUS','OUTRO')),
 operation text not null check(operation in ('extract','insert','invoice','reconcile')),
 steps jsonb not null check(jsonb_typeof(steps)='array' and jsonb_array_length(steps) between 1 and 20),
 notes text not null default '' check(char_length(notes)<=2000),
 created_at timestamptz not null default now(),
 unique(id,organization_id),
 foreign key(company_id,organization_id) references public.fiscal_companies(id,organization_id)
);
create index fiscal_erp_routines_org_idx on public.fiscal_erp_routines(organization_id,created_at desc);
create index fiscal_erp_routines_company_idx on public.fiscal_erp_routines(company_id,organization_id);
create table public.fiscal_erp_runs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.fiscal_organizations(id),
 routine_id uuid not null,
 status text not null default 'blocked' check(status='blocked'),
 message text not null default 'Conector ERP não configurado. Nenhuma transação foi executada.',
 created_at timestamptz not null default now(),
 foreign key(routine_id,organization_id) references public.fiscal_erp_routines(id,organization_id)
);
create index fiscal_erp_runs_org_idx on public.fiscal_erp_runs(organization_id,created_at desc);
create index fiscal_erp_runs_routine_idx on public.fiscal_erp_runs(routine_id,organization_id);

alter table public.fiscal_inbox_messages enable row level security;
alter table public.fiscal_obligations enable row level security;
alter table public.fiscal_reconciliations enable row level security;
alter table public.fiscal_erp_routines enable row level security;
alter table public.fiscal_erp_runs enable row level security;
create policy inbox_read on public.fiscal_inbox_messages for select to authenticated using(fiscal_private.organization_role(organization_id) is not null);
create policy inbox_insert on public.fiscal_inbox_messages for insert to authenticated with check(fiscal_private.organization_role(organization_id) in ('admin','operator'));
create policy inbox_update on public.fiscal_inbox_messages for update to authenticated using(fiscal_private.organization_role(organization_id) in ('admin','operator')) with check(fiscal_private.organization_role(organization_id) in ('admin','operator'));
create policy obligations_read on public.fiscal_obligations for select to authenticated using(fiscal_private.organization_role(organization_id) is not null);
create policy obligations_insert on public.fiscal_obligations for insert to authenticated with check(fiscal_private.organization_role(organization_id) in ('admin','operator'));
create policy obligations_update on public.fiscal_obligations for update to authenticated using(fiscal_private.organization_role(organization_id) in ('admin','operator')) with check(fiscal_private.organization_role(organization_id) in ('admin','operator'));
create policy reconciliations_read on public.fiscal_reconciliations for select to authenticated using(fiscal_private.organization_role(organization_id) is not null);
create policy reconciliations_insert on public.fiscal_reconciliations for insert to authenticated with check(fiscal_private.organization_role(organization_id) in ('admin','operator'));
create policy erp_routines_read on public.fiscal_erp_routines for select to authenticated using(fiscal_private.organization_role(organization_id) is not null);
create policy erp_routines_insert on public.fiscal_erp_routines for insert to authenticated with check(fiscal_private.organization_role(organization_id) in ('admin','operator'));
create policy erp_runs_read on public.fiscal_erp_runs for select to authenticated using(fiscal_private.organization_role(organization_id) is not null);
create policy erp_runs_insert on public.fiscal_erp_runs for insert to authenticated with check(fiscal_private.organization_role(organization_id) in ('admin','operator'));
revoke all on public.fiscal_inbox_messages,public.fiscal_obligations,public.fiscal_reconciliations,public.fiscal_erp_routines,public.fiscal_erp_runs from anon,authenticated;
grant select on public.fiscal_inbox_messages,public.fiscal_obligations,public.fiscal_reconciliations,public.fiscal_erp_routines,public.fiscal_erp_runs to authenticated;
grant insert on public.fiscal_inbox_messages,public.fiscal_obligations,public.fiscal_reconciliations,public.fiscal_erp_routines to authenticated;
grant insert(organization_id,routine_id) on public.fiscal_erp_runs to authenticated;
-- Original content, parent references and tenant cannot be moved through updates.
grant update(status,assignee,notes) on public.fiscal_inbox_messages,public.fiscal_obligations to authenticated;
create function fiscal_private.audit_module_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data jsonb:=to_jsonb(new); subject_text text; action_text text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 action_text:=case tg_table_name when 'fiscal_inbox_messages' then 'Caixa postal' when 'fiscal_obligations' then 'Obrigação' when 'fiscal_reconciliations' then 'Conciliação de estoque' when 'fiscal_erp_routines' then 'Rotina ERP' else 'Solicitação ERP bloqueada' end;
 subject_text:=coalesce(row_data->>'subject',row_data->>'name',row_data->>'fiscal_filename',row_data->>'routine_id');
 insert into public.fiscal_audit_events(organization_id,user_id,action,subject)
 values(new.organization_id,auth.uid(),action_text||case when tg_op='UPDATE' then ' atualizada' else ' registrada' end,subject_text||coalesce(' · '||(row_data->>'status'),''));
 return new;
end; $$;
revoke all on function fiscal_private.audit_module_change() from public,anon,authenticated;
create trigger fiscal_inbox_audit after insert or update on public.fiscal_inbox_messages for each row execute function fiscal_private.audit_module_change();
create trigger fiscal_obligation_audit after insert or update on public.fiscal_obligations for each row execute function fiscal_private.audit_module_change();
create trigger fiscal_reconciliation_audit after insert on public.fiscal_reconciliations for each row execute function fiscal_private.audit_module_change();
create trigger fiscal_routine_audit after insert on public.fiscal_erp_routines for each row execute function fiscal_private.audit_module_change();
create trigger fiscal_run_audit after insert on public.fiscal_erp_runs for each row execute function fiscal_private.audit_module_change();
