-- Developer Hub for safely maintaining published copies only.
-- Developer access is independent from publisher eligibility and never exposes private libraries.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.developer_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'developer')),
  enabled boolean not null default true,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now()
);

create table if not exists public.developer_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references auth.users(id),
  action text not null,
  publisher_user_id uuid not null references public.published_profiles(user_id),
  entity_type text not null check (entity_type in ('profile', 'collection', 'episode', 'library')),
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  revision_before bigint not null,
  revision_after bigint not null,
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  created_at timestamptz not null default now()
);

create index if not exists developer_audit_publisher_created_idx
  on public.developer_audit_log(publisher_user_id, created_at desc);
create index if not exists developer_audit_actor_created_idx
  on public.developer_audit_log(actor_user_id, created_at desc);

alter table public.developer_accounts enable row level security;
alter table public.developer_audit_log enable row level security;

revoke all on table public.developer_accounts from public, anon, authenticated;
revoke all on table public.developer_audit_log from public, anon, authenticated;

create or replace function private.require_developer()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before opening Developer Hub' using errcode = '42501';
  end if;

  select d.role into v_role
  from public.developer_accounts d
  where d.user_id = auth.uid() and d.enabled;

  if v_role is null then
    raise exception 'Developer access is required' using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function private.publication_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.published_profiles p where p.user_id = p_user_id),
    'collections', (select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order, c.name), '[]'::jsonb) from public.published_collections c where c.user_id = p_user_id),
    'episodes', (select coalesce(jsonb_agg(to_jsonb(e) order by e.sort_order, e.title), '[]'::jsonb) from public.published_episodes e where e.user_id = p_user_id),
    'memberships', (select coalesce(jsonb_agg(to_jsonb(m) order by m.source_collection_id, m.position), '[]'::jsonb) from public.published_collection_episodes m where m.user_id = p_user_id)
  );
$$;

create or replace function private.block_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Developer audit entries are immutable' using errcode = '42501';
end;
$$;

drop trigger if exists developer_audit_immutable on public.developer_audit_log;
create trigger developer_audit_immutable
before update or delete on public.developer_audit_log
for each row execute function private.block_audit_mutation();

insert into public.developer_accounts(user_id, role, enabled, granted_by)
values
  ('8b298b36-09c7-4d2e-be8b-e8500a307f25', 'admin', true, '8b298b36-09c7-4d2e-be8b-e8500a307f25'),
  ('ad8895d0-3fb6-453e-96a0-51ba835d7158', 'developer', true, '8b298b36-09c7-4d2e-be8b-e8500a307f25')
on conflict (user_id) do update
set role = excluded.role,
    enabled = excluded.enabled,
    granted_by = excluded.granted_by;

