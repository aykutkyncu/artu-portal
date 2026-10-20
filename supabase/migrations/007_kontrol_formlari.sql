-- Kalite ve hijyen kontrol formları (2026-10-20).
--   Form şablonu: ad, hangi birim doldurur (boşsa herkes), sıklık (her gün / gerektikçe), maddeler.
--   Madde türleri: "check" (uygun / uygun değil), "number" (ölçüm; alt-üst sınır ve birim), "text" (serbest not).
--   Şablonları admin ve birim sorumluları yönetir. Hazır üç şablon gelir: günlük temizlik, sıcaklık/nem, metal dedektör.
--   Kayıt: dolduran, gün (İstanbul), değerler. Maddeler kayda kopyalanır; şablon sonradan değişse de eski kayıt bozulmaz.
--   "Uygun değil" ya da sınır dışı ölçüm varsa kayıt "uygunsuz" işaretlenir, açıklama (düzeltici faaliyet) zorunludur,
--   formun birim sorumlusuna ve adminlere bildirim gider.
--   Kayıt silinmez. Dolduran aynı gün, onaylanmadan düzeltebilir. Birim sorumlusu / admin kaydı onaylar (kontrol eden).
-- Önce 006_ariza_bildirimi.sql çalışmış olmalı (sayaç fonksiyonu arıza tablosunu da sayar).
-- Arayüzdeki karşılığı: web/src/pages/ChecksPage.tsx
-- Supabase panelinde: SQL Editor > New query > bu dosyanın tamamını yapıştır > Run  (tekrar çalıştırılabilir)

create table if not exists public.check_forms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and char_length(name) <= 120),
  description text not null default '' check (char_length(description) <= 1000),
  department uuid references public.departments (id) on delete set null,
  frequency text not null default 'daily' check (frequency in ('daily', 'free')),
  items jsonb not null default '[]' check (jsonb_typeof(items) = 'array'),
  active boolean not null default true,
  sort integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);

create table if not exists public.check_entries (
  id uuid primary key default gen_random_uuid(),
  form uuid not null references public.check_forms (id) on delete restrict,
  filled_by uuid not null references public.profiles (id) on delete cascade,
  day date not null default (now() at time zone 'Europe/Istanbul')::date,
  items jsonb not null default '[]',
  "values" jsonb not null default '{}' check (jsonb_typeof("values") = 'object'),
  has_issue boolean not null default false,
  note text not null default '' check (char_length(note) <= 2000),
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create index if not exists idx_check_entries_form_day on public.check_entries (form, day desc);
create index if not exists idx_check_entries_day on public.check_entries (day desc, created desc);

drop trigger if exists a_stamp on public.check_forms;
create trigger a_stamp before insert or update on public.check_forms
  for each row execute function private.stamp();
drop trigger if exists a_stamp on public.check_entries;
create trigger a_stamp before insert or update on public.check_entries
  for each row execute function private.stamp();

-- ============================================================ yetki

create or replace function private.istanbul_today()
returns date
language sql stable set search_path = ''
as $$
  select (now() at time zone 'Europe/Istanbul')::date
$$;

-- Formu doldurabilir mi: formun birimi boşsa herkes, değilse o birim + admin + yöneticiler
create or replace function private.can_fill_form(p_user uuid, p_form uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.check_forms f join public.profiles p on p.id = p_user
     where f.id = p_form and f.active and p.active
       and (f.department is null or f.department = p.department or p.role in ('admin', 'manager'))
  )
$$;

-- Formu (ve kayıtlarını onaylamayı) yönetebilir mi: admin; birim sorumlusu kendi biriminin formunu ya da birimsiz formu
create or replace function public.can_manage_form(p_department uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin()
      or (public.app_role() = 'manager' and (p_department is null or p_department = public.my_department()))
$$;

-- Formun sorumluları (uygunsuzluk bildirimi alıcıları): birimin sorumluları + adminler
create or replace function private.form_supervisors(p_department uuid, p_except uuid)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(p.id), '{}')
    from public.profiles p
   where p.active and p.id is distinct from p_except
     and (p.role = 'admin' or (p.role = 'manager' and p_department is not null and p.department = p_department))
$$;

-- ============================================================ şablon kuralları

create or replace function private.check_forms_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_item jsonb;
  v_ids text[] := '{}';
  v_kind text;
begin
  new.name := btrim(new.name);
  new.description := btrim(new.description);
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    new.created_by := old.created_by;
  end if;

  if auth.uid() is not null then
    if not public.can_manage_form(new.department) or (tg_op = 'UPDATE' and not public.can_manage_form(old.department)) then
      raise exception 'Bu formu sadece admin ya da birim sorumlusu düzenleyebilir.' using errcode = '42501';
    end if;
  end if;

  if jsonb_array_length(new.items) = 0 then
    raise exception 'Forma en az bir madde ekleyin.' using errcode = '23514';
  end if;
  if jsonb_array_length(new.items) > 60 then
    raise exception 'Bir formda en fazla 60 madde olabilir.' using errcode = '23514';
  end if;
  for v_item in select * from jsonb_array_elements(new.items) loop
    v_kind := v_item ->> 'kind';
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item ->> 'id', '') !~ '^[a-z0-9-]{1,40}$' then
      raise exception 'Geçersiz form maddesi.' using errcode = '23514';
    end if;
    if v_item ->> 'id' = any (v_ids) then
      raise exception 'Form maddelerinin kimlikleri benzersiz olmalı.' using errcode = '23514';
    end if;
    v_ids := v_ids || (v_item ->> 'id');
    if btrim(coalesce(v_item ->> 'label', '')) = '' or char_length(v_item ->> 'label') > 200 then
      raise exception 'Her maddenin adı olmalı (en fazla 200 karakter).' using errcode = '23514';
    end if;
    if v_kind is null or v_kind not in ('check', 'number', 'text') then
      raise exception 'Madde türü geçersiz.' using errcode = '23514';
    end if;
    if v_kind = 'number' then
      if (v_item ? 'min' and jsonb_typeof(v_item -> 'min') not in ('number', 'null'))
         or (v_item ? 'max' and jsonb_typeof(v_item -> 'max') not in ('number', 'null')) then
        raise exception 'Ölçüm sınırları sayı olmalı.' using errcode = '23514';
      end if;
      if jsonb_typeof(v_item -> 'min') = 'number' and jsonb_typeof(v_item -> 'max') = 'number'
         and (v_item ->> 'min')::numeric > (v_item ->> 'max')::numeric then
        raise exception '"%": alt sınır üst sınırdan büyük olamaz.', v_item ->> 'label' using errcode = '23514';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists c_check on public.check_forms;
