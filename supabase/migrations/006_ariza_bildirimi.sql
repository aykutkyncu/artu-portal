-- Arıza / bakım bildirimi (2026-10-19).
--   Herkes arıza bildirir (makine/yer, açıklama, fotoğraf, acil, makine durdu mu). Bildirim bakım ekibine gider.
--   Bakım ekibi: Yönetim > Birimler'de "bakım birimi" işaretlenen birim(ler)in üyeleri + admin.
--   Bakım ekibi arızayı üstlenir (ya da ekipten birine atar), çözünce kapatır; bildirene haber gider.
--   Makine durduysa duruş süresi (dakika) kapatılırken yazılır; boş bırakılırsa bildirimden kapanışa geçen süre alınır.
--   Kapanan arıza yeniden açılabilir (bildiren ya da bakım). Kayıt silinmez; iptal edilir.
--   Herkes bütün arızaları görür (atölyede aynı arızanın iki kez bildirilmemesi için).
-- Önce 005_izin_talepleri.sql çalışmış olmalı (sayaç fonksiyonu izin tablosunu da sayar).
-- Arayüzdeki karşılığı: web/src/pages/FaultsPage.tsx
-- Supabase panelinde: SQL Editor > New query > bu dosyanın tamamını yapıştır > Run  (tekrar çalıştırılabilir)

alter table public.departments add column if not exists maintenance boolean not null default false;

create table if not exists public.faults (
  id uuid primary key default gen_random_uuid(),
  reported_by uuid not null references public.profiles (id) on delete cascade,
  department uuid references public.departments (id) on delete set null,
  location text not null check (btrim(location) <> '' and char_length(location) <= 150),
  description text not null check (btrim(description) <> '' and char_length(description) <= 2000),
  urgent boolean not null default false,
  machine_stopped boolean not null default false,
  photos text[] not null default '{}' check (cardinality(photos) <= 5),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'cancelled')),
  assignee uuid references public.profiles (id) on delete set null,
  taken_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolution text not null default '' check (char_length(resolution) <= 2000),
  downtime_minutes integer check (downtime_minutes between 0 and 100000),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create index if not exists idx_faults_status on public.faults (status, created desc);
create index if not exists idx_faults_reported_by on public.faults (reported_by);

drop trigger if exists a_stamp on public.faults;
create trigger a_stamp before insert or update on public.faults
  for each row execute function private.stamp();

-- ============================================================ yetki

-- Kişi bakım ekibinde mi: bakım birimindeki aktif kullanıcı ya da admin.
create or replace function private.is_maintenance_user(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p left join public.departments d on d.id = p.department
     where p.id = p_user and p.active and (p.role = 'admin' or coalesce(d.maintenance, false))
  )
$$;

create or replace function public.is_maintenance()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and private.is_maintenance_user(auth.uid())
$$;

