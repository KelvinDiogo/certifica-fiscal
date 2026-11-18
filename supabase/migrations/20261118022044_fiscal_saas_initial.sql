-- Multi-tenant fiscal MVP. No fiscal connector is enabled by this migration.
create schema if not exists fiscal_private;
revoke all on schema fiscal_private from public, anon;
grant usage on schema fiscal_private to authenticated;

create table public.fiscal_organizations (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(trim(name)) between 2 and 100),
 created_at timestamptz not null default now()
);
create table public.fiscal_memberships (
 organization_id uuid not null references public.fiscal_organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check (role in ('admin','operator','viewer')),
 primary key (organization_id,user_id)
);
create index memberships_user_idx on public.fiscal_memberships(user_id,organization_id);

create function fiscal_private.valid_cnpj(value text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare weights integer[]:=array[5,4,3,2,9,8,7,6,5,4,3,2]; s integer; r integer; d integer; i integer;
begin
 if value !~ '^[A-Z0-9]{12}[0-9]{2}$' or value ~ '^([0-9])\1{13}$' then return false; end if;
 s:=0;
 for i in 1..12 loop s:=s+(ascii(substr(value,i,1))-48)*weights[i]; end loop;
 r:=s%11; d:=case when r<2 then 0 else 11-r end;
 if d<>substr(value,13,1)::integer then return false; end if;
 weights:=array[6,5,4,3,2,9,8,7,6,5,4,3,2]; s:=0;
 for i in 1..13 loop s:=s+(ascii(substr(value,i,1))-48)*weights[i]; end loop;
 r:=s%11; d:=case when r<2 then 0 else 11-r end;
 return d=substr(value,14,1)::integer;
end; $$;
revoke all on function fiscal_private.valid_cnpj(text) from public,anon;
grant execute on function fiscal_private.valid_cnpj(text) to authenticated;

create table public.fiscal_companies (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.fiscal_organizations(id),
 name text not null check (char_length(trim(name)) between 2 and 150),
 cnpj text not null check (fiscal_private.valid_cnpj(cnpj)),
 state text not null check (state in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
 city text not null check (char_length(trim(city)) between 2 and 100),
 created_at timestamptz not null default now(),
 unique(organization_id,cnpj), unique(id,organization_id)
);
create table public.fiscal_certificates (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.fiscal_organizations(id),
 company_id uuid not null,
 type text not null check(type in ('federal','estadual','municipal','fgts','trabalhista')),
 result text not null check(result in ('negativa','positiva_efeitos_negativa','positiva','nao_verificada')),
 issued_at date not null,
 expires_at date not null check(expires_at>=issued_at),
 reference text not null check(char_length(trim(reference)) between 1 and 200),
 notes text not null default '' check(char_length(notes)<=2000),
 document_path text check(document_path is null or document_path like organization_id::text||'/%'),
 created_at timestamptz not null default now(),
 foreign key(company_id,organization_id) references public.fiscal_companies(id,organization_id),
 check(issued_at<=(now() at time zone 'America/Sao_Paulo')::date)
);
create index certificates_company_idx on public.fiscal_certificates(organization_id,company_id,type,issued_at desc,created_at desc,id desc);
create table public.fiscal_consultation_jobs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.fiscal_organizations(id),
 company_id uuid not null,
 type text not null check(type in ('federal','estadual','municipal','fgts','trabalhista')),
 status text not null default 'blocked' check(status='blocked'),
 message text not null default 'Conector fiscal não configurado. Consulta não executada.',
 created_at timestamptz not null default now(),
 foreign key(company_id,organization_id) references public.fiscal_companies(id,organization_id)
);
create index consultation_jobs_org_idx on public.fiscal_consultation_jobs(organization_id,created_at desc);
create table public.fiscal_audit_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.fiscal_organizations(id),
 user_id uuid references auth.users(id) on delete set null,
 action text not null, subject text not null,
 created_at timestamptz not null default now()
);
create index audit_events_org_idx on public.fiscal_audit_events(organization_id,created_at desc);
create index audit_events_user_idx on public.fiscal_audit_events(user_id);
create table public.fiscal_invitations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.fiscal_organizations(id),
 token_hash text not null unique,
 role text not null check(role in ('operator','viewer')),
 expires_at timestamptz not null,
 accepted_at timestamptz,
 created_at timestamptz not null default now()
);
create index invitations_org_idx on public.fiscal_invitations(organization_id);

