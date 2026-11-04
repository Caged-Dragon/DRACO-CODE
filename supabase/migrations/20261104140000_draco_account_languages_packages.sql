create table if not exists public.draco_user_languages (
  user_id uuid not null references auth.users(id) on delete cascade,
  language text not null check (language in ('java','c','cpp')),
  installed_at timestamptz not null default now(),
  primary key (user_id, language)
);
alter table public.draco_user_languages enable row level security;
revoke all on public.draco_user_languages from anon;
grant select, insert, delete on public.draco_user_languages to authenticated;
create policy "Users read their Draco languages" on public.draco_user_languages for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add their Draco languages" on public.draco_user_languages for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users remove their Draco languages" on public.draco_user_languages for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.draco_user_packages (
  user_id uuid not null references auth.users(id) on delete cascade,
  language text not null check (language in ('python','javascript','java','c','cpp')),
  package_name text not null check (char_length(package_name) between 1 and 120),
  package_version text not null default '' check (char_length(package_version) <= 80),
  installed_at timestamptz not null default now(),
  primary key (user_id, language, package_name)
);
alter table public.draco_user_packages enable row level security;
revoke all on public.draco_user_packages from anon;
grant select, insert, delete on public.draco_user_packages to authenticated;
create policy "Users read their Draco packages" on public.draco_user_packages for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add their Draco packages" on public.draco_user_packages for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users remove their Draco packages" on public.draco_user_packages for delete to authenticated using ((select auth.uid()) = user_id);
create index if not exists draco_user_packages_owner_language_idx on public.draco_user_packages(user_id, language);
