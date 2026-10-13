-- Artu Portal – başlangıç şeması (Supabase)
-- Tablolar, erişim kuralları (RLS), iş kuralları, bildirim tetikleyicileri, dosya alanları ve canlı yayın.
-- Arayüzdeki karşılığı: web/src/lib/db.ts ve sayfalar. Yetkiler hem arayüzde hem burada uygulanır;
-- biri değişirse diğeri de güncellenmeli.
-- Supabase panelinde: SQL Editor > New query > bu dosyanın tamamını yapıştır > Run
-- (Tekrar çalıştırılabilir; var olan veriyi silmez.)

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;

-- API'ye kapalı şema: ayarlar ve iç fonksiyonlar
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ============================================================ tablolar

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> '' and char_length(name) <= 100),
  color text not null default '' check (char_length(color) <= 20),
  description text not null default '' check (char_length(description) <= 500),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);

-- Her giriş hesabının (auth.users) portaldaki kaydı. Giriş kullanıcı adıyladır;
-- auth.users'taki e-posta "kullaniciadi@portal.artucikolata.com.tr" biçiminde üretilir (private.login_email).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,50}$'),
  email text not null default '' check (char_length(email) <= 200),
  name text not null check (btrim(name) <> '' and char_length(name) <= 100),
  avatar text not null default '',
  role text not null default 'staff' check (role in ('admin', 'manager', 'staff')),
  department uuid references public.departments (id) on delete set null,
  title text not null default '' check (char_length(title) <= 100),
  phone text not null default '' check (char_length(phone) <= 30),
  active boolean not null default true,
  last_seen timestamptz,
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 200000),
  author uuid not null references public.profiles (id),
  departments uuid[] not null default '{}' check (cardinality(departments) <= 50),
  priority text not null default 'normal' check (priority in ('normal', 'important', 'urgent')),
  pinned boolean not null default false,
  require_ack boolean not null default false,
  attachments text[] not null default '{}' check (cardinality(attachments) <= 5),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create index if not exists idx_announcements_created on public.announcements (created desc);

create table if not exists public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  announcement uuid not null references public.announcements (id) on delete cascade,
  "user" uuid not null references public.profiles (id) on delete cascade,
  created timestamptz not null default now(),
  unique (announcement, "user")
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'group')),
  name text not null default '' check (char_length(name) <= 100),
  members uuid[] not null check (cardinality(members) between 2 and 200),
  created_by uuid not null references public.profiles (id),
  direct_key text,
  last_message_at timestamptz not null default now(),
  last_message_text text not null default '',
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create unique index if not exists idx_conversations_direct on public.conversations (direct_key) where direct_key is not null;
create index if not exists idx_conversations_members on public.conversations using gin (members);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation uuid not null references public.conversations (id) on delete cascade,
  sender uuid not null references public.profiles (id),
  text text not null default '' check (char_length(text) <= 5000),
  attachments text[] not null default '{}' check (cardinality(attachments) <= 5),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create index if not exists idx_messages_conv_created on public.messages (conversation, created);

-- Okunma durumu yalnızca mark_conversation_read() ile yazılır.
create table if not exists public.conversation_reads (
  id uuid primary key default gen_random_uuid(),
  conversation uuid not null references public.conversations (id) on delete cascade,
  "user" uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  unique (conversation, "user")
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  description text not null default '' check (char_length(description) <= 5000),
  start timestamptz not null,
  "end" timestamptz,
  all_day boolean not null default false,
  category text not null default 'other' check (category in ('meeting', 'shipment', 'production', 'leave', 'training', 'visit', 'other')),
  location text not null default '' check (char_length(location) <= 200),
  departments uuid[] not null default '{}' check (cardinality(departments) <= 50),
  participants uuid[] not null default '{}' check (cardinality(participants) <= 200),
  created_by uuid not null references public.profiles (id),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create index if not exists idx_events_start on public.events (start);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  description text not null default '' check (char_length(description) <= 10000),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'review', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date timestamptz,
  assignees uuid[] not null default '{}' check (cardinality(assignees) <= 50),
  department uuid references public.departments (id) on delete set null,
  created_by uuid not null references public.profiles (id),
  completed_at timestamptz,
  attachments text[] not null default '{}' check (cardinality(attachments) <= 5),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create index if not exists idx_tasks_assignees on public.tasks using gin (assignees);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task uuid not null references public.tasks (id) on delete cascade,
  author uuid not null references public.profiles (id),
  text text not null check (btrim(text) <> '' and char_length(text) <= 5000),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create index if not exists idx_task_comments_task on public.task_comments (task, created);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  "user" uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('morning', 'evening', 'night', 'office', 'off', 'leave', 'sick', 'holiday')),
  start_time text not null default '' check (start_time = '' or start_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  end_time text not null default '' check (end_time = '' or end_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  department uuid references public.departments (id) on delete set null,
  note text not null default '' check (char_length(note) <= 500),
  created timestamptz not null default now(),
  updated timestamptz not null default now(),
  unique ("user", date)
);
create index if not exists idx_shifts_date on public.shifts (date);

create table if not exists public.production_plans (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  product text not null check (btrim(product) <> '' and char_length(product) <= 200),
  product_code text not null default '' check (char_length(product_code) <= 50), -- ileride Logo stok kodu ile eşleşir
  quantity numeric not null default 0 check (quantity >= 0),
  unit text not null default '' check (unit in ('', 'kg', 'adet', 'koli', 'ton', 'paket')),
  produced_quantity numeric not null default 0 check (produced_quantity >= 0),
  line text not null default '' check (char_length(line) <= 100),
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'done', 'cancelled')),
  responsible uuid references public.profiles (id) on delete set null,
  department uuid references public.departments (id) on delete set null,
  notes text not null default '' check (char_length(notes) <= 2000),
  created_by uuid not null references public.profiles (id),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create index if not exists idx_production_plans_date on public.production_plans (date);

