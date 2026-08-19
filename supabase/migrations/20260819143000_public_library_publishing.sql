-- Transaction-safe, opt-in public library publishing.
-- Private collections/episodes remain protected by their existing RLS policies.

create table if not exists public.publisher_allowlist (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  granted_at timestamptz not null default now()
);

create table if not exists public.published_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null,
  is_published boolean not null default false,
  revision bigint not null default 0 check (revision >= 0),
  published_at timestamptz
);

create table if not exists public.published_collections (
  user_id uuid not null references public.published_profiles(user_id) on delete cascade,
  source_collection_id uuid not null,
  name text not null,
  icon text not null default 'library',
  color text not null default '#5b5ce2',
  parent_source_collection_id uuid,
  sort_order bigint not null default 0,
  published_at timestamptz not null default now(),
  primary key (user_id, source_collection_id),
  foreign key (user_id, parent_source_collection_id)
    references public.published_collections(user_id, source_collection_id)
    deferrable initially deferred
);

create table if not exists public.published_episodes (
  user_id uuid not null references public.published_profiles(user_id) on delete cascade,
  source_episode_id uuid not null,
  title text not null,
  tag text not null default 'Episode',
  source_type text not null check (source_type in ('spotify','local','online')),
  spotify_url text,
  spotify_embed_url text,
  artwork_url text,
  duration_ms bigint,
  time_label text not null default '—',
  sort_order bigint not null default 0,
  published_at timestamptz not null default now(),
  primary key (user_id, source_episode_id)
);

create table if not exists public.published_collection_episodes (
  user_id uuid not null,
  source_collection_id uuid not null,
  source_episode_id uuid not null,
  position integer not null default 0,
  primary key (user_id, source_collection_id, source_episode_id),
  foreign key (user_id, source_collection_id)
    references public.published_collections(user_id, source_collection_id) on delete cascade,
  foreign key (user_id, source_episode_id)
    references public.published_episodes(user_id, source_episode_id) on delete cascade
);

create table if not exists public.publication_revisions (
  user_id uuid not null references public.published_profiles(user_id) on delete cascade,
  revision bigint not null,
  scope_collection_id uuid,
  overridden_collection_ids uuid[] not null default '{}',
  overridden_episode_ids uuid[] not null default '{}',
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  primary key (user_id, revision)
);

create index if not exists published_collections_parent_idx
  on public.published_collections(user_id, parent_source_collection_id, sort_order);
create index if not exists published_episodes_order_idx
  on public.published_episodes(user_id, sort_order);
create index if not exists published_collection_episodes_collection_idx
  on public.published_collection_episodes(user_id, source_collection_id, position);
create index if not exists publication_revisions_expiry_idx
  on public.publication_revisions(expires_at);

alter table public.publisher_allowlist enable row level security;
alter table public.published_profiles enable row level security;
alter table public.published_collections enable row level security;
alter table public.published_episodes enable row level security;
alter table public.published_collection_episodes enable row level security;
alter table public.publication_revisions enable row level security;

revoke all on table public.publisher_allowlist from anon, authenticated;
revoke all on table public.published_profiles from anon, authenticated;
revoke all on table public.published_collections from anon, authenticated;
revoke all on table public.published_episodes from anon, authenticated;
revoke all on table public.published_collection_episodes from anon, authenticated;
revoke all on table public.publication_revisions from anon, authenticated;

grant select on table public.publisher_allowlist to authenticated;
grant select on table public.published_profiles to anon, authenticated;
grant select on table public.published_collections to anon, authenticated;
grant select on table public.published_episodes to anon, authenticated;
grant select on table public.published_collection_episodes to anon, authenticated;

drop policy if exists "Publisher can read own eligibility" on public.publisher_allowlist;
create policy "Publisher can read own eligibility"
on public.publisher_allowlist for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Published profiles are public" on public.published_profiles;
create policy "Published profiles are public"
on public.published_profiles for select to anon, authenticated
using (is_published);

