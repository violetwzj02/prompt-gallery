-- Additive recycle-bin columns for album_items.
-- Does not rewrite or update existing rows. A constant default on purge_status
-- is metadata-only in modern Postgres and appears as 'idle' for current rows.
-- The companion delete-guard SQL lives in docs/album-items-delete-guard.sql and is
-- not on the default migrations path. Do not apply it until every client has been
-- upgraded off the old hard-delete path. See docs/album-recycle-bin-upgrade.md.

alter table public.album_items
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users (id) on delete set null,
  add column if not exists purge_status text not null default 'idle',
  add column if not exists purge_error text,
  add column if not exists drive_purged_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'album_items_purge_status_check'
      and conrelid = 'public.album_items'::regclass
  ) then
    alter table public.album_items
      add constraint album_items_purge_status_check
      check (purge_status in ('idle', 'pending', 'drive_purged', 'failed'));
  end if;
end
$$;

create index if not exists album_items_live_created_at_idx
  on public.album_items (created_at desc)
  where deleted_at is null;

create index if not exists album_items_trash_deleted_at_idx
  on public.album_items (deleted_at desc)
  where deleted_at is not null;

create index if not exists album_items_purge_retry_idx
  on public.album_items (updated_at)
  where purge_status in ('pending', 'failed');

-- Keep identity fields immutable and block restoring a row after the Drive
-- file has been purged. This is safe for older clients because they never
-- restore and do not write these new columns.
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
    new.deleted_at := null;
    new.deleted_by := null;
    new.purge_status := coalesce(nullif(btrim(new.purge_status), ''), 'idle');
    new.purge_error := null;
    new.drive_purged_at := null;
  else
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.drive_file_id := old.drive_file_id;
    new.source := old.source;
    new.prompt_id := old.prompt_id;
    new.created_at := old.created_at;

    if old.drive_purged_at is not null then
      new.drive_purged_at := old.drive_purged_at;
    end if;
    if old.purge_status = 'drive_purged' then
      new.purge_status := 'drive_purged';
    end if;

    if old.deleted_at is null and new.deleted_at is not null then
      new.deleted_by := coalesce(auth.uid(), new.deleted_by);
      new.purge_status := coalesce(nullif(btrim(new.purge_status), ''), 'idle');
    elsif old.deleted_at is not null and new.deleted_at is null then
      if old.purge_status = 'drive_purged' or old.drive_purged_at is not null then
        raise exception '云盘文件已删除，无法恢复';
      end if;
      if old.purge_status = 'pending' then
        raise exception '正在清除，无法恢复';
      end if;
      new.deleted_by := null;
      new.purge_status := 'idle';
      new.purge_error := null;
      new.drive_purged_at := null;
    end if;
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

  new.purge_status := coalesce(nullif(btrim(new.purge_status), ''), 'idle');
  new.purge_error := nullif(btrim(new.purge_error), '');

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

revoke all on function private.album_items_protect() from public, anon, authenticated;
