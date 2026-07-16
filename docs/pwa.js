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