-- Kayıt sadece save_push_subscription() üzerinden (adres doğrulamasıyla) yapılır.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  "user" uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  user_agent text not null default '' check (char_length(user_agent) <= 300),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);

-- Bildirim servisi (Edge Function) adresi ve ortak anahtarı. KURULUM.md'deki adımda doldurulur;
-- boşken bildirim gönderilmez, uygulamanın geri kalanı çalışır.
create table if not exists private.settings (
  id boolean primary key default true check (id),
  push_url text not null default '',
  push_secret text not null default ''
);
insert into private.settings default values on conflict do nothing;

-- ============================================================ yetki yardımcıları
-- Pasif hesabın rolü yok sayılır: bütün erişim kuralları bu fonksiyonlara bakar.

create or replace function public.app_role()
returns text
language sql stable security definer set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_active()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.app_role() is not null
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.app_role() = 'admin', false)
$$;

create or replace function public.is_manager()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.app_role() in ('admin', 'manager'), false)
$$;

create or replace function public.my_department()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select department from public.profiles where id = auth.uid() and active
$$;

create or replace function private.login_email(p_username text)
returns text
language sql immutable set search_path = ''
as $$
  select lower(btrim(p_username)) || '@portal.artucikolata.com.tr'
$$;

create or replace function private.display_name(p_user uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((select coalesce(nullif(name, ''), username) from public.profiles where id = p_user), 'Bir kullanıcı')
$$;

-- Listedeki herkes kayıtlı kullanıcı mı (uuid[] alanlarında yabancı anahtar olmadığı için)
create or replace function private.all_users_exist(p_users uuid[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from unnest(p_users) as u (id) where not exists (select 1 from public.profiles p where p.id = u.id)
  )
$$;

create or replace function private.distinct_ids(p_ids uuid[])
returns uuid[]
language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(id order by ord), '{}')
  from (select id, min(ord) as ord from unnest(p_ids) with ordinality as t (id, ord) where id is not null group by id) s
$$;

-- ============================================================ ortak tetikleyiciler

-- created / updated sunucuda belirlenir; istemcinin gönderdiği değer yok sayılır.
create or replace function private.stamp()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created := now();
  else
    new.id := old.id;
    new.created := old.created;
  end if;
  if to_jsonb(new) ? 'updated' then
    new.updated := now();
  end if;
  return new;
end;
$$;

-- Güncellemede değişmemesi gereken sütunları eski değerine döndürür (sütun adları tetikleyici parametresi).
create or replace function private.freeze_columns()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_patch jsonb := '{}';
  v_col text;
begin
  foreach v_col in array tg_argv loop
    v_patch := v_patch || jsonb_build_object(v_col, v_old -> v_col);
  end loop;
  return jsonb_populate_record(new, v_patch);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['departments', 'profiles', 'announcements', 'announcement_reads', 'conversations', 'messages',
                           'events', 'tasks', 'task_comments', 'shifts', 'production_plans', 'push_subscriptions'] loop
    execute format('drop trigger if exists a_stamp on public.%I', t);
    execute format('create trigger a_stamp before insert or update on public.%I for each row execute function private.stamp()', t);
  end loop;
end $$;

drop trigger if exists b_freeze on public.announcements;
create trigger b_freeze before update on public.announcements
  for each row execute function private.freeze_columns('author');
drop trigger if exists b_freeze on public.conversations;
create trigger b_freeze before update on public.conversations
  for each row execute function private.freeze_columns('type', 'direct_key');
drop trigger if exists b_freeze on public.messages;
create trigger b_freeze before update on public.messages
  for each row execute function private.freeze_columns('conversation', 'sender');
drop trigger if exists b_freeze on public.events;
create trigger b_freeze before update on public.events
  for each row execute function private.freeze_columns('created_by');
drop trigger if exists b_freeze on public.tasks;
create trigger b_freeze before update on public.tasks
  for each row execute function private.freeze_columns('created_by');
drop trigger if exists b_freeze on public.production_plans;
create trigger b_freeze before update on public.production_plans
  for each row execute function private.freeze_columns('created_by');

-- Silinen birim, duyuru ve etkinliklerin hedef listesinden de çıkar.
create or replace function private.department_deleted()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.announcements set departments = array_remove(departments, old.id) where departments @> array[old.id];
  update public.events set departments = array_remove(departments, old.id) where departments @> array[old.id];
  return old;
end;
$$;
drop trigger if exists department_deleted on public.departments;
create trigger department_deleted after delete on public.departments
  for each row execute function private.department_deleted();

-- ============================================================ bildirim gönderimi

-- Bildirimi Edge Function'a ("bildirim") iletir; o da telefonlara / tarayıcılara Web Push gönderir.
-- İstek, işlem tamamlandıktan sonra arka planda gider (pg_net); hata olursa kayıt işlemi etkilenmez.
create or replace function private.notify(p_users uuid[], p_title text, p_body text, p_url text, p_tag text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_users uuid[];
begin
  select push_url, push_secret into v_url, v_secret from private.settings;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return;
  end if;

  select array_agg(distinct p.id) into v_users
    from public.profiles p
   where p.id = any (p_users) and p.active
     and exists (select 1 from public.push_subscriptions s where s."user" = p.id);
  if v_users is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'user_ids', v_users,
      'title', left(coalesce(p_title, 'Artu Portal'), 120),
      'body', case when char_length(coalesce(p_body, '')) > 180 then left(p_body, 179) || '…' else coalesce(p_body, '') end,
      'url', p_url,
      'tag', p_tag
    ),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-portal-secret', v_secret),
    timeout_milliseconds := 15000
  );