-- Bakım birimindeki aktif kişiler (bildirim alıcıları). Kimse yoksa adminler.
create or replace function private.maintenance_team(p_except uuid)
returns uuid[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(p.id) into v_ids
    from public.profiles p join public.departments d on d.id = p.department
   where p.active and d.maintenance and p.id is distinct from p_except;
  if v_ids is null then
    select array_agg(p.id) into v_ids from public.profiles p where p.active and p.role = 'admin' and p.id is distinct from p_except;
  end if;
  return v_ids;
end;
$$;

-- ============================================================ iş kuralları

create or replace function private.faults_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_team boolean := v_uid is not null and private.is_maintenance_user(v_uid);
  v_photo text;
begin
  new.location := btrim(new.location);
  new.description := btrim(new.description);
  new.resolution := btrim(new.resolution);

  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.reported_by := v_uid;
      new.status := 'open';
      new.assignee := null;
      new.taken_at := null;
      new.resolved_by := null;
      new.resolved_at := null;
      new.resolution := '';
      new.downtime_minutes := null;
      if new.department is null then
        new.department := public.my_department();
      end if;
    end if;
  elsif v_uid is not null then
    new.reported_by := old.reported_by;

    if old.status = 'cancelled' then
      raise exception 'İptal edilen arıza değiştirilemez; yeni bildirim açın.' using errcode = '42501';
    end if;

    -- Bildirimin içeriği: açıkken bildiren, çözülene kadar bakım ekibi düzeltebilir
    if (new.location, new.description, new.urgent, new.machine_stopped, new.photos, new.department)
       is distinct from (old.location, old.description, old.urgent, old.machine_stopped, old.photos, old.department) then
      if not ((old.status = 'open' and old.reported_by = v_uid) or (v_team and old.status in ('open', 'in_progress'))) then
        raise exception 'Bu arıza bildirimini değiştiremezsiniz.' using errcode = '42501';
      end if;
    end if;

    if new.status = old.status then
      if new.assignee is distinct from old.assignee or new.resolution <> old.resolution
         or new.downtime_minutes is distinct from old.downtime_minutes then
        if not v_team then
          raise exception 'Bu işlemi sadece bakım ekibi yapabilir.' using errcode = '42501';
        end if;
        if new.assignee is distinct from old.assignee and old.status <> 'in_progress' then
          raise exception 'Önce arızayı üstlenin.' using errcode = '23514';
        end if;
        if (new.resolution <> old.resolution or new.downtime_minutes is distinct from old.downtime_minutes) and old.status <> 'resolved' then
          raise exception 'Çözüm ve duruş süresi arıza kapatılırken yazılır.' using errcode = '23514';
        end if;
      end if;
      new.taken_at := old.taken_at;
      new.resolved_by := old.resolved_by;
      new.resolved_at := old.resolved_at;
    elsif new.status = 'in_progress' then
      if not v_team then
        raise exception 'Arızayı sadece bakım ekibi üstlenebilir.' using errcode = '42501';
      end if;
      if old.status <> 'open' then
        raise exception 'Bu arıza zaten üstlenilmiş ya da kapanmış.' using errcode = '23514';
      end if;
      new.assignee := coalesce(new.assignee, v_uid);
      new.taken_at := now();
      new.resolution := '';
      new.downtime_minutes := null;
    elsif new.status = 'resolved' then
      if not v_team then
        raise exception 'Arızayı sadece bakım ekibi kapatabilir.' using errcode = '42501';
      end if;
      if new.resolution = '' then
        raise exception 'Yapılan işlemi (çözümü) yazın.' using errcode = '23514';
      end if;
      new.assignee := coalesce(new.assignee, v_uid);
      new.taken_at := coalesce(old.taken_at, now());
      new.resolved_by := v_uid;
      new.resolved_at := now();
      if not new.machine_stopped then
        new.downtime_minutes := null;
      elsif new.downtime_minutes is null then
        new.downtime_minutes := least(100000, floor(extract(epoch from now() - old.created) / 60)::integer);
      end if;
    elsif new.status = 'open' then
      -- Bakım üstlendiği işi bırakır ya da kapanan arıza yeniden açılır
      if old.status = 'in_progress' and not v_team then
        raise exception 'Bu işlemi sadece bakım ekibi yapabilir.' using errcode = '42501';
      end if;
      if old.status = 'resolved' and not (v_team or old.reported_by = v_uid) then
        raise exception 'Arızayı sadece bildiren ya da bakım ekibi yeniden açabilir.' using errcode = '42501';
      end if;
      new.assignee := null;
      new.taken_at := null;
      new.resolved_by := null;
      new.resolved_at := null;
      new.resolution := '';
      new.downtime_minutes := null;
    elsif new.status = 'cancelled' then
      if old.status = 'resolved' then
        raise exception 'Kapanmış arıza iptal edilemez.' using errcode = '23514';
      end if;
      if not (v_team or (old.status = 'open' and old.reported_by = v_uid)) then
        raise exception 'Bu arızayı iptal edemezsiniz.' using errcode = '42501';
      end if;
      new.resolution := old.resolution;
      new.downtime_minutes := old.downtime_minutes;
    end if;
  end if;

  if new.assignee is not null and (tg_op = 'INSERT' or new.assignee is distinct from old.assignee)
     and not private.is_maintenance_user(new.assignee) then
    raise exception 'Arıza sadece bakım ekibinden birine atanabilir.' using errcode = '23514';
  end if;

  foreach v_photo in array new.photos loop
    if v_photo not like 'faults/' || new.id || '/%' then
      raise exception 'Geçersiz fotoğraf yolu.' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists c_check on public.faults;
create trigger c_check before insert or update on public.faults
  for each row execute function private.faults_check();

-- 95 → "1 sa 35 dk", 40 → "40 dk"
create or replace function private.fmt_minutes(p_minutes integer)
returns text
language sql immutable set search_path = ''
as $$
  select case when p_minutes >= 60
              then (p_minutes / 60)::text || ' sa' || case when p_minutes % 60 > 0 then ' ' || (p_minutes % 60)::text || ' dk' else '' end
              else p_minutes::text || ' dk' end
$$;

-- Bildirimler
create or replace function private.faults_changed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.reported_by);
  v_tag text := 'fault-' || new.id;
  v_head text := case when new.urgent or new.machine_stopped then '🚨 ' else '🔧 ' end;
