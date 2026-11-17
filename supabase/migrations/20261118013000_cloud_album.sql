-- Admin-only cloud album metadata. Image bytes live in the admin's Google Drive.
-- Apply in the Supabase SQL editor after 20261117220000_account_center.sql.
-- Does not include or require a service_role key; RLS + private.is_admin() is enough.
-- Authorization must only read app_metadata. Users can edit user_metadata.
-- Does not alter Auth, billing, or existing user/style data.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.album_valid_category_name(raw text)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select
    raw is not null
    and char_length(btrim(raw)) between 1 and 20
    and btrim(raw) not in ('全部', '自定义')
    and lower(btrim(raw)) <> 'admin'
    and position('/' in btrim(raw)) = 0
    and position(E'\\' in btrim(raw)) = 0;
$$;

revoke all on function private.album_valid_category_name(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- album_settings: at most one row (id = 'default')
-- ---------------------------------------------------------------------------

create table if not exists public.album_settings (
  id text primary key default 'default' check (id = 'default'),
  drive_root_folder_id text,
  connected_google_email text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create or replace function private.album_settings_protect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
  else
    new.id := 'default';
  end if;
  new.drive_root_folder_id := nullif(btrim(new.drive_root_folder_id), '');
  new.connected_google_email := nullif(btrim(new.connected_google_email), '');
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists album_settings_protect on public.album_settings;
create trigger album_settings_protect
  before insert or update on public.album_settings
  for each row
  execute function private.album_settings_protect();

revoke all on function private.album_settings_protect() from public, anon, authenticated;

revoke all on table public.album_settings from anon, authenticated, public;
grant select, insert, update, delete on table public.album_settings to authenticated;

alter table public.album_settings enable row level security;

drop policy if exists "Admins can read album settings" on public.album_settings;
drop policy if exists "Admins can insert album settings" on public.album_settings;
drop policy if exists "Admins can update album settings" on public.album_settings;
drop policy if exists "Admins can delete album settings" on public.album_settings;

create policy "Admins can read album settings"
  on public.album_settings for select to authenticated
  using (private.is_admin());

create policy "Admins can insert album settings"
  on public.album_settings for insert to authenticated
  with check (private.is_admin());

create policy "Admins can update album settings"
  on public.album_settings for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy "Admins can delete album settings"
  on public.album_settings for delete to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- album_categories
-- ---------------------------------------------------------------------------

create table if not exists public.album_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  kind text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint album_categories_name_len check (char_length(name) between 1 and 20),
  constraint album_categories_kind_check check (kind in ('preset', 'custom')),
  constraint album_categories_name_valid check (private.album_valid_category_name(name)),
  constraint album_categories_name_key unique (name)
);

create unique index if not exists album_categories_name_lower_idx
  on public.album_categories (lower(name));

create or replace function private.album_categories_protect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.name := btrim(new.name);
    new.slug := nullif(btrim(new.slug), '');
    if new.kind is null then
      new.kind := 'custom';
    end if;
    if new.kind = 'preset' and auth.uid() is not null then
      -- Clients may not invent new presets.
      new.kind := 'custom';
    end if;
    if new.kind = 'custom' then
      new.created_by := auth.uid();
    end if;
    if not private.album_valid_category_name(new.name) then
      raise exception '该名称不可用作相册分类';
    end if;
    return new;
  end if;

  new.id := old.id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.kind := old.kind;

  if old.kind = 'preset' then
    new.name := old.name;
    new.slug := old.slug;
  else
    new.name := btrim(new.name);
    new.slug := nullif(btrim(new.slug), '');
    if not private.album_valid_category_name(new.name) then
      raise exception '该名称不可用作相册分类';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists album_categories_protect on public.album_categories;
create trigger album_categories_protect
  before insert or update on public.album_categories
  for each row
  execute function private.album_categories_protect();

create or replace function private.album_categories_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.kind = 'preset' then
    raise exception '预设分类不能删除';
  end if;
  return old;
end;
$$;

drop trigger if exists album_categories_guard_delete on public.album_categories;
create trigger album_categories_guard_delete
  before delete on public.album_categories
  for each row
  execute function private.album_categories_guard_delete();

create or replace function private.album_categories_propagate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.kind = 'custom' and new.name is distinct from old.name then
    update public.album_items
      set custom_categories = (
            select coalesce(array_agg(case when x = old.name then new.name else x end), '{}')
            from unnest(custom_categories) as x
          ),
          updated_at = now()
      where old.name = any (custom_categories);
  end if;
  return new;
end;
$$;

drop trigger if exists album_categories_propagate on public.album_categories;
create trigger album_categories_propagate
  after update of name on public.album_categories
  for each row
  execute function private.album_categories_propagate();

create or replace function private.album_categories_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.kind = 'custom' then
    update public.album_items
      set custom_categories = (
            select coalesce(array_agg(x), '{}')
            from unnest(custom_categories) as x
            where x is distinct from old.name
          ),
          updated_at = now()
      where old.name = any (custom_categories);
  end if;
  return old;
end;
$$;

drop trigger if exists album_categories_cleanup on public.album_categories;
create trigger album_categories_cleanup
  after delete on public.album_categories
  for each row
  execute function private.album_categories_cleanup();

revoke all on function private.album_categories_protect() from public, anon, authenticated;
revoke all on function private.album_categories_guard_delete() from public, anon, authenticated;
revoke all on function private.album_categories_propagate() from public, anon, authenticated;
revoke all on function private.album_categories_cleanup() from public, anon, authenticated;

insert into public.album_categories (name, slug, kind)
values
  ('真人', 'zhenren', 'preset'),
  ('CG', 'cg', 'preset'),
  ('电影', 'dianying', 'preset'),
  ('3D', '3d', 'preset'),
  ('2D', '2d', 'preset'),
  ('场景', 'changjing', 'preset'),
  ('18+', 'eighteen', 'preset')
on conflict (name) do nothing;

revoke all on table public.album_categories from anon, authenticated, public;
grant select, insert, update, delete on table public.album_categories to authenticated;

alter table public.album_categories enable row level security;

drop policy if exists "Admins can read album categories" on public.album_categories;
drop policy if exists "Admins can insert album categories" on public.album_categories;
drop policy if exists "Admins can update album categories" on public.album_categories;
drop policy if exists "Admins can delete album categories" on public.album_categories;

create policy "Admins can read album categories"
  on public.album_categories for select to authenticated
  using (private.is_admin());

create policy "Admins can insert album categories"
  on public.album_categories for insert to authenticated
  with check (private.is_admin());

create policy "Admins can update album categories"
  on public.album_categories for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy "Admins can delete album categories"
  on public.album_categories for delete to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- album_items
-- ---------------------------------------------------------------------------

create table if not exists public.album_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  drive_file_id text not null,
  title text,
  source text not null,
  prompt_id text,
  mime_type text,
  size_bytes bigint,
  auto_categories text[] not null default '{}',
  custom_categories text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint album_items_drive_file_id_key unique (drive_file_id),
  constraint album_items_source_check check (source in ('upload', 'generated')),
  constraint album_items_mime_check check (
    mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  ),
  constraint album_items_size_check check (
    size_bytes is null or (size_bytes >= 0 and size_bytes <= 52428800)
  )
);

