(() => {
  let deferredInstallPrompt = null;
  let serviceWorkerRegistration = null;

  const installButton = () => document.querySelector('#installApp');
  const installCopy = () => document.querySelector('#installAppCopy');
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isAndroid = () => /Android/i.test(navigator.userAgent);
  const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function refreshIcons(){
    window.lucide?.createIcons();
  }

  function ensureIOSGuide(){
    let guide = document.querySelector('#iosInstallGuide');
    if(guide) return guide;

    guide = document.createElement('div');
    guide.id = 'iosInstallGuide';
    guide.className = 'ios-install-backdrop';
    guide.hidden = true;
    guide.setAttribute('role','dialog');
    guide.setAttribute('aria-modal','true');
    guide.setAttribute('aria-labelledby','iosInstallTitle');
    guide.innerHTML = `
      <div class="ios-install-sheet">
        <div class="ios-install-handle"></div>
        <div class="ios-install-head">
          <div>
            <p class="eyebrow">INSTALL ON IPHONE OR IPAD</p>
            <h3 id="iosInstallTitle">Add Geodeta to your Home Screen</h3>
          </div>
          <button id="closeIOSInstallGuide" class="icon-button" aria-label="Close install guide"><i data-lucide="x"></i></button>
        </div>
        <div class="ios-install-steps">
          <div class="ios-install-step"><span>1</span><div><strong>Open the Share menu</strong><p>Tap the Share button in Safari. It looks like a square with an arrow pointing upward.</p></div><i data-lucide="share"></i></div>
          <div class="ios-install-step"><span>2</span><div><strong>Choose Add to Home Screen</strong><p>Scroll through the actions and tap <b>Add to Home Screen</b>.</p></div><i data-lucide="square-plus"></i></div>
          <div class="ios-install-step"><span>3</span><div><strong>Confirm the installation</strong><p>Tap <b>Add</b>. Geodeta will appear on your Home Screen and open like an app.</p></div><i data-lucide="check"></i></div>
        </div>
        <p class="ios-install-note">Apple requires these steps to be completed from the browser menu; websites cannot open the system installation screen automatically.</p>
        <button id="dismissIOSInstallGuide" class="primary">Got it</button>
      </div>`;
    document.body.appendChild(guide);

    const close = () => {
      guide.classList.remove('is-open');
      setTimeout(() => { guide.hidden = true; }, 180);
    };
    guide.querySelector('#closeIOSInstallGuide')?.addEventListener('click',close);
    guide.querySelector('#dismissIOSInstallGuide')?.addEventListener('click',close);
    guide.addEventListener('click',event => { if(event.target === guide) close(); });
    refreshIcons();
    return guide;
  }

  function showIOSGuide(){
    const guide = ensureIOSGuide();
    guide.hidden = false;
    requestAnimationFrame(() => guide.classList.add('is-open'));
    refreshIcons();
  }

  function setInstallState(state){
    const button = installButton();
    const copy = installCopy();
    if(!button) return;

    button.classList.remove('pwa-ready','pwa-installed','pwa-ios');
    button.disabled = false;

    if(state === 'installed'){
      button.classList.add('pwa-installed');
      button.disabled = true;
      button.innerHTML = '<i data-lucide="check"></i>Installed';
      if(copy) copy.textContent = 'Geodeta Media is installed on this device.';
    }else if(state === 'ready'){
      button.classList.add('pwa-ready');
      button.innerHTML = '<i data-lucide="download"></i>Install';
      if(copy) copy.textContent = 'Tap Install to add Geodeta as a standalone Android app.';
    }else if(state === 'ios'){
      button.classList.add('pwa-ios');
      button.innerHTML = '<i data-lucide="share"></i>Show steps';
      if(copy) copy.textContent = 'See the iPhone or iPad Add to Home Screen instructions.';
    }else{
      button.innerHTML = '<i data-lucide="smartphone"></i>Install';
      if(copy){
        copy.textContent = isAndroid()
          ? 'Tap Install, or open the Chrome menu and choose Install app.'
          : 'Install Geodeta from your browser’s app or shortcut menu.';
      }
    }

    refreshIcons();
  }

  async function requestInstall(){
    if(isStandalone()){
      setInstallState('installed');
      return;
    }

    if(isIOS()){
      showIOSGuide();
      return;
    }

    if(deferredInstallPrompt){
      const prompt = deferredInstallPrompt;
      deferredInstallPrompt = null;
      await prompt.prompt();
      const choice = await prompt.userChoice;

      if(choice?.outcome === 'accepted'){
        showToast('Installing Geodeta Media');
      }else{
        showToast('Install canceled');
        setInstallState('default');
      }
      return;
    }

    if(isAndroid()){
      showToast('Open the Chrome menu and choose Install app');
    }else{
      showToast('Use your browser menu to install or add this app');
    }
  }

  async function registerServiceWorker(){
    if(!('serviceWorker' in navigator)) return;

    try{
      serviceWorkerRegistration = await navigator.serviceWorker.register('/service-worker.js', {scope:'/'});
      await serviceWorkerRegistration.update().catch(() => null);

      serviceWorkerRegistration.addEventListener('updatefound', () => {
        const worker = serviceWorkerRegistration.installing;
        if(!worker) return;
        worker.addEventListener('statechange', () => {
          if(worker.state === 'installed' && navigator.serviceWorker.controller){
            worker.postMessage({type:'SKIP_WAITING'});
          }
        });
      });
    }catch(error){
      console.warn('PWA service worker registration failed.', error);
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if(!isStandalone()) setInstallState('ready');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    setInstallState('installed');
    showToast('Geodeta Media installed');
  });

  document.addEventListener('DOMContentLoaded', () => {
    installButton()?.addEventListener('click', requestInstall);
    setInstallState(isStandalone() ? 'installed' : isIOS() ? 'ios' : 'default');
    registerServiceWorker();
  });
})();

