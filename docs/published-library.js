(() => {
  const PUBLIC_HOST = 'podcasts.geodeta.us';
  const PUBLIC_INSTALL_NEVER_KEY = 'geodetaPublicInstallNever';
  const isPublicSite = () => location.hostname === PUBLIC_HOST;
  const byId = id => document.getElementById(id);

  function cleanSlug(){
    return decodeURIComponent(location.pathname.split('/').filter(Boolean)[0] || '')
      .replace(/^@/,'')
      .trim()
      .toLowerCase();
  }

  function publicLibraryUrl(slug){
    return `https://${PUBLIC_HOST}/@${slug}`;
  }

  async function shareLink(url,title='Geodeta Podcasts'){
    try{
      if(navigator.share){
        await navigator.share({title,url});
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast('Public link copied');
    }catch(error){
      if(error?.name === 'AbortError') return;
      const input = document.createElement('textarea');
      input.value = url;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      showToast('Public link copied');
    }
  }

  function requestPublicInstall(){
    const privateInstallButton = byId('installApp');
    if(privateInstallButton) privateInstallButton.click();
    else showToast('Use your browser menu to install this app');
  }

  function injectPublicActions(slug){
    const topbar = document.querySelector('#libraryView .topbar');
    if(!topbar || byId('publicPageActions')) return;
    topbar.insertAdjacentHTML('beforeend',`
      <div id="publicPageActions" class="public-page-actions">
        <button id="publicBackToDirectory" class="public-header-button" type="button" ${slug ? '' : 'hidden'}><i data-lucide="arrow-left"></i><span>All libraries</span></button>
        <button id="publicShareLibrary" class="public-header-button" type="button" ${slug ? '' : 'hidden'}><i data-lucide="share-2"></i><span>Share</span></button>
        <button id="publicInstallApp" class="public-header-button public-install-button" type="button"><i data-lucide="download"></i><span>Install app</span></button>
      </div>`);
    byId('publicBackToDirectory')?.addEventListener('click',() => { location.href = '/'; });
    byId('publicShareLibrary')?.addEventListener('click',() => shareLink(publicLibraryUrl(slug),document.title));
    byId('publicInstallApp')?.addEventListener('click',requestPublicInstall);
    refreshIcons();
  }

  function showPublicInstallPrompt(){
    if(cleanSlug() || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) return;
    if(localStorage.getItem(PUBLIC_INSTALL_NEVER_KEY) === 'true' || byId('publicInstallPrompt')) return;
    document.body.insertAdjacentHTML('beforeend',`
      <div id="publicInstallPrompt" class="public-install-prompt-backdrop" role="dialog" aria-modal="true" aria-labelledby="publicInstallPromptTitle">
        <section class="public-install-prompt">
          <span class="public-install-prompt-icon"><i data-lucide="smartphone"></i></span>
          <p class="eyebrow">GEODETA PODCASTS</p>
          <h3 id="publicInstallPromptTitle">Install the app?</h3>
          <p>Keep published podcast libraries one tap away and open them in a standalone app.</p>
          <button id="publicInstallNow" class="primary" type="button"><i data-lucide="download"></i>Install</button>
          <div class="public-install-dismissals">
            <button id="publicInstallNotNow" class="public-link-button" type="button">Not now</button>
            <button id="publicInstallNever" class="public-link-button" type="button">Don’t remind me again</button>
          </div>
        </section>
      </div>`);
    const close = () => byId('publicInstallPrompt')?.remove();
    byId('publicInstallNow')?.addEventListener('click',() => { close(); requestPublicInstall(); });
    byId('publicInstallNotNow')?.addEventListener('click',close);
    byId('publicInstallNever')?.addEventListener('click',() => {
      localStorage.setItem(PUBLIC_INSTALL_NEVER_KEY,'true');
      close();
    });
    refreshIcons();
  }

  function publicEpisodeOpen(privateOpenPlayer){
    return id => {
      const episode = state.episodes.find(item => item.id === id);
      if(!episode) return;
      if(episode.source !== 'spotify' || !episode.url){
        showToast('This episode is listed only');
        return;
      }
      privateOpenPlayer(id);
    };
  }

  function setPublicChrome(displayName='Published Libraries'){
    document.body.classList.add('published-site','library-read-only');
    document.title = displayName === 'Published Libraries'
      ? 'Geodeta Published Libraries'
      : `${displayName} · Geodeta Podcasts`;
    const eyebrow = document.querySelector('#libraryView .topbar .eyebrow');
    const title = document.querySelector('#libraryView .topbar h1');
    if(eyebrow) eyebrow.textContent = displayName === 'Published Libraries' ? 'GEODETA PODCASTS' : displayName.toUpperCase();
    if(title) title.textContent = displayName === 'Published Libraries' ? 'Published Libraries' : 'Library';
    const avatar = byId('headerAvatar');
    if(avatar){
      avatar.textContent = displayName.slice(0,1).toUpperCase();
      avatar.setAttribute('aria-label',displayName);
    }
  }

  async function loadDirectory(){
    setPublicChrome();
    window.startupLoader?.setStatus?.('Loading published libraries…');
    const {data,error} = await db()
      .from('published_profiles')
      .select('slug,display_name,published_at')
      .eq('is_published',true)
      .order('display_name');
    if(error) throw error;

    const groups = byId('groups');
    const recentHead = byId('recentEpisodes')?.previousElementSibling;
    if(recentHead) recentHead.hidden = true;
    byId('recentEpisodes').innerHTML = '';
    byId('recentEmpty').hidden = true;
    byId('collectionSearch').placeholder = 'Search published libraries';

    const draw = () => {
      const term = byId('collectionSearch').value.trim().toLowerCase();
      const rows = (data || []).filter(row => row.display_name.toLowerCase().includes(term));
      groups.innerHTML = rows.map(row => `
        <article class="group-card public-profile-card" data-slug="${esc(row.slug)}">
          <span class="group-icon"><i data-lucide="library"></i></span>
          <span class="public-profile-copy">
            <strong>${esc(row.display_name)}</strong>
            <span class="count">podcasts.geodeta.us/@${esc(row.slug)}</span>
          </span>
          <i class="public-row-arrow" data-lucide="chevron-right"></i>
        </article>
      `).join('');
      groups.querySelectorAll('[data-slug]').forEach(card => {
        card.addEventListener('click',() => { location.href = `/@${card.dataset.slug}`; });
      });
      byId('noCollections').textContent = rows.length ? '' : 'No published libraries found.';
      byId('noCollections').hidden = rows.length > 0;
      refreshIcons();
    };
    byId('collectionSearch').addEventListener('input',draw);
    draw();
  }

  async function loadPublishedLibrary(slug){
    window.startupLoader?.setStatus?.('Loading published collection cards…');
    const {data,error} = await db().rpc('get_published_library',{p_slug:slug});
    if(error) throw error;
    if(!data){
      setPublicChrome('Published Libraries');
      byId('groups').innerHTML = '<div class="public-not-found"><strong>Library not found</strong><span>This library is not published.</span><a href="/">Browse published libraries</a></div>';
      byId('recentEpisodes').innerHTML = '';
      byId('recentEmpty').hidden = true;
      return;
    }

    setPublicChrome(data.profile.displayName);
    state = {
      collections: [
        {id:'all',name:'All Episodes',icon:'library',color:'#5b5ce2',parentId:null},
        ...(data.collections || []).map(item => ({
          id:item.id,
          name:item.name,
          icon:item.icon || 'library',
          color:item.color || '#5b5ce2',
          parentId:item.parentId || null,
          sortOrder:Number(item.sortOrder) || 0
        }))
      ],
      episodes: (data.episodes || []).map((item,index) => ({
        id:item.id,
        groups:item.groups?.length ? item.groups : ['all'],
        source:item.source || 'local',
        tag:item.tag || 'Episode',
        title:item.title || 'Untitled episode',
        timeLabel:normalizeTimeLabel(item.timeLabel),
        durationMs:Number(item.durationMs) || 0,
        progress:0,
        artText:(item.tag || item.title || 'EP').slice(0,2).toUpperCase(),
        artClass:item.source === 'spotify' ? 'one' : 'three',
        artImage:item.artImage || '',
        artSource:item.artImage ? 'spotify' : 'default',
        url:item.url || '',
        embed:item.embed || '',
        savedAt:(data.episodes || []).length - index,
        syncStatus:'synced'
      }))
    };

    const privateOpenPlayer = openPlayer;
    openPlayer = publicEpisodeOpen(privateOpenPlayer);
    byId('collectionSearch').placeholder = 'Search collections';
    renderAll();
    showView(byId('libraryView'));
  }

  function bindPublicControls(){
    byId('collectionSearch')?.addEventListener('input',renderCollections);
    byId('episodeSearch')?.addEventListener('input',renderEpisodes);
    ['showSpotify','showLocal','showOnline'].forEach(id => {
      byId(id)?.addEventListener('change',renderEpisodes);
    });
    byId('filterButton')?.addEventListener('click',event => {
      event.stopPropagation();
      byId('filterPopover')?.classList.toggle('open');
    });
    document.addEventListener('click',event => {
      if(!event.target.closest('.collection-actions')) byId('filterPopover')?.classList.remove('open');
    });
    byId('playHere')?.addEventListener('click',playSelected);
    byId('openSpotify')?.addEventListener('click',() => {
      if(selectedEpisode?.url) window.open(selectedEpisode.url,'_blank','noopener');
    });
    document.querySelectorAll('.close-sheet').forEach(button => button.addEventListener('click',closeSheets));
    document.querySelectorAll('.sheet-backdrop').forEach(sheet => {
      sheet.addEventListener('click',event => { if(event.target === sheet) closeSheets(); });
    });
  }

  async function initPublicSite(){
    if(!db()) throw new Error('The published library service did not load');
    libraryReadOnly = true;
    const slug = cleanSlug();
    injectPublicActions(slug);
    if(slug){
      bindPublicControls();
      await loadPublishedLibrary(slug);
    }
    else await loadDirectory();
    refreshIcons();
    window.dispatchEvent(new Event('geodeta:data-startup-ready'));
    if(!slug) setTimeout(showPublicInstallPrompt,700);
  }

  let eligibility = null;
  let preview = null;
  let publishingScope = null;
  let unpublishPreview = null;
  let unpublishMode = '';
  let preselectedClearCollection = null;

  function injectPublisherUi(){
    if(byId('publishLibraryModal')) return;
    const actions = document.querySelector('.collection-actions');
    actions?.insertAdjacentHTML('afterbegin',`
      <button id="collectionHeaderUnpublish" class="icon-button publisher-only" aria-label="Unpublish collection" hidden>
        <i data-lucide="eye-off"></i>
      </button>
      <button id="collectionHeaderPublish" class="icon-button publisher-only" aria-label="Publish collection" hidden>
        <i data-lucide="send"></i>
      </button>
    `);
    const maintenance = document.querySelector('.app-maintenance');
    maintenance?.insertAdjacentHTML('beforebegin',`
      <section id="publisherSettings" class="publisher-settings publisher-only" hidden>
        <div class="section-head"><h2>Published Library</h2></div>
        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-copy"><strong>Publish entire library</strong><span>Review existing public items before replacing anything.</span></div>
            <button id="publishWholeLibrary" class="action-button"><i data-lucide="send"></i>Publish</button>
          </div>
          <div class="settings-row">
            <div class="settings-copy"><strong>Public page</strong><span id="publisherPublicUrl">Publish once to create your page.</span></div>
            <button id="viewPublishedLibrary" class="action-button" disabled><i data-lucide="external-link"></i>View</button>
          </div>
          <div class="settings-row">
            <div class="settings-copy"><strong>Share public page</strong><span>Send a direct link that opens your published library.</span></div>
            <button id="sharePublishedLibrary" class="action-button" disabled><i data-lucide="share-2"></i>Share</button>
          </div>
          <div class="settings-row">
            <div class="settings-copy"><strong>Manage published content</strong><span>Hide the page, clear everything, or choose specific public items.</span></div>
            <button id="unpublishWholeLibrary" class="action-button danger-action" disabled><i data-lucide="settings-2"></i>Manage</button>
          </div>
        </div>
      </section>
    `);
    document.body.insertAdjacentHTML('beforeend',`
      <div id="publishLibraryModal" class="publish-modal-backdrop" hidden>
        <section class="publish-modal" role="dialog" aria-modal="true" aria-labelledby="publishModalTitle">
          <div class="publish-modal-head">
            <div><p class="eyebrow">SAFE PUBLISH</p><h3 id="publishModalTitle">Review published items</h3></div>
            <button id="closePublishModal" class="icon-button" aria-label="Close"><i data-lucide="x"></i></button>
          </div>
          <p id="publishSummary" class="publish-summary"></p>
          <div id="publishCollisionControls" class="publish-collision-controls" hidden>
            <button id="selectAllOverrides" class="text-button">Select all</button>
            <button id="clearAllOverrides" class="text-button">Skip all</button>
          </div>
          <div id="publishCollisionList" class="publish-collision-list" hidden></div>
          <p id="publishSafetyNote" class="publish-safety-note" hidden><i data-lucide="shield-check"></i>Unchecked overrides stay exactly as they are online.</p>
          <div class="publish-modal-actions">
            <button id="publishSelected" class="secondary">Publish selected</button>
            <button id="publishAll" class="primary">Publish all</button>
          </div>
        </section>
      </div>
    `);
    document.body.insertAdjacentHTML('beforeend',`
      <div id="unpublishLibraryModal" class="publish-modal-backdrop" hidden>
        <section class="publish-modal" role="dialog" aria-modal="true" aria-labelledby="unpublishModalTitle">
          <div class="publish-modal-head">
            <div><p class="eyebrow">PUBLISHED LIBRARY</p><h3 id="unpublishModalTitle">Choose what to do</h3></div>
            <button id="closeUnpublishModal" class="icon-button" aria-label="Close"><i data-lucide="x"></i></button>
          </div>
          <p id="unpublishSummary" class="publish-summary"></p>
          <div id="unpublishChoices" class="unpublish-choice-list">
            <button id="chooseHidePublished" class="unpublish-choice" type="button"><span><i data-lucide="eye-off"></i></span><strong>Hide</strong><small>Take the page offline but keep all published content stored.</small></button>
            <button id="chooseClearAllPublished" class="unpublish-choice" type="button"><span><i data-lucide="trash-2"></i></span><strong>Clear all</strong><small>Remove every published collection and episode.</small></button>
            <button id="chooseClearSelectedPublished" class="unpublish-choice" type="button"><span><i data-lucide="list-checks"></i></span><strong>Clear selected</strong><small>Choose individual collections and episodes to remove.</small></button>
          </div>
          <div id="unpublishSelectionControls" class="publish-collision-controls" hidden>
            <button id="selectAllClearItems" class="text-button">Select all</button>
            <button id="clearAllClearItems" class="text-button">Clear selection</button>
          </div>
          <div id="unpublishItemList" class="publish-collision-list" hidden></div>
          <p id="unpublishSafetyNote" class="publish-safety-note"><i data-lucide="history"></i>A restorable snapshot is retained for 30 days.</p>
          <div class="publish-modal-actions single-action">
            <button id="cancelUnpublish" class="secondary">Cancel</button>
            <button id="confirmUnpublish" class="primary danger-primary" hidden>Continue</button>
          </div>
        </section>
      </div>
    `);

    byId('collectionHeaderPublish')?.addEventListener('click',() => {
      openPublishPreview(activeCollection?.id === 'all' ? null : activeCollection?.id || null);
    });
    byId('collectionHeaderUnpublish')?.addEventListener('click',() => {
      openUnpublishMenu(activeCollection?.id === 'all' ? null : activeCollection?.id || null);
    });
    byId('publishWholeLibrary')?.addEventListener('click',() => openPublishPreview(null));
    byId('unpublishWholeLibrary')?.addEventListener('click',() => openUnpublishMenu(null));
    byId('viewPublishedLibrary')?.addEventListener('click',() => {
      if(eligibility?.slug) window.open(`https://${PUBLIC_HOST}/@${eligibility.slug}`,'_blank','noopener');
    });
    byId('sharePublishedLibrary')?.addEventListener('click',() => {
      if(eligibility?.slug) shareLink(publicLibraryUrl(eligibility.slug),'My Geodeta Podcast Library');
    });
    byId('closePublishModal')?.addEventListener('click',closePublishModal);
    byId('publishLibraryModal')?.addEventListener('click',event => {
      if(event.target.id === 'publishLibraryModal') closePublishModal();
    });
    byId('selectAllOverrides')?.addEventListener('click',() => {
      document.querySelectorAll('#publishCollisionList input').forEach(input => { input.checked = true; });
    });
    byId('clearAllOverrides')?.addEventListener('click',() => {
      document.querySelectorAll('#publishCollisionList input').forEach(input => { input.checked = false; });
    });
    byId('publishSelected')?.addEventListener('click',() => {
      const collections = [...document.querySelectorAll('[data-publish-kind="collection"]:checked')].map(input => input.value);
      const episodes = [...document.querySelectorAll('[data-publish-kind="episode"]:checked')].map(input => input.value);
      commitPublication(collections,episodes);
    });
    byId('publishAll')?.addEventListener('click',() => {
      const collections = (preview?.collections || []).filter(item => item.changed).map(item => item.id);
      const episodes = (preview?.episodes || []).filter(item => item.changed).map(item => item.id);
      commitPublication(collections,episodes);
    });
    byId('closeUnpublishModal')?.addEventListener('click',closeUnpublishModal);
    byId('cancelUnpublish')?.addEventListener('click',closeUnpublishModal);
    byId('unpublishLibraryModal')?.addEventListener('click',event => {
      if(event.target.id === 'unpublishLibraryModal') closeUnpublishModal();
    });
    byId('confirmUnpublish')?.addEventListener('click',commitUnpublication);
    byId('chooseHidePublished')?.addEventListener('click',() => selectUnpublishMode('hide'));
    byId('chooseClearAllPublished')?.addEventListener('click',() => selectUnpublishMode('clear-all'));
    byId('chooseClearSelectedPublished')?.addEventListener('click',() => selectUnpublishMode('clear-selected'));
    byId('selectAllClearItems')?.addEventListener('click',() => {
      document.querySelectorAll('#unpublishItemList input').forEach(input => { input.checked = true; });
    });
    byId('clearAllClearItems')?.addEventListener('click',() => {
      document.querySelectorAll('#unpublishItemList input').forEach(input => { input.checked = false; });
    });
    refreshIcons();
  }

  function closePublishModal(){
    byId('publishLibraryModal').hidden = true;
    preview = null;
    publishingScope = null;
  }

  function closeUnpublishModal(){
    byId('unpublishLibraryModal').hidden = true;
    unpublishPreview = null;
    unpublishMode = '';
    preselectedClearCollection = null;
  }

  function clearItemRow(kind,item){
    return `<label class="publish-collision-row">
      <input type="checkbox" value="${esc(item.id)}" data-clear-kind="${kind}" ${kind === 'collection' && item.id === preselectedClearCollection ? 'checked' : ''}>
      <span class="publish-collision-icon danger-icon"><i data-lucide="${kind === 'collection' ? 'folder' : 'podcast'}"></i></span>
      <span class="publish-collision-copy">
        <strong>${esc(kind === 'collection' ? item.name : item.title)}</strong>
        <small>${kind === 'collection' ? 'Nested collections are included automatically' : esc(item.tag || 'Published episode')}</small>
      </span>
    </label>`;
  }

  async function openUnpublishMenu(collectionId){
    if(!currentUser){ showToast('Sign in with Google first'); return; }
    const button = collectionId ? byId('collectionHeaderUnpublish') : byId('unpublishWholeLibrary');
    if(button) button.disabled = true;
    try{
      const {data,error} = await db().rpc('get_published_clear_preview');
      if(error) throw error;
      unpublishPreview = data;
      preselectedClearCollection = collectionId;
      unpublishMode = '';
      byId('unpublishModalTitle').textContent = 'Choose what to do';
      byId('unpublishSummary').textContent = `${data.collections.length} published collection${data.collections.length === 1 ? '' : 's'} and ${data.episodes.length} episode${data.episodes.length === 1 ? '' : 's'} are currently stored.`;
      byId('chooseHidePublished').disabled = !data.isPublished;
      byId('chooseClearAllPublished').disabled = !data.collections.length && !data.episodes.length;
      byId('chooseClearSelectedPublished').disabled = !data.collections.length && !data.episodes.length;
      document.querySelectorAll('.unpublish-choice').forEach(choice => choice.classList.remove('selected'));
      byId('unpublishItemList').hidden = true;
      byId('unpublishSelectionControls').hidden = true;
      byId('confirmUnpublish').hidden = true;
      byId('unpublishLibraryModal').hidden = false;
      refreshIcons();
    }catch(error){
      console.error(error);
      showToast(error.message || 'Could not prepare unpublish preview');
    }finally{
      if(button) button.disabled = false;
    }
  }

  function selectUnpublishMode(mode){
    if(!unpublishPreview) return;
    unpublishMode = mode;
    document.querySelectorAll('.unpublish-choice').forEach(choice => choice.classList.remove('selected'));
    const selectedChoice = mode === 'hide' ? byId('chooseHidePublished') : mode === 'clear-all' ? byId('chooseClearAllPublished') : byId('chooseClearSelectedPublished');
    selectedChoice?.classList.add('selected');
    const list = byId('unpublishItemList');
    const controls = byId('unpublishSelectionControls');
    const confirm = byId('confirmUnpublish');
    list.hidden = mode !== 'clear-selected';
    controls.hidden = mode !== 'clear-selected';
    confirm.hidden = false;
    if(mode === 'hide'){
      byId('unpublishModalTitle').textContent = 'Hide public page?';
      byId('unpublishSummary').textContent = 'The page will disappear immediately, but all published collections and episodes remain stored for later.';
      confirm.textContent = 'Hide public page';
    }else if(mode === 'clear-all'){
      byId('unpublishModalTitle').textContent = 'Clear all published content?';
      byId('unpublishSummary').textContent = `This removes ${unpublishPreview.collections.length} collection${unpublishPreview.collections.length === 1 ? '' : 's'} and ${unpublishPreview.episodes.length} episode${unpublishPreview.episodes.length === 1 ? '' : 's'}, then hides the empty page.`;
      confirm.textContent = 'Clear all';
    }else{
      byId('unpublishModalTitle').textContent = 'Clear selected content';
      byId('unpublishSummary').textContent = 'Choose published items to remove. Selecting a collection also includes every nested collection inside it.';
      list.innerHTML = [
        ...unpublishPreview.collections.map(item => clearItemRow('collection',item)),
        ...unpublishPreview.episodes.map(item => clearItemRow('episode',item))
      ].join('');
      confirm.textContent = 'Clear selected';
    }
    refreshIcons();
  }

  async function commitUnpublication(){
    if(!unpublishPreview) return;
    const committedMode = unpublishMode;
    const buttons = [...document.querySelectorAll('#unpublishLibraryModal button')];
    buttons.forEach(button => { button.disabled = true; });
    try{
      let data,error;
      if(unpublishMode === 'hide'){
        ({data,error} = await db().rpc('unpublish_library_selection',{
          p_collection_id:null,
          p_expected_revision:unpublishPreview.revision
        }));
      }else{
        const collectionIds = [...document.querySelectorAll('[data-clear-kind="collection"]:checked')].map(input => input.value);
        const episodeIds = [...document.querySelectorAll('[data-clear-kind="episode"]:checked')].map(input => input.value);
        if(unpublishMode === 'clear-selected' && !collectionIds.length && !episodeIds.length){
          showToast('Select at least one item to clear');
          return;
        }
        ({data,error} = await db().rpc('clear_published_library_selection',{
          p_collection_ids:collectionIds,
          p_episode_ids:episodeIds,
          p_expected_revision:unpublishPreview.revision,
          p_clear_all:unpublishMode === 'clear-all'
        }));
      }
      if(error) throw error;
      eligibility = {...eligibility,isPublished:committedMode === 'clear-selected' ? eligibility.isPublished && !data.hidden : !data.hidden};
      drawPublisherEligibility();
      closeUnpublishModal();
      showToast(committedMode === 'hide' ? 'Public library hidden' : `${data.removedCollections} collection${data.removedCollections === 1 ? '' : 's'} and ${data.removedEpisodes} episode${data.removedEpisodes === 1 ? '' : 's'} cleared`);
    }catch(error){
      console.error(error);
      showToast(error.message || 'Unpublishing failed');
      if(error.code === '40001') closeUnpublishModal();
    }finally{
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function collisionRow(kind,item){
    const label = kind === 'collection' ? item.name : item.title;
    const previous = kind === 'collection' ? item.existingName : item.existingTitle;
    const changed = item.changed;
    return `<label class="publish-collision-row">
      <input type="checkbox" value="${esc(item.id)}" data-publish-kind="${kind}">
      <span class="publish-collision-icon"><i data-lucide="${kind === 'collection' ? 'folder' : 'podcast'}"></i></span>
      <span class="publish-collision-copy">
        <strong>${esc(label)}</strong>
        <small>${changed ? `Replace “${esc(previous || label)}”` : 'Already matches the published copy'}</small>
      </span>
      <span class="publish-change-state ${changed ? 'changed' : ''}">${changed ? 'Changed' : 'Same'}</span>
    </label>`;
  }

  async function openPublishPreview(collectionId){
    if(!currentUser){ showToast('Sign in with Google first'); return; }
    if(localStorage.getItem(DIRTY_KEY) === 'true'){
      showToast('Upload Changes before publishing');
      return;
    }
    const button = collectionId ? byId('collectionHeaderPublish') : byId('publishWholeLibrary');
    if(button) button.disabled = true;
    try{
      if(await window.mediaSync?.checkForUpdates?.()){
        showToast('Download Updates before publishing');
        return;
      }
      const {data,error} = await db().rpc('get_publication_preview',{p_collection_id:collectionId});
      if(error) throw error;
      preview = data;
      publishingScope = collectionId;
      const changedCollections = (data.collections || []).filter(item => item.changed);
      const changedEpisodes = (data.episodes || []).filter(item => item.changed);
      const overrides = [...changedCollections,...changedEpisodes];
      byId('publishSummary').textContent = `${data.newCollectionCount} new collection${data.newCollectionCount === 1 ? '' : 's'} and ${data.newEpisodeCount} new episode${data.newEpisodeCount === 1 ? '' : 's'} will be added automatically.${overrides.length ? ` ${overrides.length} changed existing item${overrides.length === 1 ? '' : 's'} can be overridden.` : ' No existing published items need overriding.'}`;
      byId('publishCollisionList').innerHTML = [
        ...changedCollections.map(item => collisionRow('collection',item)),
        ...changedEpisodes.map(item => collisionRow('episode',item))
      ].join('');
      byId('publishCollisionList').hidden = overrides.length === 0;
      byId('publishCollisionControls').hidden = overrides.length === 0;
      byId('publishSafetyNote').hidden = overrides.length === 0;
      byId('publishSelected').hidden = overrides.length === 0;
      byId('publishAll').textContent = overrides.length ? 'Publish all' : 'Publish';
      byId('publishLibraryModal').hidden = false;
      refreshIcons();
    }catch(error){
      console.error(error);
      showToast(error.message || 'Could not compare published items');
    }finally{
      if(button) button.disabled = false;
    }
  }

  async function commitPublication(collectionIds,episodeIds){
    if(!preview) return;
    const buttons = [...document.querySelectorAll('#publishLibraryModal button')];
    buttons.forEach(button => { button.disabled = true; });
    try{
      const {data,error} = await db().rpc('publish_library_selection',{
        p_collection_id:publishingScope,
        p_expected_revision:preview.revision,
        p_override_collection_ids:collectionIds,
        p_override_episode_ids:episodeIds
      });
      if(error) throw error;
      eligibility = {...eligibility,slug:data.slug};
      eligibility.isPublished = true;
      drawPublisherEligibility();
      closePublishModal();
      showToast(`Published revision ${data.revision}`);
    }catch(error){
      console.error(error);
      showToast(error.message || 'Publishing failed');
      if(error.code === '40001') closePublishModal();
    }finally{
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function drawPublisherEligibility(){
    const allowed = Boolean(eligibility);
    document.querySelectorAll('.publisher-only').forEach(element => { element.hidden = !allowed; });
    const url = byId('publisherPublicUrl');
    const view = byId('viewPublishedLibrary');
    const share = byId('sharePublishedLibrary');
    const unpublish = byId('unpublishWholeLibrary');
    const collectionUnpublish = byId('collectionHeaderUnpublish');
    if(url) url.textContent = allowed
      ? `${eligibility.isPublished ? '' : 'Hidden · '}podcasts.geodeta.us/@${eligibility.slug}`
      : '';
    if(view) view.disabled = !allowed || !eligibility.slug || !eligibility.isPublished;
    if(share) share.disabled = !allowed || !eligibility.slug || !eligibility.isPublished;
    if(unpublish) unpublish.disabled = !allowed;
    if(collectionUnpublish) collectionUnpublish.hidden = !allowed;
  }

  async function refreshEligibility(){
    injectPublisherUi();
    eligibility = null;
    if(currentUser && db()){
      const {data,error} = await db()
        .from('publisher_allowlist')
        .select('enabled')
        .eq('user_id',currentUser.id)
        .eq('enabled',true)
        .maybeSingle();
      if(!error && data){
        const profileResult = await db()
          .from('published_profiles')
          .select('slug,is_published,revision')
          .eq('user_id',currentUser.id)
          .maybeSingle();
        if(!profileResult.error && profileResult.data){
          eligibility = {
            slug:profileResult.data.slug,
            isPublished:Boolean(profileResult.data.is_published),
            revision:Number(profileResult.data.revision) || 0
          };
        }
      }
    }
    drawPublisherEligibility();
  }

  window.publishedLibrary = {isPublicSite,initPublicSite};
  window.publicPublishing = {refreshEligibility,openPublishPreview};
})();