drop policy if exists "Published collections are public" on public.published_collections;
create policy "Published collections are public"
on public.published_collections for select to anon, authenticated
using (exists (
  select 1 from public.published_profiles p
  where p.user_id = published_collections.user_id and p.is_published
));

drop policy if exists "Published episodes are public" on public.published_episodes;
create policy "Published episodes are public"
on public.published_episodes for select to anon, authenticated
using (exists (
  select 1 from public.published_profiles p
  where p.user_id = published_episodes.user_id and p.is_published
));

drop policy if exists "Published memberships are public" on public.published_collection_episodes;
create policy "Published memberships are public"
on public.published_collection_episodes for select to anon, authenticated
using (exists (
  select 1 from public.published_profiles p
  where p.user_id = published_collection_episodes.user_id and p.is_published
));

-- The two explicitly approved publishers. Emails are deliberately not copied.
insert into public.publisher_allowlist(user_id, enabled)
values
  ('8b298b36-09c7-4d2e-be8b-e8500a307f25', true),
  ('ad8895d0-3fb6-453e-96a0-51ba835d7158', true)
on conflict (user_id) do update set enabled = excluded.enabled;

insert into public.published_profiles(user_id, slug, display_name)
values
  ('8b298b36-09c7-4d2e-be8b-e8500a307f25', 'geodeta-us', 'Geodeta Us'),
  ('ad8895d0-3fb6-453e-96a0-51ba835d7158', 'hubert-sadecki', 'Hubert Sadecki')
on conflict (user_id) do update
set slug = excluded.slug, display_name = excluded.display_name;

