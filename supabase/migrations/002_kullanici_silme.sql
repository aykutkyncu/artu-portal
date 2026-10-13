-- Kullanıcı silme (2026-10-13, kullanıcı istedi): admin, Yönetim > Kullanıcılar ekranından hesabı kalıcı olarak silebilsin.
--   Kim     : sadece admin; kendi hesabını silemez
--   Kural   : kayıt bırakmış kullanıcı silinemez (duyuru, mesaj, görev, yorum, etkinlik, üretim planı ya da
--             yazışılmış birebir sohbet). Geçmiş bozulmasın diye bu hesaplar silinmez, pasifleştirilir.
--   Silinen : giriş hesabı, profil, vardiyaları, okundu kayıtları, bildirim abonelikleri; grup üyeliklerinden,
--             görev atamalarından ve etkinlik katılımcılarından da çıkarılır.
-- Şifre değiştirme zaten var: admin_reset_password (001).
-- Arayüzdeki karşılığı: web/src/pages/AdminPage.tsx (UserEditor > "Kullanıcıyı sil")
-- Supabase panelinde: SQL Editor > New query > bu dosyanın tamamını yapıştır > Run

create or replace function public.admin_delete_user(p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Bu işlem için yetkiniz yok.' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'Kendi hesabınızı silemezsiniz.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Kullanıcı bulunamadı.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.announcements where author = p_user)
     or exists (select 1 from public.messages where sender = p_user)
     or exists (select 1 from public.tasks where created_by = p_user)
     or exists (select 1 from public.task_comments where author = p_user)
     or exists (select 1 from public.events where created_by = p_user)
     or exists (select 1 from public.production_plans where created_by = p_user)
     or exists (select 1 from public.conversations c
                 where c.type = 'direct' and p_user = any (c.members)
                   and exists (select 1 from public.messages m where m.conversation = c.id)) then
    raise exception 'Bu kullanıcının kayıtları (mesaj, duyuru, görev…) var; silmek yerine hesabı pasifleştirin.' using errcode = '23503';
  end if;

  -- Hiç yazışılmamış birebir sohbetler ve 2 kişinin altına düşecek gruplar kapanır
  delete from public.conversations
   where p_user = any (members) and (type = 'direct' or cardinality(members) <= 2);
  update public.conversations
     set members = array_remove(members, p_user),
         created_by = case when created_by = p_user then (array_remove(members, p_user))[1] else created_by end
   where p_user = any (members);
  update public.tasks set assignees = array_remove(assignees, p_user) where p_user = any (assignees);
  update public.events set participants = array_remove(participants, p_user) where p_user = any (participants);
  update public.production_plans set responsible = null where responsible = p_user;

  -- Profil, vardiyalar, okundu kayıtları ve abonelikler bu satıra bağlıdır; onunla birlikte silinir
  delete from auth.users where id = p_user;
end;
$$;

revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- Kontrol: tek satır, "1" olmalı
select 'kullanıcı silme fonksiyonu' as kontrol, count(*)::text as sonuc
  from pg_proc where pronamespace = 'public'::regnamespace and proname = 'admin_delete_user';
