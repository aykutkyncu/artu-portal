-- Mesaj özellikleri (2026-10-13, kullanıcı istedi: "gelen mesajları silebilsin, arşivleyebilsin, sessize alabilsin, düzenleyebilsin").
--   Benden sil      : kişi herhangi bir mesajı sadece kendi görünümünden kaldırır (message_hides). Karşı taraf görmeye devam eder.
--   Herkesten sil   : zaten vardı (001): kişi kendi gönderdiği mesajı herkes için siler. Başkasının mesajı herkesten silinemez.
--   Düzenle         : kişi kendi mesajının metnini değiştirir; mesaj "düzenlendi" diye işaretlenir (messages.edited_at).
--   Sessize al      : o sohbetten telefon bildirimi gelmez; okunmamış sayacı çalışmaya devam eder.
--   Arşivle         : sohbet listeden "Arşiv" bölümüne taşınır; mesajlar silinmez, kişi istediğinde geri alır.
-- Sessize alma ve arşiv kişiye özeldir (conversation_settings); karşı tarafı etkilemez.
-- Arayüzdeki karşılığı: web/src/components/ChatView.tsx, web/src/pages/MessagesPage.tsx
-- Supabase panelinde: SQL Editor > New query > bu dosyanın tamamını yapıştır > Run  (tekrar çalıştırılabilir)

alter table public.messages add column if not exists edited_at timestamptz;

create table if not exists public.message_hides (
  "user" uuid not null references public.profiles (id) on delete cascade,
  message uuid not null references public.messages (id) on delete cascade,
  created timestamptz not null default now(),
  primary key ("user", message)
);

create table if not exists public.conversation_settings (
  "user" uuid not null references public.profiles (id) on delete cascade,
  conversation uuid not null references public.conversations (id) on delete cascade,
  muted boolean not null default false,
  archived boolean not null default false,
  updated timestamptz not null default now(),
  primary key ("user", conversation)
);

-- ============================================================ iş kuralları

-- Metni değişen mesaj "düzenlendi" olarak işaretlenir (001'deki tanımın yenisi).
create or replace function private.messages_check()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.text := btrim(new.text);
  if new.text = '' and cardinality(new.attachments) = 0 then
    raise exception 'Boş mesaj gönderilemez.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.edited_at := null;
  elsif new.text is distinct from old.text then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

-- Sessize alan üyeye bildirim gitmez (001'deki tanımın yenisi).
create or replace function private.messages_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv public.conversations;
  v_preview text := case when new.text = '' then '📎 Dosya' else new.text end;
  v_title text := private.display_name(new.sender);
  v_users uuid[];
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
  select array_agg(m) into v_users
    from unnest(array_remove(v_conv.members, new.sender)) as m
   where not exists (select 1 from public.conversation_settings s
                      where s."user" = m and s.conversation = v_conv.id and s.muted);
  perform private.notify(v_users, v_title, v_preview, '/mesajlar/' || v_conv.id, 'conv-' || v_conv.id);
  return null;
end;
$$;

-- Son mesaj düzenlenir ya da silinirse sohbet listesindeki özet de güncellenir.
create or replace function private.messages_changed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_conversation uuid := case when tg_op = 'DELETE' then old.conversation else new.conversation end;
  v_preview text;
begin
  if tg_op = 'UPDATE' and new.text is not distinct from old.text then
    return null;
  end if;
  select case when m.text = '' then '📎 Dosya' when char_length(m.text) > 190 then left(m.text, 189) || '…' else m.text end
    into v_preview
    from public.messages m
   where m.conversation = v_conversation
   order by m.created desc
   limit 1;
  update public.conversations
     set last_message_text = coalesce(v_preview, '')
   where id = v_conversation and last_message_text is distinct from coalesce(v_preview, '');
  return null;
end;
$$;
drop trigger if exists changed on public.messages;
create trigger changed after update or delete on public.messages
  for each row execute function private.messages_changed();

revoke execute on all functions in schema private from public, anon, authenticated;

-- ============================================================ erişim kuralları

alter table public.message_hides enable row level security;
alter table public.conversation_settings enable row level security;
revoke all on public.message_hides, public.conversation_settings from anon;
grant select, insert, delete on public.message_hides to authenticated;
grant select, insert, update, delete on public.conversation_settings to authenticated;

-- Kişinin "benden sil" dediği mesaj artık ona görünmez (001'deki kuralın yenisi).
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation)
         and not exists (select 1 from public.message_hides h where h.message = id and h."user" = auth.uid()));

-- Kişi sadece görebildiği mesajı kendinden gizler
drop policy if exists message_hides_select on public.message_hides;
create policy message_hides_select on public.message_hides for select to authenticated using ("user" = auth.uid());
drop policy if exists message_hides_insert on public.message_hides;
create policy message_hides_insert on public.message_hides for insert to authenticated
  with check ("user" = auth.uid() and exists (select 1 from public.messages m where m.id = message));
drop policy if exists message_hides_delete on public.message_hides;
create policy message_hides_delete on public.message_hides for delete to authenticated using ("user" = auth.uid());

-- Sessize alma / arşiv: kişi sadece üyesi olduğu sohbet için kendi ayarını yazar
drop policy if exists conversation_settings_select on public.conversation_settings;
create policy conversation_settings_select on public.conversation_settings for select to authenticated
  using ("user" = auth.uid() and public.is_active());
drop policy if exists conversation_settings_insert on public.conversation_settings;
create policy conversation_settings_insert on public.conversation_settings for insert to authenticated
  with check ("user" = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation));
drop policy if exists conversation_settings_update on public.conversation_settings;
create policy conversation_settings_update on public.conversation_settings for update to authenticated
  using ("user" = auth.uid())
  with check ("user" = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation));
drop policy if exists conversation_settings_delete on public.conversation_settings;
create policy conversation_settings_delete on public.conversation_settings for delete to authenticated using ("user" = auth.uid());

-- Kontrol: üç satır da "evet" olmalı
select 'düzenlendi sütunu' as kontrol,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'edited_at') then 'evet' else 'HAYIR' end as sonuc
union all
select 'benden sil tablosu', case when to_regclass('public.message_hides') is not null then 'evet' else 'HAYIR' end
union all
select 'sessize al / arşiv tablosu', case when to_regclass('public.conversation_settings') is not null then 'evet' else 'HAYIR' end;
