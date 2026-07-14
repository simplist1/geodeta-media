const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const refreshIcons = () => window.lucide?.createIcons();
const db = () => window.supabaseClient;

const STORAGE_KEY = 'geodetaUiStateV3';
const DIRTY_KEY = 'geodetaUiDirty';
const iconNames = ['library','heart','bookmark','clock','headphones','mic-2','music','radio','star','sparkles','flame','bike','plane','globe-2','briefcase','brain','book-open','film','tv','gamepad-2','coffee','dumbbell','leaf','lightbulb','rocket','camera','palette','message-circle','users','folder','archive','circle-play','list-music','podcast','newspaper','graduation-cap','badge-dollar-sign','wrench','cpu'];
const colors = ['#5b5ce2','#ff6b6b','#f59e0b','#10b981','#0ea5e9','#8b5cf6','#ec4899','#334155'];
const pendingAudioFiles = new Map();

const defaultState = {
  collections: [
    {id:'all',name:'All Episodes',icon:'library',color:'#5b5ce2'},
    {id:'favorites',name:'Favorites',icon:'heart',color:'#ec4899'},
    {id:'later',name:'Listen Later',icon:'clock',color:'#0ea5e9'}
  ],
  episodes: [
    {id:'e1',groups:['favorites'],source:'spotify',tag:'Waveform',title:'A sample Spotify episode',time:'1h 04m',progress:18,artText:'WV',artClass:'two',artImage:'',artSource:'default',url:'https://open.spotify.com/show/6o81QuW22s5m2nfcXWjucc',embed:'https://open.spotify.com/embed/show/6o81QuW22s5m2nfcXWjucc',savedAt:5},
    {id:'e2',groups:['later'],source:'local',tag:'Local upload',title:'Sample uploaded podcast episode',time:'12 min',progress:0,artText:'UP',artClass:'five',artImage:'',artSource:'default',localName:'sample-podcast.mp3',localUrl:'',savedAt:4},
    {id:'e3',groups:['later'],source:'online',tag:'Cloud library',title:'Synced file waiting to download',time:'Not downloaded',progress:0,artText:'ON',artClass:'three',artImage:'',artSource:'default',onlineName:'remote-episode.mp3',onlinePath:'user/audio/remote-episode.mp3',savedAt:3}
  ]
};

function loadState(){
  try{
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(saved?.collections && saved?.episodes){
      saved.episodes.forEach(ep => { if(ep.localUrl?.startsWith('blob:')) ep.localUrl=''; });
      return saved;
    }
  }catch(error){ console.warn('Could not load local UI state', error); }
  return structuredClone(defaultState);
}

let state = loadState();
let activeCollection = null;
let selectedEpisode = null;
let selectedIcon = 'library';
let selectedColor = colors[0];
let addSource = 'spotify';
let editingCollectionId = null;
let editingEpisodeId = null;
let draftArtwork = '';
let draftArtworkSource = 'default';
let draftLocalUrl = '';
let spotifyArtworkTimer = null;
let currentUser = null;

function saveState(markDirty=true){
  const safe = structuredClone(state);
  safe.episodes.forEach(ep => { if(ep.localUrl?.startsWith('blob:')) ep.localUrl=''; });
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    if(markDirty) localStorage.setItem(DIRTY_KEY,'true');
  }catch(error){ showToast('Local storage is full'); }
}
function esc(value=''){ return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function showToast(text){ const toast=$('#toast'); toast.textContent=text; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>toast.classList.remove('show'),1800); }
function openSheet(selector){ $(selector).classList.add('open'); refreshIcons(); }
function closeSheets(){ $$('.sheet-backdrop').forEach(sheet=>sheet.classList.remove('open')); $('#playerMount').innerHTML=''; }
function showView(view){ $$('.view').forEach(item=>item.classList.remove('active')); view.classList.add('active'); $$('.nav-item').forEach(item=>item.classList.remove('active')); if(view.id==='libraryView') $('#libraryNav').classList.add('active'); if(view.id==='profileView') $('#profileNav').classList.add('active'); refreshIcons(); }
function countFor(id){ return id==='all' ? state.episodes.length : state.episodes.filter(ep=>ep.groups.includes(id)).length; }
function sourceInfo(source){ return source==='spotify' ? {label:'Spotify',icon:'radio'} : source==='online' ? {label:'Online',icon:'cloud'} : {label:'Local',icon:'file-audio'}; }
function artMarkup(ep){ return ep.artImage ? `<img src="${esc(ep.artImage)}" alt="">` : esc(ep.artText || 'EP'); }
function isUuid(value){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||''); }
function normalizeIds(){
  const remap = new Map();
  state.collections.forEach(collection=>{
    if(collection.id==='all') return;
    if(!isUuid(collection.id)){ const next=crypto.randomUUID(); remap.set(collection.id,next); collection.id=next; }
  });
  state.episodes.forEach(ep=>{
    ep.groups=(ep.groups||[]).map(group=>remap.get(group)||group);
    if(!isUuid(ep.id)) ep.id=crypto.randomUUID();
  });
  if(activeCollection && remap.has(activeCollection.id)) activeCollection=state.collections.find(c=>c.id===remap.get(activeCollection.id))||null;
}