begin
  if tg_op = 'INSERT' then
    perform private.notify(private.maintenance_team(new.reported_by),
                           v_head || case when new.urgent then 'ACİL arıza: ' else 'Arıza: ' end || new.location,
                           case when new.machine_stopped then 'Makine durdu · ' else '' end || new.description
                             || ' · ' || private.display_name(new.reported_by),
                           '/arizalar', v_tag);
    return null;
  end if;

  if new.status = old.status then
    if new.status = 'in_progress' and new.assignee is distinct from old.assignee and new.assignee is not null and new.assignee <> v_actor then
      perform private.notify(array[new.assignee], '🛠️ Size arıza atandı: ' || new.location, new.description, '/arizalar', v_tag);
    end if;
    return null;
  end if;

  if new.status = 'in_progress' then
    if new.reported_by <> v_actor then
      perform private.notify(array[new.reported_by], '🛠️ Arıza üstlenildi: ' || new.location,
                             private.display_name(new.assignee) || ' ilgileniyor.', '/arizalar', v_tag);
    end if;
    if new.assignee <> v_actor then
      perform private.notify(array[new.assignee], '🛠️ Size arıza atandı: ' || new.location, new.description, '/arizalar', v_tag);
    end if;
  elsif new.status = 'resolved' then
    if new.reported_by <> v_actor then
      perform private.notify(array[new.reported_by], '✅ Arıza giderildi: ' || new.location,
                             new.resolution || case when new.downtime_minutes is not null
                                                    then ' · Duruş ' || private.fmt_minutes(new.downtime_minutes) else '' end,
                             '/arizalar', v_tag);
    end if;
  elsif new.status = 'open' and old.status = 'resolved' then
    perform private.notify(private.maintenance_team(v_actor), '↩️ Arıza yeniden açıldı: ' || new.location,
                           new.description || ' · ' || private.display_name(v_actor), '/arizalar', v_tag);
  elsif new.status = 'cancelled' and new.reported_by <> v_actor then
    perform private.notify(array[new.reported_by], '✖️ Arıza bildirimi iptal edildi: ' || new.location,
                           private.display_name(v_actor), '/arizalar', v_tag);
  end if;
  return null;
end;
$$;
drop trigger if exists changed on public.faults;
create trigger changed after insert or update on public.faults
  for each row execute function private.faults_changed();

-- Sayaçlara "bakım ekibini bekleyen (kimsenin üstlenmediği) arıza" eklendi (005'teki tanımın yenisi).
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

  return jsonb_build_object('conversations', v_conversations, 'announcements', v_announcements, 'leaves', v_leaves, 'faults', v_faults);
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.is_maintenance() from public, anon;
grant execute on function public.is_maintenance() to authenticated;

-- ============================================================ erişim kuralları

alter table public.faults enable row level security;
revoke all on public.faults from anon, authenticated;
grant select, insert, update on public.faults to authenticated;

drop policy if exists faults_select on public.faults;
create policy faults_select on public.faults for select to authenticated using (public.is_active());
drop policy if exists faults_insert on public.faults;
create policy faults_insert on public.faults for insert to authenticated
  with check (public.is_active() and reported_by = auth.uid());
-- Kimin neyi değiştirebileceği: private.faults_check
drop policy if exists faults_update on public.faults;
create policy faults_update on public.faults for update to authenticated
  using (public.is_active() and (reported_by = auth.uid() or public.is_maintenance()))
  with check (public.is_active());

-- Arıza fotoğrafları "ekler" alanında faults/<arıza id>/… yolunda durur (001'deki tanımların yenisi).
create or replace function public.can_read_attachment(p_path text)
returns boolean
language sql stable set search_path = ''
as $$
  select case split_part(p_path, '/', 1)
    when 'messages' then exists (select 1 from public.conversations c where c.id::text = split_part(p_path, '/', 2))
    when 'announcements' then exists (select 1 from public.announcements a where a.id::text = split_part(p_path, '/', 2))
    when 'tasks' then exists (select 1 from public.tasks t where t.id::text = split_part(p_path, '/', 2))
    when 'faults' then exists (select 1 from public.faults f where f.id::text = split_part(p_path, '/', 2))
    else false
  end
$$;

drop policy if exists ekler_insert on storage.objects;
create policy ekler_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ekler' and public.is_active() and name ~ '^(messages|announcements|tasks|faults)/[0-9a-f-]{36}/[^/]+$'
    and case split_part(name, '/', 1)
          when 'messages' then public.can_read_attachment(name)
          when 'announcements' then public.is_manager()
          else true
        end
  );

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'faults') then
    alter publication supabase_realtime add table public.faults;
  end if;
end $$;

-- Kontrol: iki satır da "evet" olmalı
select 'arıza tablosu' as kontrol, case when to_regclass('public.faults') is not null then 'evet' else 'HAYIR' end as sonuc
union all
select 'bakım birimi sütunu',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'departments' and column_name = 'maintenance') then 'evet' else 'HAYIR' end;
