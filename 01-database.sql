-- 事業場ノート 1.0 : Supabase SQL Editor で全体を実行してください。
-- 新しい専用プロジェクト向け。既存データの削除処理はありません。
begin;

create table if not exists public.hoan_owners (
 user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.hoan_owners enable row level security;
revoke all on public.hoan_owners from anon, authenticated;
grant select on public.hoan_owners to authenticated;
drop policy if exists hoan_owner_read on public.hoan_owners;
create policy hoan_owner_read on public.hoan_owners for select to authenticated using (user_id=(select auth.uid()));

create or replace function public.hoan_is_owner() returns boolean
language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.hoan_owners where user_id=(select auth.uid())); $$;
revoke all on function public.hoan_is_owner() from public, anon;
grant execute on function public.hoan_is_owner() to authenticated;

create sequence if not exists public.hoan_revision_seq;
revoke all on sequence public.hoan_revision_seq from anon, authenticated;
create table if not exists public.hoan_records (
 owner_id uuid not null references auth.users(id) on delete cascade,
 id text not null check(length(id) between 1 and 120),
 doc jsonb not null check(jsonb_typeof(doc)='object'),
 version bigint not null default 1 check(version>0),
 revision bigint not null default nextval('public.hoan_revision_seq'),
 mutation_id text not null,
 updated_at timestamptz not null default clock_timestamp(),
 primary key(owner_id,id)
);
alter table public.hoan_records enable row level security;
create index if not exists hoan_records_changes on public.hoan_records(owner_id,revision);
revoke all on public.hoan_records from anon, authenticated;
grant select on public.hoan_records to authenticated;
drop policy if exists hoan_record_read on public.hoan_records;
create policy hoan_record_read on public.hoan_records for select to authenticated
 using(owner_id=(select auth.uid()) and (select public.hoan_is_owner()));

-- Receipts make retries safe, including a lost response after a committed write.
create table if not exists public.hoan_receipts (
 owner_id uuid not null references auth.users(id) on delete cascade,
 mutation_id text not null,
 record_id text not null,
 applied_version bigint not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(owner_id,mutation_id)
);
alter table public.hoan_receipts enable row level security;
revoke all on public.hoan_receipts from anon, authenticated;

create or replace function public.hoan_put_record(p_id text,p_doc jsonb,p_base_version bigint,p_mutation_id text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 uid uuid := auth.uid();
 current_row public.hoan_records%rowtype;
 receipt public.hoan_receipts%rowtype;
 current_version bigint := 0;
 next_version bigint;
begin
 if uid is null or not public.hoan_is_owner() then raise exception 'owner_required' using errcode='42501'; end if;
 if p_id is null or length(p_id) not between 1 and 120 or p_mutation_id is null or length(p_mutation_id) not between 1 and 120 or p_base_version is null or p_base_version<0 then
  raise exception 'invalid_record';
 end if;
 if p_doc is null or jsonb_typeof(p_doc) is distinct from 'object'
  or p_doc->>'id' is distinct from p_id
  or coalesce(p_doc->>'kind','') not in ('region','site','equipment','task','field','attachment')
  or jsonb_typeof(p_doc->'values') is distinct from 'object'
  or jsonb_typeof(p_doc->'deleted') is distinct from 'boolean'
  or not(p_doc ? 'parentId')
  or jsonb_typeof(p_doc->'parentId') not in ('null','string')
  or octet_length(p_doc::text)>1000000 then raise exception 'invalid_record'; end if;

 -- Serialize this owner's commits so an incremental cursor cannot skip a late commit.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,0));
 select * into receipt from public.hoan_receipts where owner_id=uid and mutation_id=p_mutation_id;
 if found then
  if receipt.record_id<>p_id then raise exception 'mutation_id_reused'; end if;
  return jsonb_build_object('status','ok','version',receipt.applied_version);
 end if;
 select * into current_row from public.hoan_records where owner_id=uid and id=p_id;
 if found then current_version:=current_row.version; end if;
 if current_version<>p_base_version then
  return jsonb_build_object('status','conflict','record',jsonb_build_object('id',current_row.id,'doc',current_row.doc,'version',current_row.version,'mutation_id',current_row.mutation_id));
 end if;
 next_version:=current_version+1;
 insert into public.hoan_records(owner_id,id,doc,version,mutation_id,updated_at)
 values(uid,p_id,p_doc,next_version,p_mutation_id,clock_timestamp())
 on conflict(owner_id,id) do update set doc=excluded.doc,version=excluded.version,revision=excluded.revision,mutation_id=excluded.mutation_id,updated_at=excluded.updated_at;
 insert into public.hoan_receipts(owner_id,mutation_id,record_id,applied_version) values(uid,p_mutation_id,p_id,next_version);
 return jsonb_build_object('status','ok','version',next_version);
end;
$$;
revoke all on function public.hoan_put_record(text,jsonb,bigint,text) from public, anon;
grant execute on function public.hoan_put_record(text,jsonb,bigint,text) to authenticated;

create or replace function public.hoan_changes(p_after bigint default 0)
returns jsonb language sql stable security invoker set search_path=''
as $$
 select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(changed)-'revision'),'[]'::jsonb),
  'cursor',coalesce(max(revision),p_after))
 from (select id,doc,version,mutation_id,revision from public.hoan_records
  where owner_id=(select auth.uid()) and revision>greatest(p_after,0)
  order by revision limit 500) changed;
$$;
revoke all on function public.hoan_changes(bigint) from public, anon;
grant execute on function public.hoan_changes(bigint) to authenticated;

-- A private bucket; only the registered owner's own path is accessible.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('hoan-assets','hoan-assets',false,20971520,array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists hoan_asset_select on storage.objects;
drop policy if exists hoan_asset_insert on storage.objects;
drop policy if exists hoan_asset_update on storage.objects;
create policy hoan_asset_select on storage.objects for select to authenticated
 using(bucket_id='hoan-assets' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.hoan_is_owner()));
create policy hoan_asset_insert on storage.objects for insert to authenticated
 with check(bucket_id='hoan-assets' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.hoan_is_owner()));
create policy hoan_asset_update on storage.objects for update to authenticated
 using(bucket_id='hoan-assets' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.hoan_is_owner()))
 with check(bucket_id='hoan-assets' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.hoan_is_owner()));
commit;