exception when others then
  raise warning 'bildirim gönderilemedi: %', sqlerrm;
end;
$$;

-- ============================================================ kullanıcılar

-- Yetkisiz alan değişikliklerini engeller. SQL Editor'den (oturumsuz) yapılan değişikliklere karışmaz.
create or replace function private.profiles_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.username := lower(btrim(new.username));
  new.name := btrim(new.name);
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    if new.role is distinct from old.role or new.department is distinct from old.department
       or new.active is distinct from old.active or new.username is distinct from old.username then
      raise exception 'Bu alanları sadece admin değiştirebilir.' using errcode = '42501';
    end if;
  elsif new.id = auth.uid() and (not new.active or new.role <> 'admin') then
    -- Admin kendini kilitlemesin
    raise exception 'Kendi hesabınızın rolünü değiştiremez, hesabınızı pasifleştiremezsiniz.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists b_guard on public.profiles;
create trigger b_guard before update on public.profiles
  for each row execute function private.profiles_guard();

-- Kullanıcı adı değişince giriş adresi de değişir; pasifleştirilen hesap giriş yapamaz, oturumu yenilenmez.
create or replace function private.profiles_sync_auth()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.username is distinct from old.username then
    update auth.users set email = private.login_email(new.username), updated_at = now() where id = new.id;
    update auth.identities
       set identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb(private.login_email(new.username))),
           updated_at = now()
     where user_id = new.id and provider = 'email';
  end if;
  if new.active is distinct from old.active then
    update auth.users
       set banned_until = case when new.active then null else timestamptz '2999-12-31 00:00:00+00' end, updated_at = now()
     where id = new.id;
    if not new.active then
      delete from public.push_subscriptions where "user" = new.id;
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists sync_auth on public.profiles;
create trigger sync_auth after update on public.profiles
  for each row execute function private.profiles_sync_auth();

