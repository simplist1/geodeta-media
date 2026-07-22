(() => {
  const settingKey = 'geodetaStartupLoaderEnabled';
  const overlay = document.querySelector('#startupLoader');
  const toggle = document.querySelector('#startupLoaderToggle');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  let enabled = true;
  try{
    enabled = localStorage.getItem(settingKey) !== 'false';
  }catch(error){}
  const startedAt = performance.now();
  const minimumVisibleMs = 300;
  const fallbackMs = 20000;
  let leaving = false;

  function appThemeColor(){
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? '#111114'
      : '#f5f5f7';
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
      },820);
    },wait);
  }

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

  window.addEventListener('geodeta:data-startup-ready',leave,{once:true});

  async function checkSession(){
    try{
      const {data,error} = await window.supabaseClient.auth.getSession();
      if(error || !data?.session) leave();
    }catch(error){
      console.warn('Startup session check failed',error);
      leave();
    }
  }

  if(themeMeta) themeMeta.content = '#5b5ce2';
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded',checkSession,{once:true});
  }else{
    checkSession();
  }

  setTimeout(leave,fallbackMs);
  window.startupLoader = {finish:leave};
})();
