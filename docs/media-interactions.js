(() => {
  const REORDER_HOLD_MS = 350;
  const EDIT_HOLD_MS = 850;
  const MOVE_TOLERANCE = 12;
  const boundCards = new WeakSet();
  let metadataRequest = 0;
  let metadataTimer = null;
  let draggingEpisodeId = '';
  let activeMobileGesture = null;
  let suppressClickUntil = 0;

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
    if(typeof state === 'undefined' || !Array.isArray(state.episodes)) return false;
    const orderedIds = [...container.querySelectorAll('.episode[data-id]')].map(card => card.dataset.id);
    if(orderedIds.length < 2) return false;
  
    const byId = new Map(state.episodes.map(episode => [episode.id,episode]));
    const visibleSet = new Set(orderedIds);
    const slots = [];
    state.episodes.forEach((episode,index) => {
      if(visibleSet.has(episode.id)) slots.push(index);
    });
  
    const previousIds = slots.map(index => state.episodes[index]?.id);
    if(previousIds.every((id,index) => id === orderedIds[index])) return false;
  
    orderedIds.forEach((id,index) => {
      if(slots[index] !== undefined && byId.has(id)) state.episodes[slots[index]] = byId.get(id);
    });
  
    if(typeof saveState === 'function') saveState();
    if(typeof renderAll === 'function') renderAll();
    if(typeof queueAutoSync === 'function') queueAutoSync();
    if(typeof showToast === 'function') showToast('Episode order updated');
    return true;
  }

  function episodeListCanReorder(container){
    if(container.id !== 'episodes') return false;
    const search = document.querySelector('#episodeSearch')?.value.trim();
    const filters = ['#showSpotify','#showLocal','#showOnline']
      .map(selector => document.querySelector(selector))
      .filter(Boolean);
    return !search && filters.every(input => input.checked);
  }

  function canReorderEpisodes(container){
    return isFinePointer() && episodeListCanReorder(container);
  }

  function bindEpisodeDrag(card,container){
    if(!canReorderEpisodes(container)){
      card.removeAttribute('draggable');
      return;
    }
  
    let phonePointerActive = false;
    card.draggable = true;
    card.classList.add('episode-reorderable');
  
    card.addEventListener('pointerdown',event => {
      phonePointerActive = isPhonePointer(event);
    },true);
    card.addEventListener('pointerup',() => { phonePointerActive = false; },true);
    card.addEventListener('pointercancel',() => { phonePointerActive = false; },true);
  
    card.addEventListener('dragstart',event => {
      if(phonePointerActive || isPhonePointer(event)){
        event.preventDefault();
        return;
      }
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

  function collectionParentId(id){
    if(typeof state === 'undefined' || !Array.isArray(state.collections)) return null;
    return state.collections.find(item => item.id === id)?.parentId || null;
  }

  function reorderCollectionsFromContainer(container,parentId){
    if(typeof state === 'undefined' || !Array.isArray(state.collections)) return false;
    const normalizedParent = parentId || null;
    const orderedIds = [...container.querySelectorAll('.explorer-category[data-id],.group-card[data-id]')]
      .map(card => card.dataset.id)
      .filter(id => id && id !== 'all' && collectionParentId(id) === normalizedParent);
    if(orderedIds.length < 2) return false;
  
    const byId = new Map(state.collections.map(item => [item.id,item]));
    const visibleSet = new Set(orderedIds);
    const slots = [];
    state.collections.forEach((item,index) => {
      if(visibleSet.has(item.id) && (item.parentId || null) === normalizedParent) slots.push(index);
    });
  
    const previousIds = slots.map(index => state.collections[index]?.id);
    if(previousIds.every((id,index) => id === orderedIds[index])) return false;
  
    orderedIds.forEach((id,index) => {
      if(slots[index] !== undefined && byId.has(id)) state.collections[slots[index]] = byId.get(id);
    });
  
    if(typeof saveState === 'function') saveState();
    if(typeof renderAll === 'function') renderAll();
    if(typeof queueAutoSync === 'function') queueAutoSync();
    if(typeof showToast === 'function') showToast('Category order updated');
    return true;
  }

  function touchById(event,identifier){
    return [...event.touches,...event.changedTouches].find(touch => touch.identifier === identifier) || null;
  }

  function mobileReorderTarget(gesture,x,y){
    const selector = gesture.type === 'episode'
      ? '.episode[data-id]'
      : '.explorer-category[data-id],.group-card[data-id]';
    const target = document.elementFromPoint(x,y)?.closest(selector);
    if(!target || target === gesture.card || target.parentElement !== gesture.container) return null;
    if(gesture.type === 'category'){
      const id = target.dataset.id;
      if(!id || id === 'all' || collectionParentId(id) !== gesture.parentId) return null;
    }
    return target;
  }

  function canStartMobileReorder(gesture){
    if(gesture.type === 'episode'){
      return episodeListCanReorder(gesture.container)
        && gesture.container.querySelectorAll('.episode[data-id]').length > 1;
    }
  
    if(gesture.card.dataset.id === 'all') return false;
    if(gesture.container.id === 'groups' && document.querySelector('#collectionSearch')?.value.trim()) return false;
    return [...gesture.container.querySelectorAll('.explorer-category[data-id],.group-card[data-id]')]
      .filter(card => card.dataset.id !== 'all' && collectionParentId(card.dataset.id) === gesture.parentId)
      .length > 1;
  }

  function moveMobileCard(gesture,x,y){
    const target = mobileReorderTarget(gesture,x,y);
    if(!target) return;
    const rect = target.getBoundingClientRect();
    gesture.container.insertBefore(
      gesture.card,
      y < rect.top + rect.height / 2 ? target : target.nextSibling
    );
  }

  function finishMobileGesture(gesture,event,cancelled=false){
    clearTimeout(gesture.readyTimer);
    clearTimeout(gesture.editTimer);
    gesture.card.classList.remove('long-press-pending','long-press-activated','episode-dragging','dragging');
  
    if(gesture.mode === 'reorder' && !cancelled){
      event.preventDefault();
      suppressClickUntil = Date.now() + 700;
      if(gesture.type === 'episode') reorderStateFromContainer(gesture.container);
      else reorderCollectionsFromContainer(gesture.container,gesture.parentId);
    }else if(gesture.mode === 'edit'){
      event.preventDefault();
      suppressClickUntil = Date.now() + 700;
    }
  
    if(activeMobileGesture === gesture) activeMobileGesture = null;
  }

  function bindMobileGestures(card,type){
    card.addEventListener('touchstart',event => {
      if(event.touches.length !== 1 || activeMobileGesture) return;
      const interactive = event.target.closest('button,input,a,select,textarea');
      if(interactive && !interactive.classList.contains('drag-handle')) return;
      if(type === 'category' && card.dataset.id === 'all') return;
  
      const touch = event.touches[0];
      const gesture = {
        card,
        type,
        container:card.parentElement,
        identifier:touch.identifier,
        startX:touch.clientX,
        startY:touch.clientY,
        startedAt:performance.now(),
        parentId:type === 'category' ? collectionParentId(card.dataset.id) : null,
        mode:'pending',
        readyTimer:null,
        editTimer:null,
      };
  
      gesture.readyTimer = setTimeout(() => {
        if(activeMobileGesture !== gesture || gesture.mode !== 'pending') return;
        gesture.mode = 'ready';
        card.classList.add('long-press-pending');
      },REORDER_HOLD_MS);
  
      gesture.editTimer = setTimeout(() => {
        if(activeMobileGesture !== gesture || !['pending','ready'].includes(gesture.mode)) return;
        gesture.mode = 'edit';
        card.classList.remove('long-press-pending');
        card.classList.add('long-press-activated');
        navigator.vibrate?.(18);
        setTimeout(() => card.classList.remove('long-press-activated'),180);
  
        const id = card.dataset.id;
        if(type === 'episode' && id && typeof openEpisodeSheet === 'function') openEpisodeSheet(id);
        if(type === 'category' && id && typeof openCollectionSheet === 'function') openCollectionSheet(id);
      },EDIT_HOLD_MS);
  
      activeMobileGesture = gesture;
    },{passive:true});
  
    card.addEventListener('touchmove',event => {
      const gesture = activeMobileGesture;
      if(!gesture || gesture.card !== card) return;
      const touch = touchById(event,gesture.identifier);
      if(!touch) return;
  
      const distance = Math.hypot(touch.clientX - gesture.startX,touch.clientY - gesture.startY);
      const elapsed = performance.now() - gesture.startedAt;
  
      if(['pending','ready'].includes(gesture.mode) && distance > MOVE_TOLERANCE){
        if(elapsed < REORDER_HOLD_MS || !canStartMobileReorder(gesture)){
          gesture.mode = 'scroll';
          clearTimeout(gesture.readyTimer);
          clearTimeout(gesture.editTimer);
          card.classList.remove('long-press-pending');
          return;
        }
  
        gesture.mode = 'reorder';
        clearTimeout(gesture.editTimer);
        card.classList.remove('long-press-pending');
        card.classList.add(type === 'episode' ? 'episode-dragging' : 'dragging');
        navigator.vibrate?.(12);
      }
  
      if(gesture.mode !== 'reorder') return;
      event.preventDefault();
      moveMobileCard(gesture,touch.clientX,touch.clientY);
    },{passive:false});
  
    card.addEventListener('touchend',event => {
      const gesture = activeMobileGesture;
      if(!gesture || gesture.card !== card) return;
      finishMobileGesture(gesture,event);
    },{passive:false});
  
    card.addEventListener('touchcancel',event => {
      const gesture = activeMobileGesture;
      if(!gesture || gesture.card !== card) return;
      finishMobileGesture(gesture,event,true);
    },{passive:false});
  
    card.addEventListener('contextmenu',event => {
      if(activeMobileGesture?.card === card || event.sourceCapabilities?.firesTouchEvents){
        event.preventDefault();
      }
    });
  }

  function bindCards(){
    document.querySelectorAll('.episode[data-id]').forEach(card => {
      if(boundCards.has(card)) return;
      boundCards.add(card);
      bindEpisodeDrag(card,card.parentElement);
      bindMobileGestures(card,'episode');
    });

    document.querySelectorAll('.group-card[data-id],.explorer-category[data-id]').forEach(card => {
      if(boundCards.has(card)) return;
      boundCards.add(card);
      bindMobileGestures(card,'category');
    });
  }

  function initialize(){
    bindSpotifyAutofill();
    bindCards();
    document.addEventListener('click',event => {
      if(Date.now() >= suppressClickUntil || !event.target.closest('.episode,.group-card,.explorer-category')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },true);
    const observer = new MutationObserver(() => bindCards());
    observer.observe(document.body,{childList:true,subtree:true});
  }

  document.addEventListener('DOMContentLoaded',initialize);
})();
