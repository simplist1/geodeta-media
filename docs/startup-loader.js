(() => {
  const overlay = document.querySelector('#startupLoader');
  if(!overlay) return;

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const startedAt = performance.now();
  const minimumVisibleMs = 520;
  const fallbackMs = 15000;
  let leaving = false;

  function appThemeColor(){
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? '#111114'
      : '#f5f5f7';
  }

  function leave(){
    if(leaving) return;
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

  const startupRunSync = runSync;
  runSync = async function(type,quiet=false){
    try{
      return await startupRunSync(type,quiet);
    }finally{
      if(type === 'data') leave();
    }
  };

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
