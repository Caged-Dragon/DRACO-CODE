-- Draco Code: Project mode (account holders only).
-- Additive and idempotent. Does not touch any existing table or function.

create table if not exists public.draco_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  language text not null check (language in ('python','javascript','java','c','cpp')),
  entry_path text check (entry_path is null or char_length(entry_path) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists draco_projects_user_updated_idx on public.draco_projects(user_id, updated_at desc);

create table if not exists public.draco_project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.draco_projects(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path text not null check (
    char_length(path) between 1 and 200
    and path ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$'
  ),
  is_folder boolean not null default false,
  content text not null default '' check (octet_length(content) <= 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, path),
  check (not is_folder or content = '')
);
create index if not exists draco_project_files_user_idx on public.draco_project_files(user_id);

alter table public.draco_projects enable row level security;
alter table public.draco_project_files enable row level security;
revoke all on public.draco_projects from anon;
revoke all on public.draco_project_files from anon;
grant select, insert, update, delete on public.draco_projects to authenticated;
grant select, insert, update, delete on public.draco_project_files to authenticated;

drop policy if exists "Users read their projects" on public.draco_projects;
create policy "Users read their projects" on public.draco_projects for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users create their projects" on public.draco_projects;
create policy "Users create their projects" on public.draco_projects for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users update their projects" on public.draco_projects;
create policy "Users update their projects" on public.draco_projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete their projects" on public.draco_projects;
create policy "Users delete their projects" on public.draco_projects for delete to authenticated using ((select auth.uid()) = user_id);

-- A file row must belong to the caller AND sit inside a project the caller owns.
drop policy if exists "Users read their project files" on public.draco_project_files;
create policy "Users read their project files" on public.draco_project_files for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users create their project files" on public.draco_project_files;
create policy "Users create their project files" on public.draco_project_files for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (select 1 from public.draco_projects p where p.id = project_id and p.user_id = (select auth.uid())));
drop policy if exists "Users update their project files" on public.draco_project_files;
create policy "Users update their project files" on public.draco_project_files for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (select 1 from public.draco_projects p where p.id = project_id and p.user_id = (select auth.uid())));
drop policy if exists "Users delete their project files" on public.draco_project_files;
create policy "Users delete their project files" on public.draco_project_files for delete to authenticated using ((select auth.uid()) = user_id);

-- Limits: 25 projects per user; 100 entries and 300 KB per project.
create or replace function public.draco_projects_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.draco_projects where user_id = new.user_id) >= 25 then
    raise exception 'Project limit reached (25). Delete a project first.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists draco_projects_limit_trg on public.draco_projects;
create trigger draco_projects_limit_trg before insert on public.draco_projects for each row execute function public.draco_projects_limit();

create or replace function public.draco_project_files_limits() returns trigger
language plpgsql set search_path = '' as $$
declare n int; bytes bigint;
begin
  select count(*), coalesce(sum(octet_length(content)), 0) into n, bytes
    from public.draco_project_files where project_id = new.project_id and id <> new.id;
  if n >= 100 then raise exception 'A project can hold at most 100 files and folders.' using errcode = 'check_violation'; end if;
  if bytes + octet_length(new.content) > 300000 then raise exception 'Project is larger than 300 KB.' using errcode = 'check_violation'; end if;
  return new;
end $$;
drop trigger if exists draco_project_files_limits_trg on public.draco_project_files;
create trigger draco_project_files_limits_trg before insert or update of content, project_id on public.draco_project_files for each row execute function public.draco_project_files_limits();

-- Keep updated_at honest.
create or replace function public.draco_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists draco_projects_touch on public.draco_projects;
create trigger draco_projects_touch before update on public.draco_projects for each row execute function public.draco_touch();
drop trigger if exists draco_project_files_touch on public.draco_project_files;
create trigger draco_project_files_touch before update on public.draco_project_files for each row execute function public.draco_touch();

create or replace function public.draco_bump_project() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.draco_projects set updated_at = now() where id = coalesce(new.project_id, old.project_id);
  return null;
end $$;
drop trigger if exists draco_project_files_bump on public.draco_project_files;
create trigger draco_project_files_bump after insert or update or delete on public.draco_project_files for each row execute function public.draco_bump_project();

-- Atomic folder rename / delete. SECURITY INVOKER, so RLS still applies to every row touched.
create or replace function public.draco_rename_path(p_project uuid, p_old text, p_new text) returns void
language sql security invoker set search_path = '' as $$
  update public.draco_project_files
     set path = p_new || substr(path, char_length(p_old) + 1)
   where project_id = p_project and (path = p_old or left(path, char_length(p_old) + 1) = p_old || '/');
$$;
create or replace function public.draco_delete_path(p_project uuid, p_path text) returns void
language sql security invoker set search_path = '' as $$
  delete from public.draco_project_files
   where project_id = p_project and (path = p_path or left(path, char_length(p_path) + 1) = p_path || '/');
$$;
revoke all on function public.draco_rename_path(uuid, text, text) from public, anon;
revoke all on function public.draco_delete_path(uuid, text) from public, anon;
grant execute on function public.draco_rename_path(uuid, text, text) to authenticated;
grant execute on function public.draco_delete_path(uuid, text) to authenticated;
