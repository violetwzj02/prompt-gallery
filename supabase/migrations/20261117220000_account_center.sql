-- Personal center: profile fields and public avatar storage.
-- Apply in the Supabase SQL editor after 20261117140000_style_review.sql.
-- Does not include or require a service_role key; RLS + private.is_admin() is enough.
-- Authorization must only read app_metadata. Users can edit user_metadata.

-- ---------------------------------------------------------------------------
-- Profiles: display name, bio, avatar, updated_at
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists display_name text,
  add column if not exists bio text,
  add column if not exists avatar_url text,
  add column if not exists updated_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_display_name_len;

alter table public.profiles
  add constraint profiles_display_name_len
  check (display_name is null or char_length(display_name) between 1 and 20);

alter table public.profiles
  drop constraint if exists profiles_bio_len;

alter table public.profiles
  add constraint profiles_bio_len
  check (bio is null or char_length(bio) <= 200);

-- Owners may read and update their own row. Identity columns stay locked.
-- Email continues to sync from the existing auth.users trigger.

create or replace function private.protect_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := old.id;
  new.email := old.email;
  new.created_at := old.created_at;
  new.updated_at := now();
  if new.display_name is not null then
    new.display_name := nullif(btrim(new.display_name), '');
  end if;
  if new.bio is not null then
    new.bio := nullif(btrim(new.bio), '');
  end if;
  if new.avatar_url is not null then
    new.avatar_url := nullif(btrim(new.avatar_url), '');
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_identity on public.profiles;
create trigger protect_profile_identity
  before update on public.profiles
  for each row
  execute function private.protect_profile_identity();

revoke all on function private.protect_profile_identity() from public, anon, authenticated;

revoke all on table public.profiles from anon, authenticated, public;
grant select, update on table public.profiles to authenticated;

alter table public.profiles enable row level security;

drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

create policy "Admins can read all profiles"
  on public.profiles for select to authenticated
  using (private.is_admin());

create policy "Users can read own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- Storage: public avatars bucket, writes only under {auth.uid()}/...
--
-- If this block cannot run in the SQL editor (rare storage catalog permission),
-- create a public bucket named `avatars` in the dashboard with a 5 MB limit
-- and image MIME types (image/jpeg, image/png, image/webp, image/gif), then
-- re-run the policy statements below.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatar images are publicly readable" on storage.objects;
drop policy if exists "Users can upload their own avatar" on storage.objects;
drop policy if exists "Users can update their own avatar" on storage.objects;
drop policy if exists "Users can delete their own avatar" on storage.objects;

create policy "Avatar images are publicly readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and (
      lower(coalesce(metadata ->> 'mimetype', '')) in (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif'
      )
      or lower(substring(name from '\.([^.]+)$')) in ('jpg', 'jpeg', 'png', 'webp', 'gif')
    )
  );

create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
