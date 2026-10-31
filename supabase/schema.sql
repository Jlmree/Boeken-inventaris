-- Plak dit in Supabase > SQL Editor > Run.
create table if not exists public.books (
  id         text primary key,
  family     text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists books_family_idx on public.books (family);

alter table public.books enable row level security;

-- Alleen wie de gezinscode (header x-family) kent, ziet/wijzigt de boeken van dat gezin.
drop policy if exists "gezin" on public.books;
create policy "gezin" on public.books
  for all to anon
  using      (family = coalesce(current_setting('request.headers', true)::json ->> 'x-family', ''))
  with check (family = coalesce(current_setting('request.headers', true)::json ->> 'x-family', ''));
