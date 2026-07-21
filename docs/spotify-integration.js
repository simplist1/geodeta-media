(() => {
  const SPOTIFY_SCOPES = [
    'user-read-playback-position',
    'user-read-playback-state',
    'user-library-read'
  ].join(' ');
  const SPOTIFY_CALLBACK_PARAM = 'spotify_callback';
  const SPOTIFY_PENDING_KEY = 'geodetaSpotifyLinkPending';
  const SPOTIFY_ROOT_NAME = 'Spotify';
  const SPOTIFY_SAVED_NAME = 'Saved Episodes';

  let spotifyBusy = false;
  let spotifyConnected = false;
  let spotifyIdentity = null;
  let captureRunning = false;

  const client = () => window.supabaseClient;
  const refreshLucide = () => window.lucide?.createIcons();

  function callbackRequested(){
    return new URL(window.location.href).searchParams.get(SPOTIFY_CALLBACK_PARAM) === '1' ||
      sessionStorage.getItem(SPOTIFY_PENDING_KEY) === 'true';
  }

  function cleanCallbackUrl(){
    const url = new URL(window.location.href);
    if(!url.searchParams.has(SPOTIFY_CALLBACK_PARAM)) return;
    url.searchParams.delete(SPOTIFY_CALLBACK_PARAM);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function parseSpotifyId(url=''){
    try{
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const episodeIndex = parts.indexOf('episode');
      return episodeIndex >= 0 ? parts[episodeIndex + 1] || '' : '';
    }catch{
      const match = String(url).match(/spotify:episode:([A-Za-z0-9]+)/);
      return match?.[1] || '';
    }
  }

  function formatClock(milliseconds){
    const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`
      : `${minutes}:${String(seconds).padStart(2,'0')}`;
  }

  function formatDurationLabel(milliseconds){
    const seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
    if(!seconds) return '—';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours ? `${hours}h ${String(minutes).padStart(2,'0')}m` : `${Math.max(1, minutes)} min`;
  }

  async function invokeSpotify(body){
    const supabase = client();
    if(!supabase) throw new Error('Supabase is not ready');
    const {data,error} = await supabase.functions.invoke('spotify-sync',{body});
    if(error){
      let message = error.message || 'Spotify request failed';
      try{
        const response = error.context;
        if(response?.clone){
          const detail = await response.clone().json();
          message = detail?.error || message;
          if(detail?.code) error.code = detail.code;
        }
      }catch{}
      const wrapped = new Error(message);
      wrapped.code = error.code;
      throw wrapped;
    }
    if(data?.error){
      const wrapped = new Error(data.error);
      wrapped.code = data.code;
      throw wrapped;
    }
    return data || {};
  }

  function spotifySettingsCopy(){
    return document.querySelector('#spotifyLink')?.closest('.settings-row')?.querySelector('.settings-copy span');
  }

  function setSpotifyButtonState({identity=false,connected=false,needsSetup=false,busy=false}={}){
    const button = document.querySelector('#spotifyLink');
    if(!button) return;
    spotifyConnected = connected;
    button.disabled = busy;
    button.classList.toggle('unlink', connected);
    button.classList.toggle('spotify-linked', connected);
    button.classList.toggle('spotify-needs-setup', needsSetup && !connected);
    button.innerHTML = busy
      ? '<i data-lucide="loader-circle"></i> Working…'
      : connected
        ? 'Unlink'
        : identity
          ? 'Reconnect'
          : 'Link to Spotify';

    const copy = spotifySettingsCopy();
    if(copy){
      copy.textContent = connected
        ? 'Saved episodes and listening positions are connected.'
        : needsSetup
          ? 'Spotify is linked, but the secure server connection needs attention.'
          : 'Import saved episodes and sync listening positions.';
    }
    refreshLucide();
  }

  async function getSpotifyIdentity(){
    const supabase = client();
    if(!supabase) return null;
    const {data,error} = await supabase.auth.getUserIdentities();
    if(error) return null;
    return data?.identities?.find(identity => identity.provider === 'spotify') || null;
  }

  async function updateSpotifyStatus(){
    if(!currentUser){
      spotifyIdentity = null;
      setSpotifyButtonState();
      return {identity:false,connected:false};
    }

    spotifyIdentity = await getSpotifyIdentity();
    let status = {connected:false};
    try{
      status = await invokeSpotify({action:'status'});
    }catch(error){
      console.warn('Spotify status check failed',error);
    }

    setSpotifyButtonState({
      identity:Boolean(spotifyIdentity),
      connected:Boolean(spotifyIdentity && status.connected),
      needsSetup:Boolean(spotifyIdentity && !status.connected),
    });
    return {identity:Boolean(spotifyIdentity),connected:Boolean(spotifyIdentity && status.connected)};
  }

  async function captureSpotifySession(session){
    if(captureRunning || !callbackRequested() || !session?.provider_token) return false;
    captureRunning = true;
    try{
      setSpotifyButtonState({identity:true,busy:true});
      await invokeSpotify({
        action:'store',
        accessCredential:session.provider_token,
        refreshCredential:session.provider_refresh_token || '',
        expiresIn:3600,
        scope:SPOTIFY_SCOPES,
      });
      sessionStorage.removeItem(SPOTIFY_PENDING_KEY);
      cleanCallbackUrl();
      showToast('Spotify linked');
      await updateSpotifyStatus();
      await syncSpotifyEpisodes({quiet:true});
      return true;
    }catch(error){
      console.error('Spotify token handoff failed',error);
      const missingSecrets = error.code === 'spotify_secrets_missing' || /secrets are not configured/i.test(error.message);
      setSpotifyButtonState({identity:true,connected:false,needsSetup:true});
      showToast(missingSecrets ? 'Add Spotify server secrets, then relink' : error.message || 'Spotify linking failed');
      return false;
    }finally{
      captureRunning = false;
    }
  }

  async function startSpotifyLink(){
    if(!currentUser){
      showToast('Sign in with Google first');
      return;
    }
    const supabase = client();
    if(!supabase) return;

    setSpotifyButtonState({identity:Boolean(spotifyIdentity),busy:true});
    try{
      if(spotifyIdentity){
        await supabase.auth.unlinkIdentity(spotifyIdentity);
        spotifyIdentity = null;
      }
      sessionStorage.setItem(SPOTIFY_PENDING_KEY,'true');
      const {error} = await supabase.auth.linkIdentity({
        provider:'spotify',
        options:{
          redirectTo:'https://media.geodeta.us/?spotify_callback=1',
          scopes:SPOTIFY_SCOPES,
          queryParams:{show_dialog:'true'},
        },
      });
      if(error) throw error;
    }catch(error){
      sessionStorage.removeItem(SPOTIFY_PENDING_KEY);
      console.error(error);
      showToast(error.message || 'Spotify linking failed');
      await updateSpotifyStatus();
    }
  }

  async function disconnectSpotify(){
    if(!currentUser) return;
    setSpotifyButtonState({identity:true,connected:true,busy:true});
    try{
      await invokeSpotify({action:'disconnect'});
      const identity = spotifyIdentity || await getSpotifyIdentity();
      if(identity){
        const {error} = await client().auth.unlinkIdentity(identity);
        if(error) throw error;
      }
      spotifyIdentity = null;
      spotifyConnected = false;
      showToast('Spotify unlinked');
    }catch(error){
      console.error(error);
      showToast(error.message || 'Could not unlink Spotify');
    }finally{
      await updateSpotifyStatus();
    }
  }

  function ensureSpotifyFolders(){
    let spotifyRoot = state.collections.find(item =>
      item.id !== 'all' &&
      (item.spotifySystem === 'root' || (item.name === SPOTIFY_ROOT_NAME && !item.parentId))
    );
    if(!spotifyRoot){
      spotifyRoot = {
        id:crypto.randomUUID(),
        name:SPOTIFY_ROOT_NAME,
        icon:'radio',
        color:'#1ed760',
        parentId:null,
        spotifySystem:'root',
      };
      state.collections.push(spotifyRoot);
    }

    let saved = state.collections.find(item =>
      item.id !== 'all' &&
      (item.spotifySystem === 'saved' || (item.name === SPOTIFY_SAVED_NAME && item.parentId === spotifyRoot.id))
    );
    if(!saved){
      saved = {
        id:crypto.randomUUID(),
        name:SPOTIFY_SAVED_NAME,
        icon:'bookmark',
        color:'#1ed760',
        parentId:spotifyRoot.id,
        spotifySystem:'saved',
      };
      state.collections.push(saved);
    }
    return {spotifyRoot,saved};
  }

  function findSpotifyEpisode(spotifyId,url=''){
    return state.episodes.find(ep =>
      ep.spotifyId === spotifyId ||
      parseSpotifyId(ep.url || '') === spotifyId ||
      (url && ep.url === url)
    ) || null;
  }

  function mergeSpotifyData(payload){
    const {saved} = ensureSpotifyFolders();
    const syncedAt = payload.syncedAt || new Date().toISOString();
    const remoteIds = new Set();
    let created = 0;
    let updated = 0;

    for(const item of payload.episodes || []){
      if(!item.id) continue;
      remoteIds.add(item.id);
      const existing = findSpotifyEpisode(item.id,item.url);
      const target = existing || {
        id:crypto.randomUUID(),
        groups:[saved.id],
        source:'spotify',
        progress:0,
        savedAt:item.addedAt ? new Date(item.addedAt).getTime() : Date.now(),
        artClass:'one',
        syncStatus:currentUser ? 'pending' : 'local',
      };

      const positionMs = Math.max(0,Number(item.resumePositionMs || 0));
      const durationMs = Math.max(0,Number(item.durationMs || 0));
      Object.assign(target,{
        source:'spotify',
        title:item.name || target.title || 'Untitled Spotify episode',
        tag:item.showName || target.tag || 'Spotify',
        url:item.url || target.url || '',
        embed:item.id ? `https://open.spotify.com/embed/episode/${item.id}` : target.embed || '',
        artImage:item.artwork || target.artImage || '',
        artSource:item.artwork ? 'spotify' : target.artSource || 'default',
        artText:(item.showName || item.name || 'SP').slice(0,2).toUpperCase(),
        timeLabel:formatDurationLabel(durationMs),
        positionMs,
        progress:durationMs ? Math.min(100,(positionMs / durationMs) * 100) : 0,
        finished:Boolean(item.fullyPlayed),
        spotifyId:item.id,
        spotifySaved:true,
        spotifySavedAt:item.addedAt || target.spotifySavedAt || null,
        spotifyLastSyncedAt:syncedAt,
        spotifyDurationMs:durationMs,
        syncStatus:currentUser ? 'pending' : 'local',
      });

      if(!Array.isArray(target.groups) || !target.groups.length) target.groups = [saved.id];
      if(!existing){
        state.episodes.unshift(target);
        created += 1;
      }else{
        updated += 1;
      }
    }

    for(const episode of state.episodes){
      const spotifyId = episode.spotifyId || parseSpotifyId(episode.url || '');
      if(episode.source === 'spotify' && spotifyId && !remoteIds.has(spotifyId)){
        episode.spotifyId = spotifyId;
        episode.spotifySaved = false;
        episode.spotifyLastSyncedAt = syncedAt;
      }
    }

    const playback = payload.playback;
    if(playback?.episodeId){
      const current = findSpotifyEpisode(playback.episodeId);
      if(current){
        const durationMs = Number(playback.durationMs || current.spotifyDurationMs || 0);
        const positionMs = Math.max(0,Number(playback.progressMs || 0));
        current.positionMs = positionMs;
        current.spotifyDurationMs = durationMs;
        current.progress = durationMs ? Math.min(100,(positionMs / durationMs) * 100) : current.progress || 0;
        current.spotifyLastSyncedAt = syncedAt;
      }
    }

    saveState();
    renderAll();
    queueAutoSync();
    return {created,updated,total:(payload.episodes || []).length};
  }

  async function syncSpotifyEpisodesUnlocked({quiet=false}={}){
    if(spotifyBusy) return;
    if(!currentUser){
      if(!quiet) showToast('Sign in with Google first');
      return;
    }

    const status = await updateSpotifyStatus();
    if(!status.connected){
      if(!quiet) showToast(status.identity ? 'Reconnect Spotify first' : 'Link Spotify first');
      return;
    }

    spotifyBusy = true;
    const syncButton = document.querySelector('[data-sync="spotify"]');
    if(syncButton){
      syncButton.disabled = true;
      syncButton.classList.add('spotify-syncing');
      syncButton.innerHTML = '<i data-lucide="loader-circle"></i>Syncing Spotify';
    }
    const syncStatus = document.querySelector('#syncStatus');
    if(syncStatus) syncStatus.innerHTML = '<i data-lucide="loader-circle"></i> Syncing Spotify…';
    refreshLucide();

    try{
      const payload = await invokeSpotify({action:'sync'});
      const result = mergeSpotifyData(payload);
      await uploadLocalData();
      if(syncStatus) syncStatus.innerHTML = '<i data-lucide="check-circle-2"></i> Spotify synced just now';
      if(!quiet) showToast(`${result.total} Spotify episode${result.total === 1 ? '' : 's'} synced`);
    }catch(error){
      console.error(error);
      if(syncStatus) syncStatus.innerHTML = '<i data-lucide="circle-alert"></i> Spotify sync failed';
      if(!quiet) showToast(error.message || 'Spotify sync failed');
      if(/relink|authorization expired|not linked/i.test(error.message || '')) await updateSpotifyStatus();
    }finally{
      spotifyBusy = false;
      if(syncButton){
        syncButton.disabled = false;
        syncButton.classList.remove('spotify-syncing');
        syncButton.innerHTML = '<i data-lucide="radio"></i>Sync Spotify';
      }
      refreshLucide();
    }
  }

  function syncSpotifyEpisodes(options={}){
    const task = () => syncSpotifyEpisodesUnlocked(options);
    return window.mediaSync?.runLocked ? window.mediaSync.runLocked(task) : task();
  }

  const baseEpisodeSyncInfo = episodeSyncInfo;
  episodeSyncInfo = function(ep){
    if(ep.source === 'spotify' && ep.spotifySaved === false){
      return {label:'Not saved',icon:'bookmark-x',className:'is-pending'};
    }
    return baseEpisodeSyncInfo(ep);
  };

  const baseEpisodeMarkup = episodeMarkup;
  episodeMarkup = function(ep){
    if(ep.source !== 'spotify') return baseEpisodeMarkup(ep);
    const durationMs = Number(ep.spotifyDurationMs || 0);
    const positionMs = Number(ep.positionMs || 0);
    const display = durationMs
      ? `${formatClock(positionMs)} / ${formatClock(durationMs)}`
      : ep.timeLabel;
    return baseEpisodeMarkup({...ep,timeLabel:display});
  };

  const baseEpisodeRows = episodeRows;
  episodeRows = function(userId){
    return baseEpisodeRows(userId).map(row => {
      const ep = state.episodes.find(item => item.id === row.id);
      return {
        ...row,
        spotify_id:ep?.spotifyId || parseSpotifyId(ep?.url || '') || null,
        spotify_saved:ep?.source === 'spotify' ? ep.spotifySaved !== false : null,
        spotify_saved_at:ep?.spotifySavedAt || null,
        spotify_last_synced_at:ep?.spotifyLastSyncedAt || null,
        spotify_duration_ms:Number(ep?.spotifyDurationMs || 0) || null,
      };
    });
  };

  const baseDownloadRemoteData = downloadRemoteData;
  downloadRemoteData = async function(){
    const result = await baseDownloadRemoteData();
    if(!currentUser) return result;
    const {data,error} = await db().from('episodes')
      .select('id,spotify_id,spotify_saved,spotify_saved_at,spotify_last_synced_at,spotify_duration_ms')
      .eq('user_id',currentUser.id);
    if(!error){
      const rows = new Map((data || []).map(row => [row.id,row]));
      state.episodes.forEach(ep => {
        const row = rows.get(ep.id);
        if(!row) return;
        ep.spotifyId = row.spotify_id || parseSpotifyId(ep.url || '') || '';
        ep.spotifySaved = row.spotify_saved;
        ep.spotifySavedAt = row.spotify_saved_at;
        ep.spotifyLastSyncedAt = row.spotify_last_synced_at;
        ep.spotifyDurationMs = Number(row.spotify_duration_ms || 0);
      });
      saveState(false);
      renderAll();
    }
    return result;
  };

  function bindSpotifyControls(){
    const linkButton = document.querySelector('#spotifyLink');
    linkButton?.addEventListener('click',async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if(spotifyBusy) return;
      const status = await updateSpotifyStatus();
      if(status.connected) await disconnectSpotify();
      else await startSpotifyLink();
    },true);

    const syncButton = document.querySelector('[data-sync="spotify"]');
    syncButton?.addEventListener('click',async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      await syncSpotifyEpisodes();
    },true);
  }

  async function initializeSpotify(){
    bindSpotifyControls();
    document.querySelector('.source-tab[data-source="online"]')?.setAttribute('aria-hidden','true');
    refreshLucide();

    const {data} = await client().auth.getSession();
    if(callbackRequested()) await captureSpotifySession(data.session);
    const status = await updateSpotifyStatus();
    if(status.connected && !callbackRequested()){
      setTimeout(() => syncSpotifyEpisodes({quiet:true}),900);
    }
  }

  if(client()){
    client().auth.onAuthStateChange((_event,session) => {
      setTimeout(async () => {
        if(callbackRequested() && session?.provider_token) await captureSpotifySession(session);
        else await updateSpotifyStatus();
      },0);
    });
  }

  document.addEventListener('DOMContentLoaded',() => {
    setTimeout(() => initializeSpotify().catch(error => console.error(error)),900);
  });
})();