-- Private, fixed-search-path definer helper avoids recursive membership policies.
create function fiscal_private.organization_role(org uuid) returns text
language sql stable security definer set search_path='' as $$
 select m.role from public.fiscal_memberships m
 where m.organization_id=org and m.user_id=(select auth.uid()) and (select auth.uid()) is not null
$$;
revoke all on function fiscal_private.organization_role(uuid) from public,anon;
grant execute on function fiscal_private.organization_role(uuid) to authenticated;

alter table public.fiscal_organizations enable row level security;
alter table public.fiscal_memberships enable row level security;
alter table public.fiscal_companies enable row level security;
alter table public.fiscal_certificates enable row level security;
alter table public.fiscal_consultation_jobs enable row level security;
alter table public.fiscal_audit_events enable row level security;
alter table public.fiscal_invitations enable row level security;

create policy organizations_read on public.fiscal_organizations for select to authenticated using(fiscal_private.organization_role(id) is not null);
create policy memberships_read on public.fiscal_memberships for select to authenticated using(fiscal_private.organization_role(organization_id) is not null);
create policy companies_read on public.fiscal_companies for select to authenticated using(fiscal_private.organization_role(organization_id) is not null);
create policy companies_insert on public.fiscal_companies for insert to authenticated with check(fiscal_private.organization_role(organization_id) in ('admin','operator'));
create policy certificates_read on public.fiscal_certificates for select to authenticated using(fiscal_private.organization_role(organization_id) is not null);
create policy certificates_insert on public.fiscal_certificates for insert to authenticated with check(fiscal_private.organization_role(organization_id) in ('admin','operator'));
create policy jobs_read on public.fiscal_consultation_jobs for select to authenticated using(fiscal_private.organization_role(organization_id) is not null);
create policy jobs_insert on public.fiscal_consultation_jobs for insert to authenticated with check(fiscal_private.organization_role(organization_id) in ('admin','operator'));
create policy audit_read on public.fiscal_audit_events for select to authenticated using(fiscal_private.organization_role(organization_id) is not null);
create policy invitations_read on public.fiscal_invitations for select to authenticated using(fiscal_private.organization_role(organization_id)='admin');

revoke all on public.fiscal_organizations,public.fiscal_memberships,public.fiscal_companies,public.fiscal_certificates,public.fiscal_consultation_jobs,public.fiscal_audit_events,public.fiscal_invitations from anon,authenticated;
grant select on public.fiscal_organizations,public.fiscal_memberships,public.fiscal_companies,public.fiscal_certificates,public.fiscal_consultation_jobs,public.fiscal_audit_events to authenticated;
grant insert on public.fiscal_companies,public.fiscal_certificates to authenticated;
grant insert(organization_id,company_id,type) on public.fiscal_consultation_jobs to authenticated;
grant select(id,organization_id,role,expires_at,accepted_at,created_at) on public.fiscal_invitations to authenticated;

-- Audit is written by database triggers; clients cannot forge audit records.
create function fiscal_private.audit_insert() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 insert into public.fiscal_audit_events(organization_id,user_id,action,subject)
 values(new.organization_id,auth.uid(),case tg_table_name when 'fiscal_companies' then 'Empresa cadastrada' when 'fiscal_certificates' then 'Certidão registrada manualmente' else 'Consulta bloqueada — sem conector' end,
 case tg_table_name when 'fiscal_companies' then to_jsonb(new)->>'name' else (select c.name from public.fiscal_companies c where c.id=(to_jsonb(new)->>'company_id')::uuid and c.organization_id=new.organization_id)||' · '||(to_jsonb(new)->>'type') end);
 return new;
end; $$;
revoke all on function fiscal_private.audit_insert() from public,anon,authenticated;
create trigger audit_company after insert on public.fiscal_companies for each row execute function fiscal_private.audit_insert();
create trigger audit_certificate after insert on public.fiscal_certificates for each row execute function fiscal_private.audit_insert();
create trigger audit_job after insert on public.fiscal_consultation_jobs for each row execute function fiscal_private.audit_insert();

