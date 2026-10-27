-- Espace photos privé (section 9.2). Chemins : <owner>/<stock_lot ou hunt_lot>/<fichier>.jpg
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
on conflict (id) do update set public = false;

drop policy if exists "photos owner read" on storage.objects;
create policy "photos owner read" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "photos owner write" on storage.objects;
create policy "photos owner write" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "photos owner delete" on storage.objects;
create policy "photos owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
