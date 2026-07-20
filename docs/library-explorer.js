(() => {
  const ROOT = 'all';
  const DB_NAME = 'geodeta-local-media';
  const STORE = 'audio';
  let preferredParent = null;
  let deleteAction = null;
  let duplicateResolve = null;

  state.collections.forEach(item => {
    if(item.id !== ROOT && item.parentId === undefined) item.parentId = null;
  });

  const mediaStore = {
    open(){
      return new Promise((resolve,reject) => {
        const request = indexedDB.open(DB_NAME,1);
        request.onupgradeneeded = () => {
          if(!request.result.objectStoreNames.contains(STORE)){
            request.result.createObjectStore(STORE,{keyPath:'episodeId'});
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    },
    async put(episodeId,file){
      const database = await this.open();
      return new Promise((resolve,reject) => {
        const tx = database.transaction(STORE,'readwrite');
        tx.objectStore(STORE).put({episodeId,blob:file,name:file.name || `${episodeId}.mp3`,type:file.type || 'audio/mpeg'});
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    },
    async get(episodeId){
      const database = await this.open();
      return new Promise((resolve,reject) => {
        const request = database.transaction(STORE,'readonly').objectStore(STORE).get(episodeId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    },
    async remove(episodeId){
      const database = await this.open();
      return new Promise((resolve,reject) => {
        const tx = database.transaction(STORE,'readwrite');
        tx.objectStore(STORE).delete(episodeId);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  };

  function injectUI(){
    const profileNav = document.querySelector('#profileNav');
    if(profileNav) profileNav.innerHTML = '<i data-lucide="settings"></i>Settings';
    const profileTitle = document.querySelector('#profileView h1');
    if(profileTitle) profileTitle.textContent = 'Settings';

    const collectionName = document.querySelector('#collectionName');
    if(collectionName && !document.querySelector('#collectionParent')){
      collectionName.insertAdjacentHTML('beforebegin','<label class="field-label" for="collectionParent">Parent category</label><select id="collectionParent" class="sheet-input category-select"></select><label class="field-label" for="collectionName">Category name</label>');
    }

    const episodeTag = document.querySelector('#episodeTag');
    if(episodeTag && !document.querySelector('#episodeCategory')){
      episodeTag.insertAdjacentHTML('afterend','<label class="field-label" for="episodeCategory">Category</label><select id="episodeCategory" class="sheet-input category-select"></select>');
    }

    const search = document.querySelector('#episodeSearch')?.closest('.search-wrap');
    if(search && !document.querySelector('#subcategoryArea')){
      search.insertAdjacentHTML('beforebegin','<div id="categoryBreadcrumb" class="category-breadcrumb"></div><section id="subcategoryArea" class="subcategory-area"><div class="section-head explorer-head"><h2>Subcategories</h2><button id="addSubcategory" class="text-button">Add</button></div><div id="subcategories" class="groups subcategory-grid"></div><div id="noSubcategories" class="empty compact-empty">No subcategories here.</div></section><div class="section-head explorer-head episode-heading"><h2>Episodes</h2></div>');
    }

    const appArea = document.querySelector('.app-maintenance');
    if(appArea && !document.querySelector('#libraryTransfer')){
      appArea.insertAdjacentHTML('beforebegin','<div id="libraryTransfer" class="library-transfer"><div class="section-head"><h2>Import & Export</h2></div><div class="settings-card transfer-card"><div class="settings-row transfer-row"><div class="settings-copy"><strong>Export library</strong><span>Share categories, episodes, tags, links, and progress.</span></div><button id="exportLibrary" class="action-button"><i data-lucide="file-down"></i>JSON</button></div><div class="settings-row transfer-row"><div class="settings-copy"><strong>Export with media</strong><span>Creates a ZIP with audio available on this device.</span></div><button id="exportMedia" class="action-button"><i data-lucide="archive"></i>ZIP</button></div><div class="settings-row transfer-row"><div class="settings-copy"><strong>Import library</strong><span>Merges a Geodeta JSON or ZIP into this library.</span></div><button id="importLibrary" class="action-button"><i data-lucide="file-up"></i>Import</button><input id="importLibraryFile" type="file" accept=".json,.zip,application/json,application/zip" hidden></div></div></div>');
    }

    if(!document.querySelector('#deleteConfirm')){
      document.body.insertAdjacentHTML('beforeend','<div id="deleteConfirm" class="confirm-backdrop" hidden><div class="confirm-card" role="dialog" aria-modal="true"><div class="confirm-icon danger"><i data-lucide="trash-2"></i></div><h3 id="deleteConfirmTitle">Delete episode?</h3><p id="deleteConfirmCopy">This removes it from every category.</p><div class="confirm-actions"><button id="cancelDelete" class="confirm-cancel">Cancel</button><button id="confirmDelete" class="confirm-delete">Delete</button></div></div></div>');
    }

    if(!document.querySelector('#duplicatePrompt')){
      document.body.insertAdjacentHTML('beforeend','<div id="duplicatePrompt" class="confirm-backdrop" hidden><div class="confirm-card" role="dialog" aria-modal="true"><div class="confirm-icon"><i data-lucide="files"></i></div><h3>Duplicates found</h3><p id="duplicateCopy">Choose how existing items should be handled.</p><div class="duplicate-actions"><button id="duplicateCancel" class="confirm-cancel">Cancel import</button><button id="duplicateIgnore" class="confirm-cancel">Ignore duplicates</button><button id="duplicateReplace" class="confirm-primary">Replace duplicates</button></div></div></div>');
    }
    window.lucide?.createIcons();
  }

  injectUI();

  const parentOf = item => item?.parentId || null;
  const byId = id => state.collections.find(item => item.id === id) || null;
  const childrenOf = parent => state.collections.filter(item => item.id !== ROOT && parentOf(item) === (parent || null));

  function descendants(id){
    const result = new Set();
    const stack = [id];
    while(stack.length){
      childrenOf(stack.pop()).forEach(child => {
        if(!result.has(child.id)){
          result.add(child.id);
          stack.push(child.id);
        }
      });
    }
    return result;
  }

  function pathFor(id){
    const path = [];
    const seen = new Set();
    let item = byId(id);
    while(item && item.id !== ROOT && !seen.has(item.id)){
      path.unshift(item);
      seen.add(item.id);
      item = byId(parentOf(item));
    }
    return path;
  }

  function flatCollections(exclude=null){
    const blocked = exclude ? new Set([exclude,...descendants(exclude)]) : new Set();
    const rows = [];
    const walk = (parent,depth) => childrenOf(parent).forEach(item => {
      if(blocked.has(item.id)) return;
      rows.push({item,depth});
      walk(item.id,depth + 1);
    });
    walk(null,0);
    return rows;
  }

  function renderParentOptions(value=null,exclude=null){
    const select = document.querySelector('#collectionParent');
    if(!select) return;
    select.innerHTML = '<option value="">Library root</option>' + flatCollections(exclude).map(({item,depth}) => `<option value="${esc(item.id)}">${'— '.repeat(depth)}${esc(item.name)}</option>`).join('');
    select.value = value || '';
  }

  function renderEpisodeCategory(value=ROOT){
    const select = document.querySelector('#episodeCategory');
    if(!select) return;
    select.innerHTML = '<option value="all">Unfiled / All Episodes</option>' + flatCollections().map(({item,depth}) => `<option value="${esc(item.id)}">${'— '.repeat(depth)}${esc(item.name)}</option>`).join('');
    select.value = byId(value) ? value : ROOT;
  }

  function categoryCard(item){
    const folders = childrenOf(item.id).length;
    const episodes = state.episodes.filter(ep => (ep.groups || []).includes(item.id)).length;
    return `<article class="group-card explorer-category" data-id="${esc(item.id)}" draggable="true"><div class="card-tools"><button class="round-tool drag-handle" aria-label="Move category"><i data-lucide="grip-vertical"></i></button><button class="round-tool collection-edit" aria-label="Edit category"><i data-lucide="pencil"></i></button><button class="round-tool collection-delete" aria-label="Delete category"><i data-lucide="x"></i></button></div><span class="group-icon" style="background:${esc(item.color)}"><i data-lucide="${esc(item.icon)}"></i></span><strong>${esc(item.name)}</strong><span class="count">${folders ? `${folders} folder${folders === 1 ? '' : 's'} · ` : ''}${episodes} episode${episodes === 1 ? '' : 's'}</span></article>`;
  }

  function allCard(){
    const item = byId(ROOT) || {id:ROOT,name:'All Episodes',icon:'library',color:'#5b5ce2'};
    return `<article class="group-card explorer-category special-category" data-id="all"><span class="group-icon" style="background:${esc(item.color)}"><i data-lucide="${esc(item.icon)}"></i></span><strong>${esc(item.name)}</strong><span class="count">${state.episodes.length} saved</span></article>`;
  }

  function bindCategoryCards(mount,parent,draggable=true){
    mount.querySelectorAll('.explorer-category').forEach(card => {
      const id = card.dataset.id;
      card.addEventListener('click',event => { if(!event.target.closest('button')) openCollection(id); });
      card.querySelector('.collection-edit')?.addEventListener('click',event => { event.stopPropagation(); openCollectionSheet(id); });
      card.querySelector('.collection-delete')?.addEventListener('click',event => {
        event.stopPropagation();
        const item = byId(id);
        if(!item) return;
        const nested = descendants(id);
        openDelete(`Delete “${item.name}”?`,`Episodes stay in the library but are removed from this category.${nested.size ? ` This also removes ${nested.size} nested categor${nested.size === 1 ? 'y' : 'ies'}.` : ''}`,async () => {
          const removed = new Set([id,...nested]);
          state.collections = state.collections.filter(category => !removed.has(category.id));
          state.episodes.forEach(ep => {
            ep.groups = (ep.groups || []).filter(group => !removed.has(group));
            if(!ep.groups.length) ep.groups = [ROOT];
          });
          saveState();
          if(activeCollection && removed.has(activeCollection.id)){
            activeCollection = null;
            showView(document.querySelector('#libraryView'));
          }
          renderAll();
          if(currentUser && isUuid(id)) await db().from('collections').delete().eq('id',id);
          showToast('Category deleted');
        });
      });
      if(draggable && id !== ROOT) enableCollectionDrag(card,parent,mount);
      else { card.removeAttribute('draggable'); card.querySelector('.drag-handle')?.remove(); }
    });
    window.lucide?.createIcons();
  }

  renderCollections = function(){
    const term = document.querySelector('#collectionSearch').value.trim().toLowerCase();
    const mount = document.querySelector('#groups');
    if(term){
      const matches = state.collections.filter(item => item.name.toLowerCase().includes(term) || pathFor(item.id).map(part => part.name).join(' / ').toLowerCase().includes(term));
      mount.innerHTML = matches.map(item => item.id === ROOT ? allCard() : categoryCard(item)).join('');
      bindCategoryCards(mount,null,false);
      document.querySelector('#noCollections').hidden = matches.length > 0;
    }else{
      mount.innerHTML = allCard() + childrenOf(null).map(categoryCard).join('');
      bindCategoryCards(mount,null,true);
      document.querySelector('#noCollections').hidden = true;
    }
  };

  function renderSubcategories(){
    const area = document.querySelector('#subcategoryArea');
    const mount = document.querySelector('#subcategories');
    const crumb = document.querySelector('#categoryBreadcrumb');
    if(!activeCollection || !area || !mount || !crumb) return;
    const isAll = activeCollection.id === ROOT;
    area.hidden = isAll;
    crumb.hidden = isAll;
    if(isAll) return;

    const path = pathFor(activeCollection.id);
    crumb.innerHTML = '<button data-root="1">Library</button>' + path.map(item => `<span>›</span><button data-id="${esc(item.id)}">${esc(item.name)}</button>`).join('');
    crumb.querySelector('[data-root]')?.addEventListener('click',() => showView(document.querySelector('#libraryView')));
    crumb.querySelectorAll('[data-id]').forEach(button => button.addEventListener('click',() => openCollection(button.dataset.id)));

    const children = childrenOf(activeCollection.id);
    mount.innerHTML = children.map(categoryCard).join('');
    document.querySelector('#noSubcategories').hidden = children.length > 0;
    bindCategoryCards(mount,activeCollection.id,true);
  }

  openCollection = function(id){
    activeCollection = byId(id);
    if(!activeCollection) return;
    document.querySelector('#collectionPageTitle').textContent = activeCollection.name;
    document.querySelector('#collectionLargeIcon').style.background = activeCollection.color;
    document.querySelector('#collectionLargeIcon').innerHTML = `<i data-lucide="${esc(activeCollection.icon)}"></i>`;
    document.querySelector('#episodeSearch').value = '';
    document.querySelector('#showSpotify').checked = true;
    document.querySelector('#showLocal').checked = true;
    document.querySelector('#showOnline').checked = true;
    renderSubcategories();
    renderEpisodes();
    showView(document.querySelector('#collectionView'));
  };

  renderEpisodes = function(){
    if(!activeCollection) return;
    const term = document.querySelector('#episodeSearch').value.trim().toLowerCase();
    const allowed = {spotify:document.querySelector('#showSpotify').checked,local:document.querySelector('#showLocal').checked,online:document.querySelector('#showOnline').checked};
    let list = activeCollection.id === ROOT ? state.episodes : state.episodes.filter(ep => (ep.groups || []).includes(activeCollection.id));
    list = list.filter(ep => (`${ep.tag || ''} ${ep.title || ''}`).toLowerCase().includes(term) && allowed[ep.source]);
    document.querySelector('#episodes').innerHTML = list.map(episodeMarkup).join('');
    document.querySelector('#emptyCollection').hidden = list.length > 0;
    wireEpisodes(document.querySelector('#episodes'));
    document.querySelector('#filterButton').classList.toggle('active',!Object.values(allowed).every(Boolean));
  };

  renderAll = function(){
    renderCollections();
    renderRecent();
    if(activeCollection){
      activeCollection = byId(activeCollection.id);
      if(activeCollection){ renderSubcategories(); renderEpisodes(); }
      else showView(document.querySelector('#libraryView'));
    }
  };

  enableCollectionDrag = function(card,parent,mount){
    let touchPointerActive = false;
    card.addEventListener('pointerdown',event => {
      touchPointerActive = event.pointerType === 'touch';
    },true);
    card.addEventListener('pointerup',() => { touchPointerActive = false; },true);
    card.addEventListener('pointercancel',() => { touchPointerActive = false; },true);

    card.addEventListener('dragstart',event => {
      if(touchPointerActive || event.pointerType === 'touch'){
        event.preventDefault();
        return;
      }
      card.classList.add('dragging');
    });
    card.addEventListener('dragend',() => {
      if(!card.classList.contains('dragging')) return;
      card.classList.remove('dragging');
      syncCollectionOrder(parent,mount);
    });
    card.addEventListener('dragover',event => {
      if(touchPointerActive) return;
      event.preventDefault();
      const moving = mount.querySelector('.dragging');
      if(!moving || moving === card) return;
      const rect = card.getBoundingClientRect();
      mount.insertBefore(moving,event.clientY < rect.top + rect.height / 2 ? card : card.nextSibling);
    });
    const handle = card.querySelector('.drag-handle');
    let moving = false;
    handle?.addEventListener('pointerdown',event => {
      if(event.pointerType === 'touch') return;
      moving = true;
      handle.setPointerCapture(event.pointerId);
      card.classList.add('dragging');
      event.stopPropagation();
    });
    handle?.addEventListener('pointermove',event => {
      if(!moving || event.pointerType === 'touch') return;
      const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('.explorer-category');
      if(target && target !== card && target.parentElement === mount){
        const rect = target.getBoundingClientRect();
        mount.insertBefore(card,event.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
      }
    });
    const finishPointerMove = () => {
      if(!moving) return;
      moving = false;
      card.classList.remove('dragging');
      syncCollectionOrder(parent,mount);
    };
    handle?.addEventListener('pointerup',finishPointerMove);
    handle?.addEventListener('pointercancel',finishPointerMove);
  };

  syncCollectionOrder = function(parent=null,mount=document.querySelector('#groups')){
    const normalizedParent = parent || null;
    const ids = [...mount.querySelectorAll('.explorer-category')]
      .map(card => card.dataset.id)
      .filter(id => id !== ROOT && parentOf(byId(id)) === normalizedParent);
    const byCollectionId = new Map(state.collections.map(item => [item.id,item]));
    const visibleSet = new Set(ids);
    const slots = [];
    state.collections.forEach((item,index) => {
      if(visibleSet.has(item.id) && parentOf(item) === normalizedParent) slots.push(index);
    });
    const previous = slots.map(index => state.collections[index]?.id);
    if(previous.every((id,index) => id === ids[index])) return;
    ids.forEach((id,index) => {
      if(slots[index] !== undefined && byCollectionId.has(id)){
        state.collections[slots[index]] = byCollectionId.get(id);
      }
    });
    saveState();
    queueAutoSync();
    showToast('Category order updated');
  };

  const originalOpenCollectionSheet = openCollectionSheet;
  openCollectionSheet = function(id=null){
    const item = id ? byId(id) : null;
    const parent = item ? parentOf(item) : preferredParent || (activeCollection && activeCollection.id !== ROOT ? activeCollection.id : null);
    preferredParent = null;
    renderParentOptions(parent,id);
    originalOpenCollectionSheet(id);
    document.querySelector('#collectionSheetTitle').textContent = item ? 'Edit category' : 'New category';
    document.querySelector('#createCollection').textContent = item ? 'Save changes' : 'Create category';
  };

  saveCollection = function(){
    const name = document.querySelector('#collectionName').value.trim();
    if(!name){ showToast('Enter a category name'); return; }
    const parentId = document.querySelector('#collectionParent').value || null;
    const editing = Boolean(editingCollectionId);
    if(editing){
      const item = byId(editingCollectionId);
      if(parentId === item?.id || descendants(item?.id).has(parentId)){ showToast('A category cannot contain itself'); return; }
      if(item) Object.assign(item,{name,icon:selectedIcon,color:selectedColor,parentId});
    }else{
      state.collections.push({id:crypto.randomUUID(),name,icon:selectedIcon,color:selectedColor,parentId});
    }
    saveState(); renderAll(); closeSheets(); queueAutoSync(); showToast(editing ? 'Category updated' : 'Category created');
  };

  const originalOpenEpisodeSheet = openEpisodeSheet;
  openEpisodeSheet = function(id=null){
    const ep = id ? state.episodes.find(item => item.id === id) : null;
    const selected = ep?.groups?.find(group => group !== ROOT) || (activeCollection && activeCollection.id !== ROOT ? activeCollection.id : ROOT);
    renderEpisodeCategory(selected);
    originalOpenEpisodeSheet(id);
  };

  const originalSaveEpisode = saveEpisode;
  saveEpisode = async function(){
    const before = new Set(state.episodes.map(ep => ep.id));
    const editId = editingEpisodeId;
    const category = document.querySelector('#episodeCategory')?.value || ROOT;
    const file = document.querySelector('#audioFile')?.files?.[0] || null;
    await originalSaveEpisode();
    const target = editId ? state.episodes.find(ep => ep.id === editId) : state.episodes.find(ep => !before.has(ep.id));
    if(!target) return;
    target.groups = category === ROOT ? [ROOT] : [category];
    target.audioPath = '';
    if(file){ await mediaStore.put(target.id,file); target.localName = file.name; target.source = 'local'; }
    saveState(); renderAll(); queueAutoSync({episodeId:target.id,includeFiles:false});
  };

  collectionRows = userId => state.collections.filter(item => item.id !== ROOT).map((item,index) => ({id:item.id,user_id:userId,name:item.name,icon:item.icon,color:item.color,parent_id:parentOf(item),position:index}));
  episodeRows = userId => state.episodes.map(ep => ({id:ep.id,user_id:userId,title:ep.title,tag:ep.tag || 'Episode',source_type:ep.source || 'local',spotify_url:ep.url || null,spotify_embed_url:ep.embed || null,artwork_path:ep.artworkPath || null,artwork_url:ep.artSource === 'spotify' ? ep.artImage || null : null,audio_path:null,original_filename:ep.localName || ep.onlineName || null,position_ms:Math.round(ep.positionMs || 0),progress_percent:Number(ep.progress) || 0,finished:Number(ep.progress) >= 98,time_label:normalizeTimeLabel(ep.timeLabel || ep.time),saved_at:new Date(Number(ep.savedAt) > 1e12 ? Number(ep.savedAt) : Date.now()).toISOString()}));

  const originalDownloadRemoteData = downloadRemoteData;
  downloadRemoteData = async function(){
    const result = await originalDownloadRemoteData();
    if(!currentUser) return result;
    const {data,error} = await db().from('collections').select('id,parent_id').eq('user_id',currentUser.id);
    if(!error){
      const parents = new Map(data.map(row => [row.id,row.parent_id || null]));
      state.collections.forEach(item => { if(item.id !== ROOT) item.parentId = parents.get(item.id) || null; });
    }
    state.episodes.forEach(ep => { ep.audioPath = ''; ep.onlinePath = ''; if(ep.source !== 'spotify' && ep.source !== 'online') ep.source = 'local'; });
    await hydrateLocalMedia();
    saveState(false); renderAll();
    return result;
  };

  syncFiles = async function(){
    if(!currentUser) throw new Error('Sign in with Google first');
    normalizeIds();
    for(const ep of state.episodes){
      const file = pendingAudioFiles.get(ep.id);
      if(file){ await mediaStore.put(ep.id,file); ep.localName = file.name; ep.audioPath = ''; pendingAudioFiles.delete(ep.id); }
      if(ep.artSource === 'custom' && ep.artImage?.startsWith('data:') && !ep.artworkPath){
        const blob = dataUrlToBlob(ep.artImage);
        const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
        const path = `${currentUser.id}/${ep.id}.${ext}`;
        const {error} = await db().storage.from('episode-artwork').upload(path,blob,{upsert:true,contentType:blob.type});
        if(error) throw error;
        ep.artworkPath = path;
      }
    }
    saveState(false);
    await uploadLocalData();
  };

  openPlayer = function(id){
    selectedEpisode = state.episodes.find(ep => ep.id === id);
    if(!selectedEpisode) return;
    document.querySelector('#playTitle').textContent = selectedEpisode.title;
    document.querySelector('#playerMount').innerHTML = '';
    document.querySelector('#openSpotify').hidden = selectedEpisode.source !== 'spotify';
    document.querySelector('#playHere').hidden = false;
    document.querySelector('#playHere').innerHTML = selectedEpisode.source === 'online' ? '<i data-lucide="server"></i>Play from computer' : '<i data-lucide="play"></i>Play in app';
    openSheet('#playSheet');
  };

  playSelected = async function(){
    if(!selectedEpisode) return;
    if(selectedEpisode.source === 'spotify'){
      const embed = selectedEpisode.embed || extractSpotifyEmbed(selectedEpisode.url);
      if(!embed){ showToast('This Spotify link cannot be embedded'); return; }
      document.querySelector('#playerMount').innerHTML = `<iframe class="player-frame" src="${esc(embed)}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
      document.querySelector('#playHere').hidden = true;
      return;
    }
    if(selectedEpisode.source === 'online'){
      const url = selectedEpisode.serverUrl || selectedEpisode.downloadUrl || '';
      if(!url){ showToast('Personal media server is not connected yet'); return; }
      document.querySelector('#playerMount').innerHTML = `<audio class="local-player" controls autoplay src="${esc(url)}"></audio>`;
      document.querySelector('#playHere').hidden = true;
      return;
    }
    if(!selectedEpisode.localUrl){
      const stored = await mediaStore.get(selectedEpisode.id).catch(() => null);
      if(stored?.blob){ selectedEpisode.localUrl = URL.createObjectURL(stored.blob); selectedEpisode.localName ||= stored.name; }
    }
    if(!selectedEpisode.localUrl){ showToast('This audio file is not on this device'); return; }
    document.querySelector('#playerMount').innerHTML = `<audio class="local-player" controls autoplay src="${esc(selectedEpisode.localUrl)}"></audio>`;
    document.querySelector('#playHere').hidden = true;
  };

  wireEpisodes = function(container){
    container.querySelectorAll('.episode').forEach(card => {
      const id = card.dataset.id;
      card.querySelector('.episode-delete')?.addEventListener('click',event => {
        event.stopPropagation();
        const ep = state.episodes.find(item => item.id === id);
        openDelete(`Delete “${ep?.title || 'this episode'}”?`,'This removes it from every category and from your synced metadata.',async () => {
          state.episodes = state.episodes.filter(item => item.id !== id);
          pendingAudioFiles.delete(id);
          await mediaStore.remove(id).catch(() => null);
          saveState(); renderAll();
          if(currentUser && isUuid(id)) await db().from('episodes').delete().eq('id',id);
          showToast('Episode deleted');
        });
      });
      card.querySelector('.episode-edit')?.addEventListener('click',event => { event.stopPropagation(); openEpisodeSheet(id); });
      card.querySelector('.episode-main')?.addEventListener('click',() => openPlayer(id));
    });
    window.lucide?.createIcons();
  };

  function openDelete(title,copy,action){
    deleteAction = action;
    document.querySelector('#deleteConfirmTitle').textContent = title;
    document.querySelector('#deleteConfirmCopy').textContent = copy;
    document.querySelector('#deleteConfirm').hidden = false;
    window.lucide?.createIcons();
  }
  function closeDelete(){ document.querySelector('#deleteConfirm').hidden = true; deleteAction = null; }

  function exportPayload(){
    return {
      format:'geodeta-media-library',
      version:2,
      exportedAt:new Date().toISOString(),
      collections:state.collections.filter(item => item.id !== ROOT).map(item => ({id:item.id,name:item.name,icon:item.icon,color:item.color,parentId:parentOf(item)})),
      episodes:state.episodes.map(ep => {
        const copy = structuredClone(ep);
        delete copy.localUrl; delete copy.audioPath; delete copy.onlinePath; delete copy.syncStatus;
        if(copy.artImage?.startsWith('data:') || copy.artImage?.includes('/storage/v1/object/sign/')) copy.artImage = '';
        return copy;
      })
    };
  }

  function downloadBlob(blob,name){
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }

  async function exportJson(){
    downloadBlob(new Blob([JSON.stringify(exportPayload(),null,2)],{type:'application/json'}),`geodeta-library-${new Date().toISOString().slice(0,10)}.json`);
    showToast('Library exported');
  }

  async function exportZip(){
    if(!window.JSZip){ showToast('ZIP library did not load'); return; }
    const button = document.querySelector('#exportMedia');
    button.disabled = true; button.textContent = 'Building…';
    try{
      const zip = new JSZip();
      const payload = exportPayload();
      for(const episode of payload.episodes){
        let stored = await mediaStore.get(episode.id).catch(() => null);
        if(!stored && pendingAudioFiles.has(episode.id)){ const file = pendingAudioFiles.get(episode.id); stored = {blob:file,name:file.name}; }
        if(stored?.blob){
          const name = (stored.name || `${episode.id}.mp3`).replace(/[^a-zA-Z0-9._-]/g,'_');
          episode.mediaPath = `media/audio/${episode.id}/${name}`;
          zip.file(episode.mediaPath,stored.blob);
        }
      }
      zip.file('library.json',JSON.stringify(payload,null,2));
      const blob = await zip.generateAsync({type:'blob',compression:'DEFLATE'});
      downloadBlob(blob,`geodeta-library-with-media-${new Date().toISOString().slice(0,10)}.zip`);
      showToast('Library ZIP exported');
    }catch(error){ console.error(error); showToast('Export failed'); }
    finally{ button.disabled = false; button.innerHTML = '<i data-lucide="archive"></i>ZIP'; window.lucide?.createIcons(); }
  }

  function duplicatePrompt(count){
    return new Promise(resolve => {
      duplicateResolve = resolve;
      document.querySelector('#duplicateCopy').textContent = `${count} duplicate item${count === 1 ? '' : 's'} found. Replace existing copies or keep them unchanged.`;
      document.querySelector('#duplicatePrompt').hidden = false;
    });
  }
  function finishDuplicate(choice){ document.querySelector('#duplicatePrompt').hidden = true; duplicateResolve?.(choice); duplicateResolve = null; }

  const episodeDuplicate = imported => state.episodes.find(existing => existing.id === imported.id || (imported.url && existing.url === imported.url) || (existing.source === imported.source && existing.title?.trim().toLowerCase() === imported.title?.trim().toLowerCase() && (existing.tag || '').trim().toLowerCase() === (imported.tag || '').trim().toLowerCase())) || null;

  async function importPayload(payload,zip=null){
    if(payload?.format !== 'geodeta-media-library' || !Array.isArray(payload.collections) || !Array.isArray(payload.episodes)) throw new Error('This is not a Geodeta Media export');
    const importedCollections = payload.collections.map(item => ({...item,parentId:item.parentId || item.parent_id || null}));
    let duplicateCount = importedCollections.filter(item => state.collections.some(existing => existing.id === item.id)).length + payload.episodes.filter(episodeDuplicate).length;
    let policy = 'ignore';
    if(duplicateCount){ policy = await duplicatePrompt(duplicateCount); if(policy === 'cancel') return; }

    const map = new Map();
    const pending = [...importedCollections];
    for(let pass=0; pass<importedCollections.length + 2 && pending.length; pass++){
      for(let index=pending.length - 1; index>=0; index--){
        const imported = pending[index];
        if(imported.parentId && importedCollections.some(item => item.id === imported.parentId) && !map.has(imported.parentId)) continue;
        const parent = imported.parentId ? map.get(imported.parentId) || null : null;
        const duplicate = state.collections.find(existing => existing.id === imported.id || (existing.name.toLowerCase() === imported.name.toLowerCase() && parentOf(existing) === parent));
        if(duplicate){
          map.set(imported.id,duplicate.id);
          if(policy === 'replace') Object.assign(duplicate,{name:imported.name,icon:imported.icon || 'folder',color:imported.color || '#5b5ce2',parentId:parent});
        }else{
          const id = isUuid(imported.id) && !byId(imported.id) ? imported.id : crypto.randomUUID();
          map.set(imported.id,id);
          state.collections.push({id,name:imported.name || 'Imported category',icon:imported.icon || 'folder',color:imported.color || '#5b5ce2',parentId:parent});
        }
        pending.splice(index,1);
      }
    }

    for(const imported of pending){
      const id = crypto.randomUUID(); map.set(imported.id,id);
      state.collections.push({id,name:imported.name || 'Imported category',icon:imported.icon || 'folder',color:imported.color || '#5b5ce2',parentId:null});
    }

    for(const imported of payload.episodes){
      const duplicate = episodeDuplicate(imported);
      if(duplicate && policy === 'ignore') continue;
      const target = duplicate || {};
      const id = duplicate?.id || (isUuid(imported.id) && !state.episodes.some(ep => ep.id === imported.id) ? imported.id : crypto.randomUUID());
      const groups = (imported.groups || []).map(group => group === ROOT ? ROOT : map.get(group)).filter(Boolean);
      Object.assign(target,structuredClone(imported),{id,groups:groups.length ? groups : [ROOT],localUrl:'',audioPath:'',onlinePath:'',syncStatus:currentUser ? 'pending' : 'local'});
      if(zip && imported.mediaPath){
        const entry = zip.file(imported.mediaPath);
        if(entry){
          const blob = await entry.async('blob');
          const name = imported.mediaPath.split('/').pop() || `${id}.mp3`;
          const file = new File([blob],name,{type:blob.type || 'audio/mpeg'});
          await mediaStore.put(id,file);
          target.source = 'local'; target.localName = name; target.localUrl = URL.createObjectURL(blob);
        }
      }
      if(!duplicate) state.episodes.push(target);
    }
    saveState(); renderAll(); queueAutoSync(); showToast('Library imported');
  }

  async function importFile(file){
    if(!file) return;
    try{
      if(file.name.toLowerCase().endsWith('.zip')){
        if(!window.JSZip) throw new Error('ZIP library did not load');
        const zip = await JSZip.loadAsync(file);
        const entry = zip.file('library.json');
        if(!entry) throw new Error('ZIP does not contain library.json');
        await importPayload(JSON.parse(await entry.async('text')),zip);
      }else await importPayload(JSON.parse(await file.text()));
    }catch(error){ console.error(error); showToast(error.message || 'Import failed'); }
    finally{ document.querySelector('#importLibraryFile').value = ''; }
  }

  async function hydrateLocalMedia(){
    for(const ep of state.episodes){
      if(ep.source !== 'local' || ep.localUrl) continue;
      const stored = await mediaStore.get(ep.id).catch(() => null);
      if(stored?.blob){ ep.localUrl = URL.createObjectURL(stored.blob); ep.localName ||= stored.name; }
    }
    saveState(false);
  }

  document.querySelector('#backButton')?.addEventListener('click',event => {
    event.preventDefault(); event.stopImmediatePropagation();
    const parent = parentOf(activeCollection);
    if(parent) openCollection(parent); else showView(document.querySelector('#libraryView'));
  },true);
  document.querySelector('#addSubcategory')?.addEventListener('click',() => { preferredParent = activeCollection?.id && activeCollection.id !== ROOT ? activeCollection.id : null; openCollectionSheet(); });
  document.querySelector('#cancelDelete')?.addEventListener('click',closeDelete);
  document.querySelector('#confirmDelete')?.addEventListener('click',async () => { const action = deleteAction; closeDelete(); await action?.(); });
  document.querySelector('#deleteConfirm')?.addEventListener('click',event => { if(event.target.id === 'deleteConfirm') closeDelete(); });
  document.querySelector('#duplicateCancel')?.addEventListener('click',() => finishDuplicate('cancel'));
  document.querySelector('#duplicateIgnore')?.addEventListener('click',() => finishDuplicate('ignore'));
  document.querySelector('#duplicateReplace')?.addEventListener('click',() => finishDuplicate('replace'));
  document.querySelector('#exportLibrary')?.addEventListener('click',exportJson);
  document.querySelector('#exportMedia')?.addEventListener('click',exportZip);
  document.querySelector('#importLibrary')?.addEventListener('click',() => document.querySelector('#importLibraryFile').click());
  document.querySelector('#importLibraryFile')?.addEventListener('change',event => importFile(event.target.files[0]));

  document.addEventListener('DOMContentLoaded',async () => {
    await hydrateLocalMedia();
    renderAll();
    window.lucide?.createIcons();
  });
})();