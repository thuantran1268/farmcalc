-- NHẬT KÝ SỬ DỤNG FARMCALC
-- Cách chạy: Supabase > SQL Editor > New query > dán toàn bộ > sửa dòng MẬT KHẨU QUẢN TRỊ bên dưới > Run.
-- Người dùng chỉ GHI được nhật ký, không ĐỌC được. Chỉ trang admin.html (có mật khẩu) đọc được số tổng hợp.

create table if not exists public.farmcalc_activity (
  id bigint generated always as identity primary key,
  email text not null check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[a-z]{2,}$'),
  feature text not null check (feature in ('open','view','tab','save','pdf','tools','install','print','market','policy')),
  detail text check (detail is null or length(detail) <= 60),
  session text check (session is null or length(session) <= 40),
  device text check (device is null or device in ('mobile','desktop')),
  created_at timestamptz not null default now()
);
create index if not exists farmcalc_activity_created_idx on public.farmcalc_activity (created_at desc);
create index if not exists farmcalc_activity_email_idx on public.farmcalc_activity (email, created_at desc);

alter table public.farmcalc_activity enable row level security;
revoke all on public.farmcalc_activity from anon, authenticated;
grant insert on public.farmcalc_activity to anon;
drop policy if exists "activity insert only" on public.farmcalc_activity;
create policy "activity insert only" on public.farmcalc_activity for insert to anon with check (true);

-- Hàm tổng hợp cho trang quản trị. Chỉ trả dữ liệu khi đúng mật khẩu.
create or replace function public.farmcalc_admin_stats(passcode text, days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  secret constant text := 'DOI_MAT_KHAU_QUAN_TRI_O_DAY';   -- <<< MẬT KHẨU QUẢN TRỊ: sửa chuỗi này trước khi chạy
  d int := least(greatest(coalesce(days, 30), 1), 365);
  since timestamptz := now() - make_interval(days => d);
begin
  if secret = 'DOI_MAT_KHAU_QUAN_TRI_O_DAY' or passcode is distinct from secret then
    raise exception 'Sai mật khẩu';
  end if;
  return jsonb_build_object(
    'days', d,
    'generated_at', now(),
    'users', (select coalesce(jsonb_agg(u order by u.last_seen desc), '[]'::jsonb) from (
        select email,
               min(created_at) as first_seen,
               max(created_at) as last_seen,
               count(distinct session) as sessions,
               count(*) as events,
               count(*) filter (where feature = 'save') as saves,
               count(*) filter (where feature = 'pdf') as pdfs,
               mode() within group (order by feature) filter (where feature not in ('open')) as top_feature,
               mode() within group (order by device) as device
        from public.farmcalc_activity where created_at >= since group by email) u),
    'features', (select coalesce(jsonb_agg(f order by f.n desc), '[]'::jsonb) from (
        select feature, coalesce(detail, '') as detail, count(*) as n, count(distinct email) as users
        from public.farmcalc_activity where created_at >= since group by feature, detail) f),
    'daily', (select coalesce(jsonb_agg(x order by x.day), '[]'::jsonb) from (
        select (created_at at time zone 'Asia/Bangkok')::date as day, count(distinct email) as users, count(*) as events
        from public.farmcalc_activity where created_at >= since group by 1) x)
  );
end;
$$;
revoke all on function public.farmcalc_admin_stats(text, int) from public;
grant execute on function public.farmcalc_admin_stats(text, int) to anon;
