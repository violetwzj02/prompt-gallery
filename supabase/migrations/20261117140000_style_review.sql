-- Review workflow for uploaded custom styles.
-- Apply in the Supabase SQL editor after 20261117120000_admin.sql.
-- Does not include or require a service_role key; RLS + private.is_admin() is enough.

-- ---------------------------------------------------------------------------
-- Columns
--
-- Safe grandfathering (idempotent on re-run):
--   1. Add status as nullable, with no default. Existing rows stay NULL.
--   2. Backfill only NULL rows to 'approved' so current public items remain visible.
--   3. Then set NOT NULL and default 'pending' for future inserts.
-- Re-running later will not flip new pending/rejected rows to approved, because
-- those rows already have a non-null status.
-- ---------------------------------------------------------------------------

alter table public.custom_styles
  add column if not exists status text;

update public.custom_styles
  set status = 'approved'
  where status is null;

alter table public.custom_styles
  alter column status set default 'pending',
  alter column status set not null;

alter table public.custom_styles
  drop constraint if exists custom_styles_status_check;

alter table public.custom_styles
  add constraint custom_styles_status_check
  check (status in ('pending', 'approved', 'rejected'));

alter table public.custom_styles
  add column if not exists reviewed_at timestamptz;

alter table public.custom_styles
  add column if not exists reviewed_by uuid references auth.users (id) on delete set null;

alter table public.custom_styles
  add column if not exists review_note text;

alter table public.custom_styles
  drop constraint if exists custom_styles_review_note_len;

alter table public.custom_styles
  add constraint custom_styles_review_note_len
  check (review_note is null or char_length(review_note) <= 200);

create index if not exists custom_styles_status_idx
  on public.custom_styles (status);

create index if not exists custom_styles_status_created_at_idx
  on public.custom_styles (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Trigger: non-admins cannot self-approve. Payload edits resubmit as pending.
-- Admins changing only review fields must not be forced back to pending.
-- ---------------------------------------------------------------------------

create or replace function private.custom_styles_enforce_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin boolean;
begin
  admin := coalesce(private.is_admin(), false);

  if tg_op = 'INSERT' then
    if not admin then
      new.status := 'pending';
      new.reviewed_at := null;
      new.reviewed_by := null;
      new.review_note := null;
    end if;
    if new.status is null then
      new.status := 'pending';
    end if;
    return new;
  end if;

  -- UPDATE
  if not admin then
    new.id := old.id;
    new.owner_id := old.owner_id;

    if new.payload is distinct from old.payload then
      -- Editing the style content always returns it to the review queue.
      new.status := 'pending';
      new.reviewed_at := null;
      new.reviewed_by := null;
      new.review_note := null;
    else
      -- Owners may set pending when resubmitting, but cannot set approved
      -- or spoof review attribution.
      if new.status is distinct from old.status and new.status is distinct from 'pending' then
        new.status := old.status;
      end if;

      if new.status = 'pending' and old.status is distinct from 'pending' then
        new.reviewed_at := null;
        new.reviewed_by := null;
        new.review_note := null;
      else
        new.reviewed_at := old.reviewed_at;
        new.reviewed_by := old.reviewed_by;
        new.review_note := old.review_note;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists custom_styles_enforce_review on public.custom_styles;
create trigger custom_styles_enforce_review
  before insert or update on public.custom_styles
  for each row
  execute function private.custom_styles_enforce_review();

revoke all on function private.custom_styles_enforce_review() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS: replace the open SELECT, keep write grants as they are
-- (select to anon+authenticated, insert/update/delete to authenticated).
-- Multiple SELECT policies are OR'd. UPDATE also needs a matching SELECT.
-- ---------------------------------------------------------------------------

drop policy if exists "Anyone can read published custom styles" on public.custom_styles;
drop policy if exists "Anyone can read approved custom styles" on public.custom_styles;
drop policy if exists "Users can read own custom styles" on public.custom_styles;
drop policy if exists "Admins can read all custom styles" on public.custom_styles;
drop policy if exists "Users can insert own custom styles" on public.custom_styles;
drop policy if exists "Users can update own custom styles" on public.custom_styles;
drop policy if exists "Admins can update any custom styles" on public.custom_styles;
drop policy if exists "Users can delete own custom styles" on public.custom_styles;
drop policy if exists "Admins can delete any custom styles" on public.custom_styles;

create policy "Anyone can read approved custom styles"
  on public.custom_styles for select
  to anon, authenticated
  using (status = 'approved');

create policy "Users can read own custom styles"
  on public.custom_styles for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Admins can read all custom styles"
  on public.custom_styles for select to authenticated
  using (private.is_admin());

create policy "Users can insert own custom styles"
  on public.custom_styles for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and (status = 'pending' or private.is_admin())
  );

-- Owner WITH CHECK only asserts ownership. The trigger blocks self-approval
-- and allows a no-op upsert of an already-approved row (same payload).
create policy "Users can update own custom styles"
  on public.custom_styles for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Admins can update any custom styles"
  on public.custom_styles for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy "Users can delete own custom styles"
  on public.custom_styles for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Admins can delete any custom styles"
  on public.custom_styles for delete to authenticated
  using (private.is_admin());
