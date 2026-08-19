-- Publisher-owned controls for clearing all or selected public content.

create or replace function public.get_published_clear_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Sign in before managing the public library' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.publisher_allowlist a
    where a.user_id = v_user_id and a.enabled
  ) then
    raise exception 'This account is not approved to publish' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'revision', p.revision,
      'slug', p.slug,
      'isPublished', p.is_published,
      'collections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.source_collection_id,
          'name', c.name,
          'parentId', c.parent_source_collection_id,
          'sortOrder', c.sort_order
        ) order by c.sort_order, c.name)
        from public.published_collections c where c.user_id = v_user_id
      ), '[]'::jsonb),
      'episodes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.source_episode_id,
          'title', e.title,
          'tag', e.tag,
          'sortOrder', e.sort_order
        ) order by e.sort_order, e.title)
        from public.published_episodes e where e.user_id = v_user_id
      ), '[]'::jsonb)
    )
    from public.published_profiles p
    where p.user_id = v_user_id
  );
end;
$$;

create or replace function public.clear_published_library_selection(
  p_collection_ids uuid[] default '{}',
  p_episode_ids uuid[] default '{}',
  p_expected_revision bigint default 0,
  p_clear_all boolean default false
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
  v_removed_collections integer := 0;
  v_removed_episodes integer := 0;
  v_snapshot jsonb;
  v_still_has_content boolean;
begin
  if v_user_id is null then
    raise exception 'Sign in before clearing published content' using errcode = '42501';
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

  if not found then raise exception 'Publisher profile is missing' using errcode = 'P0002'; end if;
  if v_revision <> p_expected_revision then
    raise exception 'The public library changed after this menu opened. Review it again.'
      using errcode = '40001', hint = 'PUBLICATION_STALE';
  end if;

  if p_clear_all then
    select coalesce(array_agg(c.source_collection_id), '{}') into v_collection_ids
    from public.published_collections c where c.user_id = v_user_id;
    select coalesce(array_agg(e.source_episode_id), '{}') into v_episode_ids
    from public.published_episodes e where e.user_id = v_user_id;
  else
    if exists (
      select 1 from unnest(coalesce(p_collection_ids, '{}')) id
      where not exists (
        select 1 from public.published_collections c
        where c.user_id = v_user_id and c.source_collection_id = id
      )
    ) or exists (
      select 1 from unnest(coalesce(p_episode_ids, '{}')) id
      where not exists (
        select 1 from public.published_episodes e
        where e.user_id = v_user_id and e.source_episode_id = id
      )
    ) then raise exception 'The selected published content is invalid' using errcode = '22023'; end if;

    with recursive selected_collections as (
      select c.source_collection_id
      from public.published_collections c
      where c.user_id = v_user_id
        and c.source_collection_id = any(coalesce(p_collection_ids, '{}'))
      union
      select child.source_collection_id
      from public.published_collections child
      join selected_collections parent
        on child.parent_source_collection_id = parent.source_collection_id
      where child.user_id = v_user_id
    )
    select coalesce(array_agg(source_collection_id), '{}') into v_collection_ids
    from selected_collections;
    v_episode_ids := coalesce(p_episode_ids, '{}');
  end if;

  if cardinality(v_collection_ids) = 0 and cardinality(v_episode_ids) = 0 then
    raise exception 'Select at least one published item to clear' using errcode = '22023';
  end if;

  delete from public.published_collection_episodes m
  where m.user_id = v_user_id
    and (m.source_collection_id = any(v_collection_ids) or m.source_episode_id = any(v_episode_ids));

  delete from public.published_collections c
  where c.user_id = v_user_id and c.source_collection_id = any(v_collection_ids);
  get diagnostics v_removed_collections = row_count;

  delete from public.published_episodes e
  where e.user_id = v_user_id and e.source_episode_id = any(v_episode_ids);
  get diagnostics v_removed_episodes = row_count;

  select exists (
    select 1 from public.published_collections c where c.user_id = v_user_id
    union all
    select 1 from public.published_episodes e where e.user_id = v_user_id
  ) into v_still_has_content;

  v_revision := v_revision + 1;
  update public.published_profiles p
  set revision = v_revision,
      is_published = case when p_clear_all or not v_still_has_content then false else p.is_published end,
      published_at = case when p_clear_all or not v_still_has_content then null else now() end
  where p.user_id = v_user_id;

  v_snapshot := private.publication_snapshot(v_user_id);
  insert into public.publication_revisions(user_id, revision, action, snapshot)
  values (v_user_id, v_revision, case when p_clear_all then 'clear_all' else 'clear_selected' end, v_snapshot);

  delete from public.publication_revisions where user_id = v_user_id and expires_at < now();

  return jsonb_build_object(
    'revision', v_revision,
    'slug', v_slug,
    'hidden', p_clear_all or not v_still_has_content,
    'removedCollections', v_removed_collections,
    'removedEpisodes', v_removed_episodes
  );
end;
$$;

revoke execute on function public.get_published_clear_preview() from public, anon;
revoke execute on function public.clear_published_library_selection(uuid[], uuid[], bigint, boolean) from public, anon;
grant execute on function public.get_published_clear_preview() to authenticated;
grant execute on function public.clear_published_library_selection(uuid[], uuid[], bigint, boolean) to authenticated;