create index if not exists album_items_created_at_idx
  on public.album_items (created_at desc);

create index if not exists album_items_auto_categories_idx
  on public.album_items using gin (auto_categories);

create index if not exists album_items_custom_categories_idx
  on public.album_items using gin (custom_categories);

create or replace function private.album_dedupe_text_array(input text[])
returns text[]
language sql
immutable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select array_agg(trimmed order by min_ord)
      from (
        select btrim(x) as trimmed, min(ord) as min_ord
        from unnest(coalesce(input, '{}')) with ordinality as t(x, ord)
        where x is not null and btrim(x) <> ''
        group by btrim(x)
      ) s
    ),
    '{}'
  );
$$;

revoke all on function private.album_dedupe_text_array(text[]) from public, anon, authenticated;

create or replace function private.album_items_protect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  label text;
  is_preset boolean;
begin
  if tg_op = 'INSERT' then
    new.owner_id := auth.uid();
    if new.owner_id is null then
      raise exception '请先登录';
    end if;
    new.created_at := coalesce(new.created_at, now());
  else
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.drive_file_id := old.drive_file_id;
    new.source := old.source;
    new.prompt_id := old.prompt_id;
    new.created_at := old.created_at;
  end if;

  new.drive_file_id := nullif(btrim(new.drive_file_id), '');
  if new.drive_file_id is null then
    raise exception '缺少云盘文件编号';
  end if;

  new.title := nullif(btrim(new.title), '');
  new.prompt_id := nullif(btrim(new.prompt_id), '');
  new.mime_type := nullif(btrim(new.mime_type), '');
  if new.mime_type = 'image/jpg' then
    new.mime_type := 'image/jpeg';
  end if;

  new.auto_categories := private.album_dedupe_text_array(new.auto_categories);
  new.custom_categories := private.album_dedupe_text_array(new.custom_categories);

  foreach label in array new.auto_categories loop
    select exists (
      select 1 from public.album_categories c
      where c.kind = 'preset' and c.name = label
    ) into is_preset;
    if not is_preset then
      raise exception '自动分类只能使用预设标签';
    end if;
  end loop;

  foreach label in array new.custom_categories loop
    if not private.album_valid_category_name(label) then
      raise exception '该名称不可用作相册分类';
    end if;
    select exists (
      select 1 from public.album_categories c
      where c.kind = 'preset' and c.name = label
    ) into is_preset;
    if is_preset then
      raise exception '预设标签请放在自动分类中';
    end if;
  end loop;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists album_items_protect on public.album_items;
create trigger album_items_protect
  before insert or update on public.album_items
  for each row
  execute function private.album_items_protect();

revoke all on function private.album_items_protect() from public, anon, authenticated;

revoke all on table public.album_items from anon, authenticated, public;
grant select, insert, update, delete on table public.album_items to authenticated;

alter table public.album_items enable row level security;

drop policy if exists "Admins can read album items" on public.album_items;
drop policy if exists "Admins can insert album items" on public.album_items;
drop policy if exists "Admins can update album items" on public.album_items;
drop policy if exists "Admins can delete album items" on public.album_items;

create policy "Admins can read album items"
  on public.album_items for select to authenticated
  using (private.is_admin());

create policy "Admins can insert album items"
  on public.album_items for insert to authenticated
  with check (private.is_admin());

create policy "Admins can update album items"
  on public.album_items for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy "Admins can delete album items"
  on public.album_items for delete to authenticated
  using (private.is_admin());