-- Giriş hesabını ve profilini birlikte açar. Yetki denetimi yoktur; doğrudan sadece SQL Editor'den
-- (ilk admin için) çağrılır, uygulama admin_create_user() üzerinden kullanır.
-- Supabase'in auth tablolarına doğrudan yazar; şifre bcrypt ile saklanır.
create or replace function private.create_user(
  p_username text, p_password text, p_name text, p_role text default 'staff',
  p_department uuid default null, p_title text default '', p_phone text default '', p_email text default ''
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_email text;
begin
  if v_username !~ '^[a-z0-9._-]{3,50}$' then
    raise exception 'Kullanıcı adı 3-50 karakter olmalı; sadece küçük harf, rakam, nokta, tire içerebilir.' using errcode = '23514';
  end if;
  if v_name = '' then
    raise exception 'Ad soyad boş olamaz.' using errcode = '23514';
  end if;
  if p_password is null or char_length(p_password) < 10 or char_length(p_password) > 72 then
    raise exception 'Şifre 10 ile 72 karakter arasında olmalı.' using errcode = '23514';
  end if;
  v_email := private.login_email(v_username);
  if exists (select 1 from public.profiles where username = v_username)
     or exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Bu kullanıcı adı zaten kullanılıyor.' using errcode = '23505';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_id, v_id::text, 'email',
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    now(), now(), now()
  );

  insert into public.profiles (id, username, name, role, department, title, phone, email)
  values (v_id, v_username, v_name, coalesce(nullif(p_role, ''), 'staff'), p_department,
          coalesce(p_title, ''), coalesce(p_phone, ''), coalesce(btrim(p_email), ''));

  return v_id;
end;
$$;