create trigger c_check before insert or update on public.check_forms
  for each row execute function private.check_forms_check();

-- ============================================================ kayıt kuralları

create or replace function private.check_entries_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_form public.check_forms;
  v_item jsonb;
  v_val jsonb;
  v_num numeric;
  v_issue boolean := false;
  v_key text;
begin
  new.note := btrim(new.note);

  if tg_op = 'INSERT' then
    select * into v_form from public.check_forms where id = new.form;
    if v_uid is not null then
      new.filled_by := v_uid;
      new.day := private.istanbul_today();
      new.verified_by := null;
      new.verified_at := null;
      if not private.can_fill_form(v_uid, new.form) then
        raise exception 'Bu formu doldurma yetkiniz yok.' using errcode = '42501';
      end if;
    end if;
    new.items := v_form.items; -- şablonun o anki hali kayda kopyalanır
  else
    select * into v_form from public.check_forms where id = old.form;
    new.form := old.form;
    new.filled_by := old.filled_by;
    new.day := old.day;
    new.items := old.items;

    if v_uid is not null then
      if new.verified_by is distinct from old.verified_by then
        -- Onaylama / onayı geri alma: sadece formun sorumlusu, kendi kaydını onaylayamaz (admin hariç)
        if not public.can_manage_form(v_form.department) then
          raise exception 'Kaydı sadece formun birim sorumlusu ya da admin onaylayabilir.' using errcode = '42501';
        end if;
        if old.filled_by = v_uid and not public.is_admin() then
          raise exception 'Kendi doldurduğunuz kaydı onaylayamazsınız.' using errcode = '42501';
        end if;
        if new.verified_by is not null then
          new.verified_by := v_uid;
          new.verified_at := now();
        else
          new.verified_at := null;
        end if;
        if (new."values", new.note) is distinct from (old."values", old.note) then
          raise exception 'Onay ve düzeltme ayrı yapılır.' using errcode = '23514';
        end if;
        return new;
      end if;
      new.verified_at := old.verified_at;
      if (new."values", new.note) is distinct from (old."values", old.note) then
        if old.filled_by <> v_uid then
          raise exception 'Kaydı sadece dolduran kişi düzeltebilir.' using errcode = '42501';
        end if;
        if old.verified_by is not null then
          raise exception 'Onaylanmış kayıt değiştirilemez.' using errcode = '42501';
        end if;
        if old.day <> private.istanbul_today() then
          raise exception 'Kayıt sadece doldurulduğu gün düzeltilebilir.' using errcode = '42501';
        end if;
      end if;
    end if;
  end if;

  -- Değerleri denetle ve uygunsuzluğu hesapla
  for v_key in select jsonb_object_keys(new."values") loop
    if not exists (select 1 from jsonb_array_elements(new.items) i where i ->> 'id' = v_key) then
      raise exception 'Formda olmayan madde.' using errcode = '23514';
    end if;
  end loop;
  for v_item in select * from jsonb_array_elements(new.items) loop
    v_val := new."values" -> (v_item ->> 'id');
    if v_val is null or jsonb_typeof(v_val) = 'null' or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '') then
      if v_item ->> 'kind' <> 'text' then
        raise exception '"%" doldurulmadı.', v_item ->> 'label' using errcode = '23514';
      end if;
      continue;
    end if;
    case v_item ->> 'kind'
      when 'check' then
        if jsonb_typeof(v_val) <> 'boolean' then
          raise exception '"%": uygun / uygun değil seçin.', v_item ->> 'label' using errcode = '23514';
        end if;
        if not (v_val #>> '{}')::boolean then
          v_issue := true;
        end if;
      when 'number' then
        if jsonb_typeof(v_val) <> 'number' then
          raise exception '"%": sayı yazın.', v_item ->> 'label' using errcode = '23514';
        end if;
        v_num := (v_val #>> '{}')::numeric;
        if (jsonb_typeof(v_item -> 'min') = 'number' and v_num < (v_item ->> 'min')::numeric)
           or (jsonb_typeof(v_item -> 'max') = 'number' and v_num > (v_item ->> 'max')::numeric) then
          v_issue := true;
        end if;
      else
        if jsonb_typeof(v_val) <> 'string' or char_length(v_val #>> '{}') > 500 then
          raise exception '"%": en fazla 500 karakter.', v_item ->> 'label' using errcode = '23514';
        end if;
    end case;
  end loop;
  new.has_issue := v_issue;
  if v_issue and new.note = '' then
    raise exception 'Uygunsuzluk var: ne yapıldığını (düzeltici faaliyeti) açıklamaya yazın.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists c_check on public.check_entries;
create trigger c_check before insert or update on public.check_entries
  for each row execute function private.check_entries_check();

-- Uygunsuzluk bildirimi (yeni kayıtta ya da düzeltmede ilk kez uygunsuz olunca)
create or replace function private.check_entries_changed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_form public.check_forms;
begin
  if not new.has_issue or (tg_op = 'UPDATE' and old.has_issue) then
    return null;
  end if;
  select * into v_form from public.check_forms where id = new.form;
  perform private.notify(private.form_supervisors(v_form.department, new.filled_by),
                         '⚠️ Uygunsuzluk: ' || v_form.name,
                         new.note || ' · ' || private.display_name(new.filled_by),
                         '/kontroller', 'check-' || new.id);
  return null;
end;
$$;
drop trigger if exists changed on public.check_entries;
create trigger changed after insert or update on public.check_entries
  for each row execute function private.check_entries_changed();

-- Sayaçlara "bugün doldurmam gereken ve henüz kimsenin doldurmadığı günlük form" eklendi (006'daki tanımın yenisi).
-- Yöneticiler için birimsiz formlar ve kendi birimleri sayılır; admin sadece birimsiz formları görür (her birimin işi değil).
create or replace function public.unread_counts()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles;
  v_conversations jsonb;
  v_announcements integer;
  v_leaves integer := 0;
  v_faults integer := 0;
  v_checks integer := 0;
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

  if v_me.role in ('admin', 'manager') then
    select count(*) into v_leaves
      from public.leave_requests l
     where l.status = 'pending' and l."user" <> v_uid and public.can_decide_leave(l."user");
  end if;

  if private.is_maintenance_user(v_uid) then
    select count(*) into v_faults from public.faults f where f.status = 'open';
  end if;

  select count(*) into v_checks
    from public.check_forms f
   where f.active and f.frequency = 'daily'
     and (f.department is null or f.department = v_me.department)
     and not exists (select 1 from public.check_entries e where e.form = f.id and e.day = private.istanbul_today());

  return jsonb_build_object('conversations', v_conversations, 'announcements', v_announcements, 'leaves', v_leaves,
                            'faults', v_faults, 'checks', v_checks);
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.can_manage_form(uuid) from public, anon;
grant execute on function public.can_manage_form(uuid) to authenticated;

-- ============================================================ erişim kuralları

alter table public.check_forms enable row level security;
revoke all on public.check_forms from anon, authenticated;
grant select, insert, update on public.check_forms to authenticated;

drop policy if exists check_forms_select on public.check_forms;
create policy check_forms_select on public.check_forms for select to authenticated using (public.is_active());
drop policy if exists check_forms_insert on public.check_forms;
create policy check_forms_insert on public.check_forms for insert to authenticated
  with check (public.is_active() and public.can_manage_form(department));
drop policy if exists check_forms_update on public.check_forms;
create policy check_forms_update on public.check_forms for update to authenticated
  using (public.is_active() and public.can_manage_form(department))
  with check (public.is_active() and public.can_manage_form(department));

alter table public.check_entries enable row level security;
revoke all on public.check_entries from anon, authenticated;
grant select, insert, update on public.check_entries to authenticated;

drop policy if exists check_entries_select on public.check_entries;
create policy check_entries_select on public.check_entries for select to authenticated using (public.is_active());
drop policy if exists check_entries_insert on public.check_entries;
create policy check_entries_insert on public.check_entries for insert to authenticated
  with check (public.is_active() and filled_by = auth.uid());
-- Kimin neyi değiştirebileceği: private.check_entries_check
drop policy if exists check_entries_update on public.check_entries;
create policy check_entries_update on public.check_entries for update to authenticated
  using (public.is_active() and (filled_by = auth.uid() or public.is_manager()))
  with check (public.is_active());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'check_entries') then
    alter publication supabase_realtime add table public.check_entries;
  end if;
end $$;

-- ============================================================ hazır şablonlar (tablo boşsa)
-- Sınırlar örnektir; Kontroller > Formlar ekranından işletmeye göre değiştirin.

do $$
begin
  if not exists (select 1 from public.check_forms) then
    insert into public.check_forms (name, description, frequency, sort, items) values
    ('Günlük temizlik kontrolü', 'Vardiya sonunda üretim alanı temizliği.', 'daily', 1, '[
      {"id": "zemin", "label": "Zemin ve giderler temiz", "kind": "check"},
      {"id": "tezgah", "label": "Tezgâh ve çalışma yüzeyleri temiz, dezenfekte edildi", "kind": "check"},
      {"id": "makine", "label": "Makine temas yüzeyleri temiz (dolum, temperleme, kalıp)", "kind": "check"},
      {"id": "kalip", "label": "Kalıplar yıkandı ve kurudu", "kind": "check"},
      {"id": "lavabo", "label": "Lavabo: sabun, dezenfektan, kâğıt havlu var", "kind": "check"},
      {"id": "cop", "label": "Çöpler boşaltıldı, kapaklar kapalı", "kind": "check"},
      {"id": "hasere", "label": "Haşere izi yok", "kind": "check"},
      {"id": "cam", "label": "Kırık cam / sert plastik yok", "kind": "check"},
      {"id": "not", "label": "Not", "kind": "text"}
    ]'),
    ('Sıcaklık ve nem kontrolü', 'Depo ve üretim alanı ölçümleri. Günde en az bir kez, sıcak günlerde öğleden sonra tekrar.', 'daily', 2, '[
      {"id": "hammadde-sicaklik", "label": "Hammadde deposu sıcaklığı", "kind": "number", "unit": "°C", "min": 12, "max": 20},
      {"id": "hammadde-nem", "label": "Hammadde deposu nemi", "kind": "number", "unit": "%", "min": 0, "max": 60},
      {"id": "mamul-sicaklik", "label": "Mamul deposu sıcaklığı", "kind": "number", "unit": "°C", "min": 12, "max": 18},
      {"id": "mamul-nem", "label": "Mamul deposu nemi", "kind": "number", "unit": "%", "min": 0, "max": 60},
      {"id": "uretim-sicaklik", "label": "Üretim alanı sıcaklığı", "kind": "number", "unit": "°C", "min": 16, "max": 22},
      {"id": "sogutucu", "label": "Soğutucu / buzdolabı", "kind": "number", "unit": "°C", "min": 0, "max": 4},
      {"id": "not", "label": "Not", "kind": "text"}
    ]'),
    ('Metal dedektör kontrolü', 'Vardiya başında ve ürün değişiminde test parçalarıyla.', 'daily', 3, '[
      {"id": "urun", "label": "Ürün", "kind": "text"},
      {"id": "fe", "label": "Fe test parçası algılandı ve ayrıldı", "kind": "check"},
      {"id": "nonfe", "label": "Non-Fe test parçası algılandı ve ayrıldı", "kind": "check"},
      {"id": "ss", "label": "Paslanmaz çelik test parçası algılandı ve ayrıldı", "kind": "check"},
      {"id": "red", "label": "Ret düzeneği / ret kutusu çalışıyor, kilitli", "kind": "check"},
      {"id": "not", "label": "Not", "kind": "text"}
    ]');
  end if;
end $$;

-- Kontrol: üç satır da "evet" olmalı
select 'form tablosu' as kontrol, case when to_regclass('public.check_forms') is not null then 'evet' else 'HAYIR' end as sonuc
union all
select 'kayıt tablosu', case when to_regclass('public.check_entries') is not null then 'evet' else 'HAYIR' end
union all
select 'hazır formlar', case when exists (select 1 from public.check_forms) then 'evet' else 'HAYIR' end;
