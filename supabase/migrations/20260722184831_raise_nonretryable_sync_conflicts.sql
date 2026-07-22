create or replace function public.sync_media_changes(
  p_collection_upserts jsonb default '[]'::jsonb,
  p_episode_upserts jsonb default '[]'::jsonb,
  p_collection_order jsonb default '[]'::jsonb,
  p_episode_order jsonb default '[]'::jsonb,
  p_collection_deletes jsonb default '[]'::jsonb,
  p_episode_deletes jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  item jsonb;
  v_id uuid;
  v_expected bigint;
  v_version bigint;
  v_updated_at timestamptz;
  v_collections jsonb := '[]'::jsonb;
  v_episodes jsonb := '[]'::jsonb;
  v_conflict jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));

  select jsonb_build_object(
    'type','collection',
    'id',request.id,
    'expected_version',request.expected_version,
    'current_version',record.version
  )
  into v_conflict
  from (
    select
      (value->>'id')::uuid as id,
      coalesce((value->>'expected_version')::bigint,0) as expected_version
    from jsonb_array_elements(coalesce(p_collection_upserts,'[]'::jsonb))
    union all
    select
      (value->>'id')::uuid,
      (value->>'expected_version')::bigint
    from jsonb_array_elements(coalesce(p_collection_order,'[]'::jsonb))
    union all
    select
      (value->>'id')::uuid,
      (value->>'expected_version')::bigint
    from jsonb_array_elements(coalesce(p_collection_deletes,'[]'::jsonb))
  ) request
  left join public.collections record
    on record.id = request.id
   and record.user_id = v_uid
   and record.deleted_at is null
  where
    (request.expected_version = 0 and record.id is not null)
    or
    (request.expected_version > 0 and (
      record.id is null or record.version <> request.expected_version
    ))
  limit 1;

  if v_conflict is not null then
    raise exception 'Collection % has a newer version',v_conflict->>'id'
      using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'type','episode',
    'id',request.id,
    'expected_version',request.expected_version,
    'current_version',record.version
  )
  into v_conflict
  from (
    select
      (value->>'id')::uuid as id,
      coalesce((value->>'expected_version')::bigint,0) as expected_version
    from jsonb_array_elements(coalesce(p_episode_upserts,'[]'::jsonb))
    union all
    select
      (value->>'id')::uuid,
      (value->>'expected_version')::bigint
    from jsonb_array_elements(coalesce(p_episode_order,'[]'::jsonb))
    union all
    select
      (value->>'id')::uuid,
      (value->>'expected_version')::bigint
    from jsonb_array_elements(coalesce(p_episode_deletes,'[]'::jsonb))
  ) request
  left join public.episodes record
    on record.id = request.id
   and record.user_id = v_uid
   and record.deleted_at is null
  where
    (request.expected_version = 0 and record.id is not null)
    or
    (request.expected_version > 0 and (
      record.id is null or record.version <> request.expected_version
    ))
  limit 1;

  if v_conflict is not null then
    raise exception 'Episode % has a newer version',v_conflict->>'id'
      using errcode = 'P0001';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_collection_upserts,'[]'::jsonb))
  loop
    v_id := (item->>'id')::uuid;
    v_expected := coalesce((item->>'expected_version')::bigint,0);
    v_version := null;
    v_updated_at := null;

    if v_expected = 0 then
      insert into public.collections (
        id,user_id,name,icon,color,parent_id,position,sort_order,version,deleted_at
      ) values (
        v_id,v_uid,item->>'name',coalesce(item->>'icon','library'),
        coalesce(item->>'color','#5b5ce2'),nullif(item->>'parent_id','')::uuid,
        coalesce((item->>'sort_order')::integer,0),
        coalesce((item->>'sort_order')::bigint,0),1,null
      )
      on conflict (id) do nothing
      returning version,updated_at into v_version,v_updated_at;
    else
      update public.collections
      set name = item->>'name',
          icon = coalesce(item->>'icon','library'),
          color = coalesce(item->>'color','#5b5ce2'),
          parent_id = nullif(item->>'parent_id','')::uuid,
          position = coalesce((item->>'sort_order')::integer,position),
          sort_order = coalesce((item->>'sort_order')::bigint,sort_order),
          version = version + 1,
          deleted_at = null
      where id = v_id and user_id = v_uid and version = v_expected and deleted_at is null
      returning version,updated_at into v_version,v_updated_at;
    end if;

    if v_version is null then
      raise exception 'Collection % has a newer version',v_id using errcode = 'P0001';
    end if;
    v_collections := v_collections || jsonb_build_array(jsonb_build_object(
      'id',v_id,'version',v_version,'updated_at',v_updated_at
    ));
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_episode_upserts,'[]'::jsonb))
  loop
    v_id := (item->>'id')::uuid;
    v_expected := coalesce((item->>'expected_version')::bigint,0);
    v_version := null;
    v_updated_at := null;

    if v_expected = 0 then
      insert into public.episodes (
        id,user_id,title,tag,source_type,spotify_url,spotify_embed_url,
        artwork_path,artwork_url,audio_path,original_filename,duration_ms,
        position_ms,progress_percent,finished,time_label,saved_at,
        spotify_id,spotify_saved,spotify_saved_at,spotify_last_synced_at,
        spotify_duration_ms,sort_order,version,deleted_at
      ) values (
        v_id,v_uid,item->>'title',coalesce(item->>'tag','Episode'),
        coalesce(item->>'source_type','local'),item->>'spotify_url',
        item->>'spotify_embed_url',item->>'artwork_path',item->>'artwork_url',
        item->>'audio_path',item->>'original_filename',
        nullif(item->>'duration_ms','')::bigint,
        coalesce((item->>'position_ms')::bigint,0),
        coalesce((item->>'progress_percent')::numeric,0),
        coalesce((item->>'finished')::boolean,false),
        coalesce(item->>'time_label','—'),
        coalesce((item->>'saved_at')::timestamptz,now()),
        item->>'spotify_id',nullif(item->>'spotify_saved','')::boolean,
        nullif(item->>'spotify_saved_at','')::timestamptz,
        nullif(item->>'spotify_last_synced_at','')::timestamptz,
        nullif(item->>'spotify_duration_ms','')::integer,
        coalesce((item->>'sort_order')::bigint,0),1,null
      )
      on conflict (id) do nothing
      returning version,updated_at into v_version,v_updated_at;
    else
      update public.episodes
      set title = item->>'title',
          tag = coalesce(item->>'tag','Episode'),
          source_type = coalesce(item->>'source_type','local'),
          spotify_url = item->>'spotify_url',
          spotify_embed_url = item->>'spotify_embed_url',
          artwork_path = item->>'artwork_path',
          artwork_url = item->>'artwork_url',
          audio_path = item->>'audio_path',
          original_filename = item->>'original_filename',
          duration_ms = nullif(item->>'duration_ms','')::bigint,
          position_ms = coalesce((item->>'position_ms')::bigint,0),
          progress_percent = coalesce((item->>'progress_percent')::numeric,0),
          finished = coalesce((item->>'finished')::boolean,false),
          time_label = coalesce(item->>'time_label','—'),
          saved_at = coalesce((item->>'saved_at')::timestamptz,saved_at),
          spotify_id = item->>'spotify_id',
          spotify_saved = nullif(item->>'spotify_saved','')::boolean,
          spotify_saved_at = nullif(item->>'spotify_saved_at','')::timestamptz,
          spotify_last_synced_at = nullif(item->>'spotify_last_synced_at','')::timestamptz,
          spotify_duration_ms = nullif(item->>'spotify_duration_ms','')::integer,
          sort_order = coalesce((item->>'sort_order')::bigint,sort_order),
          version = version + 1,
          deleted_at = null
      where id = v_id and user_id = v_uid and version = v_expected and deleted_at is null
      returning version,updated_at into v_version,v_updated_at;
    end if;

    if v_version is null then
      raise exception 'Episode % has a newer version',v_id using errcode = 'P0001';
    end if;

    delete from public.collection_episodes where episode_id = v_id;
    insert into public.collection_episodes (collection_id,episode_id,position)
    select c.id,v_id,(g.ordinality - 1)::integer
    from jsonb_array_elements_text(coalesce(item->'group_ids','[]'::jsonb))
      with ordinality as g(collection_id,ordinality)
    join public.collections c
      on c.id = g.collection_id::uuid
     and c.user_id = v_uid
     and c.deleted_at is null
    on conflict (collection_id,episode_id)
    do update set position = excluded.position;

    v_episodes := v_episodes || jsonb_build_array(jsonb_build_object(
      'id',v_id,'version',v_version,'updated_at',v_updated_at
    ));
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_collection_order,'[]'::jsonb))
  loop
    v_id := (item->>'id')::uuid;
    v_expected := (item->>'expected_version')::bigint;
    v_version := null;
    update public.collections
    set position = (item->>'sort_order')::integer,
        sort_order = (item->>'sort_order')::bigint,
        version = version + 1
    where id = v_id and user_id = v_uid and version = v_expected and deleted_at is null
    returning version,updated_at into v_version,v_updated_at;
    if v_version is null then
      raise exception 'Collection % has a newer version',v_id using errcode = 'P0001';
    end if;
    v_collections := v_collections || jsonb_build_array(jsonb_build_object(
      'id',v_id,'version',v_version,'updated_at',v_updated_at
    ));
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_episode_order,'[]'::jsonb))
  loop
    v_id := (item->>'id')::uuid;
    v_expected := (item->>'expected_version')::bigint;
    v_version := null;
    update public.episodes
    set sort_order = (item->>'sort_order')::bigint,
        version = version + 1
    where id = v_id and user_id = v_uid and version = v_expected and deleted_at is null
    returning version,updated_at into v_version,v_updated_at;
    if v_version is null then
      raise exception 'Episode % has a newer version',v_id using errcode = 'P0001';
    end if;
    v_episodes := v_episodes || jsonb_build_array(jsonb_build_object(
      'id',v_id,'version',v_version,'updated_at',v_updated_at
    ));
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_episode_deletes,'[]'::jsonb))
  loop
    v_id := (item->>'id')::uuid;
    v_expected := (item->>'expected_version')::bigint;
    v_version := null;
    delete from public.collection_episodes where episode_id = v_id;
    update public.episodes
    set deleted_at = now(),version = version + 1
    where id = v_id and user_id = v_uid and version = v_expected and deleted_at is null
    returning version,updated_at into v_version,v_updated_at;
    if v_version is null then
      raise exception 'Episode % has a newer version',v_id using errcode = 'P0001';
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_collection_deletes,'[]'::jsonb))
  loop
    v_id := (item->>'id')::uuid;
    v_expected := (item->>'expected_version')::bigint;
    if exists (
      select 1 from public.collections child
      where child.parent_id = v_id
        and child.user_id = v_uid
        and child.deleted_at is null
        and not exists (
          select 1
          from jsonb_array_elements(coalesce(p_collection_deletes,'[]'::jsonb)) deletion
          where (deletion->>'id')::uuid = child.id
        )
    ) then
      raise exception 'Collection % still has active children',v_id using errcode = '23503';
    end if;

    v_version := null;
    delete from public.collection_episodes where collection_id = v_id;
    update public.collections
    set deleted_at = now(),version = version + 1
    where id = v_id and user_id = v_uid and version = v_expected and deleted_at is null
    returning version,updated_at into v_version,v_updated_at;
    if v_version is null then
      raise exception 'Collection % has a newer version',v_id using errcode = 'P0001';
    end if;
  end loop;

  return jsonb_build_object(
    'collections',v_collections,
    'episodes',v_episodes,
    'synced_at',now()
  );
end;
$$;

revoke all on function public.sync_media_changes(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.sync_media_changes(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

comment on function public.sync_media_changes(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
is 'Atomically syncs versioned media changes for auth.uid(); order-only updates never modify collection parent_id.';
