-- OPTIONAL. Do not apply until every client is on the recycle-bin frontend
-- and no longer hard-deletes album_items after a Drive delete.
-- Older clients delete the metadata row after a successful Drive delete and
-- would be blocked here, leaving an unrecoverable Drive gap.
-- See docs/album-recycle-bin-upgrade.md for upgrade and rollback order.

create or replace function private.album_items_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.purge_status is distinct from 'drive_purged' then
    raise exception '只能在云盘文件已清除后删除相册记录';
  end if;
  return old;
end;
$$;

revoke all on function private.album_items_delete_guard() from public, anon, authenticated;

drop trigger if exists album_items_delete_guard on public.album_items;
create trigger album_items_delete_guard
  before delete on public.album_items
  for each row
  execute function private.album_items_delete_guard();
