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
  let unpublishingScope = null;

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
            <div class="settings-copy"><strong>Unpublish entire library</strong><span>Hide the public page while keeping its 30-day revision history.</span></div>
            <button id="unpublishWholeLibrary" class="action-button danger-action" disabled><i data-lucide="eye-off"></i>Unpublish</button>
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
          <div id="publishCollisionList" class="publish-collision-list"></div>
          <p class="publish-safety-note"><i data-lucide="shield-check"></i>Unchecked existing items stay exactly as they are online.</p>
          <div class="publish-modal-actions">
            <button id="publishSkipExisting" class="secondary">Skip all existing</button>
            <button id="publishSelected" class="primary">Publish selected overrides</button>
          </div>
        </section>
      </div>
    `);
    document.body.insertAdjacentHTML('beforeend',`
      <div id="unpublishLibraryModal" class="publish-modal-backdrop" hidden>
        <section class="publish-modal" role="dialog" aria-modal="true" aria-labelledby="unpublishModalTitle">
          <div class="publish-modal-head">
            <div><p class="eyebrow">SAFE UNPUBLISH</p><h3 id="unpublishModalTitle">Review what will be removed</h3></div>
            <button id="closeUnpublishModal" class="icon-button" aria-label="Close"><i data-lucide="x"></i></button>
          </div>
          <p id="unpublishSummary" class="publish-summary"></p>
          <div id="unpublishItemList" class="publish-collision-list"></div>
          <p id="unpublishSafetyNote" class="publish-safety-note"><i data-lucide="history"></i>A restorable snapshot is retained for 30 days.</p>
          <div class="publish-modal-actions single-action">
            <button id="cancelUnpublish" class="secondary">Cancel</button>
            <button id="confirmUnpublish" class="primary danger-primary">Unpublish</button>
          </div>
        </section>
      </div>
    `);

    byId('collectionHeaderPublish')?.addEventListener('click',() => {
      openPublishPreview(activeCollection?.id === 'all' ? null : activeCollection?.id || null);
    });
    byId('collectionHeaderUnpublish')?.addEventListener('click',() => {
      openUnpublishPreview(activeCollection?.id === 'all' ? null : activeCollection?.id || null);
    });
    byId('publishWholeLibrary')?.addEventListener('click',() => openPublishPreview(null));
    byId('unpublishWholeLibrary')?.addEventListener('click',() => openUnpublishPreview(null));
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
    byId('publishSkipExisting')?.addEventListener('click',() => commitPublication([],[]));
    byId('publishSelected')?.addEventListener('click',() => {
      const collections = [...document.querySelectorAll('[data-publish-kind="collection"]:checked')].map(input => input.value);
      const episodes = [...document.querySelectorAll('[data-publish-kind="episode"]:checked')].map(input => input.value);
      commitPublication(collections,episodes);
    });
    byId('closeUnpublishModal')?.addEventListener('click',closeUnpublishModal);
    byId('cancelUnpublish')?.addEventListener('click',closeUnpublishModal);
    byId('unpublishLibraryModal')?.addEventListener('click',event => {
      if(event.target.id === 'unpublishLibraryModal') closeUnpublishModal();
    });
    byId('confirmUnpublish')?.addEventListener('click',commitUnpublication);
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
    unpublishingScope = null;
  }

  function unpublishItemRow(kind,item){
    return `<div class="publish-collision-row unpublish-item-row">
      <span class="publish-collision-icon danger-icon"><i data-lucide="${kind === 'collection' ? 'folder' : 'podcast'}"></i></span>
      <span class="publish-collision-copy">
        <strong>${esc(kind === 'collection' ? item.name : item.title)}</strong>
        <small>${kind === 'collection' ? 'Collection will be removed from the public library' : 'Episode is not published in another collection'}</small>
      </span>
    </div>`;
  }

  async function openUnpublishPreview(collectionId){
    if(!currentUser){ showToast('Sign in with Google first'); return; }
    const button = collectionId ? byId('collectionHeaderUnpublish') : byId('unpublishWholeLibrary');
    if(button) button.disabled = true;
    try{
      const {data,error} = await db().rpc('get_unpublication_preview',{p_collection_id:collectionId});
      if(error) throw error;
      if(!data?.published){
        showToast('The public library is already hidden');
        drawPublisherEligibility();
        return;
      }
      unpublishPreview = data;
      unpublishingScope = collectionId;
      const wholeLibrary = collectionId === null;
      byId('unpublishModalTitle').textContent = wholeLibrary ? 'Unpublish entire library?' : 'Unpublish this collection?';
      byId('unpublishSummary').textContent = wholeLibrary
        ? `This will immediately hide ${data.collectionCount} collection${data.collectionCount === 1 ? '' : 's'} and ${data.episodeCount} episode${data.episodeCount === 1 ? '' : 's'} from podcasts.geodeta.us.`
        : `${data.collectionCount} collection${data.collectionCount === 1 ? '' : 's'} and ${(data.removedEpisodes || []).length} episode${(data.removedEpisodes || []).length === 1 ? '' : 's'} will be removed. ${data.keptEpisodeCount || 0} episode${data.keptEpisodeCount === 1 ? '' : 's'} will remain because they are published in another collection.`;
      byId('unpublishItemList').innerHTML = wholeLibrary
        ? '<div class="publish-no-conflicts"><i data-lucide="eye-off"></i>The page will be hidden; its stored publication is retained.</div>'
        : [
            ...(data.collections || []).map(item => unpublishItemRow('collection',item)),
            ...(data.removedEpisodes || []).map(item => unpublishItemRow('episode',item))
          ].join('');
      byId('confirmUnpublish').textContent = wholeLibrary ? 'Unpublish entire library' : 'Unpublish collection';
      byId('unpublishLibraryModal').hidden = false;
      refreshIcons();
    }catch(error){
      console.error(error);
      showToast(error.message || 'Could not prepare unpublish preview');
    }finally{
      if(button) button.disabled = false;
    }
  }

  async function commitUnpublication(){
    if(!unpublishPreview) return;
    const buttons = [...document.querySelectorAll('#unpublishLibraryModal button')];
    buttons.forEach(button => { button.disabled = true; });
    try{
      const {data,error} = await db().rpc('unpublish_library_selection',{
        p_collection_id:unpublishingScope,
        p_expected_revision:unpublishPreview.revision
      });
      if(error) throw error;
      eligibility = {...eligibility,isPublished:!data.hidden};
      drawPublisherEligibility();
      closeUnpublishModal();
      showToast(data.hidden ? 'Public library hidden' : `${data.removedCollections} collection${data.removedCollections === 1 ? '' : 's'} unpublished`);
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
      const collisions = [...(data.collections || []),...(data.episodes || [])];
      byId('publishSummary').textContent = `${data.newCollectionCount} new collection${data.newCollectionCount === 1 ? '' : 's'} and ${data.newEpisodeCount} new episode${data.newEpisodeCount === 1 ? '' : 's'} will be added automatically. ${collisions.length} existing item${collisions.length === 1 ? '' : 's'} need your decision.`;
      byId('publishCollisionList').innerHTML = [
        ...(data.collections || []).map(item => collisionRow('collection',item)),
        ...(data.episodes || []).map(item => collisionRow('episode',item))
      ].join('') || '<div class="publish-no-conflicts"><i data-lucide="check-circle-2"></i>No existing published items will be replaced.</div>';
      byId('publishCollisionControls').hidden = collisions.length === 0;
      byId('publishSkipExisting').textContent = collisions.length ? 'Skip all existing' : 'Publish';
      byId('publishSelected').hidden = collisions.length === 0;
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
    if(unpublish) unpublish.disabled = !allowed || !eligibility.isPublished;
    if(collectionUnpublish) collectionUnpublish.hidden = !allowed || !eligibility.isPublished;
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
