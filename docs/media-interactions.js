(() => {
  const LONG_PRESS_MS = 560;
  const MOVE_TOLERANCE = 12;
  const boundCards = new WeakSet();
  let metadataRequest = 0;
  let metadataTimer = null;
  let draggingEpisodeId = '';

  const isFinePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const isPhonePointer = event => event.pointerType === 'touch' || event.pointerType === 'pen';

  function spotifyEpisodeUrl(value=''){
    try{
      const url = new URL(String(value).trim());
      const parts = url.pathname.split('/').filter(Boolean);
      const index = parts.indexOf('episode');
      return index >= 0 && parts[index + 1] ? url.toString() : '';
    }catch{
      return '';
    }
  }

  async function loadSpotifyMetadata(){
    const input = document.querySelector('#spotifyUrl');
    const url = spotifyEpisodeUrl(input?.value || '');
    if(!url) return;

    const requestId = ++metadataRequest;
    input?.classList.add('spotify-metadata-loading');

    try{
      const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
        cache:'no-store',
        headers:{Accept:'application/json'},
      });
      if(!response.ok) throw new Error(`Spotify metadata returned ${response.status}`);
      const data = await response.json();
      if(requestId !== metadataRequest) return;

      const titleInput = document.querySelector('#episodeTitle');
      const tagInput = document.querySelector('#episodeTag');
      const title = String(data?.title || '').trim();
      const showName = String(data?.author_name || '').trim();

      if(titleInput && title && (!titleInput.value.trim() || titleInput.dataset.spotifyAutofilled === 'true')){
        titleInput.value = title;
        titleInput.dataset.spotifyAutofilled = 'true';
        titleInput.dispatchEvent(new Event('input',{bubbles:true}));
      }

      if(tagInput && showName && (!tagInput.value.trim() || tagInput.dataset.spotifyAutofilled === 'true')){
        tagInput.value = showName;
        tagInput.dataset.spotifyAutofilled = 'true';
        tagInput.dispatchEvent(new Event('input',{bubbles:true}));
      }

      if(data?.thumbnail_url && typeof draftArtwork !== 'undefined' && draftArtworkSource !== 'custom'){
        draftArtwork = data.thumbnail_url;
        draftArtworkSource = 'spotify';
        if(typeof updateArtworkPreview === 'function') updateArtworkPreview();
      }
    }catch(error){
      console.warn('Spotify episode metadata autofill failed.', error);
    }finally{
      if(requestId === metadataRequest) input?.classList.remove('spotify-metadata-loading');
    }
  }

  function bindSpotifyAutofill(){
    const urlInput = document.querySelector('#spotifyUrl');
    const titleInput = document.querySelector('#episodeTitle');
    const tagInput = document.querySelector('#episodeTag');
    if(!urlInput || urlInput.dataset.metadataAutofillBound === 'true') return;

    urlInput.dataset.metadataAutofillBound = 'true';
    urlInput.addEventListener('input',() => {
      clearTimeout(metadataTimer);
      metadataTimer = setTimeout(loadSpotifyMetadata,450);
    });
    urlInput.addEventListener('paste',() => {
      clearTimeout(metadataTimer);
      metadataTimer = setTimeout(loadSpotifyMetadata,80);
    });
    urlInput.addEventListener('blur',loadSpotifyMetadata);

    titleInput?.addEventListener('input',event => {
      if(event.isTrusted) titleInput.dataset.spotifyAutofilled = 'false';
    });
    tagInput?.addEventListener('input',event => {
      if(event.isTrusted) tagInput.dataset.spotifyAutofilled = 'false';
    });
  }

  function reorderStateFromContainer(container){
    if(typeof state === 'undefined' || !Array.isArray(state.episodes)) return;
    const orderedIds = [...container.querySelectorAll('.episode[data-id]')].map(card => card.dataset.id);
    if(orderedIds.length < 2) return;

    const byId = new Map(state.episodes.map(episode => [episode.id,episode]));
    const visibleSet = new Set(orderedIds);
    const slots = [];
    state.episodes.forEach((episode,index) => {
      if(visibleSet.has(episode.id)) slots.push(index);
    });

    orderedIds.forEach((id,index) => {
      if(slots[index] !== undefined && byId.has(id)) state.episodes[slots[index]] = byId.get(id);
    });

    if(typeof saveState === 'function') saveState();
    if(typeof renderAll === 'function') renderAll();
    if(typeof queueAutoSync === 'function') queueAutoSync();
    if(typeof showToast === 'function') showToast('Episode order updated');
  }

  function canReorderEpisodes(container){
    if(!isFinePointer() || container.id !== 'episodes') return false;
    const search = document.querySelector('#episodeSearch')?.value.trim();
    const filters = ['#showSpotify','#showLocal','#showOnline']
      .map(selector => document.querySelector(selector))
      .filter(Boolean);
    return !search && filters.every(input => input.checked);
  }

  function bindEpisodeDrag(card,container){
    if(!canReorderEpisodes(container)){
      card.removeAttribute('draggable');
      return;
    }

    card.draggable = true;
    card.classList.add('episode-reorderable');

    card.addEventListener('dragstart',event => {
      draggingEpisodeId = card.dataset.id || '';
      card.classList.add('episode-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain',draggingEpisodeId);
    });

    card.addEventListener('dragover',event => {
      if(!draggingEpisodeId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const dragging = container.querySelector(`.episode[data-id="${CSS.escape(draggingEpisodeId)}"]`);
      if(!dragging || dragging === card) return;
      const rect = card.getBoundingClientRect();
      container.insertBefore(dragging,event.clientY < rect.top + rect.height / 2 ? card : card.nextSibling);
    });

    card.addEventListener('drop',event => event.preventDefault());
    card.addEventListener('dragend',() => {
      card.classList.remove('episode-dragging');
      draggingEpisodeId = '';
      reorderStateFromContainer(container);
    });
  }

  function bindLongPress(card,type){
    let timer = null;
    let startX = 0;
    let startY = 0;
    let activated = false;

    const clear = () => {
      clearTimeout(timer);
      timer = null;
      card.classList.remove('long-press-pending');
    };

    card.addEventListener('pointerdown',event => {
      if(!isPhonePointer(event) || event.target.closest('button,input,a,select,textarea')) return;
      activated = false;
      startX = event.clientX;
      startY = event.clientY;
      card.classList.add('long-press-pending');
      timer = setTimeout(() => {
        activated = true;
        card.classList.remove('long-press-pending');
        card.classList.add('long-press-activated');
        navigator.vibrate?.(18);
        setTimeout(() => card.classList.remove('long-press-activated'),180);

        const id = card.dataset.id;
        if(type === 'episode' && id && typeof openEpisodeSheet === 'function') openEpisodeSheet(id);
        if(type === 'category' && id && id !== 'all' && typeof openCollectionSheet === 'function') openCollectionSheet(id);
      },LONG_PRESS_MS);
    });

    card.addEventListener('pointermove',event => {
      if(!timer) return;
      if(Math.hypot(event.clientX - startX,event.clientY - startY) > MOVE_TOLERANCE) clear();
    });
    card.addEventListener('pointerup',clear);
    card.addEventListener('pointercancel',clear);
    card.addEventListener('contextmenu',event => {
      if(isPhonePointer(event) || activated) event.preventDefault();
    });
    card.addEventListener('click',event => {
      if(!activated) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      activated = false;
    },true);
  }

  function bindCards(){
    document.querySelectorAll('.episode[data-id]').forEach(card => {
      if(boundCards.has(card)) return;
      boundCards.add(card);
      bindEpisodeDrag(card,card.parentElement);
      bindLongPress(card,'episode');
    });

    document.querySelectorAll('.group-card[data-id],.explorer-category[data-id]').forEach(card => {
      if(boundCards.has(card)) return;
      boundCards.add(card);
      bindLongPress(card,'category');
    });
  }

  function initialize(){
    bindSpotifyAutofill();
    bindCards();
    const observer = new MutationObserver(() => bindCards());
    observer.observe(document.body,{childList:true,subtree:true});
  }

  document.addEventListener('DOMContentLoaded',initialize);
})();
