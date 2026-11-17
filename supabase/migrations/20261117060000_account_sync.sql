-- Per-account likes, favorite folders, and shared custom style assets.
-- Apply in the Supabase SQL editor, or with the CLI against the Free project.
-- RLS is enabled on every public table. Default grants are revoked first.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null check (char_length(item_id) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table public.favorite_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index favorite_folders_one_default
  on public.favorite_folders (user_id)
  where is_default;

create index favorite_folders_user_id_idx
  on public.favorite_folders (user_id);

create table public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null check (char_length(item_id) between 1 and 200),
  folder_id uuid not null references public.favorite_folders (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create index favorites_folder_id_idx
  on public.favorites (folder_id);

create table public.custom_styles (
  id text primary key check (char_length(id) between 1 and 200),
  owner_id uuid not null references auth.users (id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index custom_styles_owner_id_idx
  on public.custom_styles (owner_id);

create index custom_styles_created_at_idx
  on public.custom_styles (created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger custom_styles_set_updated_at
  before update on public.custom_styles
  for each row
  execute function private.set_updated_at();

-- Auto-create the default folder when a user signs up.
-- Security definer lives in the private schema (not exposed by the Data API).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.favorite_folders (user_id, name, is_default)
  values (new.id, '默认收藏夹', true);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_new_user();

-- Folder must belong to the same user as the favorite row.
create or replace function private.favorites_folder_owned()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.favorite_folders f
    where f.id = new.folder_id
      and f.user_id = new.user_id
  ) then
    raise exception 'favorite folder does not belong to user';
  end if;
  return new;
end;
$$;

create trigger favorites_folder_owned
  before insert or update on public.favorites
  for each row
  execute function private.favorites_folder_owned();

-- Prevent deleting the default folder.
create or replace function private.protect_default_folder()
returns trigger
language plpgsql
as $$
begin
  if old.is_default then
    raise exception 'cannot delete the default favorite folder';
  end if;
  return old;
end;
$$;

create trigger protect_default_folder
  before delete on public.favorite_folders
  for each row
  execute function private.protect_default_folder();

create or replace function private.protect_folder_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'cannot transfer a favorite folder to another user';
  end if;
  if new.is_default is distinct from old.is_default then
    raise exception 'cannot change whether a folder is the default';
  end if;
  return new;
end;
$$;

create trigger protect_folder_defaults
  before update on public.favorite_folders
  for each row
  execute function private.protect_folder_defaults();

-- ---------------------------------------------------------------------------
-- Grants: revoke defaults, then grant only what the app needs
-- ---------------------------------------------------------------------------

revoke all on table public.likes from anon, authenticated, public;
revoke all on table public.favorite_folders from anon, authenticated, public;
revoke all on table public.favorites from anon, authenticated, public;
revoke all on table public.custom_styles from anon, authenticated, public;

grant select, insert, delete on table public.likes to authenticated;

grant select, insert, update, delete on table public.favorite_folders to authenticated;

grant select, insert, update, delete on table public.favorites to authenticated;

-- Custom styles are library assets: anyone can read them, only the owner writes.
grant select on table public.custom_styles to anon, authenticated;
grant insert, update, delete on table public.custom_styles to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.likes enable row level security;
alter table public.favorite_folders enable row level security;
alter table public.favorites enable row level security;
alter table public.custom_styles enable row level security;

create policy "Users can read own likes"
  on public.likes for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own likes"
  on public.likes for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own likes"
  on public.likes for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read own folders"
  on public.favorite_folders for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own folders"
  on public.favorite_folders for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own folders"
  on public.favorite_folders for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own non-default folders"
  on public.favorite_folders for delete to authenticated
  using ((select auth.uid()) = user_id and is_default = false);

create policy "Users can read own favorites"
  on public.favorites for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own favorites"
  on public.favorites for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own favorites"
  on public.favorites for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own favorites"
  on public.favorites for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Anyone can read published custom styles"
  on public.custom_styles for select
  to anon, authenticated
  using (true);

create policy "Users can insert own custom styles"
  on public.custom_styles for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Users can update own custom styles"
  on public.custom_styles for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Users can delete own custom styles"
  on public.custom_styles for delete to authenticated
  using ((select auth.uid()) = owner_id);
