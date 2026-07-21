(() => {
  const CURRENT_BUILD_ID = '2026.07.21.1';
  const BUILD_URL = '/build.json';
  const DISMISSED_KEY = 'geodetaDismissedUpdate';
  const CHECK_INTERVAL_MS = 10 * 60 * 1000;
  const VISIBILITY_RECHECK_MS = 2 * 60 * 1000;

  let lastCheckAt = 0;
  let latestBuildId = '';
  let checking = false;
  let refreshing = false;

  function refreshLucide(){
    window.lucide?.createIcons();
  }

  async function fetchDeployedBuild(){
    const separator = BUILD_URL.includes('?') ? '&' : '?';
    const response = await fetch(`${BUILD_URL}${separator}_=${Date.now()}`, {
      cache: 'no-store',
      headers: {Accept: 'application/json'},
    });

    if(!response.ok){
      throw new Error(`Build check failed with ${response.status}`);
    }

    const build = await response.json();
    if(!build?.id) throw new Error('Build marker is invalid');
    return build;
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

  function showUpdatePopup(build){
    const popup = document.querySelector('#updatePopup');
    if(!popup || !build?.id) return;
    if(sessionStorage.getItem(DISMISSED_KEY) === build.id) return;

    latestBuildId = build.id;

    const messageMount = document.querySelector('#updateMessage');
    const buildMount = document.querySelector('#updateCommit');

    if(messageMount){
      messageMount.textContent = build.message
        ? `${build.message}. Refresh to load it.`
        : 'A newer deployed build is available. Refresh to load it.';
    }

    if(buildMount){
      buildMount.textContent = `Build ${build.id}`;
    }

    popup.hidden = false;
    popup.classList.remove('is-closing');
    refreshLucide();
  }

  async function checkForUpdates(){
    if(checking || refreshing || !navigator.onLine) return false;
    checking = true;
    lastCheckAt = Date.now();

    try{
      const deployedBuild = await fetchDeployedBuild();

      if(deployedBuild.id === CURRENT_BUILD_ID){
        latestBuildId = '';
        hideUpdatePopup();
        return false;
      }

      showUpdatePopup(deployedBuild);
      return true;
    }catch(error){
      console.warn('Geodeta deployed-build check could not complete.', error);
      return false;
    }finally{
      checking = false;
    }
  }

  function setRefreshButtonBusy(){
    const hardRefreshButton = document.querySelector('#hardRefresh');
    const updateButton = document.querySelector('#updateNow');

    if(hardRefreshButton){
      hardRefreshButton.disabled = true;
      hardRefreshButton.innerHTML = '<i data-lucide="loader-circle"></i>Refreshing…';
    }

    if(updateButton){
      updateButton.disabled = true;
      updateButton.textContent = 'Updating…';
    }

    refreshLucide();
  }

  async function unregisterServiceWorkers(){
    if(!('serviceWorker' in navigator)) return;

    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(async registration => {
      registration.waiting?.postMessage({type:'SKIP_WAITING'});
      registration.active?.postMessage({type:'CLEAR_CACHES'});
      try{
        await registration.unregister();
      }catch(error){
        console.warn('Could not unregister an old service worker.', error);
      }
    }));
  }

  async function clearBrowserCaches(){
    if(!('caches' in window)) return;
    const names = await caches.keys();
    await Promise.all(names.map(name => caches.delete(name)));
  }

  async function reloadSameOriginAssets(){
    const urls = new Set(['/index.html', BUILD_URL]);

    for(const entry of performance.getEntriesByType('resource')){
      try{
        const url = new URL(entry.name, window.location.href);
        if(url.origin === window.location.origin) urls.add(url.href);
      }catch{}
    }

    await Promise.all([...urls].map(async value => {
      try{
        const url = new URL(value, window.location.origin);
        url.searchParams.set('_update', latestBuildId || Date.now().toString());
        await fetch(url.toString(), {cache:'reload'});
      }catch{}
    }));
  }

  async function hardRefresh(){
    if(refreshing) return;
    refreshing = true;
    setRefreshButtonBusy();

    try{
      sessionStorage.removeItem(DISMISSED_KEY);
      await unregisterServiceWorkers();
      await clearBrowserCaches();
      await reloadSameOriginAssets();
    }catch(error){
      console.warn('Some old app files could not be cleared.', error);
    }

    const url = new URL(window.location.href);
    url.searchParams.set('_build', latestBuildId || Date.now().toString());
    url.hash = '';
    window.location.replace(url.toString());
  }

  function dismissCurrentUpdate(){
    if(latestBuildId){
      sessionStorage.setItem(DISMISSED_KEY, latestBuildId);
    }
    hideUpdatePopup();
  }

  function bindUpdateControls(){
    document.querySelector('#hardRefresh')?.addEventListener('click', hardRefresh);
    document.querySelector('#updateNow')?.addEventListener('click', hardRefresh);
    document.querySelector('#updateLater')?.addEventListener('click', dismissCurrentUpdate);

    document.querySelector('#updatePopup')?.addEventListener('click', event => {
      if(event.target.id === 'updatePopup') dismissCurrentUpdate();
    });
  }

  function startUpdateWatcher(){
    setTimeout(checkForUpdates, 4000);
    setInterval(checkForUpdates, CHECK_INTERVAL_MS);

    window.addEventListener('online', () => setTimeout(checkForUpdates, 500));
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