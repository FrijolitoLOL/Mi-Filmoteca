-- MI FILMOTECA 6.0 - MIGRACIÓN ADITIVA
-- EJECUTAR EN SQL EDITOR DE SUPABASE, CON EL ESQUEMA 5.x YA INSTALADO.
-- NO borra ni altera registros de filmoteca_movies.
-- Seguridad: las consultas cruzadas solo ocurren tras aceptación explícita y expiran.

begin;

create table if not exists public.filmoteca_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  avatar_emoji text not null default '🎬',
  discoverable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint filmoteca_profile_username_check check (username ~ '^[a-z0-9_]{3,24}$'),
  constraint filmoteca_profile_display_name_check check (char_length(btrim(display_name)) between 1 and 40),
  constraint filmoteca_profile_avatar_check check (char_length(avatar_emoji) between 1 and 8)
);
create index if not exists filmoteca_profiles_discoverable_idx
  on public.filmoteca_profiles(username) where discoverable;

alter table public.filmoteca_profiles enable row level security;
revoke all on public.filmoteca_profiles from anon;
grant select, insert, update, delete on public.filmoteca_profiles to authenticated;
drop policy if exists "filmoteca_profile_read_own" on public.filmoteca_profiles;
create policy "filmoteca_profile_read_own" on public.filmoteca_profiles
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "filmoteca_profile_create_own" on public.filmoteca_profiles;
create policy "filmoteca_profile_create_own" on public.filmoteca_profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "filmoteca_profile_update_own" on public.filmoteca_profiles;
create policy "filmoteca_profile_update_own" on public.filmoteca_profiles
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "filmoteca_profile_delete_own" on public.filmoteca_profiles;
create policy "filmoteca_profile_delete_own" on public.filmoteca_profiles
  for delete to authenticated using (user_id = (select auth.uid()));

create table if not exists public.filmoteca_comparisons (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  pending_until timestamptz not null default (now() + interval '24 hours'),
  responded_at timestamptz,
  accepted_until timestamptz,
  constraint filmoteca_compare_not_self check (requester_id <> target_id),
  constraint filmoteca_compare_status_check check (status in ('pending','accepted','declined','closed'))
);
create index if not exists filmoteca_compare_sender_idx on public.filmoteca_comparisons(requester_id,created_at desc);
create index if not exists filmoteca_compare_recipient_idx on public.filmoteca_comparisons(target_id,created_at desc);

alter table public.filmoteca_comparisons enable row level security;
revoke all on public.filmoteca_comparisons from public, anon, authenticated;
-- Los usuarios ven metadatos de sus solicitudes, PERO no pueden insertar, alterar ni aceptar filas directamente.
grant select on public.filmoteca_comparisons to authenticated;
drop policy if exists "filmoteca_comparison_participants_read" on public.filmoteca_comparisons;
create policy "filmoteca_comparison_participants_read" on public.filmoteca_comparisons
  for select to authenticated using (
    requester_id = (select auth.uid()) or target_id = (select auth.uid())
  );

-- Mantener funciones privilegiadas fuera de los esquemas expuestos por PostgREST.
create schema if not exists filmoteca_private;
revoke all on schema filmoteca_private from public, anon;
grant usage on schema filmoteca_private to authenticated;

-- Encontrar usuarios SOLO mediante nombre exacto y SOLO si optaron por ser localizables.
create or replace function filmoteca_private.lookup_user(p_username text)
returns table (user_id uuid, username text, display_name text, avatar_emoji text)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  if lower(btrim(coalesce(p_username,''))) !~ '^[a-z0-9_]{3,24}$' then return; end if;
  return query
    select p.user_id, p.username, p.display_name, p.avatar_emoji
    from public.filmoteca_profiles p
    where p.username = lower(btrim(p_username)) and p.discoverable = true
      and p.user_id <> auth.uid()
    limit 1;
end;
$$;

