-- Return structured health rows from the Developer Hub checker.

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
      select jsonb_agg(to_jsonb(checks) order by severity desc, label)
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
          and (e.spotify_url is null or e.spotify_url !~ '^https://open[.]spotify[.]com/')
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

revoke execute on function public.get_developer_publication_health(uuid) from public, anon;
grant execute on function public.get_developer_publication_health(uuid) to authenticated;
