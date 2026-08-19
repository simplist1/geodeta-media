-- Safe whole-library and collection-scoped unpublishing.

alter table public.publication_revisions
  add column if not exists action text not null default 'publish';

create or replace function public.get_unpublication_preview(p_collection_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_revision bigint;
  v_slug text;
  v_is_published boolean;
  v_collection_ids uuid[] := '{}';
  v_episode_ids uuid[] := '{}';
begin
  if v_user_id is null then
    raise exception 'Sign in before unpublishing' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.publisher_allowlist a
    where a.user_id = v_user_id and a.enabled
  ) then
    raise exception 'This account is not approved to publish' using errcode = '42501';
  end if;

  select p.revision, p.slug, p.is_published
  into v_revision, v_slug, v_is_published
  from public.published_profiles p
  where p.user_id = v_user_id;

  if not found or not v_is_published then
    return jsonb_build_object(
      'published', false,
      'revision', coalesce(v_revision, 0),
      'slug', v_slug,
      'scopeCollectionId', p_collection_id,
      'collections', '[]'::jsonb,
      'removedEpisodes', '[]'::jsonb,
      'keptEpisodeCount', 0
    );
  end if;

  if p_collection_id is null then
    return jsonb_build_object(
      'published', true,
      'revision', v_revision,
      'slug', v_slug,
      'scopeCollectionId', null,
      'collectionCount', (select count(*) from public.published_collections c where c.user_id = v_user_id),
      'episodeCount', (select count(*) from public.published_episodes e where e.user_id = v_user_id),
      'collections', '[]'::jsonb,
      'removedEpisodes', '[]'::jsonb,
      'keptEpisodeCount', 0
    );
  end if;

  if not exists (
    select 1 from public.published_collections c
    where c.user_id = v_user_id and c.source_collection_id = p_collection_id
  ) then
    raise exception 'This collection is not published' using errcode = 'P0002';
  end if;

  with recursive scoped as (
    select c.source_collection_id
    from public.published_collections c
    where c.user_id = v_user_id and c.source_collection_id = p_collection_id
    union all
    select child.source_collection_id
    from public.published_collections child
    join scoped parent on child.parent_source_collection_id = parent.source_collection_id
    where child.user_id = v_user_id
  )
  select coalesce(array_agg(source_collection_id), '{}') into v_collection_ids from scoped;

  select coalesce(array_agg(distinct m.source_episode_id), '{}') into v_episode_ids
  from public.published_collection_episodes m
  where m.user_id = v_user_id and m.source_collection_id = any(v_collection_ids);

  return jsonb_build_object(
    'published', true,
    'revision', v_revision,
    'slug', v_slug,
    'scopeCollectionId', p_collection_id,
    'collectionCount', cardinality(v_collection_ids),
    'episodeCount', cardinality(v_episode_ids),
    'collections', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.source_collection_id, 'name', c.name) order by c.sort_order, c.name)
      from public.published_collections c
      where c.user_id = v_user_id and c.source_collection_id = any(v_collection_ids)
    ), '[]'::jsonb),
    'removedEpisodes', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.source_episode_id, 'title', e.title, 'tag', e.tag) order by e.sort_order, e.title)
      from public.published_episodes e
      where e.user_id = v_user_id
        and e.source_episode_id = any(v_episode_ids)
        and not exists (
          select 1 from public.published_collection_episodes outside_membership
          where outside_membership.user_id = v_user_id
            and outside_membership.source_episode_id = e.source_episode_id
            and not (outside_membership.source_collection_id = any(v_collection_ids))
        )
    ), '[]'::jsonb),
    'keptEpisodeCount', (
      select count(*)
      from public.published_episodes e
      where e.user_id = v_user_id
        and e.source_episode_id = any(v_episode_ids)
        and exists (
          select 1 from public.published_collection_episodes outside_membership
          where outside_membership.user_id = v_user_id
            and outside_membership.source_episode_id = e.source_episode_id
            and not (outside_membership.source_collection_id = any(v_collection_ids))
        )
    )
  );
end;
$$;