function episodeMarkup(ep){
  const source = sourceInfo(ep.source);
  return `<article class="episode" data-id="${esc(ep.id)}">
    <div class="episode-tools"><button class="episode-tool episode-edit" aria-label="Edit episode"><i data-lucide="pencil"></i></button><button class="episode-tool episode-delete" aria-label="Remove episode"><i data-lucide="x"></i></button></div>
    <div class="episode-main"><div class="art ${esc(ep.artClass || 'one')}">${artMarkup(ep)}</div><div><p class="podcast-name">${esc(ep.tag || 'Episode')}</p><p class="episode-title">${esc(ep.title)}</p><div class="meta"><span class="source-badge"><i data-lucide="${source.icon}"></i>${source.label}</span><span>${esc(ep.time || 'Not started')}</span><div class="progress"><span style="width:${Math.max(0,Math.min(100,Number(ep.progress)||0))}%"></span></div></div></div><div class="chevron">›</div></div>
  </article>`;
}
function wireEpisodes(container){
  container.querySelectorAll('.episode').forEach(card=>{
    const id=card.dataset.id;
    card.querySelector('.episode-delete').addEventListener('click',async event=>{ event.stopPropagation(); state.episodes=state.episodes.filter(ep=>ep.id!==id); pendingAudioFiles.delete(id); saveState(); renderAll(); if(currentUser&&isUuid(id)) await db().from('episodes').delete().eq('id',id); showToast('Episode removed'); });
    card.querySelector('.episode-edit').addEventListener('click',event=>{ event.stopPropagation(); openEpisodeSheet(id); });
    card.querySelector('.episode-main').addEventListener('click',()=>openPlayer(id));
  });
  refreshIcons();
}
function renderRecent(){ const recent=[...state.episodes].sort((a,b)=>(b.savedAt||0)-(a.savedAt||0)).slice(0,5); $('#recentEpisodes').innerHTML=recent.map(episodeMarkup).join(''); $('#recentEmpty').hidden=recent.length>0; wireEpisodes($('#recentEpisodes')); }
function renderCollections(){
  const term=$('#collectionSearch').value.trim().toLowerCase();
  const list=state.collections.filter(c=>c.name.toLowerCase().includes(term));
  $('#groups').innerHTML=list.map(c=>`<article class="group-card" data-id="${esc(c.id)}" draggable="true"><div class="card-tools"><button class="round-tool drag-handle" aria-label="Move collection"><i data-lucide="grip-vertical"></i></button><button class="round-tool collection-edit" aria-label="Edit collection"><i data-lucide="pencil"></i></button><button class="round-tool collection-delete" aria-label="Delete collection"><i data-lucide="x"></i></button></div><span class="group-icon" style="background:${esc(c.color)}"><i data-lucide="${esc(c.icon)}"></i></span><strong>${esc(c.name)}</strong><span class="count">${countFor(c.id)} saved</span></article>`).join('');
  $$('.group-card').forEach(card=>{
    const id=card.dataset.id;
    card.addEventListener('click',event=>{ if(!event.target.closest('button')) openCollection(id); });
    card.querySelector('.collection-edit').addEventListener('click',event=>{ event.stopPropagation(); openCollectionSheet(id); });
    card.querySelector('.collection-delete').addEventListener('click',async event=>{ event.stopPropagation(); state.collections=state.collections.filter(c=>c.id!==id); state.episodes.forEach(ep=>ep.groups=ep.groups.filter(group=>group!==id)); saveState(); renderAll(); if(currentUser&&isUuid(id)) await db().from('collections').delete().eq('id',id); showToast('Collection removed'); });
    enableCollectionDrag(card);
  });
  $('#noCollections').hidden=list.length>0; refreshIcons();
}
function enableCollectionDrag(card){
  card.addEventListener('dragstart',()=>card.classList.add('dragging'));
  card.addEventListener('dragend',()=>{ card.classList.remove('dragging'); syncCollectionOrder(); });
  card.addEventListener('dragover',event=>{ event.preventDefault(); const dragging=$('.group-card.dragging'); if(!dragging||dragging===card)return; const rect=card.getBoundingClientRect(); $('#groups').insertBefore(dragging,event.clientY<rect.top+rect.height/2?card:card.nextSibling); });
  const handle=card.querySelector('.drag-handle'); let moving=false;
  handle.addEventListener('pointerdown',event=>{ moving=true; handle.setPointerCapture(event.pointerId); card.classList.add('dragging'); event.stopPropagation(); });
  handle.addEventListener('pointermove',event=>{ if(!moving)return; const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.group-card'); if(target&&target!==card){ const rect=target.getBoundingClientRect(); $('#groups').insertBefore(card,event.clientY<rect.top+rect.height/2?target:target.nextSibling); } });
  handle.addEventListener('pointerup',()=>{ moving=false; card.classList.remove('dragging'); syncCollectionOrder(); });
}
function syncCollectionOrder(){ const order=$$('.group-card').map(card=>card.dataset.id); state.collections.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id)); saveState(); showToast('Collection order updated'); }
function openCollection(id){ activeCollection=state.collections.find(c=>c.id===id); if(!activeCollection)return; $('#collectionPageTitle').textContent=activeCollection.name; $('#collectionLargeIcon').style.background=activeCollection.color; $('#collectionLargeIcon').innerHTML=`<i data-lucide="${esc(activeCollection.icon)}"></i>`; $('#episodeSearch').value=''; $('#showSpotify').checked=true; $('#showLocal').checked=true; $('#showOnline').checked=true; renderEpisodes(); showView($('#collectionView')); }
function renderEpisodes(){ if(!activeCollection)return; const term=$('#episodeSearch').value.trim().toLowerCase(); const allowed={spotify:$('#showSpotify').checked,local:$('#showLocal').checked,online:$('#showOnline').checked}; let list=activeCollection.id==='all'?state.episodes:state.episodes.filter(ep=>ep.groups.includes(activeCollection.id)); list=list.filter(ep=>(`${ep.tag} ${ep.title}`).toLowerCase().includes(term)&&allowed[ep.source]); $('#episodes').innerHTML=list.map(episodeMarkup).join(''); $('#emptyCollection').hidden=list.length>0; wireEpisodes($('#episodes')); $('#filterButton').classList.toggle('active',!Object.values(allowed).every(Boolean)); }
function renderAll(){ renderCollections(); renderRecent(); if(activeCollection){ activeCollection=state.collections.find(c=>c.id===activeCollection.id)||null; if(activeCollection)renderEpisodes(); else showView($('#libraryView')); } }
function renderIconGrid(term=''){ const list=iconNames.filter(name=>name.includes(term.toLowerCase())); $('#iconGrid').innerHTML=list.map(name=>`<button class="icon-choice ${name===selectedIcon?'selected':''}" data-icon="${name}" title="${name}"><i data-lucide="${name}"></i></button>`).join(''); $$('.icon-choice').forEach(button=>button.addEventListener('click',()=>{ selectedIcon=button.dataset.icon; renderIconGrid($('#iconSearch').value); })); refreshIcons(); }
function renderColors(){ $('#colorGrid').innerHTML=colors.map(color=>`<button class="color-choice ${color===selectedColor?'selected':''}" style="--swatch:${color}" data-color="${color}" aria-label="Choose ${color}"></button>`).join(''); $$('.color-choice').forEach(button=>button.addEventListener('click',()=>{ selectedColor=button.dataset.color; renderColors(); })); }
function openCollectionSheet(id=null){ editingCollectionId=id; const collection=id?state.collections.find(c=>c.id===id):null; selectedIcon=collection?.icon||'library'; selectedColor=collection?.color||colors[0]; $('#collectionSheetTitle').textContent=collection?'Edit collection':'New collection'; $('#createCollection').textContent=collection?'Save changes':'Create collection'; $('#collectionName').value=collection?.name||''; $('#iconSearch').value=''; renderIconGrid(); renderColors(); openSheet('#collectionSheet'); setTimeout(()=>$('#collectionName').focus(),180); }
function saveCollection(){ const name=$('#collectionName').value.trim(); if(!name){ showToast('Enter a collection name'); return; } if(editingCollectionId){ const collection=state.collections.find(c=>c.id===editingCollectionId); if(collection)Object.assign(collection,{name,icon:selectedIcon,color:selectedColor}); showToast('Collection updated'); } else state.collections.push({id:crypto.randomUUID(),name,icon:selectedIcon,color:selectedColor}); saveState(); renderAll(); closeSheets(); }
function setSource(source){ addSource=source; $$('.source-tab').forEach(button=>button.classList.toggle('selected',button.dataset.source===source)); $('#spotifyFields').hidden=source!=='spotify'; $('#localFields').hidden=source!=='local'; $('#onlineFields').hidden=source!=='online'; $('#spotifyArtworkButton').hidden=source!=='spotify'; refreshIcons(); }
function updateArtworkPreview(){ $('#artworkPreview').innerHTML=draftArtwork?`<img src="${esc(draftArtwork)}" alt="Episode artwork">`:'EP'; }
function spotifyFallbackArtwork(){ const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" rx="45" fill="#1ed760"/><circle cx="150" cy="150" r="92" fill="#101010"/><path d="M94 125c39-15 86-12 123 8M101 153c34-11 76-8 108 8M109 180c27-7 59-5 84 7" fill="none" stroke="#1ed760" stroke-width="14" stroke-linecap="round"/></svg>`; return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
async function syncSpotifyArtwork(silent=false){ const url=$('#spotifyUrl').value.trim(); if(!url||!url.includes('spotify.com')){if(!silent)showToast('Enter a Spotify link first');return;} $('#spotifyArtworkButton').disabled=true; $('#spotifyArtworkButton').innerHTML='<i data-lucide="loader-circle"></i> Syncing artwork'; refreshIcons(); try{ const response=await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`); if(!response.ok)throw new Error(); const data=await response.json(); if(!data.thumbnail_url)throw new Error(); draftArtwork=data.thumbnail_url; draftArtworkSource='spotify'; updateArtworkPreview(); if(!silent)showToast('Spotify artwork synced'); }catch{ if(draftArtworkSource!=='custom'){draftArtwork=spotifyFallbackArtwork();draftArtworkSource='spotify';updateArtworkPreview();} if(!silent)showToast('Using Spotify fallback artwork'); }finally{$('#spotifyArtworkButton').disabled=false;$('#spotifyArtworkButton').innerHTML='<i data-lucide="refresh-cw"></i> Sync Spotify artwork';refreshIcons();} }
function readImage(file){ return new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(file); }); }
function extractSpotifyEmbed(url){ try{ const parsed=new URL(url); const parts=parsed.pathname.split('/').filter(Boolean); return parts[0]&&parts[1]?`https://open.spotify.com/embed/${parts[0]}/${parts[1]}`:''; }catch{return '';} }
function openEpisodeSheet(id=null){ editingEpisodeId=id; const ep=id?state.episodes.find(item=>item.id===id):null; $('#episodeSheetTitle').textContent=ep?'Edit episode':'Add podcast media'; $('#saveEpisode').textContent=ep?'Save changes':'Add episode'; $('#episodeTitle').value=ep?.title||''; $('#episodeTag').value=ep?.tag||''; $('#spotifyUrl').value=ep?.url||''; $('#onlineName').value=ep?.onlineName||''; $('#onlinePath').value=ep?.onlinePath||''; $('#audioFile').value=''; $('#artworkFile').value=''; draftArtwork=ep?.artImage||''; draftArtworkSource=ep?.artSource||'default'; draftLocalUrl=ep?.localUrl||''; updateArtworkPreview(); setSource(ep?.source||'spotify'); openSheet('#episodeSheet'); }
async function saveEpisode(){ const title=$('#episodeTitle').value.trim()||'Untitled episode'; const tag=$('#episodeTag').value.trim()||sourceInfo(addSource).label; const existing=editingEpisodeId?state.episodes.find(ep=>ep.id===editingEpisodeId):null; const target=existing||{id:crypto.randomUUID(),groups:activeCollection&&activeCollection.id!=='all'?[activeCollection.id]:['all'],progress:0,savedAt:Date.now(),artClass:addSource==='online'?'three':addSource==='local'?'five':'one'}; target.title=title; target.tag=tag; target.source=addSource; target.artImage=draftArtwork; target.artSource=draftArtworkSource; target.artText=(tag||title).slice(0,2).toUpperCase(); target.time=target.time||'Not started'; if(addSource==='spotify'){target.url=$('#spotifyUrl').value.trim()||'https://open.spotify.com';target.embed=extractSpotifyEmbed(target.url);target.localName='';target.onlineName='';target.onlinePath='';if(!draftArtwork)await syncSpotifyArtwork(true);target.artImage=draftArtwork;target.artSource=draftArtworkSource;} else if(addSource==='local'){const file=$('#audioFile').files[0];if(file){if(draftLocalUrl?.startsWith('blob:'))URL.revokeObjectURL(draftLocalUrl);draftLocalUrl=URL.createObjectURL(file);target.localName=file.name;pendingAudioFiles.set(target.id,file);}target.localUrl=draftLocalUrl;target.url='';target.embed='';target.onlineName='';target.onlinePath='';target.time=target.localUrl?'Ready to play':'Local file';} else {target.onlineName=$('#onlineName').value.trim()||'cloud-audio.mp3';target.onlinePath=$('#onlinePath').value.trim()||`user/audio/${target.onlineName}`;target.audioPath=target.onlinePath;target.url='';target.embed='';target.localUrl='';target.localName='';target.time='Not downloaded';} if(!existing)state.episodes.unshift(target); saveState(); renderAll(); closeSheets(); showToast(existing?'Episode updated':'Episode added'); }
function openPlayer(id){ selectedEpisode=state.episodes.find(ep=>ep.id===id); if(!selectedEpisode)return; $('#playTitle').textContent=selectedEpisode.title; $('#playerMount').innerHTML=''; $('#openSpotify').hidden=selectedEpisode.source!=='spotify'; $('#playHere').hidden=false; $('#playHere').innerHTML=selectedEpisode.source==='online'?'<i data-lucide="cloud-download"></i> Download and play':'<i data-lucide="play"></i> Play in app'; openSheet('#playSheet'); }
async function playSelected(){ if(!selectedEpisode)return; if(selectedEpisode.source==='spotify'){const embed=selectedEpisode.embed||extractSpotifyEmbed(selectedEpisode.url);if(!embed){showToast('This Spotify link cannot be embedded');return;}$('#playerMount').innerHTML=`<iframe class="player-frame" src="${esc(embed)}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;$('#playHere').hidden=true;} else if(selectedEpisode.source==='local'){if(!selectedEpisode.localUrl){showToast('Choose the local file again on this device');return;}$('#playerMount').innerHTML=`<audio class="local-player" controls autoplay src="${esc(selectedEpisode.localUrl)}"></audio>`;$('#playHere').hidden=true;} else {if(!currentUser||!selectedEpisode.audioPath){showToast('Sign in and sync files first');return;}const {data,error}=await db().storage.from('podcast-audio').createSignedUrl(selectedEpisode.audioPath,3600);if(error){showToast('Could not load online file');return;}$('#playerMount').innerHTML=`<audio class="local-player" controls autoplay src="${esc(data.signedUrl)}"></audio>`;$('#playHere').hidden=true;} }

function setupProfile(){ let nickname=localStorage.getItem('geodetaNickname')||'Som'; let photo=localStorage.getItem('geodetaProfilePhoto')||''; $('#nickname').value=nickname; function draw(){nickname=$('#nickname').value.trim()||'S';localStorage.setItem('geodetaNickname',nickname);localStorage.setItem(DIRTY_KEY,'true');$('#profileInitial').textContent=nickname[0].toUpperCase();$('#headerAvatar').textContent=nickname[0].toUpperCase();$('#profilePhoto').querySelectorAll('img').forEach(img=>img.remove());if(photo){const img=document.createElement('img');img.src=photo;$('#profilePhoto').prepend(img);$('#headerAvatar').innerHTML=`<img src="${photo}" alt="">`;}} $('#nickname').addEventListener('input',draw); $('#photoEdit').addEventListener('click',()=>$('#photoInput').click()); $('#photoInput').addEventListener('change',event=>{const file=event.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{photo=reader.result;localStorage.setItem('geodetaProfilePhoto',photo);draw();showToast('Profile picture saved locally');};reader.readAsDataURL(file);}); draw(); }
function updateGoogleButton(){ const button=$('#googleLink'); button.textContent=currentUser?'Sign out':'Sign in with Google'; button.classList.toggle('unlink',Boolean(currentUser)); const copy=button.closest('.settings-row')?.querySelector('.settings-copy span'); if(copy)copy.textContent=currentUser?currentUser.email:'Use Google for your Geodeta Media account.'; }
async function handleGoogleButton(){ if(!db()){showToast('Supabase is not ready');return;} if(currentUser){await db().auth.signOut();return;} const {error}=await db().auth.signInWithOAuth({provider:'google',options:{redirectTo:'https://media.geodeta.us'}}); if(error){console.error(error);showToast('Google sign-in failed');} }
function setupSpotifyButton(){ const button=$('#spotifyLink'); let linked=localStorage.getItem('geodetaSpotifyLinked')==='true'; const draw=()=>{button.textContent=linked?'Unlink':'Link to Spotify';button.classList.toggle('unlink',linked)}; draw(); button.addEventListener('click',()=>{linked=!linked;localStorage.setItem('geodetaSpotifyLinked',String(linked));draw();showToast(`Spotify ${linked?'linked':'unlinked'} in UI`);}); }

function collectionRows(userId){ return state.collections.filter(c=>c.id!=='all').map((c,index)=>({id:c.id,user_id:userId,name:c.name,icon:c.icon,color:c.color,position:index})); }
function episodeRows(userId){ return state.episodes.map(ep=>({id:ep.id,user_id:userId,title:ep.title,tag:ep.tag||'Episode',source_type:ep.source==='online'?'local':ep.source,spotify_url:ep.url||null,spotify_embed_url:ep.embed||null,artwork_path:ep.artworkPath||null,artwork_url:ep.artSource==='spotify'?ep.artImage||null:null,audio_path:ep.audioPath||ep.onlinePath||null,original_filename:ep.localName||ep.onlineName||null,position_ms:Math.round((ep.positionMs||0)),progress_percent:Number(ep.progress)||0,finished:Number(ep.progress)>=98,saved_at:new Date(Number(ep.savedAt)>1e12?Number(ep.savedAt):Date.now()).toISOString()})); }
function relationRows(){ const rows=[]; state.episodes.forEach((ep,episodeIndex)=>ep.groups.filter(group=>group!=='all'&&isUuid(group)).forEach(group=>rows.push({collection_id:group,episode_id:ep.id,position:episodeIndex}))); return rows; }
async function uploadLocalData(){
  normalizeIds(); saveState(false);
  const userId=currentUser.id;
  const nickname=$('#nickname').value.trim()||currentUser.user_metadata?.full_name||'User';
  let result=await db().from('profiles').upsert({user_id:userId,nickname}); if(result.error)throw result.error;
  await db().from('collection_episodes').delete().in('episode_id',state.episodes.filter(ep=>isUuid(ep.id)).map(ep=>ep.id));
  await db().from('episodes').delete().eq('user_id',userId);
  await db().from('collections').delete().eq('user_id',userId);
  const collections=collectionRows(userId); if(collections.length){result=await db().from('collections').insert(collections);if(result.error)throw result.error;}
  const episodes=episodeRows(userId); if(episodes.length){result=await db().from('episodes').insert(episodes);if(result.error)throw result.error;}
  const relations=relationRows(); if(relations.length){result=await db().from('collection_episodes').insert(relations);if(result.error)throw result.error;}
  localStorage.setItem(DIRTY_KEY,'false');
}
async function downloadRemoteData(){
  const userId=currentUser.id;
  const [profileResult,collectionResult,episodeResult,relationResult]=await Promise.all([
    db().from('profiles').select('nickname').eq('user_id',userId).maybeSingle(),
    db().from('collections').select('*').eq('user_id',userId).order('position'),
    db().from('episodes').select('*').eq('user_id',userId).order('saved_at',{ascending:false}),
    db().from('collection_episodes').select('*')
  ]);
  for(const result of [profileResult,collectionResult,episodeResult,relationResult])if(result.error)throw result.error;
  if(profileResult.data?.nickname){$('#nickname').value=profileResult.data.nickname;localStorage.setItem('geodetaNickname',profileResult.data.nickname);}
  if(!collectionResult.data.length&&!episodeResult.data.length)return false;
  const relationMap=new Map(); relationResult.data.forEach(row=>{if(!relationMap.has(row.episode_id))relationMap.set(row.episode_id,[]);relationMap.get(row.episode_id).push(row.collection_id);});
  state.collections=[{id:'all',name:'All Episodes',icon:'library',color:'#5b5ce2'},...collectionResult.data.map(row=>({id:row.id,name:row.name,icon:row.icon,color:row.color}))];
  state.episodes=episodeResult.data.map(row=>({id:row.id,groups:relationMap.get(row.id)||['all'],source:row.spotify_url?'spotify':row.audio_path?'online':row.source_type,tag:row.tag,title:row.title,time:row.audio_path&&!row.spotify_url?'Not downloaded':row.finished?'Finished':'Synced',progress:Number(row.progress_percent)||0,positionMs:Number(row.position_ms)||0,artText:(row.tag||row.title).slice(0,2).toUpperCase(),artClass:row.spotify_url?'one':'three',artImage:row.artwork_url||'',artSource:row.artwork_url?'spotify':'default',artworkPath:row.artwork_path||'',url:row.spotify_url||'',embed:row.spotify_embed_url||'',audioPath:row.audio_path||'',onlinePath:row.audio_path||'',onlineName:row.original_filename||'',savedAt:new Date(row.saved_at).getTime()}));
  saveState(false); localStorage.setItem(DIRTY_KEY,'false'); renderAll(); return true;
}
async function syncData(){
  if(!currentUser)throw new Error('Sign in with Google first');
  const remoteCheck=await db().from('episodes').select('id',{count:'exact',head:true}).eq('user_id',currentUser.id); if(remoteCheck.error)throw remoteCheck.error;
  const dirty=localStorage.getItem(DIRTY_KEY)==='true';
  if(dirty||!remoteCheck.count){await uploadLocalData();}else await downloadRemoteData();
}
function dataUrlToBlob(dataUrl){ const [header,data]=dataUrl.split(','); const mime=header.match(/data:(.*?);/)?.[1]||'image/jpeg'; const binary=atob(data); const bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i); return new Blob([bytes],{type:mime}); }
async function syncFiles(){
  if(!currentUser)throw new Error('Sign in with Google first');
  normalizeIds();
  for(const ep of state.episodes){
    const file=pendingAudioFiles.get(ep.id);
    if(file){const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');const path=`${currentUser.id}/${ep.id}-${safeName}`;const {error}=await db().storage.from('podcast-audio').upload(path,file,{upsert:true});if(error)throw error;ep.audioPath=path;ep.onlinePath=path;ep.onlineName=file.name;pendingAudioFiles.delete(ep.id);}
    if(ep.artSource==='custom'&&ep.artImage?.startsWith('data:')){const blob=dataUrlToBlob(ep.artImage);const path=`${currentUser.id}/${ep.id}.jpg`;const {error}=await db().storage.from('episode-artwork').upload(path,blob,{upsert:true,contentType:blob.type});if(error)throw error;ep.artworkPath=path;}
  }
  saveState(); await uploadLocalData();
}
async function runSync(type,quiet=false){
  const status=$('#syncStatus'); status.innerHTML=`<i data-lucide="loader-circle"></i> Syncing ${type}…`; refreshIcons();
  try{
    if(type==='data')await syncData();
    if(type==='files')await syncFiles();
    if(type==='all'){await syncFiles();await syncData();}
    if(type==='spotify')showToast('Spotify position sync needs Spotify OAuth');
    status.innerHTML='<i data-lucide="check-circle-2"></i> Synced just now'; if(!quiet&&type!=='spotify')showToast(type==='all'?'Everything synced':`${type[0].toUpperCase()+type.slice(1)} synced`);
  }catch(error){console.error(error);status.innerHTML='<i data-lucide="circle-alert"></i> Sync failed';if(!quiet)showToast(error.message||'Sync failed');}
  refreshIcons();
}
async function setupAuth(){
  if(!db()){showToast('Supabase client did not load');return;}
  const {data}=await db().auth.getSession(); currentUser=data.session?.user||null; updateGoogleButton();
  db().auth.onAuthStateChange((event,session)=>{currentUser=session?.user||null;updateGoogleButton();if(currentUser&&(event==='SIGNED_IN'||event==='INITIAL_SESSION'))setTimeout(()=>runSync('data',true),250);});
}

function bindEvents(){
  $('#libraryNav').addEventListener('click',()=>showView($('#libraryView'))); $('#profileNav').addEventListener('click',()=>showView($('#profileView'))); $('#headerAvatar').addEventListener('click',()=>showView($('#profileView'))); $('#backButton').addEventListener('click',()=>showView($('#libraryView')));
  $('#collectionSearch').addEventListener('input',renderCollections); $('#episodeSearch').addEventListener('input',renderEpisodes); $('#showSpotify').addEventListener('change',renderEpisodes); $('#showLocal').addEventListener('change',renderEpisodes); $('#showOnline').addEventListener('change',renderEpisodes);
  $('#filterButton').addEventListener('click',event=>{event.stopPropagation();$('#filterPopover').classList.toggle('open')}); document.addEventListener('click',event=>{if(!event.target.closest('.collection-actions'))$('#filterPopover').classList.remove('open')});
  $('#addGroup').addEventListener('click',()=>openCollectionSheet()); $('#collectionHeaderEdit').addEventListener('click',()=>activeCollection&&openCollectionSheet(activeCollection.id)); $('#createCollection').addEventListener('click',saveCollection); $('#iconSearch').addEventListener('input',event=>renderIconGrid(event.target.value));
  $('#addEpisode').addEventListener('click',()=>openEpisodeSheet()); $$('.source-tab').forEach(button=>button.addEventListener('click',()=>setSource(button.dataset.source))); $('#saveEpisode').addEventListener('click',saveEpisode);
  $('#artworkChoose').addEventListener('click',()=>$('#artworkFile').click()); $('#artworkFile').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;draftArtwork=await readImage(file);draftArtworkSource='custom';updateArtworkPreview();showToast('Custom episode image selected')});
  $('#spotifyArtworkButton').addEventListener('click',()=>syncSpotifyArtwork(false)); $('#spotifyUrl').addEventListener('input',()=>{clearTimeout(spotifyArtworkTimer);if(draftArtworkSource!=='custom')spotifyArtworkTimer=setTimeout(()=>syncSpotifyArtwork(true),650)});
  $('#playHere').addEventListener('click',playSelected); $('#openSpotify').addEventListener('click',()=>selectedEpisode?.url&&window.open(selectedEpisode.url,'_blank','noopener'));
  $$('.close-sheet').forEach(button=>button.addEventListener('click',closeSheets)); $$('.sheet-backdrop').forEach(sheet=>sheet.addEventListener('click',event=>{if(event.target===sheet)closeSheets()}));
  $$('.sync-button').forEach(button=>button.addEventListener('click',()=>runSync(button.dataset.sync)));
  $('#googleLink').addEventListener('click',handleGoogleButton);
}
async function init(){ bindEvents(); setupProfile(); setupSpotifyButton(); renderAll(); refreshIcons(); await setupAuth(); setTimeout(()=>{if(currentUser)runSync('data',true)},700); }
document.addEventListener('DOMContentLoaded',init);
