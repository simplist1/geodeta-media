(() => {
  const CURRENT_BUILD = {
    'docs/index.html': 'e51b84d5b680457d7113058ea6b3986a217b124b',
    'docs/manifest.webmanifest': 'e30f8d9e75a29342ebb59af5fdb32b84373d4415',
    'docs/service-worker.js': '0f4134475af0ab2f398cd7b3408d0d90c8230c55',
    'docs/art/icon-192.svg': 'c79766e4e03dd4cfe5b2b929c3d938a81171f0f4',
    'docs/art/icon-512.svg': '5cb7b94faadd297bd3392a445cc589e1fda03344',
    'docs/art/icon-maskable.svg': 'aca80c3585fa8197be964ab46c2181fae928934a',
    'docs/app.css': 'fa93056b25a4085aee22be65d78276b759a325e1',
    'docs/app-overrides.css': '1cd35e299ba7a0be0636f70079538e322fe24900',
    'docs/app.js': '2ccb2ed1a0efacc6311648b06aab29cb2daccedc',
    'docs/library-explorer.css': 'dd421cd7a390d778c30a311bc0915823999cb77b',
    'docs/library-explorer.js': 'bdcc567c555e879383c22f34d7ef27645681a0eb',
    'docs/profile-autosync.js': '18d913c5cebf2bb457473c0033bdfcd9e76eb279',
    'docs/pwa.css': 'f0069d8b38bac770fac6e614d1ecc4a77aaea0fc',
    'docs/pwa.js': '113f7dca94af063cb3428e3eab87d8c7150dc8f0',
    'docs/spotify-integration.css': 'b13e72069d89b719ed685aaaede62f6641b6b419',
    'docs/spotify-integration.js': '1ac00a2bb4096506f09593fe7c0be3cf0b9ed6ce',
    'docs/supabase.js': 'dcea987629c7e58997a728f21e9fd53a109f77e8',
    'docs/update.css': '729a2dd2eb41ae88b2409a924f1339d0ba2e9f6a'
  };

  const TREE_URL = 'https://api.github.com/repos/simplist1/geodeta-media/git/trees/main?recursive=1';
  const COMMIT_URL = 'https://api.github.com/repos/simplist1/geodeta-media/commits/main';
  const DISMISSED_KEY = 'geodetaDismissedUpdate';
  const CHECK_INTERVAL_MS = 10 * 60 * 1000;
  const VISIBILITY_RECHECK_MS = 2 * 60 * 1000;

  let lastCheckAt = 0;
  let latestUpdateKey = '';
  let checking = false;

  function refreshLucide(){
    window.lucide?.createIcons();
  }

  async function fetchJson(url){
    const separator = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${separator}_=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json'
      }
    });

    if(!response.ok){
      throw new Error(`Update check failed with ${response.status}`);
    }

    return response.json();
  }

  function hideUpdatePopup(){
    const popup = document.querySelector('#updatePopup');
    if(!popup || popup.hidden) return;

    popup.classList.add('is-closing');
    setTimeout(() => {
      popup.hidden = true;
      popup.classList.remove('is-closing');
    }, 180);
  }

  function showUpdatePopup({key,commitSha='',message=''}){
    const popup = document.querySelector('#updatePopup');
    if(!popup) return;

    if(sessionStorage.getItem(DISMISSED_KEY) === key) return;

    latestUpdateKey = key;
    const messageMount = document.querySelector('#updateMessage');
    const commitMount = document.querySelector('#updateCommit');

    if(messageMount){
      messageMount.textContent = message || 'Refresh Geodeta Media to load the latest changes.';
    }

    if(commitMount){
      commitMount.textContent = commitSha ? `Commit ${commitSha.slice(0,7)}` : '';
    }

    popup.hidden = false;
    popup.classList.remove('is-closing');
    refreshLucide();
  }

  async function getCommitDetails(){
    try{
      const commit = await fetchJson(COMMIT_URL);
      const message = commit?.commit?.message?.split('\n')[0]?.trim() || '';
      return {
        sha: commit?.sha || '',
        message: message ? `${message}. Refresh to load it.` : ''
      };
    }catch(error){
      console.warn('Could not load update commit details.', error);
      return {sha:'',message:''};
    }
  }

  async function checkForUpdates(){
    if(checking) return false;
    checking = true;
    lastCheckAt = Date.now();

    try{
      const tree = await fetchJson(TREE_URL);
      const remoteFiles = new Map(
        (tree.tree || [])
          .filter(item => item.type === 'blob')
          .map(item => [item.path,item.sha])
      );

      const changedFiles = Object.entries(CURRENT_BUILD)
        .filter(([path,sha]) => remoteFiles.get(path) && remoteFiles.get(path) !== sha)
        .map(([path]) => path);

      if(!changedFiles.length) return false;

      const details = await getCommitDetails();
      const key = details.sha || changedFiles.join('|');
      showUpdatePopup({
        key,
        commitSha: details.sha,
        message: details.message || 'A newer deployed build is available. Refresh to load it.'
      });
      return true;
    }catch(error){
      console.warn('Geodeta update check could not complete.', error);
      return false;
    }finally{
      checking = false;
    }
  }

  async function hardRefresh(){
    const button = document.querySelector('#hardRefresh');
    if(button){
      button.disabled = true;
      button.innerHTML = '<i data-lucide="loader-circle"></i>Refreshing…';
      refreshLucide();
    }

    try{
      if('caches' in window){
        const names = await caches.keys();
        await Promise.all(names.map(name => caches.delete(name)));
      }

      if('serviceWorker' in navigator){
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(registration => registration.update().catch(() => null)));
      }
    }catch(error){
      console.warn('Some cached files could not be cleared.', error);
    }

    sessionStorage.removeItem(DISMISSED_KEY);
    const url = new URL(window.location.href);
    url.searchParams.set('_refresh', latestUpdateKey || Date.now().toString());
    url.hash = '';
    window.location.replace(url.toString());
  }

  function bindUpdateControls(){
    document.querySelector('#hardRefresh')?.addEventListener('click', hardRefresh);
    document.querySelector('#updateNow')?.addEventListener('click', hardRefresh);
    document.querySelector('#updateLater')?.addEventListener('click', () => {
      if(latestUpdateKey){
        sessionStorage.setItem(DISMISSED_KEY, latestUpdateKey);
      }
      hideUpdatePopup();
    });

    document.querySelector('#updatePopup')?.addEventListener('click', event => {
      if(event.target.id === 'updatePopup'){
        if(latestUpdateKey){
          sessionStorage.setItem(DISMISSED_KEY, latestUpdateKey);
        }
        hideUpdatePopup();
      }
    });
  }

  function startUpdateWatcher(){
    setTimeout(checkForUpdates, 3500);
    setInterval(checkForUpdates, CHECK_INTERVAL_MS);

    document.addEventListener('visibilitychange', () => {
      if(
        document.visibilityState === 'visible' &&
        Date.now() - lastCheckAt > VISIBILITY_RECHECK_MS
      ){
        checkForUpdates();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindUpdateControls();
    startUpdateWatcher();
    refreshLucide();
  });
})();