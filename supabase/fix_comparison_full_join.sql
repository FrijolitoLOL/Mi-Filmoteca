-- Mi Filmoteca 6.0: corregir error PostgreSQL "FULL JOIN is only supported..."
-- Ejecutar en Supabase > SQL Editor. No elimina películas ni modifica RLS o permisos.
-- Equivalencia exacta al FULL OUTER JOIN anterior:
--   (A LEFT JOIN B) UNION ALL (filas de B sin coincidencia en A).
-- Los criterios originales de coincidencia y la autorización temporal se conservan.

begin;

create or replace function filmoteca_private.read_comparison(p_request_id uuid)
returns table (
  movie_title text,
  movie_release_year smallint,
  movie_genre text,
  movie_poster_path text,
  tmdb_id integer,
  mine boolean,
  theirs boolean,
  is_match boolean,
  my_watched_date date,
  their_watched_date date,
  my_at_home boolean,
  their_at_home boolean
)
language plpgsql security definer set search_path = '' as $function$
declare
  v_peer uuid;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión primero';
  end if;

  -- Se mantiene el permiso: solo participantes de una solicitud aceptada y vigente.
  select case when c.requester_id = auth.uid() then c.target_id else c.requester_id end
    into v_peer
  from public.filmoteca_comparisons c
  where c.id = p_request_id
    and c.status = 'accepted'
    and c.accepted_until > now()
    and (c.requester_id = auth.uid() or c.target_id = auth.uid());

  if v_peer is null then
    raise exception 'No existe un permiso activo de comparación para tu cuenta';
  end if;

  return query
    with a as (
      select m.*
      from public.filmoteca_movies m
      where m.user_id = auth.uid() and m.to_watch = false
      order by m.created_at desc
      limit 3000
    ),
    b as (
      select m.*
      from public.filmoteca_movies m
      where m.user_id = v_peer and m.to_watch = false
      order by m.created_at desc
      limit 3000
    ),
    combined_rows as (
      -- Coincidencias + películas vistas únicamente por el usuario actual.
      select
        coalesce(a.title, b.title) as movie_title,
        coalesce(a.release_year, b.release_year) as movie_release_year,
        coalesce(a.genre, b.genre) as movie_genre,
        coalesce(a.poster_path, b.poster_path) as movie_poster_path,
        coalesce(a.tmdb_id, b.tmdb_id) as tmdb_id,
        (a.id is not null) as mine,
        (b.id is not null) as theirs,
        (a.id is not null and b.id is not null) as is_match,
        a.watched_date as my_watched_date,
        b.watched_date as their_watched_date,
        a.watched_at_home as my_at_home,
        b.watched_at_home as their_at_home
      from a
      left join b on (
        (a.tmdb_id is not null and b.tmdb_id is not null and a.tmdb_id = b.tmdb_id)
        or (
          (a.tmdb_id is null or b.tmdb_id is null)
          and lower(btrim(a.title)) = lower(btrim(b.title))
          and a.release_year is not distinct from b.release_year
        )
      )

      union all

      -- Películas vistas únicamente por el otro usuario.
      select
        b.title as movie_title,
        b.release_year as movie_release_year,
        b.genre as movie_genre,
        b.poster_path as movie_poster_path,
        b.tmdb_id as tmdb_id,
        false as mine,
        true as theirs,
        false as is_match,
        null::date as my_watched_date,
        b.watched_date as their_watched_date,
        null::boolean as my_at_home,
        b.watched_at_home as their_at_home
      from b
      where not exists (
        select 1 from a
        where (
          (a.tmdb_id is not null and b.tmdb_id is not null and a.tmdb_id = b.tmdb_id)
          or (
            (a.tmdb_id is null or b.tmdb_id is null)
            and lower(btrim(a.title)) = lower(btrim(b.title))
            and a.release_year is not distinct from b.release_year
          )
        )
      )
    )
    select
      r.movie_title,
      r.movie_release_year,
      r.movie_genre,
      r.movie_poster_path,
      r.tmdb_id,
      r.mine,
      r.theirs,
      r.is_match,
      r.my_watched_date,
      r.their_watched_date,
      r.my_at_home,
      r.their_at_home
    from combined_rows r
    order by r.is_match desc, lower(r.movie_title);
end;
$function$;

commit;
