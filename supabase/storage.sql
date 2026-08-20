-- 英语口语练习助手：学习音频跨设备备份
-- 在 Supabase Dashboard → SQL Editor → New query 中执行。

insert into storage.buckets (id, name, public)
values ('learning-audio', 'learning-audio', false)
on conflict (id) do update set public = false;

drop policy if exists "Users manage own learning audio" on storage.objects;
create policy "Users manage own learning audio"
on storage.objects for all to authenticated
using (
  bucket_id = 'learning-audio'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'learning-audio'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
