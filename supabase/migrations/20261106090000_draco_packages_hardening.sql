-- Draco Code: harden language + package storage at the database level.
-- Safe to run more than once. It only removes rows the backend could never have used.
--
-- What this fixes
--  * Invalid / unusable package rows could be stored (any 1-120 char text), so a typo could break runs.
--  * Names that differ only by case were stored twice.
--  * No per-user package limit (the backend silently ignored everything past 20).
--  * Packages could be saved for a language the account never added.
--  * Removing a language left its packages behind.
--  * user_id had no default, and the API schema cache could be stale after earlier migrations.

-- 1) The one definition of "a package this site can install", mirrored by the browser and the backend.
create or replace function public.draco_package_is_valid(p_language text, p_name text, p_version text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_name is null or p_version is null then false
    when p_version <> '' and p_version !~ '^[A-Za-z0-9.+_-]{1,80}$' then false
    when p_language = 'python'     then p_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
    when p_language = 'javascript' then p_name ~* '^(?:@[a-z0-9][a-z0-9._-]{0,49}/)?[a-z0-9][a-z0-9._-]{0,99}$'
    when p_language = 'java'       then p_name ~ '^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$'
    when p_language = 'c'          then p_name in ('libsqlite3-dev','libssl-dev','libcurl4-openssl-dev')
    when p_language = 'cpp'        then p_name in ('nlohmann-json3-dev','libboost-dev','libeigen3-dev','libfmt-dev')
    else false
  end
$$;

-- 2) Repair existing data first, so the new rules can be switched on.
delete from public.draco_user_packages
 where not public.draco_package_is_valid(language, package_name, package_version);

delete from public.draco_user_packages a
  using public.draco_user_packages b
 where a.user_id = b.user_id and a.language = b.language
   and lower(a.package_name) = lower(b.package_name)
   and (a.installed_at, a.package_name) > (b.installed_at, b.package_name);

delete from public.draco_user_packages p
 where p.language in ('java','c','cpp')
   and not exists (select 1 from public.draco_user_languages l where l.user_id = p.user_id and l.language = p.language);

-- 3) Rules enforced by the database itself.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'draco_user_packages_valid_chk') then
    alter table public.draco_user_packages
      add constraint draco_user_packages_valid_chk check (public.draco_package_is_valid(language, package_name, package_version));
  end if;
end $$;

create unique index if not exists draco_user_packages_ci_uidx
  on public.draco_user_packages (user_id, language, lower(package_name));

alter table public.draco_user_languages alter column user_id set default auth.uid();
alter table public.draco_user_packages  alter column user_id set default auth.uid();

create or replace function public.draco_packages_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.draco_user_packages where user_id = new.user_id and language = new.language) >= 20 then
    raise exception 'You can keep up to 20 packages per language. Remove one first.' using errcode = 'check_violation';
  end if;
  if new.language in ('java','c','cpp') and not exists (
       select 1 from public.draco_user_languages l where l.user_id = new.user_id and l.language = new.language) then
    raise exception 'Add this language to your account before adding packages for it.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists draco_packages_before_insert_trg on public.draco_user_packages;
create trigger draco_packages_before_insert_trg before insert on public.draco_user_packages
  for each row execute function public.draco_packages_before_insert();

-- Removing a language removes the packages that only made sense for it.
create or replace function public.draco_language_removed() returns trigger
language plpgsql set search_path = '' as $$
begin
  delete from public.draco_user_packages where user_id = old.user_id and language = old.language;
  return old;
end $$;
drop trigger if exists draco_language_removed_trg on public.draco_user_languages;
create trigger draco_language_removed_trg after delete on public.draco_user_languages
  for each row execute function public.draco_language_removed();

-- 4) Re-assert access rules (in case an earlier migration only partly applied). Owner-only, never anonymous.
alter table public.draco_user_languages enable row level security;
alter table public.draco_user_packages  enable row level security;
revoke all on public.draco_user_languages from anon;
revoke all on public.draco_user_packages  from anon;
grant select, insert, delete on public.draco_user_languages to authenticated;
grant select, insert, delete on public.draco_user_packages  to authenticated;
drop policy if exists "Users read their Draco languages" on public.draco_user_languages;
create policy "Users read their Draco languages" on public.draco_user_languages for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users add their Draco languages" on public.draco_user_languages;
create policy "Users add their Draco languages" on public.draco_user_languages for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users remove their Draco languages" on public.draco_user_languages;
create policy "Users remove their Draco languages" on public.draco_user_languages for delete to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users read their Draco packages" on public.draco_user_packages;
create policy "Users read their Draco packages" on public.draco_user_packages for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users add their Draco packages" on public.draco_user_packages;
create policy "Users add their Draco packages" on public.draco_user_packages for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users remove their Draco packages" on public.draco_user_packages;
create policy "Users remove their Draco packages" on public.draco_user_packages for delete to authenticated using ((select auth.uid()) = user_id);

-- 5) Make the API see the current tables and functions right away.
notify pgrst, 'reload schema';