create or replace function public.admin_create_user(
  p_username text, p_password text, p_name text, p_role text default 'staff',
  p_department uuid default null, p_title text default '', p_phone text default '', p_email text default ''
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Bu işlem için yetkiniz yok.' using errcode = '42501';
  end if;
  return private.create_user(p_username, p_password, p_name, p_role, p_department, p_title, p_phone, p_email);
end;
$$;

-- Admin bir kullanıcının şifresini değiştirir (açık oturumları kapatmaz).
create or replace function public.admin_reset_password(p_user uuid, p_password text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Bu işlem için yetkiniz yok.' using errcode = '42501';
  end if;
  if p_password is null or char_length(p_password) < 10 or char_length(p_password) > 72 then
    raise exception 'Şifre 10 ile 72 karakter arasında olmalı.' using errcode = '23514';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = p_user;
  if not found then
    raise exception 'Kullanıcı bulunamadı.' using errcode = 'P0002';
  end if;
end;
$$;

-- ============================================================ sohbetler ve mesajlar

create or replace function private.conversations_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.members := private.distinct_ids(new.members);
  new.name := btrim(new.name);
  if not private.all_users_exist(new.members) then
    raise exception 'Sohbete eklenen kullanıcı bulunamadı.' using errcode = '23503';
  end if;
  if new.type = 'direct' then
    if cardinality(new.members) <> 2 then
      raise exception 'Birebir sohbet tam olarak 2 kişi olmalıdır.' using errcode = '23514';
    end if;
    new.name := '';
  else
    if new.name = '' then
      raise exception 'Grup adı zorunludur.' using errcode = '23514';
    end if;
    new.direct_key := null;
  end if;
  if tg_op = 'INSERT' then
    new.last_message_at := now();
    new.last_message_text := '';
  elsif auth.uid() is not null and new.created_by is distinct from old.created_by and not (new.created_by = any (new.members)) then
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
drop trigger if exists c_check on public.conversations;
create trigger c_check before insert or update on public.conversations
  for each row execute function private.conversations_check();

create or replace function private.messages_check()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.text := btrim(new.text);
  if new.text = '' and cardinality(new.attachments) = 0 then
    raise exception 'Boş mesaj gönderilemez.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists c_check on public.messages;
create trigger c_check before insert or update on public.messages
  for each row execute function private.messages_check();

create or replace function private.messages_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv public.conversations;
  v_preview text := case when new.text = '' then '📎 Dosya' else new.text end;
  v_title text := private.display_name(new.sender);
begin
  update public.conversations
     set last_message_at = new.created,
         last_message_text = case when char_length(v_preview) > 190 then left(v_preview, 189) || '…' else v_preview end
   where id = new.conversation
  returning * into v_conv;

  update public.profiles set last_seen = now() where id = new.sender;

  if v_conv.type = 'group' then
    v_title := v_title || ' · ' || v_conv.name;
  end if;
  perform private.notify(array_remove(v_conv.members, new.sender), v_title, v_preview,
                         '/mesajlar/' || v_conv.id, 'conv-' || v_conv.id);
  return null;
end;
$$;
drop trigger if exists created on public.messages;
create trigger created after insert on public.messages
  for each row execute function private.messages_created();

-- İki kişi arasındaki sohbeti bulur ya da oluşturur.
create or replace function public.direct_conversation(p_user uuid)
returns public.conversations
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_conv public.conversations;
begin
  if not public.is_active() then
    raise exception 'Oturum bulunamadı.' using errcode = '42501';
  end if;
  if p_user is null or p_user = v_uid then
    raise exception 'Kendinizle sohbet başlatamazsınız.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and active) then
    raise exception 'Kullanıcı bulunamadı.' using errcode = 'P0002';
  end if;

  v_key := least(v_uid::text, p_user::text) || ':' || greatest(v_uid::text, p_user::text);
  -- Aynı anda iki istek gelirse ikincisi mevcut kaydı döndürür.
  insert into public.conversations (type, members, created_by, direct_key)
  values ('direct', array[v_uid, p_user], v_uid, v_key)
  on conflict (direct_key) where direct_key is not null do nothing;

  select * into v_conv from public.conversations where direct_key = v_key;
  return v_conv;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_active()
     or not exists (select 1 from public.conversations where id = p_conversation and v_uid = any (members)) then
    raise exception 'Sohbet bulunamadı.' using errcode = 'P0002';
  end if;
  insert into public.conversation_reads (conversation, "user", last_read_at)
  values (p_conversation, v_uid, now())
  on conflict (conversation, "user") do update set last_read_at = excluded.last_read_at;
end;
$$;

-- Gruptan ayrılır; 2 kişiden az kalırsa grup kapanır, kurucu ayrılırsa yönetim kalan ilk üyeye geçer.
create or replace function public.leave_conversation(p_conversation uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_conv public.conversations;
  v_remaining uuid[];
begin
  select * into v_conv from public.conversations where id = p_conversation and v_uid = any (members) for update;
  if not found or not public.is_active() then
    raise exception 'Sohbet bulunamadı.' using errcode = 'P0002';
  end if;
  if v_conv.type <> 'group' then
    raise exception 'Sadece gruplardan ayrılabilirsiniz.' using errcode = '23514';
  end if;

  v_remaining := array_remove(v_conv.members, v_uid);
  if cardinality(v_remaining) < 2 then
    delete from public.conversations where id = p_conversation;
    return;
  end if;
  update public.conversations
     set members = v_remaining,
         created_by = case when created_by = v_uid then v_remaining[1] else created_by end
   where id = p_conversation;
end;
$$;

-- Sohbet bazında okunmamış mesaj ve okunmamış duyuru sayıları; "son görülme"yi de tazeler.
create or replace function public.unread_counts()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles;
  v_conversations jsonb;
  v_announcements integer;
begin
  select * into v_me from public.profiles where id = v_uid and active;
  if not found then
    raise exception 'Oturum bulunamadı.' using errcode = '42501';
  end if;
  if v_me.last_seen is null or v_me.last_seen < now() - interval '2 minutes' then
    update public.profiles set last_seen = now() where id = v_uid;
  end if;

  select coalesce(jsonb_object_agg(t.conversation::text, t.n), '{}'::jsonb) into v_conversations
    from (
      select m.conversation, count(*) as n
        from public.messages m
        join public.conversations c on c.id = m.conversation
        left join public.conversation_reads r on r.conversation = m.conversation and r."user" = v_uid
       where v_uid = any (c.members)
         and m.sender <> v_uid
         and (r.last_read_at is null or m.created > r.last_read_at)
       group by m.conversation
    ) t;

  select count(*) into v_announcements
    from public.announcements a
   where a.author <> v_uid
     and a.created >= v_me.created
     and (cardinality(a.departments) = 0 or v_me.role = 'admin' or v_me.department = any (a.departments))
     and not exists (select 1 from public.announcement_reads r where r.announcement = a.id and r."user" = v_uid);

  return jsonb_build_object('conversations', v_conversations, 'announcements', v_announcements);
end;
$$;

-- ============================================================ duyurular

create or replace function private.announcements_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_users uuid[];
begin
  select array_agg(p.id) into v_users
    from public.profiles p
   where p.active and p.id <> new.author
     and (cardinality(new.departments) = 0 or p.department = any (new.departments) or p.role = 'admin');

  perform private.notify(
    v_users,
    case when new.priority = 'urgent' then '🚨 ACİL: ' else '📢 ' end || new.title,
    btrim(regexp_replace(regexp_replace(new.body, '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')),
    '/duyurular/' || new.id, 'ann-' || new.id);
  return null;
end;
$$;
drop trigger if exists created on public.announcements;
create trigger created after insert on public.announcements
  for each row execute function private.announcements_created();

-- ============================================================ görevler

create or replace function private.tasks_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.assignees := private.distinct_ids(new.assignees);
  if not private.all_users_exist(new.assignees) then
    raise exception 'Görev atanan kullanıcı bulunamadı.' using errcode = '23503';
  end if;

  -- Atanan (yönetici olmayan) kişi yalnızca durumu değiştirebilir.
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_manager() and old.created_by <> auth.uid() then
    if (to_jsonb(new) - 'status' - 'completed_at' - 'updated') <> (to_jsonb(old) - 'status' - 'completed_at' - 'updated') then
      raise exception 'Size atanan görevde sadece durumu değiştirebilirsiniz.' using errcode = '42501';
    end if;
  end if;

  if new.status = 'done' then
    new.completed_at := case when tg_op = 'UPDATE' and old.status = 'done' then coalesce(old.completed_at, now()) else now() end;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists c_check on public.tasks;
create trigger c_check before insert or update on public.tasks
  for each row execute function private.tasks_check();

create or replace function private.tasks_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.created_by);
  v_new uuid[];
  v_body text := new.title;
begin
  if tg_op = 'INSERT' then
    v_new := new.assignees;
  else
    select coalesce(array_agg(a), '{}') into v_new from unnest(new.assignees) as a where not (a = any (old.assignees));
  end if;
  v_new := array_remove(v_new, v_actor);

  if cardinality(v_new) > 0 then
    if new.due_date is not null then
      v_body := v_body || ' · Son tarih: ' || to_char(new.due_date at time zone 'Europe/Istanbul', 'DD.MM.YYYY');
    end if;
    perform private.notify(v_new, '📋 Yeni görev: ' || private.display_name(v_actor), v_body,
                           '/gorevler?id=' || new.id, 'task-' || new.id);
  end if;

  if tg_op = 'UPDATE' and new.status = 'done' and old.status <> 'done' and new.created_by <> v_actor then
    perform private.notify(array[new.created_by], '✅ Görev tamamlandı',
                           private.display_name(v_actor) || ': ' || new.title,
                           '/gorevler?id=' || new.id, 'task-' || new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists notify on public.tasks;
create trigger notify after insert or update on public.tasks
  for each row execute function private.tasks_notify();

create or replace function private.task_comments_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = new.task;
  perform private.notify(array_remove(v_task.assignees || v_task.created_by, new.author),
                         '💬 ' || v_task.title, private.display_name(new.author) || ': ' || new.text,
                         '/gorevler?id=' || v_task.id, 'task-' || v_task.id);
  return null;
end;
$$;
drop trigger if exists created on public.task_comments;
create trigger created after insert on public.task_comments
  for each row execute function private.task_comments_created();

-- ============================================================ takvim

create or replace function private.events_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.participants := private.distinct_ids(new.participants);
  if not private.all_users_exist(new.participants) then
    raise exception 'Katılımcı bulunamadı.' using errcode = '23503';
  end if;
  return new;
end;
$$;
drop trigger if exists c_check on public.events;
create trigger c_check before insert or update on public.events
  for each row execute function private.events_check();

create or replace function private.events_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_when text := to_char(new.start at time zone 'Europe/Istanbul', case when new.all_day then 'DD.MM.YYYY' else 'DD.MM.YYYY HH24:MI' end);
begin
  perform private.notify(array_remove(new.participants, coalesce(auth.uid(), new.created_by)),
                         '📅 ' || new.title,
                         v_when || case when new.location <> '' then ' · ' || new.location else '' end,
                         '/takvim?id=' || new.id, 'event-' || new.id);
  return null;
end;
$$;
drop trigger if exists created on public.events;
create trigger created after insert on public.events
  for each row execute function private.events_created();

-- ============================================================ bildirim aboneliği

-- Abonelik adresi https ve bilinen bir tarayıcı bildirim servisi olmalıdır (başka adrese istek atılmaz).
-- Ortak cihazda abonelik, giriş yapan yeni kullanıcıya devredilir.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default '')
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_active() then
    raise exception 'Oturum bulunamadı.' using errcode = '42501';
  end if;
  if coalesce(p_endpoint, '') !~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|[a-z0-9.-]+\.push\.apple\.com)/' then
    raise exception 'Desteklenmeyen bildirim servisi.' using errcode = '23514';
  end if;
  if coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Geçersiz bildirim aboneliği.' using errcode = '23514';
  end if;

  insert into public.push_subscriptions ("user", endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update
    set "user" = excluded."user", p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;

-- ============================================================ erişim kuralları (RLS)

do $$
declare
  t text;
begin
  foreach t in array array['departments', 'profiles', 'announcements', 'announcement_reads', 'conversations', 'messages',
                           'conversation_reads', 'events', 'tasks', 'task_comments', 'shifts', 'production_plans',
                           'push_subscriptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Birimler: herkes okur, admin yönetir
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated using (public.is_active());
drop policy if exists departments_insert on public.departments;
create policy departments_insert on public.departments for insert to authenticated with check (public.is_admin());
drop policy if exists departments_update on public.departments;
create policy departments_update on public.departments for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists departments_delete on public.departments;
create policy departments_delete on public.departments for delete to authenticated using (public.is_admin());

-- Kullanıcılar: herkes rehberi okur; kişi kendi bilgilerini, admin herkesi günceller (alan kısıtı: private.profiles_guard).
-- Yeni kullanıcı sadece admin_create_user() ile açılır; kullanıcı silinmez, pasifleştirilir.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (public.is_active());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin() or (id = auth.uid() and public.is_active()))
  with check (public.is_admin() or (id = auth.uid() and public.is_active()));

-- Duyurular: hedef birimdekiler, yazarı ve admin görür; birim sorumlusu ve admin yayınlar
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
  using (public.is_active() and (cardinality(departments) = 0 or public.my_department() = any (departments)
         or author = auth.uid() or public.is_admin()));
drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert to authenticated
  with check (public.is_manager() and author = auth.uid());
-- Yetkisi düşürülen eski yönetici kendi duyurularını da düzenleyemez.
drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements for update to authenticated
  using (public.is_manager() and (author = auth.uid() or public.is_admin()))
  with check (public.is_manager() and (author = auth.uid() or public.is_admin()));
drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements for delete to authenticated
  using (public.is_manager() and (author = auth.uid() or public.is_admin()));

-- Okundu kayıtları: kişi kendininkini, duyurunun yazarı ve admin hepsini görür
drop policy if exists announcement_reads_select on public.announcement_reads;
create policy announcement_reads_select on public.announcement_reads for select to authenticated
  using (public.is_active() and ("user" = auth.uid() or public.is_admin()
         or exists (select 1 from public.announcements a where a.id = announcement and a.author = auth.uid())));
drop policy if exists announcement_reads_insert on public.announcement_reads;
create policy announcement_reads_insert on public.announcement_reads for insert to authenticated
  with check ("user" = auth.uid() and exists (select 1 from public.announcements a where a.id = announcement));

-- Sohbetler: sadece üyeler. Birebir sohbet direct_conversation() ile açılır.
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using (public.is_active() and auth.uid() = any (members));
drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations for insert to authenticated
  with check (public.is_active() and type = 'group' and created_by = auth.uid() and auth.uid() = any (members));
drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations for update to authenticated
  using (type = 'group' and auth.uid() = any (members) and (created_by = auth.uid() or public.is_admin()))
  with check (type = 'group' and auth.uid() = any (members));
drop policy if exists conversations_delete on public.conversations;
create policy conversations_delete on public.conversations for delete to authenticated
  using (auth.uid() = any (members) and (created_by = auth.uid() or public.is_admin()));

-- Mesajlar: sohbetin üyeleri okur ve yazar; kişi sadece kendi mesajını değiştirir / siler.
-- (Alt sorgu conversations tablosunun kuralından geçer: üye değilse satır görünmez.)
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation));
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update to authenticated
  using (sender = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation))
  with check (sender = auth.uid());
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete to authenticated
  using (sender = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation));