create or replace function public.get_developer_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  v_role := private.require_developer();

  return jsonb_build_object(
    'role', v_role,
    'libraries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', p.user_id,
        'slug', p.slug,
        'displayName', p.display_name,
        'isPublished', p.is_published,
        'revision', p.revision,
        'publishedAt', p.published_at,
        'collectionCount', (select count(*) from public.published_collections c where c.user_id = p.user_id),
        'episodeCount', (select count(*) from public.published_episodes e where e.user_id = p.user_id)
      ) order by p.display_name)
      from public.published_profiles p
    ), '[]'::jsonb),
    'recentActivity', coalesce((
      select jsonb_agg(row_data order by created_at desc)
      from (
        select jsonb_build_object(
          'id', a.id,
          'actorUserId', a.actor_user_id,
          'actorName', coalesce(actor_profile.display_name, 'Developer'),
          'action', a.action,
          'publisherUserId', a.publisher_user_id,
          'libraryName', publisher_profile.display_name,
          'entityType', a.entity_type,
          'entityId', a.entity_id,
          'revisionBefore', a.revision_before,
          'revisionAfter', a.revision_after,
          'reason', a.reason,
          'createdAt', a.created_at
        ) as row_data,
        a.created_at
        from public.developer_audit_log a
        left join public.published_profiles actor_profile on actor_profile.user_id = a.actor_user_id
        join public.published_profiles publisher_profile on publisher_profile.user_id = a.publisher_user_id
        order by a.created_at desc
        limit 100
      ) activity
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_developer_published_library(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_developer();

  if not exists (select 1 from public.published_profiles p where p.user_id = p_user_id) then
    raise exception 'Published library not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'userId', p.user_id,
        'slug', p.slug,
        'displayName', p.display_name,
        'isPublished', p.is_published,
        'revision', p.revision,
        'publishedAt', p.published_at
      ) from public.published_profiles p where p.user_id = p_user_id
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
      from public.published_collections c where c.user_id = p_user_id
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
          where m.user_id = p_user_id and m.source_episode_id = e.source_episode_id
        ), '[]'::jsonb)
      ) order by e.sort_order, e.title)
      from public.published_episodes e where e.user_id = p_user_id
    ), '[]'::jsonb),
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'revision', r.revision,
        'action', r.action,
        'createdAt', r.created_at,
        'expiresAt', r.expires_at,
        'scopeCollectionId', r.scope_collection_id
      ) order by r.revision desc)
      from public.publication_revisions r
      where r.user_id = p_user_id and r.expires_at >= now()
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'actorUserId', a.actor_user_id,
        'actorName', coalesce(actor_profile.display_name, 'Developer'),
        'action', a.action,
        'entityType', a.entity_type,
        'entityId', a.entity_id,
        'before', a.before_data,
        'after', a.after_data,
        'revisionBefore', a.revision_before,
        'revisionAfter', a.revision_after,
        'reason', a.reason,
        'createdAt', a.created_at
      ) order by a.created_at desc)
      from public.developer_audit_log a
      left join public.published_profiles actor_profile on actor_profile.user_id = a.actor_user_id
      where a.publisher_user_id = p_user_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_developer_publication_health(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_developer();

  return jsonb_build_object(
    'issues', coalesce((
      select jsonb_agg(issue order by severity desc, label)
      from (
        select 'warning'::text severity, 'episode'::text entity_type,
               e.source_episode_id entity_id, e.title label,
               'Episode is not assigned to any published collection'::text message
        from public.published_episodes e
        where e.user_id = p_user_id and not exists (
          select 1 from public.published_collection_episodes m
          where m.user_id = e.user_id and m.source_episode_id = e.source_episode_id
        )
        union all
        select 'notice', 'episode', e.source_episode_id, e.title,
               'Episode has no artwork'
        from public.published_episodes e
        where e.user_id = p_user_id and nullif(trim(e.artwork_url), '') is null
        union all
        select 'warning', 'episode', e.source_episode_id, e.title,
               'Spotify episode has an invalid URL'
        from public.published_episodes e
        where e.user_id = p_user_id and e.source_type = 'spotify'
          and (e.spotify_url is null or e.spotify_url !~ '^https://open\\.spotify\\.com/')
        union all
        select 'notice', 'collection', c.source_collection_id, c.name,
               'Collection has no published episodes'
        from public.published_collections c
        where c.user_id = p_user_id and not exists (
          select 1 from public.published_collection_episodes m
          where m.user_id = c.user_id and m.source_collection_id = c.source_collection_id
        )
      ) checks
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.developer_update_published_item(
  p_user_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_expected_revision bigint,
  p_changes jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_revision bigint;
  v_before jsonb;
  v_after jsonb;
  v_parent uuid;
  v_groups uuid[];
  v_snapshot jsonb;
begin
  perform private.require_developer();

  if p_entity_type not in ('profile', 'collection', 'episode') then
    raise exception 'Unsupported published item type' using errcode = '22023';
  end if;
  if p_changes is null or p_changes = '{}'::jsonb then
    raise exception 'No changes were supplied' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Enter a reason between 3 and 500 characters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':public-library', 0));
  select p.revision into v_revision
  from public.published_profiles p
  where p.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Published library not found' using errcode = 'P0002';
  end if;
  if v_revision <> p_expected_revision then
    raise exception 'The public library changed after you opened it. Reload before saving.'
      using errcode = '40001', hint = 'PUBLICATION_STALE';
  end if;

  if p_entity_type = 'profile' then
    if p_changes - array['displayName','slug','isPublished'] <> '{}'::jsonb then
      raise exception 'Profile update contains unsupported fields' using errcode = '22023';
    end if;
    select to_jsonb(p) into v_before from public.published_profiles p where p.user_id = p_user_id;

    update public.published_profiles p
    set display_name = case when p_changes ? 'displayName' then left(trim(p_changes->>'displayName'), 80) else p.display_name end,
        slug = case when p_changes ? 'slug' then lower(trim(p_changes->>'slug')) else p.slug end,
        is_published = case when p_changes ? 'isPublished' then (p_changes->>'isPublished')::boolean else p.is_published end,
        published_at = case
          when p_changes ? 'isPublished' and not (p_changes->>'isPublished')::boolean then null
          when p_changes ? 'isPublished' and (p_changes->>'isPublished')::boolean then now()
          else p.published_at
        end
    where p.user_id = p_user_id;

    if exists (select 1 from public.published_profiles p where p.user_id = p_user_id and (p.display_name = '' or p.slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')) then
      raise exception 'Display name and public slug are invalid' using errcode = '22023';
    end if;
    select to_jsonb(p) into v_after from public.published_profiles p where p.user_id = p_user_id;

  elsif p_entity_type = 'collection' then
    if p_changes - array['name','icon','color','parentId','sortOrder'] <> '{}'::jsonb then
      raise exception 'Collection update contains unsupported fields' using errcode = '22023';
    end if;
    select to_jsonb(c) into v_before
    from public.published_collections c
    where c.user_id = p_user_id and c.source_collection_id = p_entity_id;
    if v_before is null then raise exception 'Published collection not found' using errcode = 'P0002'; end if;

    if p_changes ? 'parentId' then
      v_parent := nullif(p_changes->>'parentId', '')::uuid;
      if v_parent = p_entity_id then raise exception 'A collection cannot contain itself' using errcode = '22023'; end if;
      if v_parent is not null and not exists (
        select 1 from public.published_collections c
        where c.user_id = p_user_id and c.source_collection_id = v_parent
      ) then raise exception 'Parent collection is not in this published library' using errcode = '22023'; end if;
      if v_parent is not null and exists (
        with recursive descendants as (
          select c.source_collection_id from public.published_collections c
          where c.user_id = p_user_id and c.parent_source_collection_id = p_entity_id
          union all
          select child.source_collection_id from public.published_collections child
          join descendants parent on child.parent_source_collection_id = parent.source_collection_id
          where child.user_id = p_user_id
        ) select 1 from descendants where source_collection_id = v_parent
      ) then raise exception 'A collection cannot be moved into one of its children' using errcode = '22023'; end if;
    end if;

    update public.published_collections c
    set name = case when p_changes ? 'name' then left(trim(p_changes->>'name'), 120) else c.name end,
        icon = case when p_changes ? 'icon' then left(trim(p_changes->>'icon'), 80) else c.icon end,
        color = case when p_changes ? 'color' then left(trim(p_changes->>'color'), 24) else c.color end,
        parent_source_collection_id = case when p_changes ? 'parentId' then v_parent else c.parent_source_collection_id end,
        sort_order = case when p_changes ? 'sortOrder' then (p_changes->>'sortOrder')::bigint else c.sort_order end,
        published_at = now()
    where c.user_id = p_user_id and c.source_collection_id = p_entity_id;
    if exists (select 1 from public.published_collections c where c.user_id = p_user_id and c.source_collection_id = p_entity_id and c.name = '') then
      raise exception 'Collection name cannot be empty' using errcode = '22023';
    end if;
    select to_jsonb(c) into v_after from public.published_collections c
    where c.user_id = p_user_id and c.source_collection_id = p_entity_id;

  else
    if p_changes - array['title','tag','url','embed','artImage','durationMs','timeLabel','sortOrder','groups'] <> '{}'::jsonb then
      raise exception 'Episode update contains unsupported fields' using errcode = '22023';
    end if;
    select to_jsonb(e) || jsonb_build_object('groups', coalesce((
      select jsonb_agg(m.source_collection_id order by m.position)
      from public.published_collection_episodes m
      where m.user_id = p_user_id and m.source_episode_id = p_entity_id
    ), '[]'::jsonb)) into v_before
    from public.published_episodes e
    where e.user_id = p_user_id and e.source_episode_id = p_entity_id;
    if v_before is null then raise exception 'Published episode not found' using errcode = 'P0002'; end if;

    update public.published_episodes e
    set title = case when p_changes ? 'title' then left(trim(p_changes->>'title'), 300) else e.title end,
        tag = case when p_changes ? 'tag' then left(trim(p_changes->>'tag'), 80) else e.tag end,
        spotify_url = case when p_changes ? 'url' then nullif(trim(p_changes->>'url'), '') else e.spotify_url end,
        spotify_embed_url = case when p_changes ? 'embed' then nullif(trim(p_changes->>'embed'), '') else e.spotify_embed_url end,
        artwork_url = case when p_changes ? 'artImage' then nullif(trim(p_changes->>'artImage'), '') else e.artwork_url end,
        duration_ms = case when p_changes ? 'durationMs' then nullif(p_changes->>'durationMs', '')::bigint else e.duration_ms end,
        time_label = case when p_changes ? 'timeLabel' then left(trim(p_changes->>'timeLabel'), 40) else e.time_label end,
        sort_order = case when p_changes ? 'sortOrder' then (p_changes->>'sortOrder')::bigint else e.sort_order end,
        published_at = now()
    where e.user_id = p_user_id and e.source_episode_id = p_entity_id;
    if exists (select 1 from public.published_episodes e where e.user_id = p_user_id and e.source_episode_id = p_entity_id and e.title = '') then
      raise exception 'Episode title cannot be empty' using errcode = '22023';
    end if;

    if p_changes ? 'groups' then
      select coalesce(array_agg(value::uuid order by ordinality), '{}') into v_groups
      from jsonb_array_elements_text(p_changes->'groups') with ordinality;
      if exists (
        select 1 from unnest(v_groups) id where not exists (
          select 1 from public.published_collections c where c.user_id = p_user_id and c.source_collection_id = id
        )
      ) then raise exception 'Episode contains a collection outside this published library' using errcode = '22023'; end if;
      delete from public.published_collection_episodes m
      where m.user_id = p_user_id and m.source_episode_id = p_entity_id;
      insert into public.published_collection_episodes(user_id, source_collection_id, source_episode_id, position)
      select p_user_id, id, p_entity_id, ordinality::integer
      from unnest(v_groups) with ordinality as selected(id, ordinality);
    end if;

    select to_jsonb(e) || jsonb_build_object('groups', coalesce((
      select jsonb_agg(m.source_collection_id order by m.position)
      from public.published_collection_episodes m
      where m.user_id = p_user_id and m.source_episode_id = p_entity_id
    ), '[]'::jsonb)) into v_after
    from public.published_episodes e
    where e.user_id = p_user_id and e.source_episode_id = p_entity_id;
  end if;

  v_revision := v_revision + 1;
  update public.published_profiles p set revision = v_revision where p.user_id = p_user_id;
  v_snapshot := private.publication_snapshot(p_user_id);

  insert into public.publication_revisions(user_id, revision, scope_collection_id, action, snapshot)
  values (p_user_id, v_revision, case when p_entity_type = 'collection' then p_entity_id else null end, 'developer_edit', v_snapshot);

  insert into public.developer_audit_log(
    actor_user_id, action, publisher_user_id, entity_type, entity_id,
    before_data, after_data, revision_before, revision_after, reason
  ) values (
    v_actor, 'edit_' || p_entity_type, p_user_id, p_entity_type, p_entity_id,
    v_before, v_after, v_revision - 1, v_revision, trim(p_reason)
  );

  delete from public.publication_revisions where user_id = p_user_id and expires_at < now();
  return jsonb_build_object('revision', v_revision, 'item', v_after);
end;
$$;

create or replace function public.developer_restore_publication_revision(
  p_user_id uuid,
  p_revision bigint,
  p_expected_revision bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_current bigint;
  v_snapshot jsonb;
  v_before jsonb;
  v_new_revision bigint;
begin
  perform private.require_developer();
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Enter a reason between 3 and 500 characters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':public-library', 0));
  select p.revision into v_current from public.published_profiles p
  where p.user_id = p_user_id for update;
  if not found then raise exception 'Published library not found' using errcode = 'P0002'; end if;
  if v_current <> p_expected_revision then
    raise exception 'The public library changed after you opened it. Reload before restoring.'
      using errcode = '40001', hint = 'PUBLICATION_STALE';
  end if;

  select r.snapshot into v_snapshot from public.publication_revisions r
  where r.user_id = p_user_id and r.revision = p_revision and r.expires_at >= now();
  if v_snapshot is null then raise exception 'That revision is unavailable or expired' using errcode = 'P0002'; end if;

  v_before := private.publication_snapshot(p_user_id);
  delete from public.published_collection_episodes where user_id = p_user_id;
  delete from public.published_collections where user_id = p_user_id;
  delete from public.published_episodes where user_id = p_user_id;

  insert into public.published_collections(
    user_id, source_collection_id, name, icon, color, parent_source_collection_id, sort_order, published_at
  )
  select p_user_id, x.source_collection_id, x.name, x.icon, x.color,
         x.parent_source_collection_id, x.sort_order, coalesce(x.published_at, now())
  from jsonb_to_recordset(v_snapshot->'collections') as x(
    user_id uuid, source_collection_id uuid, name text, icon text, color text,
    parent_source_collection_id uuid, sort_order bigint, published_at timestamptz
  );

  insert into public.published_episodes(
    user_id, source_episode_id, title, tag, source_type, spotify_url, spotify_embed_url,
    artwork_url, duration_ms, time_label, sort_order, published_at
  )
  select p_user_id, x.source_episode_id, x.title, x.tag, x.source_type, x.spotify_url,
         x.spotify_embed_url, x.artwork_url, x.duration_ms, x.time_label, x.sort_order,
         coalesce(x.published_at, now())
  from jsonb_to_recordset(v_snapshot->'episodes') as x(
    user_id uuid, source_episode_id uuid, title text, tag text, source_type text,
    spotify_url text, spotify_embed_url text, artwork_url text, duration_ms bigint,
    time_label text, sort_order bigint, published_at timestamptz
  );

  insert into public.published_collection_episodes(user_id, source_collection_id, source_episode_id, position)
  select p_user_id, x.source_collection_id, x.source_episode_id, x.position
  from jsonb_to_recordset(v_snapshot->'memberships') as x(
    user_id uuid, source_collection_id uuid, source_episode_id uuid, position integer
  );

  v_new_revision := v_current + 1;
  update public.published_profiles p
  set display_name = coalesce(v_snapshot->'profile'->>'display_name', p.display_name),
      slug = coalesce(v_snapshot->'profile'->>'slug', p.slug),
      is_published = coalesce((v_snapshot->'profile'->>'is_published')::boolean, p.is_published),
      published_at = nullif(v_snapshot->'profile'->>'published_at', '')::timestamptz,
      revision = v_new_revision
  where p.user_id = p_user_id;

  v_snapshot := private.publication_snapshot(p_user_id);
  insert into public.publication_revisions(user_id, revision, action, snapshot)
  values (p_user_id, v_new_revision, 'developer_restore', v_snapshot);
  insert into public.developer_audit_log(
    actor_user_id, action, publisher_user_id, entity_type, before_data, after_data,
    revision_before, revision_after, reason
  ) values (
    v_actor, 'restore_revision', p_user_id, 'library', v_before, v_snapshot,
    v_current, v_new_revision, trim(p_reason)
  );

  return jsonb_build_object('revision', v_new_revision, 'restoredRevision', p_revision);
end;
$$;

revoke execute on function private.require_developer() from public, anon, authenticated;
revoke execute on function private.publication_snapshot(uuid) from public, anon, authenticated;
revoke execute on function private.block_audit_mutation() from public, anon, authenticated;

revoke execute on function public.get_developer_dashboard() from public, anon;
revoke execute on function public.get_developer_published_library(uuid) from public, anon;
revoke execute on function public.get_developer_publication_health(uuid) from public, anon;
revoke execute on function public.developer_update_published_item(uuid, text, uuid, bigint, jsonb, text) from public, anon;
revoke execute on function public.developer_restore_publication_revision(uuid, bigint, bigint, text) from public, anon;

grant execute on function public.get_developer_dashboard() to authenticated;
grant execute on function public.get_developer_published_library(uuid) to authenticated;
grant execute on function public.get_developer_publication_health(uuid) to authenticated;
grant execute on function public.developer_update_published_item(uuid, text, uuid, bigint, jsonb, text) to authenticated;
grant execute on function public.developer_restore_publication_revision(uuid, bigint, bigint, text) to authenticated;
