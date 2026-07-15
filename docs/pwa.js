(() => {
  let deferredInstallPrompt = null;
  let serviceWorkerRegistration = null;

  const installButton = () => document.querySelector('#installApp');
  const installCopy = () => document.querySelector('#installAppCopy');
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  function refreshIcons(){
    window.lucide?.createIcons();
  }

  function setInstallState(state){
    const button = installButton();
    const copy = installCopy();
    if(!button) return;

    button.classList.remove('pwa-ready','pwa-installed');
    button.disabled = false;

    if(state === 'installed'){
      button.classList.add('pwa-installed');
      button.disabled = true;
      button.innerHTML = '<i data-lucide="check"></i>Installed';
      if(copy) copy.textContent = 'Geodeta Media is installed on this device.';
    }else if(state === 'ready'){
      button.classList.add('pwa-ready');
      button.innerHTML = '<i data-lucide="download"></i>Install';
      if(copy) copy.textContent = 'Install Geodeta Media as a standalone Android app.';
    }else{
      button.innerHTML = '<i data-lucide="smartphone"></i>Install';
      if(copy) copy.textContent = 'On Android Chrome, install from this button or the browser menu.';
    }

    refreshIcons();
  }

  async function requestInstall(){
    if(isStandalone()){
      setInstallState('installed');
      return;
    }

    if(!deferredInstallPrompt){
      showToast('In Chrome, open the menu and choose Install app');
      return;
    }

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
    setInstallState('ready');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    setInstallState('installed');
    showToast('Geodeta Media installed');
  });

  document.addEventListener('DOMContentLoaded', () => {
    installButton()?.addEventListener('click', requestInstall);
    setInstallState(isStandalone() ? 'installed' : 'default');
    registerServiceWorker();
  });
})();