-- Cada nueva comparación requiere un envío nuevo: nunca hay permisos compartidos permanentes.
create or replace function filmoteca_private.create_invitation(p_username text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_sender uuid := auth.uid();
  v_target uuid;
  v_id uuid;
begin
  if v_sender is null then raise exception 'Inicia sesión primero'; end if;
  if not exists (select 1 from public.filmoteca_profiles where user_id = v_sender) then
    raise exception 'Configura primero tu perfil';
  end if;
  select p.user_id into v_target from public.filmoteca_profiles p
   where p.username = lower(btrim(coalesce(p_username,''))) and p.discoverable = true
     and p.user_id <> v_sender;
  if v_target is null then raise exception 'No encontramos ese usuario o no acepta solicitudes'; end if;
  if (select count(*) from public.filmoteca_comparisons
      where requester_id=v_sender and created_at > now()-interval '24 hours') >= 12 then
    raise exception 'Alcanzaste el límite diario de solicitudes';
  end if;
  if exists (select 1 from public.filmoteca_comparisons
      where requester_id=v_sender and target_id=v_target and status='pending' and pending_until > now()) then
    raise exception 'Ya tienes una solicitud pendiente para ese usuario';
  end if;
  insert into public.filmoteca_comparisons(requester_id,target_id)
    values (v_sender,v_target) returning id into v_id;
  return v_id;
end;
$$;

create or replace function filmoteca_private.list_invitations()
returns table (
  request_id uuid, other_username text, other_display_name text, other_avatar text,
  direction text, status text, created_at timestamptz,
  pending_until timestamptz, accepted_until timestamptz
) language sql security definer set search_path = '' as $$
  select c.id,
         case when c.requester_id=auth.uid() then tp.username else sp.username end,
         case when c.requester_id=auth.uid() then tp.display_name else sp.display_name end,
         case when c.requester_id=auth.uid() then tp.avatar_emoji else sp.avatar_emoji end,
         case when c.requester_id=auth.uid() then 'outgoing' else 'incoming' end,
         case when c.status='pending' and c.pending_until <= now() then 'expired'
              when c.status='accepted' and c.accepted_until <= now() then 'expired'
              else c.status end,
         c.created_at, c.pending_until, c.accepted_until
  from public.filmoteca_comparisons c
  left join public.filmoteca_profiles sp on sp.user_id=c.requester_id
  left join public.filmoteca_profiles tp on tp.user_id=c.target_id
  where auth.uid() is not null
    and (c.requester_id=auth.uid() or c.target_id=auth.uid())
    and c.created_at > now()-interval '30 days'
  order by c.created_at desc
  limit 80;
$$;

create or replace function filmoteca_private.reply_invitation(p_request_id uuid, p_accept boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  update public.filmoteca_comparisons c
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now(),
         accepted_until = case when p_accept then now() + interval '60 minutes' else null end
   where c.id = p_request_id and c.target_id = auth.uid()
     and c.status = 'pending' and c.pending_until > now()
   returning c.id into v_id;
  if v_id is null then raise exception 'La solicitud ya no está pendiente, expiró o no es tuya'; end if;
  return true;
end;
$$;

create or replace function filmoteca_private.close_invitation(p_request_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  update public.filmoteca_comparisons c
    set status='closed', accepted_until=now()
    where c.id=p_request_id and (c.requester_id=auth.uid() or c.target_id=auth.uid())
      and c.status in ('pending','accepted')
    returning c.id into v_id;
  if v_id is null then raise exception 'La solicitud no está activa o no te pertenece'; end if;
  return true;
end;
$$;

-- Esta es la ÚNICA operación que puede leer películas de otro usuario.
-- La comprobación del permiso se hace en Postgres, NO en JavaScript/RLS del cliente.
-- Solo participantes + aceptación + ventana de acceso de 60 min.
-- Solo incluye películas VISTAS (nunca la lista «Por ver»).
create or replace function filmoteca_private.read_comparison(p_request_id uuid)
returns table (
  movie_title text, movie_release_year smallint, movie_genre text,
  movie_poster_path text, tmdb_id integer,
  mine boolean, theirs boolean, is_match boolean,
  my_watched_date date, their_watched_date date,
  my_at_home boolean, their_at_home boolean
) language plpgsql security definer set search_path = '' as $$
declare v_peer uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  select case when c.requester_id=auth.uid() then c.target_id else c.requester_id end
    into v_peer
    from public.filmoteca_comparisons c
   where c.id=p_request_id and c.status='accepted'
     and c.accepted_until > now()
     and (c.requester_id=auth.uid() or c.target_id=auth.uid());
  if v_peer is null then
    raise exception 'No existe un permiso activo de comparación para tu cuenta';
  end if;
  return query
    select coalesce(a.title,b.title),coalesce(a.release_year,b.release_year),
           coalesce(a.genre,b.genre), coalesce(a.poster_path,b.poster_path),
           coalesce(a.tmdb_id,b.tmdb_id),
           a.id is not null, b.id is not null,
           a.id is not null and b.id is not null,
           a.watched_date,b.watched_date,a.watched_at_home,b.watched_at_home
    from (select m.* from public.filmoteca_movies m
          where m.user_id=auth.uid() and m.to_watch=false order by m.created_at desc limit 3000) a
    full outer join (select m.* from public.filmoteca_movies m
          where m.user_id=v_peer and m.to_watch=false order by m.created_at desc limit 3000) b
      on ((a.tmdb_id is not null and b.tmdb_id is not null and a.tmdb_id=b.tmdb_id)
          or ((a.tmdb_id is null or b.tmdb_id is null)
              and lower(btrim(a.title))=lower(btrim(b.title))
              and a.release_year is not distinct from b.release_year))
    order by (a.id is not null and b.id is not null) desc,
             lower(coalesce(a.title,b.title));
end;
$$;

-- Public RPC wrappers are INVOKER: only private functions run elevated, with checks above.
create or replace function public.filmoteca_lookup_user(p_username text)
returns table (user_id uuid,username text,display_name text,avatar_emoji text)
language sql security invoker set search_path = '' as $$
  select * from filmoteca_private.lookup_user(p_username);
$$;
create or replace function public.filmoteca_create_invitation(p_username text)
returns uuid language sql security invoker set search_path = '' as $$
  select filmoteca_private.create_invitation(p_username);
$$;
create or replace function public.filmoteca_list_invitations()
returns table (request_id uuid,other_username text,other_display_name text,other_avatar text,
               direction text,status text,created_at timestamptz,
               pending_until timestamptz,accepted_until timestamptz)
language sql security invoker set search_path = '' as $$
  select * from filmoteca_private.list_invitations();
$$;
create or replace function public.filmoteca_reply_invitation(p_request_id uuid,p_accept boolean)
returns boolean language sql security invoker set search_path = '' as $$
  select filmoteca_private.reply_invitation(p_request_id,p_accept);
$$;
create or replace function public.filmoteca_close_invitation(p_request_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select filmoteca_private.close_invitation(p_request_id);
$$;
create or replace function public.filmoteca_read_comparison(p_request_id uuid)
returns table (movie_title text,movie_release_year smallint,movie_genre text,
    movie_poster_path text,tmdb_id integer,mine boolean,theirs boolean,is_match boolean,
    my_watched_date date,their_watched_date date,my_at_home boolean,their_at_home boolean)
language sql security invoker set search_path = '' as $$
  select * from filmoteca_private.read_comparison(p_request_id);
$$;

-- Restricción explícita de EXECUTE; las funciones privadas no están en esquemas expuestos.
revoke all on all functions in schema filmoteca_private from public, anon;
grant execute on all functions in schema filmoteca_private to authenticated;
revoke all on function public.filmoteca_lookup_user(text) from public, anon;
revoke all on function public.filmoteca_create_invitation(text) from public, anon;
revoke all on function public.filmoteca_list_invitations() from public, anon;
revoke all on function public.filmoteca_reply_invitation(uuid,boolean) from public, anon;
revoke all on function public.filmoteca_close_invitation(uuid) from public, anon;
revoke all on function public.filmoteca_read_comparison(uuid) from public, anon;
grant execute on function public.filmoteca_lookup_user(text) to authenticated;
grant execute on function public.filmoteca_create_invitation(text) to authenticated;
grant execute on function public.filmoteca_list_invitations() to authenticated;
grant execute on function public.filmoteca_reply_invitation(uuid,boolean) to authenticated;
grant execute on function public.filmoteca_close_invitation(uuid) to authenticated;
grant execute on function public.filmoteca_read_comparison(uuid) to authenticated;

commit;