create or replace function public.get_publication_preview(p_collection_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_revision bigint;
  v_slug text;
  v_display_name text;
  v_collection_ids uuid[] := '{}';
  v_episode_ids uuid[] := '{}';
begin
  if v_user_id is null then
    raise exception 'Sign in before publishing' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.publisher_allowlist a
    where a.user_id = v_user_id and a.enabled
  ) then
    raise exception 'This account is not approved to publish' using errcode = '42501';
  end if;

  if p_collection_id is not null and not exists (
    select 1 from public.collections c
    where c.id = p_collection_id and c.user_id = v_user_id and c.deleted_at is null
  ) then
    raise exception 'Collection not found' using errcode = 'P0002';
  end if;

  select p.revision, p.slug, p.display_name
  into v_revision, v_slug, v_display_name
  from public.published_profiles p
  where p.user_id = v_user_id;

  with recursive ancestors as (
    select c.id, c.parent_id
    from public.collections c
    where p_collection_id is not null and c.id = p_collection_id
      and c.user_id = v_user_id and c.deleted_at is null
    union all
    select parent.id, parent.parent_id
    from public.collections parent
    join ancestors child on child.parent_id = parent.id
    where parent.user_id = v_user_id and parent.deleted_at is null
  ), descendants as (
    select c.id
    from public.collections c
    where c.user_id = v_user_id and c.deleted_at is null
      and ((p_collection_id is null and c.parent_id is null) or c.id = p_collection_id)
    union all
    select child.id
    from public.collections child
    join descendants parent on child.parent_id = parent.id
    where child.user_id = v_user_id and child.deleted_at is null
  ), scoped as (
    select id from ancestors
    union
    select id from descendants
  )
  select coalesce(array_agg(id), '{}') into v_collection_ids from scoped;

  if p_collection_id is null then
    select coalesce(array_agg(e.id), '{}') into v_episode_ids
    from public.episodes e
    where e.user_id = v_user_id and e.deleted_at is null;
  else
    select coalesce(array_agg(distinct e.id), '{}') into v_episode_ids
    from public.episodes e
    join public.collection_episodes ce on ce.episode_id = e.id
    where e.user_id = v_user_id and e.deleted_at is null
      and ce.collection_id = any(v_collection_ids);
  end if;

  return jsonb_build_object(
    'revision', coalesce(v_revision, 0),
    'slug', v_slug,
    'displayName', v_display_name,
    'scopeCollectionId', p_collection_id,
    'newCollectionCount', (
      select count(*) from unnest(v_collection_ids) id
      where not exists (
        select 1 from public.published_collections pc
        where pc.user_id = v_user_id and pc.source_collection_id = id
      )
    ),
    'newEpisodeCount', (
      select count(*) from unnest(v_episode_ids) id
      where not exists (
        select 1 from public.published_episodes pe
        where pe.user_id = v_user_id and pe.source_episode_id = id
      )
    ),
    'collections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'existingName', pc.name,
        'changed', pc.name is distinct from c.name
          or pc.icon is distinct from c.icon
          or pc.color is distinct from c.color
          or pc.parent_source_collection_id is distinct from c.parent_id
          or pc.sort_order is distinct from c.sort_order
      ) order by c.sort_order, c.name)
      from public.collections c
      join public.published_collections pc
        on pc.user_id = v_user_id and pc.source_collection_id = c.id
      where c.id = any(v_collection_ids)
    ), '[]'::jsonb),
    'episodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'title', e.title,
        'existingTitle', pe.title,
        'tag', e.tag,
        'changed', pe.title is distinct from e.title
          or pe.tag is distinct from e.tag
          or pe.source_type is distinct from e.source_type
          or pe.spotify_url is distinct from e.spotify_url
          or pe.spotify_embed_url is distinct from e.spotify_embed_url
          or pe.artwork_url is distinct from e.artwork_url
          or pe.duration_ms is distinct from e.duration_ms
          or pe.time_label is distinct from e.time_label
          or pe.sort_order is distinct from e.sort_order
      ) order by e.sort_order, e.title)
      from public.episodes e
      join public.published_episodes pe
        on pe.user_id = v_user_id and pe.source_episode_id = e.id
      where e.id = any(v_episode_ids)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.publish_library_selection(
  p_collection_id uuid,
  p_expected_revision bigint,
  p_override_collection_ids uuid[] default '{}',
  p_override_episode_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_revision bigint;
  v_slug text;
  v_collection_ids uuid[] := '{}';
  v_episode_ids uuid[] := '{}';
  v_new_collection_ids uuid[] := '{}';
  v_new_episode_ids uuid[] := '{}';
  v_refresh_collection_ids uuid[] := '{}';
begin
  if v_user_id is null then
    raise exception 'Sign in before publishing' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.publisher_allowlist a
    where a.user_id = v_user_id and a.enabled
  ) then
    raise exception 'This account is not approved to publish' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':public-library', 0));

  select p.revision, p.slug into v_revision, v_slug
  from public.published_profiles p
  where p.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Publisher profile is missing' using errcode = 'P0002';
  end if;
  if v_revision <> p_expected_revision then
    raise exception 'The public library changed after this comparison. Review it again.'
      using errcode = '40001', hint = 'PUBLICATION_STALE';
  end if;
  if p_collection_id is not null and not exists (
    select 1 from public.collections c
    where c.id = p_collection_id and c.user_id = v_user_id and c.deleted_at is null
  ) then
    raise exception 'Collection not found' using errcode = 'P0002';
  end if;

  with recursive ancestors as (
    select c.id, c.parent_id
    from public.collections c
    where p_collection_id is not null and c.id = p_collection_id
      and c.user_id = v_user_id and c.deleted_at is null
    union all
    select parent.id, parent.parent_id
    from public.collections parent
    join ancestors child on child.parent_id = parent.id
    where parent.user_id = v_user_id and parent.deleted_at is null
  ), descendants as (
    select c.id
    from public.collections c
    where c.user_id = v_user_id and c.deleted_at is null
      and ((p_collection_id is null and c.parent_id is null) or c.id = p_collection_id)
    union all
    select child.id
    from public.collections child
    join descendants parent on child.parent_id = parent.id
    where child.user_id = v_user_id and child.deleted_at is null
  ), scoped as (
    select id from ancestors
    union
    select id from descendants
  )
  select coalesce(array_agg(id), '{}') into v_collection_ids from scoped;

  if p_collection_id is null then
    select coalesce(array_agg(e.id), '{}') into v_episode_ids
    from public.episodes e
    where e.user_id = v_user_id and e.deleted_at is null;
  else
    select coalesce(array_agg(distinct e.id), '{}') into v_episode_ids
    from public.episodes e
    join public.collection_episodes ce on ce.episode_id = e.id
    where e.user_id = v_user_id and e.deleted_at is null
      and ce.collection_id = any(v_collection_ids);
  end if;

  if exists (
    select 1 from unnest(coalesce(p_override_collection_ids, '{}')) id
    where not (id = any(v_collection_ids))
      or not exists (
        select 1 from public.published_collections pc
        where pc.user_id = v_user_id and pc.source_collection_id = id
      )
  ) or exists (
    select 1 from unnest(coalesce(p_override_episode_ids, '{}')) id
    where not (id = any(v_episode_ids))
      or not exists (
        select 1 from public.published_episodes pe
        where pe.user_id = v_user_id and pe.source_episode_id = id
      )
  ) then
    raise exception 'Invalid override selection' using errcode = '22023';
  end if;

  select coalesce(array_agg(id), '{}') into v_new_collection_ids
  from unnest(v_collection_ids) id
  where not exists (
    select 1 from public.published_collections pc
    where pc.user_id = v_user_id and pc.source_collection_id = id
  );

  select coalesce(array_agg(id), '{}') into v_new_episode_ids
  from unnest(v_episode_ids) id
  where not exists (
    select 1 from public.published_episodes pe
    where pe.user_id = v_user_id and pe.source_episode_id = id
  );

  v_refresh_collection_ids := v_new_collection_ids || coalesce(p_override_collection_ids, '{}');

  insert into public.published_collections(
    user_id, source_collection_id, name, icon, color,
    parent_source_collection_id, sort_order, published_at
  )
  select v_user_id, c.id, c.name, c.icon, c.color, c.parent_id, c.sort_order, now()
  from public.collections c
  where c.user_id = v_user_id and c.id = any(v_new_collection_ids)
  order by c.parent_id nulls first, c.sort_order
  on conflict (user_id, source_collection_id) do nothing;

  update public.published_collections pc
  set name = c.name,
      icon = c.icon,
      color = c.color,
      parent_source_collection_id = c.parent_id,
      sort_order = c.sort_order,
      published_at = now()
  from public.collections c
  where pc.user_id = v_user_id
    and c.user_id = v_user_id
    and pc.source_collection_id = c.id
    and c.id = any(coalesce(p_override_collection_ids, '{}'));

  insert into public.published_episodes(
    user_id, source_episode_id, title, tag, source_type,
    spotify_url, spotify_embed_url, artwork_url, duration_ms,
    time_label, sort_order, published_at
  )
  select v_user_id, e.id, e.title, e.tag, e.source_type,
         e.spotify_url, e.spotify_embed_url, e.artwork_url, e.duration_ms,
         e.time_label, e.sort_order, now()
  from public.episodes e
  where e.user_id = v_user_id and e.id = any(v_new_episode_ids)
  on conflict (user_id, source_episode_id) do nothing;

  update public.published_episodes pe
  set title = e.title,
      tag = e.tag,
      source_type = e.source_type,
      spotify_url = e.spotify_url,
      spotify_embed_url = e.spotify_embed_url,
      artwork_url = e.artwork_url,
      duration_ms = e.duration_ms,
      time_label = e.time_label,
      sort_order = e.sort_order,
      published_at = now()
  from public.episodes e
  where pe.user_id = v_user_id
    and e.user_id = v_user_id
    and pe.source_episode_id = e.id
    and e.id = any(coalesce(p_override_episode_ids, '{}'));

  delete from public.published_collection_episodes pce
  where pce.user_id = v_user_id
    and pce.source_collection_id = any(v_refresh_collection_ids);

  insert into public.published_collection_episodes(
    user_id, source_collection_id, source_episode_id, position
  )
  select v_user_id, ce.collection_id, ce.episode_id, ce.position
  from public.collection_episodes ce
  join public.episodes e on e.id = ce.episode_id and e.user_id = v_user_id and e.deleted_at is null
  join public.published_episodes pe on pe.user_id = v_user_id and pe.source_episode_id = ce.episode_id
  where ce.collection_id = any(v_refresh_collection_ids)
  on conflict (user_id, source_collection_id, source_episode_id)
  do update set position = excluded.position;

  v_revision := v_revision + 1;
  update public.published_profiles
  set revision = v_revision, is_published = true, published_at = now()
  where user_id = v_user_id;

  insert into public.publication_revisions(
    user_id, revision, scope_collection_id,
    overridden_collection_ids, overridden_episode_ids, snapshot
  ) values (
    v_user_id, v_revision, p_collection_id,
    coalesce(p_override_collection_ids, '{}'), coalesce(p_override_episode_ids, '{}'),
    jsonb_build_object(
      'profile', (select to_jsonb(p) from public.published_profiles p where p.user_id = v_user_id),
      'collections', (select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order), '[]'::jsonb) from public.published_collections c where c.user_id = v_user_id),
      'episodes', (select coalesce(jsonb_agg(to_jsonb(e) order by e.sort_order), '[]'::jsonb) from public.published_episodes e where e.user_id = v_user_id),
      'memberships', (select coalesce(jsonb_agg(to_jsonb(m) order by m.source_collection_id, m.position), '[]'::jsonb) from public.published_collection_episodes m where m.user_id = v_user_id)
    )
  );

  delete from public.publication_revisions
  where user_id = v_user_id and expires_at < now();

  return jsonb_build_object(
    'revision', v_revision,
    'slug', v_slug,
    'publishedUrl', 'https://podcasts.geodeta.us/@' || v_slug,
    'newCollections', cardinality(v_new_collection_ids),
    'newEpisodes', cardinality(v_new_episode_ids),
    'overriddenCollections', cardinality(coalesce(p_override_collection_ids, '{}')),
    'overriddenEpisodes', cardinality(coalesce(p_override_episode_ids, '{}'))
  );
