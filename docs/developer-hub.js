(() => {
  const PUBLIC_HOST = 'podcasts.geodeta.us';
  const $id = id => document.getElementById(id);
  const html = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[char]));
  const dateLabel = value => value ? new Date(value).toLocaleString() : 'Never';
  const icon = name => `<i data-lucide="${name}"></i>`;
  let dashboard = null;
  let library = null;
  let health = [];
  let selectedUserId = null;
  let editorTarget = null;

  function toast(message){
    if(typeof window.showToast === 'function') window.showToast(message);
  }

  function inject(){
    if($id('developerView')) return;
    document.querySelector('.app')?.insertAdjacentHTML('beforeend', `
      <section id="developerView" class="view developer-view">
        <header class="developer-topbar">
          <div><p class="eyebrow">AUTHORIZED STAFF</p><h1>Developer Hub</h1></div>
          <div class="developer-head-actions">
            <span id="developerRole" class="developer-role"></span>
            <button id="developerRefresh" class="icon-button" aria-label="Refresh developer data">${icon('refresh-cw')}</button>
          </div>
        </header>
        <p class="developer-boundary">Edits here change only the public copy. Private libraries, Spotify credentials, listening progress, and local media remain inaccessible.</p>
        <div id="developerDashboard">
          <section id="developerStats" class="developer-stats"></section>
          <div class="developer-toolbar">
            <div class="search-wrap developer-search">${icon('search')}<input id="developerLibrarySearch" class="search" type="search" placeholder="Search published libraries"></div>
          </div>
          <section id="developerLibraries" class="developer-library-list"></section>
          <div class="section-head"><h2>Recent developer activity</h2></div>
          <section id="developerRecentActivity" class="developer-audit-list"></section>
          <div class="section-head"><h2>Build & cache</h2></div>
          <section id="developerBuildStatus" class="developer-build-card"></section>
        </div>
        <section id="developerLibraryPanel" hidden></section>
      </section>
    `);
    document.querySelector('.bottom-nav')?.insertAdjacentHTML('beforeend', `
      <button id="developerNav" class="nav-item">${icon('shield-check')}Developer</button>
    `);
    document.body.insertAdjacentHTML('beforeend', `
      <div id="developerEditModal" class="developer-modal-backdrop" hidden>
        <section class="developer-modal" role="dialog" aria-modal="true" aria-labelledby="developerEditTitle">
          <div class="developer-modal-head">
            <div><p class="eyebrow">PUBLIC COPY ONLY</p><h3 id="developerEditTitle">Edit published item</h3></div>
            <button id="developerEditClose" class="icon-button" aria-label="Close">${icon('x')}</button>
          </div>
          <div id="developerEditFields" class="developer-edit-fields"></div>
          <label class="developer-field"><span>Reason for change</span><textarea id="developerEditReason" maxlength="500" placeholder="Required for the permanent audit log"></textarea></label>
          <div class="developer-modal-actions"><button id="developerEditCancel" class="secondary">Cancel</button><button id="developerEditSave" class="primary">Save public revision</button></div>
        </section>
      </div>
      <div id="developerRestoreModal" class="developer-modal-backdrop" hidden>
        <section class="developer-modal developer-restore-modal" role="dialog" aria-modal="true" aria-labelledby="developerRestoreTitle">
          <div class="developer-modal-head"><div><p class="eyebrow">REVISION RESTORE</p><h3 id="developerRestoreTitle">Restore revision</h3></div><button id="developerRestoreClose" class="icon-button" aria-label="Close">${icon('x')}</button></div>
          <p id="developerRestoreCopy" class="developer-modal-copy"></p>
          <label class="developer-field"><span>Reason for restore</span><textarea id="developerRestoreReason" maxlength="500" placeholder="Required for the permanent audit log"></textarea></label>
          <div class="developer-modal-actions"><button id="developerRestoreCancel" class="secondary">Cancel</button><button id="developerRestoreSave" class="primary developer-danger-button">Restore revision</button></div>
        </section>
      </div>
    `);
    document.body.classList.add('has-developer-nav');
    bind();
    window.lucide?.createIcons();
  }

  function bind(){
    $id('developerNav').addEventListener('click', showDeveloper);
    $id('developerRefresh').addEventListener('click', refreshDashboard);
    $id('developerLibrarySearch').addEventListener('input', renderLibraries);
    $id('developerEditClose').addEventListener('click', closeEditor);
    $id('developerEditCancel').addEventListener('click', closeEditor);
    $id('developerEditSave').addEventListener('click', saveEditor);
    $id('developerRestoreClose').addEventListener('click', closeRestore);
    $id('developerRestoreCancel').addEventListener('click', closeRestore);
    $id('developerRestoreSave').addEventListener('click', restoreRevision);
    [$id('developerEditModal'),$id('developerRestoreModal')].forEach(modal => {
      modal.addEventListener('click', event => { if(event.target === modal) modal.hidden = true; });
    });
  }

  function showDeveloper(){
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    $id('developerView').classList.add('active');
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    $id('developerNav').classList.add('active');
    window.lucide?.createIcons();
  }

  async function authorize(){
    if(location.hostname === PUBLIC_HOST || !window.supabaseClient) return;
    const {data:{session}} = await window.supabaseClient.auth.getSession();
    if(!session) return remove();
    const {data,error} = await window.supabaseClient.rpc('get_developer_dashboard');
    if(error){
      if(error.code !== '42501') console.error('Developer access check failed', error);
      return remove();
    }
    dashboard = data;
    inject();
    renderDashboard();
  }

  function remove(){
    $id('developerNav')?.remove();
    $id('developerView')?.remove();
    document.body.classList.remove('has-developer-nav');
  }

  async function refreshDashboard(){
    const button = $id('developerRefresh');
    if(button) button.disabled = true;
    try{
      const {data,error} = await window.supabaseClient.rpc('get_developer_dashboard');
      if(error) throw error;
      dashboard = data;
      renderDashboard();
      if(selectedUserId) await openLibrary(selectedUserId);
      toast('Developer Hub refreshed');
    }catch(error){
      console.error(error);
      toast(error.message || 'Could not refresh Developer Hub');
    }finally{
      if(button) button.disabled = false;
    }
  }

  function renderDashboard(){
    const libraries = dashboard?.libraries || [];
    const active = libraries.filter(item => item.isPublished).length;
    $id('developerRole').textContent = dashboard?.role === 'admin' ? 'Administrator' : 'Developer';
    $id('developerStats').innerHTML = `
      <article><span>${icon('library')}</span><strong>${libraries.length}</strong><small>Libraries</small></article>
      <article><span>${icon('globe-2')}</span><strong>${active}</strong><small>Live</small></article>
      <article><span>${icon('folder')}</span><strong>${libraries.reduce((sum,item) => sum + Number(item.collectionCount || 0),0)}</strong><small>Collections</small></article>
      <article><span>${icon('podcast')}</span><strong>${libraries.reduce((sum,item) => sum + Number(item.episodeCount || 0),0)}</strong><small>Episodes</small></article>`;
    renderLibraries();
    $id('developerRecentActivity').innerHTML = activityMarkup(dashboard?.recentActivity || [], 'No developer changes have been recorded.');
    loadBuildStatus();
    window.lucide?.createIcons();
  }

  function renderLibraries(){
    const term = ($id('developerLibrarySearch')?.value || '').trim().toLowerCase();
    const rows = (dashboard?.libraries || []).filter(item => `${item.displayName} ${item.slug}`.toLowerCase().includes(term));
    $id('developerLibraries').innerHTML = rows.map(item => `
      <button class="developer-library-row" data-developer-library="${html(item.userId)}">
        <span class="developer-library-icon">${icon('library')}</span>
        <span class="developer-library-copy"><strong>${html(item.displayName)}</strong><small>podcasts.geodeta.us/@${html(item.slug)} · revision ${item.revision}</small></span>
        <span class="developer-status ${item.isPublished ? 'live' : 'hidden'}">${item.isPublished ? 'Live' : 'Hidden'}</span>
        <span class="developer-counts">${item.collectionCount} folders · ${item.episodeCount} episodes</span>
        ${icon('chevron-right')}
      </button>`).join('') || '<div class="developer-empty">No published libraries match.</div>';
    $id('developerLibraries').querySelectorAll('[data-developer-library]').forEach(button => {
      button.addEventListener('click',() => openLibrary(button.dataset.developerLibrary));
    });
    window.lucide?.createIcons();
  }

  async function loadBuildStatus(){
    try{
      const response = await fetch(`./build.json?developer=${Date.now()}`,{cache:'no-store'});
      const build = await response.json();
      $id('developerBuildStatus').innerHTML = `
        <span class="developer-library-icon">${icon('cpu')}</span>
        <span><strong>Build ${html(build.id)}</strong><small>${html(build.message)} · ${dateLabel(build.releasedAt)}</small></span>
        <button id="developerClearCache" class="action-button">${icon('rotate-cw')} Refresh cache</button>`;
      $id('developerClearCache').addEventListener('click',() => $id('hardRefresh')?.click());
      window.lucide?.createIcons();
    }catch(error){
      $id('developerBuildStatus').textContent = 'Build information is unavailable.';
    }
  }

  async function openLibrary(userId){
    selectedUserId = userId;
    $id('developerDashboard').hidden = true;
    $id('developerLibraryPanel').hidden = false;
    $id('developerLibraryPanel').innerHTML = '<div class="developer-loading"><span></span>Loading published copy…</div>';
    try{
      const [libraryResult,healthResult] = await Promise.all([
        window.supabaseClient.rpc('get_developer_published_library',{p_user_id:userId}),
        window.supabaseClient.rpc('get_developer_publication_health',{p_user_id:userId})
      ]);
      if(libraryResult.error) throw libraryResult.error;
      if(healthResult.error) throw healthResult.error;
      library = libraryResult.data;
      health = healthResult.data?.issues || [];
      renderLibraryPanel();
    }catch(error){
      console.error(error);
      toast(error.message || 'Could not load published library');
      backToDashboard();
    }
  }

  function backToDashboard(){
    selectedUserId = null;
    library = null;
    $id('developerDashboard').hidden = false;
    $id('developerLibraryPanel').hidden = true;
  }

  function renderLibraryPanel(){
    const p = library.profile;
    $id('developerLibraryPanel').innerHTML = `
      <div class="developer-library-head">
        <button id="developerBack" class="icon-button" aria-label="Back">${icon('chevron-left')}</button>
        <div><p class="eyebrow">PUBLIC COPY · REVISION ${p.revision}</p><h2>${html(p.displayName)}</h2><span>podcasts.geodeta.us/@${html(p.slug)}</span></div>
        <span class="developer-status ${p.isPublished ? 'live' : 'hidden'}">${p.isPublished ? 'Live' : 'Hidden'}</span>
      </div>
      <div class="developer-action-row">
        <button id="developerEditProfile" class="action-button">${icon('settings-2')} Public settings</button>
        <a class="action-button developer-link ${p.isPublished ? '' : 'disabled'}" href="https://podcasts.geodeta.us/@${html(p.slug)}" target="_blank" rel="noopener">${icon('external-link')} View as visitor</a>
        <button id="developerToggleVisibility" class="action-button ${p.isPublished ? 'developer-danger-soft' : ''}">${icon(p.isPublished ? 'eye-off' : 'eye')} ${p.isPublished ? 'Emergency hide' : 'Make live'}</button>
      </div>
      <nav class="developer-tabs">
        <button class="active" data-developer-tab="content">Content</button>
        <button data-developer-tab="health">Health <span>${health.length}</span></button>
        <button data-developer-tab="revisions">Revisions</button>
        <button data-developer-tab="audit">Audit log</button>
      </nav>
      <div id="developerTabContent"></div>`;
    $id('developerBack').addEventListener('click',backToDashboard);
    $id('developerEditProfile').addEventListener('click',() => openEditor('profile'));
    $id('developerToggleVisibility').addEventListener('click',() => openEditor('profile',null,true));
    document.querySelectorAll('[data-developer-tab]').forEach(button => button.addEventListener('click',() => {
      document.querySelectorAll('[data-developer-tab]').forEach(item => item.classList.toggle('active',item === button));
      renderTab(button.dataset.developerTab);
    }));
    renderTab('content');
    window.lucide?.createIcons();
  }

  function renderTab(tab){
    const mount = $id('developerTabContent');
    if(tab === 'content'){
      mount.innerHTML = `
        <div class="section-head"><h2>Collections</h2><span>${library.collections.length}</span></div>
        <section class="developer-item-list">${library.collections.map(collection => itemMarkup('collection',collection)).join('') || '<div class="developer-empty">No published collections.</div>'}</section>
        <div class="section-head"><h2>Episodes</h2><span>${library.episodes.length}</span></div>
        <section class="developer-item-list">${library.episodes.map(episode => itemMarkup('episode',episode)).join('') || '<div class="developer-empty">No published episodes.</div>'}</section>`;
      mount.querySelectorAll('[data-developer-edit]').forEach(button => button.addEventListener('click',() => openEditor(button.dataset.kind,button.dataset.developerEdit)));
    }else if(tab === 'health'){
      mount.innerHTML = health.length ? `<section class="developer-health-list">${health.map(issue => `
        <article><span class="developer-health-icon ${html(issue.severity)}">${icon(issue.severity === 'warning' ? 'triangle-alert' : 'info')}</span><span><strong>${html(issue.label)}</strong><small>${html(issue.message)}</small></span><button class="text-button" data-health-edit="${html(issue.entityId)}" data-kind="${html(issue.entityType)}">Edit</button></article>`).join('')}</section>` : '<div class="developer-good-health">'+icon('shield-check')+'<strong>No publication problems found</strong><span>Relationships, URLs, artwork, and collection coverage passed the checks.</span></div>';
      mount.querySelectorAll('[data-health-edit]').forEach(button => button.addEventListener('click',() => openEditor(button.dataset.kind,button.dataset.healthEdit)));
    }else if(tab === 'revisions'){
      mount.innerHTML = `<section class="developer-revision-list">${(library.revisions || []).map(row => `
        <article><span class="developer-revision-icon">${icon('history')}</span><span><strong>Revision ${row.revision}</strong><small>${html(String(row.action || 'publish').replaceAll('_',' '))} · ${dateLabel(row.createdAt)}</small></span>${row.revision === library.profile.revision ? '<span class="developer-status live">Current</span>' : `<button class="action-button" data-restore-revision="${row.revision}">Restore</button>`}</article>`).join('') || '<div class="developer-empty">No restorable revisions.</div>'}</section>`;
      mount.querySelectorAll('[data-restore-revision]').forEach(button => button.addEventListener('click',() => openRestore(Number(button.dataset.restoreRevision))));
    }else{
      mount.innerHTML = activityMarkup(library.audit || [], 'No developer changes have been made to this library.');
    }
    window.lucide?.createIcons();
  }

  function itemMarkup(kind,item){
    const collection = kind === 'collection';
    const subtitle = collection
      ? `${item.parentId ? 'Nested collection' : 'Top-level collection'} · order ${item.sortOrder}`
      : `${html(item.tag || 'Episode')} · ${(item.groups || []).length} collection${(item.groups || []).length === 1 ? '' : 's'}`;
    return `<article class="developer-item-row">
      <span class="developer-item-icon" ${collection ? `style="--item-color:${html(item.color)}"` : ''}>${collection ? icon(item.icon || 'folder') : (item.artImage ? `<img src="${html(item.artImage)}" alt="">` : icon('podcast'))}</span>
      <span><strong>${html(collection ? item.name : item.title)}</strong><small>${subtitle}</small></span>
      <button class="action-button" data-developer-edit="${html(item.id)}" data-kind="${kind}">${icon('pencil')} Edit</button>
    </article>`;
  }

  function activityMarkup(rows,empty){
    return rows.length ? rows.map(row => `<details class="developer-audit-row"><summary>
      <span class="developer-audit-icon">${icon(row.action === 'restore_revision' ? 'history' : 'pencil')}</span>
      <span><strong>${html(String(row.action || '').replaceAll('_',' '))}</strong><small>${html(row.actorName || 'Developer')} · ${html(row.libraryName || library?.profile?.displayName || '')} · ${dateLabel(row.createdAt)}</small></span>
      <span class="developer-revision-chip">${row.revisionBefore} → ${row.revisionAfter}</span>
    </summary><div><strong>Reason</strong><p>${html(row.reason)}</p>${row.entityType ? `<small>${html(row.entityType)}${row.entityId ? ` · ${html(row.entityId)}` : ''}</small>` : ''}</div></details>`).join('') : `<div class="developer-empty">${html(empty)}</div>`;
  }

  function field(label,name,value,type='text',extra=''){
    return `<label class="developer-field"><span>${html(label)}</span><input data-dev-field="${name}" type="${type}" value="${html(value ?? '')}" ${extra}></label>`;
  }

  function openEditor(kind,id=null,visibilityOnly=false){
    editorTarget = {kind,id,visibilityOnly};
    const fields = $id('developerEditFields');
    if(kind === 'profile'){
      const p = library.profile;
      $id('developerEditTitle').textContent = visibilityOnly ? (p.isPublished ? 'Emergency hide library' : 'Make library live') : 'Edit public profile';
      fields.innerHTML = visibilityOnly
        ? `<div class="developer-warning">${icon(p.isPublished ? 'triangle-alert' : 'eye')}<span>${p.isPublished ? 'This immediately hides the public page without changing the owner’s private library.' : 'This makes the stored public copy visible again.'}</span></div><input data-dev-field="isPublished" type="hidden" value="${String(!p.isPublished)}">`
        : `${field('Display name','displayName',p.displayName)}${field('Public slug','slug',p.slug)}`;
    }else if(kind === 'collection'){
      const item = library.collections.find(row => row.id === id);
      editorTarget.item = item;
      $id('developerEditTitle').textContent = 'Edit published collection';
      fields.innerHTML = `${field('Name','name',item.name)}${field('Lucide icon','icon',item.icon)}${field('Color','color',item.color,'color')}${field('Sort order','sortOrder',item.sortOrder,'number')}
        <label class="developer-field"><span>Parent collection</span><select data-dev-field="parentId"><option value="">Top level</option>${library.collections.filter(row => row.id !== item.id).map(row => `<option value="${html(row.id)}" ${row.id === item.parentId ? 'selected' : ''}>${html(row.name)}</option>`).join('')}</select></label>`;
    }else{
      const item = library.episodes.find(row => row.id === id);
      editorTarget.item = item;
      $id('developerEditTitle').textContent = 'Edit published episode';
      fields.innerHTML = `${field('Title','title',item.title)}${field('Tag','tag',item.tag)}${field('Spotify URL','url',item.url,'url')}${field('Embed URL','embed',item.embed,'url')}${field('Artwork URL','artImage',item.artImage,'url')}${field('Time label','timeLabel',item.timeLabel)}${field('Duration (ms)','durationMs',item.durationMs,'number','min="0"')}${field('Sort order','sortOrder',item.sortOrder,'number')}
        <fieldset class="developer-group-picker"><legend>Published collections</legend>${library.collections.map(row => `<label><input type="checkbox" data-dev-group value="${html(row.id)}" ${(item.groups || []).includes(row.id) ? 'checked' : ''}><span>${html(row.name)}</span></label>`).join('')}</fieldset>`;
    }
    $id('developerEditReason').value = '';
    $id('developerEditModal').hidden = false;
    window.lucide?.createIcons();
  }

  function closeEditor(){
    $id('developerEditModal').hidden = true;
    editorTarget = null;
  }

  function collectChanges(){
    const changes = {};
    $id('developerEditFields').querySelectorAll('[data-dev-field]').forEach(input => {
      let value = input.value;
      if(input.type === 'number') value = value === '' ? null : Number(value);
      if(input.name === 'isPublished' || input.dataset.devField === 'isPublished') value = value === 'true';
      changes[input.dataset.devField] = value;
    });
    if(editorTarget.kind === 'episode') changes.groups = [...$id('developerEditFields').querySelectorAll('[data-dev-group]:checked')].map(input => input.value);
    return changes;
  }

  async function saveEditor(){
    const reason = $id('developerEditReason').value.trim();
    if(reason.length < 3){ toast('Enter a reason for the audit log'); return; }
    const button = $id('developerEditSave');
    button.disabled = true;
    try{
      const {error} = await window.supabaseClient.rpc('developer_update_published_item',{
        p_user_id:selectedUserId,
        p_entity_type:editorTarget.kind,
        p_entity_id:editorTarget.id,
        p_expected_revision:library.profile.revision,
        p_changes:collectChanges(),
        p_reason:reason
      });
      if(error) throw error;
      closeEditor();
      await refreshDashboard();
      toast('Published revision saved and logged');
    }catch(error){
      console.error(error);
      toast(error.message || 'Could not save published revision');
      if(error.code === '40001'){ closeEditor(); await openLibrary(selectedUserId); }
    }finally{
      button.disabled = false;
    }
  }

  function openRestore(revision){
    editorTarget = {kind:'restore',revision};
    $id('developerRestoreTitle').textContent = `Restore revision ${revision}?`;
    $id('developerRestoreCopy').textContent = `The current public copy will become revision ${Number(library.profile.revision) + 1}. The restore is reversible and permanently audited.`;
    $id('developerRestoreReason').value = '';
    $id('developerRestoreModal').hidden = false;
  }

  function closeRestore(){
    $id('developerRestoreModal').hidden = true;
    editorTarget = null;
  }

  async function restoreRevision(){
    const reason = $id('developerRestoreReason').value.trim();
    if(reason.length < 3){ toast('Enter a reason for the audit log'); return; }
    const button = $id('developerRestoreSave');
    button.disabled = true;
    try{
      const {error} = await window.supabaseClient.rpc('developer_restore_publication_revision',{
        p_user_id:selectedUserId,
        p_revision:editorTarget.revision,
        p_expected_revision:library.profile.revision,
        p_reason:reason
      });
      if(error) throw error;
      closeRestore();
      await refreshDashboard();
      toast('Public revision restored and logged');
    }catch(error){
      console.error(error);
      toast(error.message || 'Could not restore revision');
      if(error.code === '40001'){ closeRestore(); await openLibrary(selectedUserId); }
    }finally{
      button.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded',authorize);
  window.addEventListener('load',() => window.supabaseClient?.auth.onAuthStateChange(() => setTimeout(authorize,0)),{once:true});
})();
