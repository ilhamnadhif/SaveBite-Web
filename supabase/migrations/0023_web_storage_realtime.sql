-- Web storage MIME restrictions and bag catalogue Realtime publication.
-- The existing RLS owner, merchant, and active-account checks remain in place.

begin;

-- Keep bucket validation and object RLS aligned. PNG remains supported for
-- avatars, while the public merchant uploads accept only JPEG and WebP.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/webp']::text[]
where id in ('bag-images', 'store-logos');

drop policy if exists storage_auth_write on storage.objects;
create policy storage_auth_write on storage.objects
for insert to authenticated with check (
  public.current_account_is_active()
  and bucket_id in ('bag-images', 'store-logos', 'avatars')
  and (storage.foldername(name))[1] = auth.uid()::text
  and (
    (
      bucket_id in ('bag-images', 'store-logos')
      and (metadata->>'mimetype') in ('image/jpeg', 'image/webp')
      and lower(coalesce(storage.extension(name), '')) in ('jpg', 'jpeg', 'webp')
    )
    or (
      bucket_id = 'avatars'
      and (metadata->>'mimetype') in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
      and lower(coalesce(storage.extension(name), '')) in ('jpg', 'jpeg', 'png', 'webp', 'heic', 'heif')
    )
  )
  and (
    bucket_id in ('avatars', 'store-logos')
    or public.current_user_has_merchant()
  )
);

drop policy if exists storage_auth_update on storage.objects;
create policy storage_auth_update on storage.objects
for update to authenticated using (
  public.current_account_is_active()
  and bucket_id in ('bag-images', 'store-logos', 'avatars')
  and (storage.foldername(name))[1] = auth.uid()::text
) with check (
  public.current_account_is_active()
  and bucket_id in ('bag-images', 'store-logos', 'avatars')
  and (storage.foldername(name))[1] = auth.uid()::text
  and (
    (
      bucket_id in ('bag-images', 'store-logos')
      and (metadata->>'mimetype') in ('image/jpeg', 'image/webp')
      and lower(coalesce(storage.extension(name), '')) in ('jpg', 'jpeg', 'webp')
    )
    or (
      bucket_id = 'avatars'
      and (metadata->>'mimetype') in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
      and lower(coalesce(storage.extension(name), '')) in ('jpg', 'jpeg', 'png', 'webp', 'heic', 'heif')
    )
  )
  and (
    bucket_id in ('avatars', 'store-logos')
    or public.current_user_has_merchant()
  )
);

-- Realtime events still pass through table SELECT privileges and RLS.
do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'surprise_bags'
     ) then
    execute 'alter publication supabase_realtime add table public.surprise_bags';
  end if;
end
$realtime$;

commit;
