create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema extensions; create schema storage; create schema net;
create table auth.users (instance_id uuid, id uuid primary key, aud text, role text, email text unique, encrypted_password text,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
  confirmation_token text, recovery_token text, email_change text, email_change_token_new text, banned_until timestamptz);
create table auth.identities (id uuid primary key, user_id uuid references auth.users on delete cascade, provider_id text, provider text,
  identity_data jsonb, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner_id text);
alter table storage.objects enable row level security;
grant usage on schema public, storage, auth, extensions to authenticated, anon;
grant all on storage.objects to authenticated;
create publication supabase_realtime;
create table net.calls (id bigserial primary key, url text, body jsonb, headers jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql security definer as $$ insert into net.calls (url, body, headers) values (url, body, headers) returning id $$;
