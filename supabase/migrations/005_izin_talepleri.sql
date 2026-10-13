-- İzin talepleri (2026-10-13).
--   Çalışan izin ister; kendi birim sorumlusu ya da admin onaylar / reddeder. Birim sorumlusunun kendi talebini admin sonuçlandırır.
--   Onaylanan izin vardiya çizelgesine kendiliğinden işlenir (rapor → "Rapor", diğerleri → "İzin"); hafta tatili ve
--   resmi tatil olarak girilmiş günlere dokunulmaz. Onaylı izin iptal edilirse çizelgeden de kalkar.
--   Yıllık izin hakkı (profiles.annual_leave_days) admin tarafından girilir; kalan = hak − o yıl onaylanan yıllık izin.
--   Talep silinmez; iptal edilir.
-- Arayüzdeki karşılığı: web/src/pages/LeavesPage.tsx
-- Supabase panelinde: SQL Editor > New query > bu dosyanın tamamını yapıştır > Run  (tekrar çalıştırılabilir)

alter table public.profiles add column if not exists annual_leave_days numeric(4, 1) not null default 14
  check (annual_leave_days >= 0 and annual_leave_days <= 99);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  "user" uuid not null references public.profiles (id) on delete cascade,
  type text not null default 'annual' check (type in ('annual', 'excuse', 'sick', 'unpaid', 'other')),
  start_date date not null,
  end_date date not null,
  days numeric(4, 1) not null check (days >= 0.5),
  note text not null default '' check (char_length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  created timestamptz not null default now(),
  updated timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date < 120),
  check (days <= end_date - start_date + 1)
);
create index if not exists idx_leave_requests_user on public.leave_requests ("user", start_date);
create index if not exists idx_leave_requests_status on public.leave_requests (status);

drop trigger if exists a_stamp on public.leave_requests;
create trigger a_stamp before insert or update on public.leave_requests
  for each row execute function private.stamp();

-- ============================================================ yetki

