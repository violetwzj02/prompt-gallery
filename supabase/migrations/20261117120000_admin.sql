-- Admin helpers for the standalone console.
-- Apply in the Supabase SQL editor after the account-sync migration.
-- Does not promote any user to admin; set app_metadata.role = 'admin' in the dashboard.

create schema if not exists private;

-- Authorization must only read app_metadata. Users can edit user_metadata.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;
grant usage on schema private to authenticated;

-- Optional backup directory of registered accounts. The admin UI still lists
-- users through the Edge Function / Auth admin API (last sign-in, ban state).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null
);

create index if not exists profiles_created_at_idx
  on public.profiles (created_at desc);

create or replace function private.handle_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profiles (id, email, created_at)
    values (new.id, new.email, new.created_at)
    on conflict (id) do update
      set email = excluded.email;
    return new;
  end if;

  update public.profiles
  set email = new.email
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_profile on auth.users;
create trigger on_auth_user_profile
  after insert or update of email on auth.users
  for each row
  execute function private.handle_user_profile();

insert into public.profiles (id, email, created_at)
select id, email, created_at
from auth.users
on conflict (id) do update
  set email = excluded.email;

revoke all on table public.profiles from anon, authenticated, public;
grant select on table public.profiles to authenticated;

alter table public.profiles enable row level security;

drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
  on public.profiles for select to authenticated
  using (private.is_admin());

-- Trigger functions must not be callable by clients, even after schema USAGE.
revoke all on function private.handle_user_profile() from public, anon, authenticated;
revoke all on function private.is_admin() from public, anon;

-- Tighten leftover default EXECUTE on earlier private helpers.
revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.favorites_folder_owned() from public, anon, authenticated;
revoke all on function private.protect_default_folder() from public, anon, authenticated;
revoke all on function private.protect_folder_defaults() from public, anon, authenticated;