end;
$$;

create or replace function public.get_published_library(p_slug text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'slug', p.slug,
      'displayName', p.display_name,
      'revision', p.revision,
      'publishedAt', p.published_at
    ),
    'collections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.source_collection_id,
        'name', c.name,
        'icon', c.icon,
        'color', c.color,
        'parentId', c.parent_source_collection_id,
        'sortOrder', c.sort_order
      ) order by c.sort_order, c.name)
      from public.published_collections c where c.user_id = p.user_id
    ), '[]'::jsonb),
    'episodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.source_episode_id,
        'title', e.title,
        'tag', e.tag,
        'source', e.source_type,
        'url', e.spotify_url,
        'embed', e.spotify_embed_url,
        'artImage', e.artwork_url,
        'durationMs', e.duration_ms,
        'timeLabel', e.time_label,
        'sortOrder', e.sort_order,
        'groups', coalesce((
          select jsonb_agg(m.source_collection_id order by m.position)
          from public.published_collection_episodes m
          where m.user_id = p.user_id and m.source_episode_id = e.source_episode_id
        ), '[]'::jsonb)
      ) order by e.sort_order, e.title)
      from public.published_episodes e where e.user_id = p.user_id
    ), '[]'::jsonb)
  )
  from public.published_profiles p
  where p.slug = lower(trim(p_slug)) and p.is_published;
$$;

revoke execute on function public.get_publication_preview(uuid) from public, anon;
revoke execute on function public.publish_library_selection(uuid, bigint, uuid[], uuid[]) from public, anon;
grant execute on function public.get_publication_preview(uuid) to authenticated;
grant execute on function public.publish_library_selection(uuid, bigint, uuid[], uuid[]) to authenticated;

revoke execute on function public.get_published_library(text) from public;
grant execute on function public.get_published_library(text) to anon, authenticated;