create function fiscal_private.create_organization(org_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare org uuid; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 insert into public.fiscal_organizations(name) values(trim(org_name)) returning id into org;
 insert into public.fiscal_memberships values(org,uid,'admin');
 insert into public.fiscal_audit_events(organization_id,user_id,action,subject) values(org,uid,'Ambiente criado',trim(org_name));
 return org;
end; $$;
create function public.fiscal_create_organization(org_name text) returns uuid
language sql security invoker set search_path='' as $$select fiscal_private.create_organization(org_name)$$;
revoke all on function fiscal_private.create_organization(text),public.fiscal_create_organization(text) from public,anon;
grant execute on function fiscal_private.create_organization(text),public.fiscal_create_organization(text) to authenticated;

create function fiscal_private.create_invitation(org uuid,invite_role text) returns text
language plpgsql security definer set search_path='' as $$
declare token text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
begin
 if auth.uid() is null or fiscal_private.organization_role(org) is distinct from 'admin' then raise exception 'Administrator required' using errcode='42501'; end if;
 if invite_role not in ('operator','viewer') then raise exception 'Invalid role' using errcode='22023'; end if;
 insert into public.fiscal_invitations(organization_id,token_hash,role,expires_at) values(org,encode(sha256(convert_to(token,'UTF8')),'hex'),invite_role,now()+interval '48 hours');
 insert into public.fiscal_audit_events(organization_id,user_id,action,subject) values(org,auth.uid(),'Convite criado',invite_role);
 return token;
end; $$;
create function public.fiscal_create_invitation(org uuid,invite_role text) returns text
language sql security invoker set search_path='' as $$select fiscal_private.create_invitation(org,invite_role)$$;
revoke all on function fiscal_private.create_invitation(uuid,text),public.fiscal_create_invitation(uuid,text) from public,anon;
grant execute on function fiscal_private.create_invitation(uuid,text),public.fiscal_create_invitation(uuid,text) to authenticated;

create function fiscal_private.accept_invitation(token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare invite public.fiscal_invitations; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if char_length(token)<>64 then raise exception 'Invalid invitation' using errcode='22023'; end if;
 select * into invite from public.fiscal_invitations where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') for update;
 if invite.id is null or invite.accepted_at is not null or invite.expires_at<=now() then raise exception 'Invitation invalid, expired or already used' using errcode='22023'; end if;
 if exists(select 1 from public.fiscal_memberships where organization_id=invite.organization_id and user_id=uid) then raise exception 'Already a member' using errcode='22023'; end if;
 insert into public.fiscal_memberships values(invite.organization_id,uid,invite.role);
 update public.fiscal_invitations set accepted_at=now() where id=invite.id;
 insert into public.fiscal_audit_events(organization_id,user_id,action,subject) values(invite.organization_id,uid,'Convite aceito',invite.role);
 return invite.organization_id;
end; $$;
create function public.fiscal_accept_invitation(token text) returns uuid
language sql security invoker set search_path='' as $$select fiscal_private.accept_invitation(token)$$;
revoke all on function fiscal_private.accept_invitation(text),public.fiscal_accept_invitation(text) from public,anon;
grant execute on function fiscal_private.accept_invitation(text),public.fiscal_accept_invitation(text) to authenticated;

-- Private PDF bucket. No public documents or service-role browser keys.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('fiscal-certificates','fiscal-certificates',false,10485760,array['application/pdf']);
create policy certificate_files_read on storage.objects for select to authenticated
 using(bucket_id='fiscal-certificates' and fiscal_private.organization_role((storage.foldername(name))[1]::uuid) is not null);
create policy certificate_files_insert on storage.objects for insert to authenticated
 with check(bucket_id='fiscal-certificates' and fiscal_private.organization_role((storage.foldername(name))[1]::uuid) in ('admin','operator'));
create policy certificate_files_delete on storage.objects for delete to authenticated
 using(bucket_id='fiscal-certificates' and fiscal_private.organization_role((storage.foldername(name))[1]::uuid) in ('admin','operator') and not exists(select 1 from public.fiscal_certificates c where c.document_path=storage.objects.name));