drop policy if exists conversation_reads_select on public.conversation_reads;
create policy conversation_reads_select on public.conversation_reads for select to authenticated
  using ("user" = auth.uid() and public.is_active());

-- Takvim: herkes görür ve ekler; ekleyen, birim sorumlusu ve admin düzenler
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated using (public.is_active());
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
  with check (public.is_active() and created_by = auth.uid());
drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (public.is_manager() or (created_by = auth.uid() and public.is_active()))
  with check (public.is_manager() or (created_by = auth.uid() and public.is_active()));
drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete to authenticated
  using (public.is_manager() or (created_by = auth.uid() and public.is_active()));

-- Görevler: atanan, açan, birim sorumlusu ve admin görür (alan kısıtı: private.tasks_check)
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (public.is_active() and (auth.uid() = any (assignees) or created_by = auth.uid() or public.is_manager()));
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.is_active() and created_by = auth.uid());
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_active() and (auth.uid() = any (assignees) or created_by = auth.uid() or public.is_manager()))
  with check (public.is_active());
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_admin() or (created_by = auth.uid() and public.is_active()));

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task));
drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (author = auth.uid() and exists (select 1 from public.tasks t where t.id = task));
drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments for delete to authenticated
  using (public.is_admin() or (author = auth.uid() and public.is_active()));