-- Bu kişinin izin talebini ben sonuçlandırabilir miyim: admin herkesinkini, birim sorumlusu kendi birimindekilerinkini.
create or replace function public.can_decide_leave(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin()
      or (public.app_role() = 'manager' and p_user <> auth.uid() and public.my_department() is not null
          and public.my_department() = (select department from public.profiles where id = p_user))
$$;

create or replace function private.leave_type_label(p_type text)
returns text
language sql immutable set search_path = ''
as $$
  select case p_type when 'annual' then 'Yıllık izin' when 'excuse' then 'Mazeret izni' when 'sick' then 'Rapor'
                     when 'unpaid' then 'Ücretsiz izin' else 'İzin' end
$$;

-- Yıllık izin hakkını sadece admin değiştirir (001'deki tanımın yenisi).
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
       or new.active is distinct from old.active or new.username is distinct from old.username
       or new.annual_leave_days is distinct from old.annual_leave_days then
      raise exception 'Bu alanları sadece admin değiştirebilir.' using errcode = '42501';
    end if;
  elsif new.id = auth.uid() and (not new.active or new.role <> 'admin') then
    -- Admin kendini kilitlemesin
    raise exception 'Kendi hesabınızın rolünü değiştiremez, hesabınızı pasifleştiremezsiniz.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ============================================================ iş kuralları

create or replace function private.leave_requests_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  new.note := btrim(new.note);
  new.decision_note := btrim(new.decision_note);

  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.status := 'pending';
      new.decided_by := null;
      new.decided_at := null;
      new.decision_note := '';
    end if;
  elsif v_uid is not null then
    new."user" := old."user";
    if new.status = old.status then
      -- Talep sahibi, sonuçlanmamış talebini düzeltebilir
      if old.status <> 'pending' or old."user" <> v_uid then
        raise exception 'Sonuçlanan izin talebi değiştirilemez.' using errcode = '42501';
      end if;
      new.decided_by := null;
      new.decided_at := null;
      new.decision_note := '';
    else
      -- Durum değişirken talebin içeriği değişmez
      new.type := old.type;
      new.start_date := old.start_date;
      new.end_date := old.end_date;
      new.days := old.days;
      new.note := old.note;
      if new.status in ('approved', 'rejected') then
        if old.status <> 'pending' then
          raise exception 'Bu talep zaten sonuçlanmış.' using errcode = '23514';
        end if;
        if not public.can_decide_leave(old."user") then
          raise exception 'Bu talebi sonuçlandırma yetkiniz yok.' using errcode = '42501';
        end if;
        new.decided_by := v_uid;
        new.decided_at := now();
      elsif new.status = 'cancelled' then
        if old.status = 'pending' and old."user" = v_uid then
          null;
        elsif old.status = 'approved' and (public.can_decide_leave(old."user") or (old."user" = v_uid and old.start_date > v_today)) then
          null;
        elsif old.status = 'approved' and old."user" = v_uid then
          raise exception 'Başlamış izni sadece birim sorumlunuz ya da admin iptal edebilir.' using errcode = '42501';
        else
          raise exception 'Bu talep iptal edilemez.' using errcode = '42501';
        end if;
        new.decided_by := old.decided_by;
        new.decided_at := old.decided_at;
        new.decision_note := old.decision_note;
      else
        raise exception 'Bu talep yeniden açılamaz; yeni talep oluşturun.' using errcode = '23514';
      end if;
    end if;
  end if;

  if new.status in ('pending', 'approved') and exists (
       select 1 from public.leave_requests r
        where r."user" = new."user" and r.id <> new.id and r.status in ('pending', 'approved')
          and r.start_date <= new.end_date and r.end_date >= new.start_date) then
    raise exception 'Bu tarihlerde başka bir izin talebiniz var.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists c_check on public.leave_requests;
create trigger c_check before insert or update on public.leave_requests
  for each row execute function private.leave_requests_check();

-- Bildirimler ve vardiya çizelgesi
create or replace function private.leave_requests_changed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new."user");
  v_department uuid;
  v_approvers uuid[];
  v_range text := to_char(new.start_date, 'DD.MM.YYYY')
                  || case when new.end_date <> new.start_date then ' – ' || to_char(new.end_date, 'DD.MM.YYYY') else '' end;
  v_summary text := private.leave_type_label(new.type) || ' · ' || v_range || ' · ' || case when new.days = trunc(new.days) then trunc(new.days)::text else replace(new.days::text, '.', ',') end || ' gün';
begin
  select department into v_department from public.profiles where id = new."user";

  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      select array_agg(p.id) into v_approvers from public.profiles p
       where p.active and p.role = 'manager' and p.department = v_department and p.id <> new."user";
      if v_approvers is null then
        select array_agg(p.id) into v_approvers from public.profiles p where p.active and p.role = 'admin' and p.id <> new."user";
      end if;
      perform private.notify(v_approvers, '🌴 İzin talebi: ' || private.display_name(new."user"), v_summary, '/izinler', 'leave-' || new.id);
    end if;
    return null;
  end if;

  if new.status = old.status then
    return null;
  end if;

  if new.status = 'approved' then
    insert into public.shifts ("user", date, kind, department, note)
    select new."user", d::date, case when new.type = 'sick' then 'sick' else 'leave' end, v_department, private.leave_type_label(new.type)
      from generate_series(new.start_date::timestamp, new.end_date::timestamp, interval '1 day') as d
    on conflict ("user", date) do update
      set kind = excluded.kind, start_time = '', end_time = '', note = excluded.note
      where public.shifts.kind not in ('off', 'holiday');
    if new."user" <> v_actor then
      perform private.notify(array[new."user"], '✅ İzin talebiniz onaylandı', v_summary, '/izinler', 'leave-' || new.id);
    end if;
  elsif new.status = 'rejected' then
    perform private.notify(array[new."user"], '❌ İzin talebiniz reddedildi',
                           v_summary || case when new.decision_note <> '' then ' · ' || new.decision_note else '' end,
                           '/izinler', 'leave-' || new.id);
  elsif new.status = 'cancelled' and old.status = 'approved' then
    delete from public.shifts
     where "user" = new."user" and date between new.start_date and new.end_date and kind in ('leave', 'sick');
    if new."user" <> v_actor then
      perform private.notify(array[new."user"], '↩️ Onaylı izniniz iptal edildi', v_summary, '/izinler', 'leave-' || new.id);
    elsif new.decided_by is not null and new.decided_by <> v_actor then
      perform private.notify(array[new.decided_by], '↩️ İzin iptal edildi: ' || private.display_name(new."user"), v_summary, '/izinler', 'leave-' || new.id);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists changed on public.leave_requests;
create trigger changed after insert or update on public.leave_requests
  for each row execute function private.leave_requests_changed();

-- Sayaçlara "sonuçlandırmamı bekleyen izin talebi" eklendi (001'deki tanımın yenisi).
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

  return jsonb_build_object('conversations', v_conversations, 'announcements', v_announcements, 'leaves', v_leaves);
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.can_decide_leave(uuid) from public, anon;
grant execute on function public.can_decide_leave(uuid) to authenticated;

-- ============================================================ erişim kuralları

alter table public.leave_requests enable row level security;
revoke all on public.leave_requests from anon, authenticated;
grant select, insert, update on public.leave_requests to authenticated;

-- Talebi sahibi, kendi birim sorumlusu ve admin görür
drop policy if exists leave_requests_select on public.leave_requests;
create policy leave_requests_select on public.leave_requests for select to authenticated
  using (public.is_active() and ("user" = auth.uid() or public.can_decide_leave("user")));
drop policy if exists leave_requests_insert on public.leave_requests;
create policy leave_requests_insert on public.leave_requests for insert to authenticated
  with check (public.is_active() and "user" = auth.uid());
-- Kimin neyi değiştirebileceği: private.leave_requests_check
drop policy if exists leave_requests_update on public.leave_requests;
create policy leave_requests_update on public.leave_requests for update to authenticated
  using (public.is_active() and ("user" = auth.uid() or public.can_decide_leave("user")))
  with check (public.is_active());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leave_requests') then
    alter publication supabase_realtime add table public.leave_requests;
  end if;
end $$;

-- Kontrol: iki satır da "evet" olmalı
select 'izin talepleri tablosu' as kontrol, case when to_regclass('public.leave_requests') is not null then 'evet' else 'HAYIR' end as sonuc
union all
select 'yıllık izin hakkı sütunu',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'annual_leave_days') then 'evet' else 'HAYIR' end;
