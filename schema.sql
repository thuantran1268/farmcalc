-- Dữ liệu CÔNG KHAI theo email. Ai biết email đúng mẫu có thể đọc và sửa dữ liệu tương ứng.
create table if not exists public.farmcalc_accounts (
 email text primary key check (email ~ '^[a-z]+\.[a-z]+@japfa\.com$'),
 draft jsonb not null default '{}'::jsonb,
 history jsonb not null default '[]'::jsonb,
 updated_at timestamptz not null default now(),
 check (jsonb_typeof(draft)='object'),
 check (jsonb_typeof(history)='array')
);
alter table public.farmcalc_accounts enable row level security;
revoke all on public.farmcalc_accounts from anon, authenticated;
grant select, insert, update on public.farmcalc_accounts to anon;
create policy "public read" on public.farmcalc_accounts for select to anon using (true);
create policy "public insert" on public.farmcalc_accounts for insert to anon with check (true);
create policy "public update" on public.farmcalc_accounts for update to anon using (true) with check (true);
