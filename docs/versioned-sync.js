(() => {
  const rootId = 'all';
  const originalDownloadRemoteData = downloadRemoteData;
  const originalPerformAutoSync = performAutoSync;
  const originalRunSync = runSync;
  let syncTail = Promise.resolve();

  function runLocked(task){
    const run = syncTail.then(task,task);
    syncTail = run.catch(() => undefined);
    return run;
  }

  function stable(value){
    return JSON.stringify(value);
  }

  function parentId(item){
    return item.parentId && item.parentId !== rootId ? item.parentId : null;
  }

  function validDate(value){
    const numeric = Number(value);
    const timestamp = Number.isFinite(numeric) && numeric > 1e12
      ? numeric
      : Date.parse(value);
    return new Date(Number.isFinite(timestamp) ? timestamp : 0).toISOString();
  }

  function collectionCanonical(item,index){
    return {
      name:item.name || 'Untitled Collection',
      icon:item.icon || 'library',
      color:item.color || '#5b5ce2',
      parent_id:parentId(item),
      sort_order:index
    };
  }

  function episodeCanonical(ep,index){
    const groups = [...new Set((ep.groups || [])
      .filter(group => group !== rootId && isUuid(group)))]
      .sort();

    return {
      title:ep.title || 'Untitled Episode',
      tag:ep.tag || 'Episode',
      source_type:ep.source === 'online' ? 'online' : ep.source || 'local',
      spotify_url:ep.url || null,
      spotify_embed_url:ep.embed || null,
      artwork_path:ep.artworkPath || null,
      artwork_url:ep.artSource === 'spotify' ? ep.artImage || null : null,
      audio_path:ep.audioPath || ep.onlinePath || null,
      original_filename:ep.localName || ep.onlineName || null,
      duration_ms:Number(ep.durationMs) || null,
      position_ms:Math.round(Number(ep.positionMs) || 0),
      progress_percent:Number(ep.progress) || 0,
      finished:Number(ep.progress) >= 98,
      time_label:normalizeTimeLabel(ep.timeLabel || ep.time),
      saved_at:validDate(ep.savedAt),
      spotify_id:ep.spotifyId || null,
      spotify_saved:typeof ep.spotifySaved === 'boolean' ? ep.spotifySaved : null,
      spotify_saved_at:ep.spotifySavedAt || null,
      spotify_last_synced_at:ep.spotifyLastSyncedAt || null,
      spotify_duration_ms:Number(ep.spotifyDurationMs) || null,
      sort_order:index,
      group_ids:groups
    };
  }

  function withoutSort(row){
    if(!row) return row;
    const copy = {...row};
    delete copy.sort_order;
    return copy;
  }

  function tombstones(){
    state.syncTombstones ||= {collections:{},episodes:{}};
    state.syncTombstones.collections ||= {};
    state.syncTombstones.episodes ||= {};
    return state.syncTombstones;
  }

  function registerDeletion(type,item){
    if(!item || !isUuid(item.id)) return;
    const version = Number(item._version) || 0;
    if(version > 0) tombstones()[type][item.id] = version;
  }

  async function fetchRemoteSnapshot(){
    const userId = currentUser.id;
    const [collectionsResult,episodesResult,relationsResult] = await Promise.all([
      db().from('collections').select('*').eq('user_id',userId).is('deleted_at',null),
      db().from('episodes').select('*').eq('user_id',userId).is('deleted_at',null),
      db().from('collection_episodes').select('collection_id,episode_id,position')
    ]);
    for(const result of [collectionsResult,episodesResult,relationsResult]){
      if(result.error) throw result.error;
    }

    const relationMap = new Map();
    for(const row of relationsResult.data || []){
      if(!relationMap.has(row.episode_id)) relationMap.set(row.episode_id,[]);
      relationMap.get(row.episode_id).push(row.collection_id);
    }

    const collections = new Map((collectionsResult.data || []).map(row => [
      row.id,
      {
        version:Number(row.version) || 1,
        canonical:{
          name:row.name,
          icon:row.icon,
          color:row.color,
          parent_id:row.parent_id || null,
          sort_order:Number(row.sort_order ?? row.position) || 0
        }
      }
    ]));

    const episodes = new Map((episodesResult.data || []).map(row => [
      row.id,
      {
        version:Number(row.version) || 1,
        canonical:{
          title:row.title,
          tag:row.tag || 'Episode',
          source_type:row.source_type || 'local',
          spotify_url:row.spotify_url || null,
          spotify_embed_url:row.spotify_embed_url || null,
          artwork_path:row.artwork_path || null,
          artwork_url:row.artwork_url || null,
          audio_path:row.audio_path || null,
          original_filename:row.original_filename || null,
          duration_ms:row.duration_ms === null ? null : Number(row.duration_ms),
          position_ms:Number(row.position_ms) || 0,
          progress_percent:Number(row.progress_percent) || 0,
          finished:Boolean(row.finished),
          time_label:normalizeTimeLabel(row.time_label),
          saved_at:new Date(row.saved_at).toISOString(),
          spotify_id:row.spotify_id || null,
          spotify_saved:typeof row.spotify_saved === 'boolean' ? row.spotify_saved : null,
          spotify_saved_at:row.spotify_saved_at || null,
          spotify_last_synced_at:row.spotify_last_synced_at || null,
          spotify_duration_ms:row.spotify_duration_ms === null ? null : Number(row.spotify_duration_ms),
          sort_order:Number(row.sort_order) || 0,
          group_ids:(relationMap.get(row.id) || []).sort()
        }
      }
    ]));

    return {collections,episodes};
  }

  async function ensureBaselines(){
    if(!currentUser) throw new Error('Sign in with Google first');
    const missing = state.collections.some(item =>
      item.id !== rootId && (!item._syncBase || !Number(item._version))
    ) || state.episodes.some(ep => !ep._syncBase || !Number(ep._version));
    if(!missing) return;

    const remote = await fetchRemoteSnapshot();
    state.collections.forEach(item => {
      if(item.id === rootId || (item._syncBase && Number(item._version))) return;
      const record = remote.collections.get(item.id);
      item._version = record?.version || 0;
      item._syncBase = record?.canonical || null;
    });
    state.episodes.forEach(ep => {
      if(ep._syncBase && Number(ep._version)) return;
      const record = remote.episodes.get(ep.id);
      ep._version = record?.version || 0;
      ep._syncBase = record?.canonical || null;
    });
    saveState(false);
  }

  function pendingChanges(){
    const collectionUpserts = [];
    const collectionOrder = [];
    const episodeUpserts = [];
    const episodeOrder = [];

    state.collections.forEach((item,index) => {
      if(item.id === rootId) return;
      const current = collectionCanonical(item,index);
      const base = item._syncBase;
      if(base && stable(current) === stable(base)) return;
      const expected_version = Number(item._version) || 0;
      if(base && stable(withoutSort(current)) === stable(withoutSort(base))){
        collectionOrder.push({id:item.id,expected_version,sort_order:current.sort_order});
      }else{
        collectionUpserts.push({id:item.id,expected_version,...current});
      }
    });

    state.episodes.forEach((ep,index) => {
      const current = episodeCanonical(ep,index);
      const base = ep._syncBase;
      if(base && stable(current) === stable(base)) return;
      const expected_version = Number(ep._version) || 0;
      if(base && stable(withoutSort(current)) === stable(withoutSort(base))){
        episodeOrder.push({id:ep.id,expected_version,sort_order:current.sort_order});
      }else{
        episodeUpserts.push({id:ep.id,expected_version,...current});
      }
    });

    const deleted = tombstones();
    return {
      collectionUpserts:sortCollectionsParentFirst(collectionUpserts),
      episodeUpserts,
      collectionOrder,
      episodeOrder,
      collectionDeletes:Object.entries(deleted.collections).map(([id,expected_version]) => ({id,expected_version})),
      episodeDeletes:Object.entries(deleted.episodes).map(([id,expected_version]) => ({id,expected_version}))
    };
  }

  function sortCollectionsParentFirst(rows){
    const byId = new Map(rows.map(row => [row.id,row]));
    const sorted = [];
    const pending = new Set(byId.keys());
    while(pending.size){
      let advanced = false;
      for(const id of [...pending]){
        const row = byId.get(id);
        if(!row.parent_id || !pending.has(row.parent_id)){
          sorted.push(row);
          pending.delete(id);
          advanced = true;
        }
      }
      if(!advanced) throw new Error('Collection nesting contains a cycle');
    }
    return sorted;
  }

  function hasChanges(changes){
    return Object.values(changes).some(items => items.length > 0);
  }

  function applyResults(changes,result){
    const collectionVersions = new Map((result.collections || []).map(row => [row.id,Number(row.version)]));
    const episodeVersions = new Map((result.episodes || []).map(row => [row.id,Number(row.version)]));

    state.collections.forEach((item,index) => {
      if(item.id === rootId || !collectionVersions.has(item.id)) return;
      item._version = collectionVersions.get(item.id);
      item._syncBase = collectionCanonical(item,index);
    });
    state.episodes.forEach((ep,index) => {
      if(!episodeVersions.has(ep.id)) return;
      ep._version = episodeVersions.get(ep.id);
      ep._syncBase = episodeCanonical(ep,index);
      ep.syncStatus = 'synced';
    });

    for(const row of changes.collectionDeletes) delete tombstones().collections[row.id];
    for(const row of changes.episodeDeletes) delete tombstones().episodes[row.id];
    localStorage.setItem(DIRTY_KEY,'false');
    saveState(false);
  }

  uploadLocalData = async function(){
    if(!currentUser) throw new Error('Sign in with Google first');
    normalizeIds();
    await ensureBaselines();
    const changes = pendingChanges();
    if(!hasChanges(changes)){
      localStorage.setItem(DIRTY_KEY,'false');
      saveState(false);
      return;
    }

    const {data,error} = await db().rpc('sync_media_changes',{
      p_collection_upserts:changes.collectionUpserts,
      p_episode_upserts:changes.episodeUpserts,
      p_collection_order:changes.collectionOrder,
      p_episode_order:changes.episodeOrder,
      p_collection_deletes:changes.collectionDeletes,
      p_episode_deletes:changes.episodeDeletes
    });
    if(error){
      if(error.code === '40001'){
        throw new Error('Sync conflict: newer cloud changes exist. Reload before trying again.');
      }
      throw error;
    }
    applyResults(changes,data || {});
  };

  downloadRemoteData = async function(){
    const downloaded = await originalDownloadRemoteData();
    if(!currentUser || downloaded === false) return downloaded;
    const remote = await fetchRemoteSnapshot();
    state.collections.forEach(item => {
      if(item.id === rootId) return;
      const record = remote.collections.get(item.id);
      item._version = record?.version || 0;
      item._syncBase = record?.canonical || null;
      item.sortOrder = record?.canonical.sort_order ?? 0;
    });
    state.episodes.forEach(ep => {
      const record = remote.episodes.get(ep.id);
      ep._version = record?.version || 0;
      ep._syncBase = record?.canonical || null;
      ep.sortOrder = record?.canonical.sort_order ?? 0;
    });
    state.syncTombstones = {collections:{},episodes:{}};
    localStorage.setItem(DIRTY_KEY,'false');
    saveState(false);
    return downloaded;
  };

  syncData = async function(){
    if(!currentUser) throw new Error('Sign in with Google first');
    const dirty = localStorage.getItem(DIRTY_KEY) === 'true';
    const hasBaseline = state.collections.some(item => item.id !== rootId && item._syncBase) ||
      state.episodes.some(ep => ep._syncBase);
    if(!dirty && !hasBaseline) return downloadRemoteData();
    if(dirty){
      await ensureBaselines();
      return uploadLocalData();
    }
    const changes = pendingChanges();
    return hasChanges(changes) ? uploadLocalData() : downloadRemoteData();
  };

  performAutoSync = function(options){
    return runLocked(() => originalPerformAutoSync(options));
  };

  runSync = function(type,quiet=false){
    return runLocked(() => originalRunSync(type,quiet));
  };

  window.mediaSync = {
    runLocked,
    registerCollectionDeletion:item => registerDeletion('collections',item),
    registerEpisodeDeletion:item => registerDeletion('episodes',item),
    pendingChanges
  };
})();
