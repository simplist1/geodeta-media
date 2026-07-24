(() => {
  const rootId = 'all';
  const originalDownloadRemoteData = downloadRemoteData;
  const originalPerformAutoSync = performAutoSync;
  const originalRunSync = runSync;
  let syncTail = Promise.resolve();
  let syncConflict = null;
  let autoSyncPromise = null;
  let autoSyncPending = false;
  let autoSyncIncludeFiles = false;

  function runLocked(task){
    const execute = () => syncConflict ? undefined : task();
    const run = syncTail.then(execute,execute);
    syncTail = run.catch(() => undefined);
    return run;
  }

  function conflictFrom(error,data){
    if(data?.conflict) return data.conflict;
    const message = error?.message || '';
    if(
      error?.code !== '40001' &&
      error?.code !== 'P0001' &&
      !/has a newer version/i.test(message)
    ) return null;
    const match = message.match(/(Collection|Episode) ([0-9a-f-]+) has a newer version/i);
    return match
      ? {type:match[1].toLowerCase(),id:match[2]}
      : {type:'record',id:null};
  }

  function conflictError(conflict){
    const label = conflict?.type && conflict.type !== 'record'
      ? `${conflict.type} ${conflict.id || ''}`.trim()
      : 'record';
    const error = new Error(
      `Sync paused: the cloud has a newer copy of this ${label}. Your local changes were kept.`
    );
    error.code = 'SYNC_CONFLICT';
    error.conflict = conflict;
    return error;
  }

  const CONFLICT_BACKUP_KEY = 'geodetaSyncConflictBackups';
  const MAX_CONFLICT_BACKUPS = 20;
  const MAX_CONFLICT_REBASE_RETRIES = 3;

  function sameValue(left,right){
    return stable(left) === stable(right);
  }

  function mergeCanonical(base,local,cloud){
    const merged = {...cloud};
    const collisions = [];
    const keys = new Set([
      ...Object.keys(base || {}),
      ...Object.keys(local || {}),
      ...Object.keys(cloud || {})
    ]);

    for(const key of keys){
      if(key === 'sort_order'){
        merged.sort_order = local.sort_order;
        continue;
      }
      const localChanged = !sameValue(local[key],base[key]);
      const cloudChanged = !sameValue(cloud[key],base[key]);
      if(!localChanged) continue;
      merged[key] = local[key];
      if(cloudChanged && !sameValue(local[key],cloud[key])) collisions.push(key);
    }
    return {merged,collisions};
  }

  function saveConflictBackup(type,id,fields,base,local,cloud){
    try{
      const backups = JSON.parse(localStorage.getItem(CONFLICT_BACKUP_KEY) || '[]');
      backups.unshift({
        type,
        id,
        fields,
        detectedAt:new Date().toISOString(),
        base,
        local,
        cloud
      });
      localStorage.setItem(
        CONFLICT_BACKUP_KEY,
        JSON.stringify(backups.slice(0,MAX_CONFLICT_BACKUPS))
      );
    }catch(error){
      console.warn('Could not save sync conflict backup',error);
    }
  }

  function applyCollectionCanonical(item,canonical){
    item.name = canonical.name;
    item.icon = canonical.icon;
    item.color = canonical.color;
    item.parentId = canonical.parent_id || rootId;
  }

  function applyEpisodeCanonical(ep,canonical){
    ep.title = canonical.title;
    ep.tag = canonical.tag;
    ep.source = canonical.source_type;
    ep.url = canonical.spotify_url || '';
    ep.embed = canonical.spotify_embed_url || '';
    ep.artworkPath = canonical.artwork_path || null;
    ep.artImage = canonical.artwork_url || '';
    ep.artSource = canonical.artwork_url
      ? 'spotify'
      : canonical.artwork_path ? 'custom' : 'default';
    ep.audioPath = canonical.audio_path || null;
    ep.onlinePath = canonical.source_type === 'online' ? canonical.audio_path || null : null;
    ep.localName = canonical.source_type === 'online' ? null : canonical.original_filename || null;
    ep.onlineName = canonical.source_type === 'online' ? canonical.original_filename || null : null;
    ep.durationMs = canonical.duration_ms;
    ep.positionMs = canonical.position_ms;
    ep.progress = canonical.progress_percent;
    ep.finished = Boolean(canonical.finished);
    ep.timeLabel = canonical.time_label;
    ep.savedAt = Date.parse(canonical.saved_at) || 0;
    ep.spotifyId = canonical.spotify_id;
    ep.spotifySaved = canonical.spotify_saved;
    ep.spotifySavedAt = canonical.spotify_saved_at;
    ep.spotifyLastSyncedAt = canonical.spotify_last_synced_at;
    ep.spotifyDurationMs = canonical.spotify_duration_ms;
    ep.groups = [rootId,...canonical.group_ids];
  }

  async function resolveConflict(conflict){
    if(!conflict?.id || !['collection','episode'].includes(conflict.type)) return false;
    const remote = await fetchRemoteSnapshot();
    let targetResolved = false;
    let changed = false;

    for(const [type,items,records,canonicalFor,applyCanonical] of [
      ['collection',state.collections,remote.collections,collectionCanonical,applyCollectionCanonical],
      ['episode',state.episodes,remote.episodes,episodeCanonical,applyEpisodeCanonical]
    ]){
      items.forEach((item,index) => {
        if(type === 'collection' && item.id === rootId) return;
        const record = records.get(item.id);
        const isTarget = type === conflict.type && item.id === conflict.id;

        if(!record){
          if(isTarget && type === 'episode' && Number(item._version) > 0){
            item._syncConflict = {
              reason:'deleted_in_cloud',
              detectedAt:new Date().toISOString()
            };
            item.syncStatus = 'error';
            targetResolved = true;
            changed = true;
          }
          return;
        }
        if(record.version <= (Number(item._version) || 0)) return;
        if(!item._syncBase) return;

        const local = canonicalFor(item,index);
        const {merged,collisions} = mergeCanonical(item._syncBase,local,record.canonical);
        if(collisions.length){
          saveConflictBackup(
            type,
            item.id,
            collisions,
            item._syncBase,
            local,
            record.canonical
          );
        }
        applyCanonical(item,merged);
        delete item._syncConflict;
        item._version = record.version;
        item._syncBase = record.canonical;
        if(type === 'episode') item.syncStatus = 'pending';
        if(isTarget) targetResolved = true;
        changed = true;
      });
    }

    if(changed){
      syncConflict = null;
      saveState(false);
    }
    return targetResolved;
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
      if(item.id === rootId || item._syncConflict) return;
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
      if(ep._syncConflict) return;
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

  uploadLocalData = async function(conflictRetries=0){
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
    const conflict = conflictFrom(error,data);
    if(conflict){
      if(
        conflictRetries < MAX_CONFLICT_REBASE_RETRIES &&
        await resolveConflict(conflict)
      ){
        return uploadLocalData(conflictRetries + 1);
      }
      syncConflict = conflictError(conflict);
      throw syncConflict;
    }
    if(error) throw error;
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
    syncConflict = null;
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

  performAutoSync = function(options={}){
    autoSyncPending = true;
    autoSyncIncludeFiles ||= Boolean(options.includeFiles);
    if(autoSyncPromise) return autoSyncPromise;

    autoSyncPromise = runLocked(async () => {
      do{
        autoSyncPending = false;
        const includeFiles = autoSyncIncludeFiles;
        autoSyncIncludeFiles = false;
        await originalPerformAutoSync({includeFiles});
      }while(autoSyncPending && !syncConflict);
    }).finally(() => {
      autoSyncPromise = null;
    });
    return autoSyncPromise;
  };

  runSync = function(type,quiet=false){
    if(!quiet) syncConflict = null;
    return runLocked(() => originalRunSync(type,quiet));
  };

  window.mediaSync = {
    runLocked,
    clearConflict:() => { syncConflict = null; },
    hasConflict:() => Boolean(syncConflict),
    registerCollectionDeletion:item => registerDeletion('collections',item),
    registerEpisodeDeletion:item => registerDeletion('episodes',item),
    pendingChanges
  };
})();