-- Vardiya ve üretim planı: herkes görür, birim sorumlusu ve admin girer
drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts for select to authenticated using (public.is_active());
drop policy if exists shifts_insert on public.shifts;
create policy shifts_insert on public.shifts for insert to authenticated with check (public.is_manager());
drop policy if exists shifts_update on public.shifts;
create policy shifts_update on public.shifts for update to authenticated using (public.is_manager()) with check (public.is_manager());
drop policy if exists shifts_delete on public.shifts;
create policy shifts_delete on public.shifts for delete to authenticated using (public.is_manager());

drop policy if exists production_plans_select on public.production_plans;
create policy production_plans_select on public.production_plans for select to authenticated using (public.is_active());
drop policy if exists production_plans_insert on public.production_plans;
create policy production_plans_insert on public.production_plans for insert to authenticated
  with check (public.is_manager() and created_by = auth.uid());
drop policy if exists production_plans_update on public.production_plans;
create policy production_plans_update on public.production_plans for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
drop policy if exists production_plans_delete on public.production_plans;
create policy production_plans_delete on public.production_plans for delete to authenticated using (public.is_manager());

-- Bildirim abonelikleri: kişi kendininkini görür ve siler (çıkışta); kayıt save_push_subscription() ile
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using ("user" = auth.uid());
drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated using ("user" = auth.uid());