create or replace function public.unpublish_library_selection(
  p_collection_id uuid,
  p_expected_revision bigint
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
  v_is_published boolean;
  v_collection_ids uuid[] := '{}';
  v_episode_ids uuid[] := '{}';
  v_removed_collections integer := 0;
  v_removed_episodes integer := 0;
  v_snapshot jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in before unpublishing' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.publisher_allowlist a
    where a.user_id = v_user_id and a.enabled
  ) then
    raise exception 'This account is not approved to publish' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':public-library', 0));

  select p.revision, p.slug, p.is_published
  into v_revision, v_slug, v_is_published
  from public.published_profiles p
  where p.user_id = v_user_id
  for update;

  if not found or not v_is_published then
    raise exception 'The library is already unpublished' using errcode = 'P0002';
  end if;
  if v_revision <> p_expected_revision then
    raise exception 'The public library changed after this preview. Review it again.'
      using errcode = '40001', hint = 'PUBLICATION_STALE';
  end if;

  v_snapshot := jsonb_build_object(
    'profile', (select to_jsonb(p) from public.published_profiles p where p.user_id = v_user_id),
    'collections', (select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order), '[]'::jsonb) from public.published_collections c where c.user_id = v_user_id),
    'episodes', (select coalesce(jsonb_agg(to_jsonb(e) order by e.sort_order), '[]'::jsonb) from public.published_episodes e where e.user_id = v_user_id),
    'memberships', (select coalesce(jsonb_agg(to_jsonb(m) order by m.source_collection_id, m.position), '[]'::jsonb) from public.published_collection_episodes m where m.user_id = v_user_id)
  );

  if p_collection_id is null then
    v_revision := v_revision + 1;
    update public.published_profiles
    set revision = v_revision, is_published = false, published_at = null
    where user_id = v_user_id;

    insert into public.publication_revisions(
      user_id, revision, scope_collection_id, action, snapshot
    ) values (v_user_id, v_revision, null, 'unpublish_library', v_snapshot);

    delete from public.publication_revisions
    where user_id = v_user_id and expires_at < now();

    return jsonb_build_object(
      'revision', v_revision,
      'slug', v_slug,
      'hidden', true,
      'removedCollections', 0,
      'removedEpisodes', 0
    );
  end if;

  if not exists (
    select 1 from public.published_collections c
    where c.user_id = v_user_id and c.source_collection_id = p_collection_id
  ) then
    raise exception 'This collection is not published' using errcode = 'P0002';
  end if;

  with recursive scoped as (
    select c.source_collection_id
    from public.published_collections c
    where c.user_id = v_user_id and c.source_collection_id = p_collection_id
    union all
    select child.source_collection_id
    from public.published_collections child
    join scoped parent on child.parent_source_collection_id = parent.source_collection_id
    where child.user_id = v_user_id
  )
  select coalesce(array_agg(source_collection_id), '{}') into v_collection_ids from scoped;

  select coalesce(array_agg(distinct m.source_episode_id), '{}') into v_episode_ids
  from public.published_collection_episodes m
  where m.user_id = v_user_id and m.source_collection_id = any(v_collection_ids);

  delete from public.published_collection_episodes m
  where m.user_id = v_user_id and m.source_collection_id = any(v_collection_ids);

  delete from public.published_collections c
  where c.user_id = v_user_id and c.source_collection_id = any(v_collection_ids);
  get diagnostics v_removed_collections = row_count;

  delete from public.published_episodes e
  where e.user_id = v_user_id
    and e.source_episode_id = any(v_episode_ids)
    and not exists (
      select 1 from public.published_collection_episodes remaining
      where remaining.user_id = v_user_id
        and remaining.source_episode_id = e.source_episode_id
    );
  get diagnostics v_removed_episodes = row_count;

  v_revision := v_revision + 1;
  update public.published_profiles
  set revision = v_revision, published_at = now()
  where user_id = v_user_id;

  insert into public.publication_revisions(
    user_id, revision, scope_collection_id, action, snapshot
  ) values (v_user_id, v_revision, p_collection_id, 'unpublish_collection', v_snapshot);

  delete from public.publication_revisions
  where user_id = v_user_id and expires_at < now();

  return jsonb_build_object(
    'revision', v_revision,
    'slug', v_slug,
    'hidden', false,
    'removedCollections', v_removed_collections,
    'removedEpisodes', v_removed_episodes
  );
end;
$$;

revoke execute on function public.get_unpublication_preview(uuid) from public, anon;
revoke execute on function public.unpublish_library_selection(uuid, bigint) from public, anon;
grant execute on function public.get_unpublication_preview(uuid) to authenticated;
grant execute on function public.unpublish_library_selection(uuid, bigint) to authenticated;

