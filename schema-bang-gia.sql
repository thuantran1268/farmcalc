-- FARMCALC · KHÓA BẢNG GIÁ (đăng ký → chờ admin duyệt → mới xem được)
-- Cách chạy: Supabase → SQL Editor → New query → dán TOÀN BỘ file này → Run.
-- File này KHÔNG chứa giá. Dữ liệu giá nạp bằng file riêng (du-lieu-bang-gia.sql) hoặc
-- bằng trang admin.html (mục "Cập nhật bảng giá").
-- Chạy lại nhiều lần vẫn an toàn.

-- 1) Bảng thành viên (không ai đọc trực tiếp được; chỉ qua các hàm bên dưới)
create table if not exists public.farmcalc_members (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  role        text not null default 'member'  check (role in ('member','admin')),
  device_id   text,
  device_at   timestamptz,
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);
alter table public.farmcalc_members enable row level security;

-- 2) Bảng giá: một dòng duy nhất chứa toàn bộ bảng giá dạng JSON
create table if not exists public.farmcalc_price_data (
  id         int primary key default 1 check (id = 1),
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.farmcalc_price_data enable row level security;

-- Không có policy nào + thu hồi quyền → web (khóa anon) không thể đọc thẳng 2 bảng này.
revoke all on public.farmcalc_members    from anon, authenticated;
revoke all on public.farmcalc_price_data from anon, authenticated;

-- 3) Tự tạo dòng "chờ duyệt" khi có người đăng ký
create or replace function public.farmcalc_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.farmcalc_members(user_id, email)
  values (new.id, lower(coalesce(new.email, '')))
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists farmcalc_on_signup on auth.users;
create trigger farmcalc_on_signup after insert on auth.users
  for each row execute function public.farmcalc_on_signup();

-- 4) Các hàm người dùng (phải đăng nhập)
create or replace function public.farmcalc_my_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.farmcalc_members;
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  insert into public.farmcalc_members(user_id, email)
    select u.id, lower(coalesce(u.email,'')) from auth.users u where u.id = auth.uid()
    on conflict (user_id) do nothing;
  select * into m from public.farmcalc_members where user_id = auth.uid();
  return jsonb_build_object('status', m.status, 'role', m.role, 'email', m.email);
end $$;

-- Đăng nhập trên máy này → máy này thành "thiết bị duy nhất" (máy cũ bị đăng xuất)
create or replace function public.farmcalc_claim_device(p_device text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.farmcalc_members;
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  if p_device is null or length(p_device) < 8 or length(p_device) > 100 then raise exception 'bad_device'; end if;
  perform public.farmcalc_my_status();
  update public.farmcalc_members set device_id = p_device, device_at = now() where user_id = auth.uid();
  select * into m from public.farmcalc_members where user_id = auth.uid();
  return jsonb_build_object('status', m.status, 'role', m.role, 'email', m.email);
end $$;

-- Lấy bảng giá: chỉ khi đã được duyệt VÀ đúng thiết bị đang đăng nhập
create or replace function public.farmcalc_get_prices(p_device text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.farmcalc_members; d jsonb;
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  select * into m from public.farmcalc_members where user_id = auth.uid();
  if not found or m.status <> 'approved' then raise exception 'not_approved'; end if;
  if m.device_id is distinct from p_device then raise exception 'device_changed'; end if;
  select doc into d from public.farmcalc_price_data where id = 1;
  if d is null then raise exception 'no_data'; end if;
  return d;
end $$;

-- 5) Các hàm của admin (chỉ tài khoản role = admin và đã duyệt)
create or replace function public.farmcalc_is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.farmcalc_members
                where user_id = auth.uid() and role = 'admin' and status = 'approved');
$$;