-- ============================================================ dosyalar (Storage)
-- "ekler"  : duyuru / görev / mesaj ekleri. GİZLİ; dosya yolu <tür>/<kayıt>/<dosya>:
--              messages/<sohbet id>/…   announcements/<duyuru id>/…   tasks/<görev id>/…
--            Kaydı görebilen eki de görebilir (uygulama kısa ömürlü imzalı bağlantı alır).
-- "avatars": profil fotoğrafları. Herkese açık adres; yol <kullanıcı id>/<dosya>.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ekler', 'ekler', false, 10485760,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
        'application/pdf', 'text/plain', 'text/csv',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/zip', 'application/x-zip-compressed']
)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Ek, bağlı olduğu kaydı görebilen kişiye açıktır (alt sorgular ilgili tablonun kuralından geçer).
create or replace function public.can_read_attachment(p_path text)
returns boolean
language sql stable set search_path = ''
as $$
  select case split_part(p_path, '/', 1)
    when 'messages' then exists (select 1 from public.conversations c where c.id::text = split_part(p_path, '/', 2))
    when 'announcements' then exists (select 1 from public.announcements a where a.id::text = split_part(p_path, '/', 2))
    when 'tasks' then exists (select 1 from public.tasks t where t.id::text = split_part(p_path, '/', 2))
    else false
  end
$$;

drop policy if exists ekler_select on storage.objects;
create policy ekler_select on storage.objects for select to authenticated
  using (bucket_id = 'ekler' and public.is_active() and (owner_id = auth.uid()::text or public.can_read_attachment(name)));

-- Yükleme: mesaj eki için sohbet üyesi, duyuru eki için birim sorumlusu / admin olmak gerekir.
drop policy if exists ekler_insert on storage.objects;
create policy ekler_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ekler' and public.is_active() and name ~ '^(messages|announcements|tasks)/[0-9a-f-]{36}/[^/]+$'
    and case split_part(name, '/', 1)
          when 'messages' then public.can_read_attachment(name)
          when 'announcements' then public.is_manager()
          else true
        end
  );

drop policy if exists ekler_delete on storage.objects;
create policy ekler_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ekler' and (owner_id = auth.uid()::text or public.is_admin()));

drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.is_active() and split_part(name, '/', 1) = auth.uid()::text);
drop policy if exists avatars_select on storage.objects;
create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);
drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

-- ============================================================ fonksiyon yetkileri
-- Uygulamanın çağırdığı fonksiyonlar sadece giriş yapmış kullanıcıya açıktır; private şeması API'ye kapalıdır.

revoke execute on all functions in schema private from public, anon, authenticated;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('app_role', 'is_active', 'is_admin', 'is_manager', 'my_department', 'can_read_attachment',
                         'admin_create_user', 'admin_reset_password', 'direct_conversation', 'mark_conversation_read',
                         'leave_conversation', 'unread_counts', 'save_push_subscription')
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ============================================================ canlı yayın (Realtime)

do $$
declare
  t text;
begin
  foreach t in array array['messages', 'conversations', 'announcements', 'events', 'tasks', 'production_plans'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================ kontrol
-- İlk satır "13", ikinci satır "2" olmalı.
select 'tablo sayısı' as kontrol, count(*)::text as sonuc
  from pg_tables
 where schemaname = 'public'
   and tablename in ('departments', 'profiles', 'announcements', 'announcement_reads', 'conversations', 'messages',
                     'conversation_reads', 'events', 'tasks', 'task_comments', 'shifts', 'production_plans', 'push_subscriptions')
union all
select 'dosya alanı sayısı', count(*)::text from storage.buckets where id in ('ekler', 'avatars');