/*
 * Spotify sync integrity guard.
 *
 * Spotify episodes can enter the local library through both manual links and
 * Saved Episodes import. The database intentionally allows only one row per
 * user and Spotify episode ID, so merge local copies before every cloud write.
 */
(() => {
  const ROOT_COLLECTION = 'all';

  function spotifyEpisodeId(value=''){
    const raw = String(value || '').trim();
    const uriMatch = raw.match(/spotify:episode:([A-Za-z0-9]+)/i);
    if(uriMatch) return uriMatch[1];

    try{
      const parsed = new URL(raw, window.location.origin);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const episodeIndex = parts.indexOf('episode');
      return episodeIndex >= 0 ? parts[episodeIndex + 1] || '' : '';
    }catch{
      return '';
    }
  }

  function spotifyKey(episode){
    return String(
      episode?.spotifyId ||
      spotifyEpisodeId(episode?.url) ||
      spotifyEpisodeId(episode?.embed) ||
      ''
    ).trim();
  }

  function realGroups(episode){
    return new Set((episode?.groups || []).filter(Boolean));
  }

  function artworkRank(episode){
    if(episode?.artSource === 'custom' && episode?.artImage) return 3;
    if(episode?.artSource === 'spotify' && episode?.artImage) return 2;
    if(episode?.artImage) return 1;
    return 0;
  }

  function canonicalScore(episode){
    const groups = [...realGroups(episode)].filter(group => group !== ROOT_COLLECTION).length;
    let score = groups * 3;
    if(episode?.source === 'spotify') score += 20;
    if(episode?.spotifySaved === true) score += 10;
    if(episode?.spotifyLastSyncedAt) score += 8;
    if(Number(episode?.spotifyDurationMs || 0) > 0) score += 5;
    if(episode?.url) score += 3;
    if(episode?.embed) score += 3;
    score += artworkRank(episode) * 4;
    return score;
  }

  function newerSpotifyState(target, source){
    const targetTime = Date.parse(target.spotifyLastSyncedAt || '') || 0;
    const sourceTime = Date.parse(source.spotifyLastSyncedAt || '') || 0;
    if(sourceTime !== targetTime) return sourceTime > targetTime;

    const targetPosition = Number(target.positionMs || 0);
    const sourcePosition = Number(source.positionMs || 0);
    return sourcePosition > targetPosition;
  }

  function meaningfulText(value){
    const text = String(value || '').trim();
    return text && !/^untitled spotify episode$/i.test(text) && !/^episode$/i.test(text);
  }

  function mergeSpotifyEpisode(target, source, key){
    const groups = new Set([
      ...realGroups(target),
      ...realGroups(source),
    ]);
    if([...groups].some(group => group !== ROOT_COLLECTION)){
      groups.delete(ROOT_COLLECTION);
    }
    if(!groups.size) groups.add(ROOT_COLLECTION);

    target.groups = [...groups];
    target.source = 'spotify';
    target.spotifyId = key;

    if(!meaningfulText(target.title) && meaningfulText(source.title)) target.title = source.title;
    if(!meaningfulText(target.tag) && meaningfulText(source.tag)) target.tag = source.tag;
    if(!target.url && source.url) target.url = source.url;
    if(!target.embed && source.embed) target.embed = source.embed;
    if(!target.timeLabel && source.timeLabel) target.timeLabel = source.timeLabel;
    if(!target.artText && source.artText) target.artText = source.artText;
    if(!target.artClass && source.artClass) target.artClass = source.artClass;

    if(artworkRank(source) > artworkRank(target)){
      target.artImage = source.artImage || '';
      target.artSource = source.artSource || 'default';
      target.artworkPath = source.artworkPath || '';
    }

    if(newerSpotifyState(target, source)){
      target.positionMs = Number(source.positionMs || 0);
      target.progress = Number(source.progress || 0);
      target.finished = Boolean(source.finished);
    }

    target.spotifyDurationMs = Math.max(
      Number(target.spotifyDurationMs || 0),
      Number(source.spotifyDurationMs || 0)
    );

    if(target.spotifySaved !== true && source.spotifySaved === true){
      target.spotifySaved = true;
    }else if(target.spotifySaved == null && source.spotifySaved != null){
      target.spotifySaved = source.spotifySaved;
    }

    if(!target.spotifySavedAt && source.spotifySavedAt){
      target.spotifySavedAt = source.spotifySavedAt;
    }

    const targetSynced = Date.parse(target.spotifyLastSyncedAt || '') || 0;
    const sourceSynced = Date.parse(source.spotifyLastSyncedAt || '') || 0;
    if(sourceSynced > targetSynced){
      target.spotifyLastSyncedAt = source.spotifyLastSyncedAt;
    }

    target.savedAt = Math.max(
      Number(target.savedAt || 0),
      Number(source.savedAt || 0)
    ) || Date.now();

    target.syncStatus = currentUser ? 'pending' : 'local';
  }

  function movePendingFile(oldId, newId){
    if(oldId === newId || !pendingAudioFiles?.has(oldId)) return;
    if(!pendingAudioFiles.has(newId)){
      pendingAudioFiles.set(newId, pendingAudioFiles.get(oldId));
    }
    pendingAudioFiles.delete(oldId);
  }

  function updateEpisodeReferences(duplicate, canonical){
    if(selectedEpisode === duplicate || selectedEpisode?.id === duplicate.id){
      selectedEpisode = canonical;
    }
    if(editingEpisodeId === duplicate.id){
      editingEpisodeId = canonical.id;
    }
    movePendingFile(duplicate.id, canonical.id);
  }

  function dedupeSpotifyEpisodes(){
    const buckets = new Map();

    for(const episode of state.episodes){
      const key = spotifyKey(episode);
      if(!key) continue;
      episode.spotifyId = key;
      if(!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(episode);
    }

    const removedObjects = new Set();
    let removed = 0;

    for(const [key, episodes] of buckets){
      if(episodes.length < 2) continue;

      const canonical = episodes.reduce((best, candidate) =>
        canonicalScore(candidate) > canonicalScore(best) ? candidate : best
      );

      for(const duplicate of episodes){
        if(duplicate === canonical) continue;
        mergeSpotifyEpisode(canonical, duplicate, key);
        updateEpisodeReferences(duplicate, canonical);
        removedObjects.add(duplicate);
        removed += 1;
      }
    }

    if(removed){
      state.episodes = state.episodes.filter(episode => !removedObjects.has(episode));
    }

    return {removed};
  }

  async function reconcileRemoteSpotifyIds(){
    if(!currentUser) return {remapped:0};

    const {data,error} = await db()
      .from('episodes')
      .select('id,spotify_id,spotify_url')
      .eq('user_id', currentUser.id);

    if(error){
      console.warn('Could not reconcile Spotify episode row IDs.', error);
      return {remapped:0};
    }

    const remoteBySpotifyId = new Map();
    for(const row of data || []){
      const key = String(row.spotify_id || spotifyEpisodeId(row.spotify_url) || '').trim();
      if(key && !remoteBySpotifyId.has(key)) remoteBySpotifyId.set(key, row.id);
    }

    const occupiedIds = new Set(state.episodes.map(episode => episode.id));
    let remapped = 0;

    for(const episode of state.episodes){
      const key = spotifyKey(episode);
      const remoteId = key ? remoteBySpotifyId.get(key) : '';
      if(!remoteId || remoteId === episode.id || !isUuid(remoteId) || occupiedIds.has(remoteId)) continue;

      const oldId = episode.id;
      occupiedIds.delete(oldId);
      occupiedIds.add(remoteId);
      episode.id = remoteId;
      movePendingFile(oldId, remoteId);

      if(editingEpisodeId === oldId) editingEpisodeId = remoteId;
      remapped += 1;
    }

    return {remapped};
  }

  const baseEpisodeRows = episodeRows;
  episodeRows = function(userId){
    dedupeSpotifyEpisodes();
    const rows = baseEpisodeRows(userId);
    const seenSpotifyIds = new Set();

    return rows.filter(row => {
      const key = String(row.spotify_id || spotifyEpisodeId(row.spotify_url) || '').trim();
      if(!key) return true;
      if(seenSpotifyIds.has(key)){
        console.warn('Skipped a duplicate Spotify episode row before upload.', key);
        return false;
      }
      seenSpotifyIds.add(key);
      return true;
    });
  };

  const baseUploadLocalData = uploadLocalData;
  uploadLocalData = async function(){
    normalizeIds();

    const cleanup = dedupeSpotifyEpisodes();
    const reconciliation = await reconcileRemoteSpotifyIds();

    if(cleanup.removed || reconciliation.remapped){
      saveState(false);
      renderAll();
    }

    try{
      return await baseUploadLocalData();
    }catch(error){
      const duplicateSpotifyKey =
        error?.code === '23505' &&
        /episodes_user_spotify_id_unique/i.test(error?.message || '');

      if(!duplicateSpotifyKey) throw error;

      const retryCleanup = dedupeSpotifyEpisodes();
      if(!retryCleanup.removed) throw error;

      saveState(false);
      renderAll();
      return baseUploadLocalData();
    }
  };

  const baseDownloadRemoteData = downloadRemoteData;
  downloadRemoteData = async function(){
    const result = await baseDownloadRemoteData();
    const cleanup = dedupeSpotifyEpisodes();

    if(cleanup.removed){
      saveState(false);
      renderAll();
    }

    return result;
  };

  document.addEventListener('DOMContentLoaded', () => {
    const cleanup = dedupeSpotifyEpisodes();
    if(!cleanup.removed) return;

    saveState();
    renderAll();
    showToast(`${cleanup.removed} duplicate Spotify episode${cleanup.removed === 1 ? '' : 's'} merged`);
  });
})();