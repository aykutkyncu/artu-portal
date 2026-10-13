-- Sohbeti silme (2026-10-13, kullanıcı istedi: "genel olarak yazışmayı silme").
--   Sohbeti sil : kişi bir sohbetin o ana kadarki bütün mesajlarını sadece kendi görünümünden kaldırır ve
--                 sohbet listesinden düşer. Karşı taraf yazışmayı görmeye devam eder; mesajlar veritabanında durur.
--                 Aynı sohbete yeni mesaj gelirse sohbet listede yeniden görünür, eski mesajlar geri gelmez.
-- Silme anı conversation_settings.cleared_at sütununda tutulur ve sadece clear_conversation() ile yazılır.
-- Arayüzdeki karşılığı: web/src/components/ChatView.tsx, web/src/pages/MessagesPage.tsx
-- Supabase panelinde: SQL Editor > New query > bu dosyanın tamamını yapıştır > Run  (tekrar çalıştırılabilir)

alter table public.conversation_settings add column if not exists cleared_at timestamptz;

-- Silme anını istemci belirleyemez (sunucu saati kullanılır); diğer sütunlar eskisi gibi yazılır.
revoke insert, update on public.conversation_settings from authenticated;
grant insert ("user", conversation, muted, archived), update ("user", conversation, muted, archived) on public.conversation_settings to authenticated;

create or replace function public.clear_conversation(p_conversation uuid)
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
  insert into public.conversation_settings ("user", conversation, cleared_at, archived)
  values (v_uid, p_conversation, now(), false)
  on conflict ("user", conversation) do update set cleared_at = excluded.cleared_at, archived = false, updated = now();
  -- Silinen mesajlar okunmamış sayılmasın
  insert into public.conversation_reads (conversation, "user", last_read_at)
  values (p_conversation, v_uid, now())
  on conflict (conversation, "user") do update set last_read_at = excluded.last_read_at;
end;
$$;

revoke execute on function public.clear_conversation(uuid) from public, anon;
grant execute on function public.clear_conversation(uuid) to authenticated;

-- Kişinin sildiği sohbetin o andan önceki mesajları artık ona görünmez (003'teki kuralın yenisi).
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = messages.conversation)
         and not exists (select 1 from public.message_hides h where h.message = messages.id and h."user" = auth.uid())
         and not exists (select 1 from public.conversation_settings s
                          where s.conversation = messages.conversation and s."user" = auth.uid() and s.cleared_at >= messages.created));

-- Kontrol: iki satır da "evet" olmalı
select 'silme anı sütunu' as kontrol,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_settings' and column_name = 'cleared_at') then 'evet' else 'HAYIR' end as sonuc
union all
select 'sohbeti sil fonksiyonu', case when to_regprocedure('public.clear_conversation(uuid)') is not null then 'evet' else 'HAYIR' end;
