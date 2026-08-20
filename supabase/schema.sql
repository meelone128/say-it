-- 英语口语练习助手：账号资料与学习数据云端同步
-- 在 Supabase Dashboard → SQL Editor → New query 中完整粘贴并执行。

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '学习者',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.learning_units (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_transcript text not null,
  english_paragraph text not null,
  saved_at timestamptz not null,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists learning_units_user_saved_at_idx
  on public.learning_units (user_id, saved_at desc);

create table if not exists public.learning_sentences (
  unit_id text not null references public.learning_units(id) on delete cascade,
  sequence integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  english_text text not null,
  chinese_meaning text not null,
  mastery text not null default 'UNRATED'
    check (mastery in ('UNRATED', 'MASTERED', 'UNMASTERED')),
  primary key (unit_id, sequence)
);

create index if not exists learning_sentences_user_idx
  on public.learning_sentences (user_id);

alter table public.profiles enable row level security;
alter table public.learning_units enable row level security;
alter table public.learning_sentences enable row level security;

drop policy if exists "Users manage own profile" on public.profiles;
create policy "Users manage own profile"
  on public.profiles for all
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users manage own learning units" on public.learning_units;
create policy "Users manage own learning units"
  on public.learning_units for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own learning sentences" on public.learning_sentences;
create policy "Users manage own learning sentences"
  on public.learning_sentences for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', '学习者')
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
