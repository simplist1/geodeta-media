-- Let the preview run with caller permissions; keep only the atomic writer privileged.

create index if not exists published_collection_episodes_episode_idx
  on public.published_collection_episodes(user_id, source_episode_id);

grant select on table public.publication_revisions to authenticated;

drop policy if exists "Publisher can read own public profile" on public.published_profiles;
create policy "Publisher can read own public profile"
on public.published_profiles for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Publisher can read own public collections" on public.published_collections;
create policy "Publisher can read own public collections"
on public.published_collections for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Publisher can read own public episodes" on public.published_episodes;
create policy "Publisher can read own public episodes"
on public.published_episodes for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Publisher can read own public memberships" on public.published_collection_episodes;
create policy "Publisher can read own public memberships"
on public.published_collection_episodes for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Publisher can read own revision history" on public.publication_revisions;
create policy "Publisher can read own revision history"
on public.publication_revisions for select to authenticated
using ((select auth.uid()) = user_id);

alter function public.get_publication_preview(uuid) security invoker;

