-- 英语口语练习助手：未掌握句子的复习日期
-- 在 Supabase Dashboard → SQL Editor → New query 中执行一次。

alter table public.learning_sentences
  add column if not exists review_due_at timestamptz;

alter table public.learning_sentences
  add column if not exists review_step integer not null default 0;