create or replace function public.farmcalc_admin_members()
returns table(user_id uuid, email text, status text, role text, device_at timestamptz, created_at timestamptz, approved_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.farmcalc_is_admin() then raise exception 'not_admin'; end if;
  return query
    select m.user_id, m.email, m.status, m.role, m.device_at, m.created_at, m.approved_at
    from public.farmcalc_members m
    order by case m.status when 'pending' then 0 when 'approved' then 1 else 2 end, m.created_at desc;
end $$;

create or replace function public.farmcalc_admin_set_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.farmcalc_is_admin() then raise exception 'not_admin'; end if;
  if p_status not in ('pending','approved','rejected') then raise exception 'bad_status'; end if;
  if p_user = auth.uid() then raise exception 'not_self'; end if;
  update public.farmcalc_members
     set status = p_status,
         approved_at = case when p_status = 'approved' then now() else null end,
         device_id = case when p_status = 'approved' then device_id else null end
   where user_id = p_user;
end $$;

create or replace function public.farmcalc_admin_reset_device(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.farmcalc_is_admin() then raise exception 'not_admin'; end if;
  update public.farmcalc_members set device_id = null, device_at = null where user_id = p_user;
end $$;

create or replace function public.farmcalc_admin_set_prices(p_doc jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.farmcalc_is_admin() then raise exception 'not_admin'; end if;
  if jsonb_typeof(p_doc->'products') is distinct from 'array' then raise exception 'bad_doc'; end if;
  insert into public.farmcalc_price_data(id, doc, updated_at) values (1, p_doc, now())
  on conflict (id) do update set doc = excluded.doc, updated_at = now();
end $$;

-- 6) Chỉ người đã đăng nhập mới gọi được các hàm; khách chưa đăng nhập thì không
do $$
declare f text;
begin
  foreach f in array array[
    'farmcalc_my_status()','farmcalc_claim_device(text)','farmcalc_get_prices(text)',
    'farmcalc_is_admin()','farmcalc_admin_members()','farmcalc_admin_set_status(uuid,text)',
    'farmcalc_admin_reset_device(uuid)','farmcalc_admin_set_prices(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- 7) Thêm tên + số điện thoại cho tài khoản (đăng ký bằng tên bất kỳ + SĐT + Gmail, admin duyệt)
alter table public.farmcalc_members add column if not exists name text, add column if not exists phone text;

create or replace function public.farmcalc_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.farmcalc_members(user_id, email, name, phone)
  values (new.id, lower(coalesce(new.email, '')),
          nullif(left(trim(coalesce(new.raw_user_meta_data->>'name','')),60),''),
          nullif(left(regexp_replace(coalesce(new.raw_user_meta_data->>'phone',''),'[^0-9+]','','g'),16),''))
  on conflict (user_id) do nothing;
  return new;
end $$;

create or replace function public.farmcalc_my_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.farmcalc_members;
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  insert into public.farmcalc_members(user_id, email, name, phone)
    select u.id, lower(coalesce(u.email,'')),
           nullif(left(trim(coalesce(u.raw_user_meta_data->>'name','')),60),''),
           nullif(left(regexp_replace(coalesce(u.raw_user_meta_data->>'phone',''),'[^0-9+]','','g'),16),'')
    from auth.users u where u.id = auth.uid()
    on conflict (user_id) do nothing;
  select * into m from public.farmcalc_members where user_id = auth.uid();
  return jsonb_build_object('status', m.status, 'role', m.role, 'email', m.email, 'name', m.name, 'phone', m.phone);
end $$;

create or replace function public.farmcalc_claim_device(p_device text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.farmcalc_members;
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  if p_device is null or length(p_device) < 8 or length(p_device) > 100 then raise exception 'bad_device'; end if;
  perform public.farmcalc_my_status();
  update public.farmcalc_members set device_id = p_device, device_at = now() where user_id = auth.uid();
  select * into m from public.farmcalc_members where user_id = auth.uid();
  return jsonb_build_object('status', m.status, 'role', m.role, 'email', m.email, 'name', m.name, 'phone', m.phone);
end $$;

drop function if exists public.farmcalc_admin_members();
create function public.farmcalc_admin_members()
returns table(user_id uuid, email text, name text, phone text, status text, role text, device_at timestamptz, created_at timestamptz, approved_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.farmcalc_is_admin() then raise exception 'not_admin'; end if;
  return query
    select m.user_id, m.email, m.name, m.phone, m.status, m.role, m.device_at, m.created_at, m.approved_at
    from public.farmcalc_members m
    order by case m.status when 'pending' then 0 when 'approved' then 1 else 2 end, m.created_at desc;
end $$;
revoke all on function public.farmcalc_admin_members() from public, anon;
grant execute on function public.farmcalc_admin_members() to authenticated;

-- ======================================================================
-- SAU KHI ĐÃ ĐĂNG KÝ tài khoản của bạn trong web (tab Bảng giá), chạy RIÊNG câu dưới
-- (đổi email cho đúng) để biến tài khoản đó thành ADMIN:
--
--   update public.farmcalc_members
--      set role = 'admin', status = 'approved', approved_at = now()
--    where email = lower('EMAIL_CUA_BAN@gmail.com');
-- ======================================================================
-- Nhiều công ty trong Bảng giá: mỗi công ty 1 dòng (dòng id 1 = Jfeed như cũ)
alter table public.farmcalc_price_data drop constraint if exists farmcalc_price_data_id_check;
alter table public.farmcalc_price_data add column if not exists company text;
update public.farmcalc_price_data set company = 'Jfeed' where id = 1 and company is null;
create unique index if not exists farmcalc_price_data_company_key on public.farmcalc_price_data (lower(company));

-- Trả về bảng giá: giữ nguyên dạng cũ (Jfeed ở ngoài) + thêm danh sách "companies"
create or replace function public.farmcalc_get_prices(p_device text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.farmcalc_members; d jsonb; cs jsonb;
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  select * into m from public.farmcalc_members where user_id = auth.uid();
  if not found or m.status <> 'approved' then raise exception 'not_approved'; end if;
  if m.device_id is distinct from p_device then raise exception 'device_changed'; end if;
  select doc into d from public.farmcalc_price_data where id = 1;
  select jsonb_agg(doc || jsonb_build_object('company', coalesce(company, 'Jfeed')) order by id) into cs from public.farmcalc_price_data;
  if cs is null then raise exception 'no_data'; end if;
  return coalesce(d, '{}'::jsonb) || jsonb_build_object('companies', cs);
end $$;

-- Admin: cập nhật bảng giá của 1 công ty (chưa có thì thêm mới)
create or replace function public.farmcalc_admin_set_company_prices(p_company text, p_doc jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c text := trim(coalesce(p_company, '')); nid int;
begin
  if not public.farmcalc_is_admin() then raise exception 'not_admin'; end if;
  if length(c) < 2 or length(c) > 40 then raise exception 'bad_company'; end if;
  if jsonb_typeof(p_doc -> 'products') <> 'array' or jsonb_array_length(p_doc -> 'products') = 0 then raise exception 'bad_doc'; end if;
  if lower(c) = 'jfeed' then
    insert into public.farmcalc_price_data(id, company, doc, updated_at) values (1, 'Jfeed', p_doc - 'company', now())
    on conflict (id) do update set doc = excluded.doc, company = 'Jfeed', updated_at = now();
  elsif exists (select 1 from public.farmcalc_price_data where lower(company) = lower(c)) then
    update public.farmcalc_price_data set doc = p_doc - 'company', company = c, updated_at = now() where lower(company) = lower(c);
  else
    select greatest(coalesce(max(id), 1), 1) + 1 into nid from public.farmcalc_price_data;
    insert into public.farmcalc_price_data(id, company, doc, updated_at) values (nid, c, p_doc - 'company', now());
  end if;
end $$;

-- Admin: gỡ bảng giá của 1 công ty (không gỡ được Jfeed)
create or replace function public.farmcalc_admin_remove_company(p_company text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.farmcalc_is_admin() then raise exception 'not_admin'; end if;
  delete from public.farmcalc_price_data where id <> 1 and lower(company) = lower(trim(coalesce(p_company, '')));
end $$;

revoke all on function public.farmcalc_admin_set_company_prices(text, jsonb) from public, anon;
grant execute on function public.farmcalc_admin_set_company_prices(text, jsonb) to authenticated;
revoke all on function public.farmcalc_admin_remove_company(text) from public, anon;
grant execute on function public.farmcalc_admin_remove_company(text) to authenticated;
