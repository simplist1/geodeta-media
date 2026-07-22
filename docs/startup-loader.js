(() => {
  const settingKey = 'geodetaStartupLoaderEnabled';
  const overlay = document.querySelector('#startupLoader');
  const status = document.querySelector('#startupLoaderStatus');
  const skip = document.querySelector('#startupLoaderSkip');
  const toggle = document.querySelector('#startupLoaderToggle');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  let enabled = true;
  try{
    enabled = localStorage.getItem(settingKey) !== 'false';
  }catch(error){}
  const startedAt = performance.now();
  const minimumVisibleMs = 300;
  const fallbackMs = 45000;
  let leaving = false;
  let dataReady = false;
  let spotifyReady = false;

  function appThemeColor(){
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? '#111114'
      : '#f5f5f7';
  }

  function setStatus(message){
    if(status && message) status.textContent = message;
  }

  function removeImmediately(){
    overlay?.remove();
    document.body.classList.remove('startup-loading');
    if(themeMeta) themeMeta.content = appThemeColor();
  }

  function leave(){
    if(leaving || !overlay) return;
    const wait = Math.max(0,minimumVisibleMs - (performance.now() - startedAt));
    leaving = true;

    setTimeout(() => {
      overlay.classList.add('is-leaving');
      overlay.setAttribute('aria-hidden','true');
      if(themeMeta) themeMeta.content = appThemeColor();

      setTimeout(() => {
        overlay.remove();
        document.body.classList.remove('startup-loading');
      },1020);
    },wait);
  }

  async function syncCollections(userId){
    setStatus('Loading collections…');
    if(!enabled || !userId) return;

    if(localStorage.getItem(DIRTY_KEY) === 'true'){
      renderAll();
      return;
    }

    try{
      const {data,error} = await window.supabaseClient
        .from('collections')
        .select('id,name,icon,color,parent_id,position,sort_order,version')
        .eq('user_id',userId)
        .is('deleted_at',null)
        .order('sort_order');

      if(error) throw error;

      const root = state.collections.find(item => item.id === 'all') || {
        id:'all',
        name:'All Episodes',
        icon:'library',
        color:'#5b5ce2'
      };
      const existing = new Map(state.collections.map(item => [item.id,item]));

      state.collections = [
        root,
        ...(data || []).map(row => {
          const sortOrder = Number(row.sort_order ?? row.position) || 0;
          return {
            ...(existing.get(row.id) || {}),
            id:row.id,
            name:row.name,
            icon:row.icon,
            color:row.color,
            parentId:row.parent_id || null,
            sortOrder,
            _version:Number(row.version) || 1,
            _syncBase:{
              name:row.name,
              icon:row.icon,
              color:row.color,
              parent_id:row.parent_id || null,
              sort_order:sortOrder
            }
          };
        })
      ];

      saveState(false);
      renderAll();
    }catch(error){
      console.warn('Startup collection sync failed',error);
    }
  }

  function finishWhenReady(){
    if(leaving || !dataReady || !spotifyReady) return;
    setStatus('Positioning library…');
    requestAnimationFrame(() => {
      requestAnimationFrame(leave);
    });
  }

  skip?.addEventListener('click',() => {
    setStatus('Finishing sync in the background…');
    leave();
  });

  if(toggle){
    toggle.checked = enabled;
    toggle.addEventListener('change',() => {
      try{
        localStorage.setItem(settingKey,String(toggle.checked));
      }catch(error){}
      document.documentElement.classList.toggle('startup-loader-disabled',!toggle.checked);
      showToast('Startup loading screen ' + (toggle.checked ? 'enabled' : 'disabled'));
    });
  }

  if(!enabled){
    removeImmediately();
    return;
  }

  if(themeMeta) themeMeta.content = '#5b5ce2';
  window.addEventListener('geodeta:data-startup-ready',() => {
    dataReady = true;
    finishWhenReady();
  },{once:true});
  window.addEventListener('geodeta:spotify-startup-ready',() => {
    spotifyReady = true;
    finishWhenReady();
  },{once:true});
  setTimeout(leave,fallbackMs);
  window.startupLoader = {finish:leave,syncCollections,setStatus};
})();
