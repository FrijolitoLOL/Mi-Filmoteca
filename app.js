/* Mi Filmoteca 6.0 — cliente web, sin claves privadas en el navegador. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const today = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const GENRES = ['Acción','Aventura','Animación','Comedia','Crimen','Documental','Drama','Fantasía','Historia','Terror','Música','Misterio','Romance','Ciencia ficción','Suspenso','Bélica','Western','Familiar','Sin clasificar'];
  const TMDB_GENRES = {28:'Acción',12:'Aventura',16:'Animación',35:'Comedia',80:'Crimen',99:'Documental',18:'Drama',10751:'Familiar',14:'Fantasía',36:'Historia',27:'Terror',10402:'Música',9648:'Misterio',10749:'Romance',878:'Ciencia ficción',53:'Suspenso',10752:'Bélica',37:'Western'};
  const state = {sb:null,user:null,movies:[],view:'all',group:'years',editing:null,selected:null,results:[],searchSeq:0,searchTimer:null,authMode:'signin',busy:false,loadedUserId:null};
  const safe = (v) => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = (s) => String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const posterPathOK = (s) => /^\/[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp)$/i.test(String(s||''));
  const posterURL = (path, size='w185') => posterPathOK(path) ? `https://image.tmdb.org/t/p/${size}${path}` : '';
  const watchYear = (m) => m.to_watch?'':(m.watched_date||'').slice(0,4);
  const fullDate = (date) => {if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return 'Sin fecha'; const [y,m,d]=date.split('-');return `${d}/${m}/${y}`;};
  const banner = (msg,ms=3900) => {const t=$('toast'); t.textContent=msg;t.hidden=false;clearTimeout(banner.timer);banner.timer=setTimeout(()=>t.hidden=true,ms);};
  const errText = (error) => {
    const s = String(error?.message || error || 'Error desconocido');
    if (/Failed to fetch|NetworkError|fetch failed/i.test(s)) return 'No se pudo conectar. Revisa tu internet y la configuración de Supabase.';
    if (/duplicate key|filmoteca_user_tmdb_unique|23505/i.test(s)) return 'Esa película ya está guardada en tu colección.';
    if (/JWT|session|401/i.test(s)) return 'La sesión expiró. Vuelve a iniciar sesión.';
    return s;
  };
  function show(which){for(const id of ['setup-view','auth-view','app-view'])$(id).hidden=id!==which;}
  function authNotice(msg,error=false){const el=$('auth-message');el.textContent=msg;el.classList.toggle('error',error);}
  function formNotice(msg){$('movie-error').textContent=msg;}

  function setAuthMode(mode){
    state.authMode=mode;
    $('tab-signin').classList.toggle('selected',mode==='signin');
    $('tab-signup').classList.toggle('selected',mode==='signup');
    $('auth-title').textContent=mode==='signin'?'Bienvenido de nuevo':'Crea tu cuenta';
    $('auth-hint').textContent=mode==='signin'?'Continúa donde dejaste tu filmoteca.':'Tu colección será privada y estará disponible en cualquier dispositivo.';
    $('auth-submit').textContent=mode==='signin'?'Entrar a mi filmoteca':'Registrarme gratis';
    $('auth-password').autocomplete=mode==='signin'?'current-password':'new-password';
    authNotice('');
  }
  async function signInGoogle(){
    if(state.busy)return;
    const button=$('auth-google');
    state.busy=true;
    button.disabled=true;
    authNotice('Abriendo el inicio de sesión de Google…');
    try{
      const {error}=await state.sb.auth.signInWithOAuth({
        provider:'google',
        options:{redirectTo:location.origin+location.pathname}
      });
      if(error)throw error;
      // Supabase redirige al navegador a Google. La sesión se restaurará al volver.
    }catch(error){
      authNotice(errText(error),true);
      state.busy=false;
      button.disabled=false;
    }
  }
  async function submitAuth(e){
    e.preventDefault(); if(state.busy)return;
    const email=$('auth-email').value.trim();const password=$('auth-password').value;
    state.busy=true;$('auth-submit').disabled=true;authNotice('Conectando…');
    try{
      const redirectTo=location.origin+location.pathname;
      const result=state.authMode==='signin'
        ?await state.sb.auth.signInWithPassword({email,password})
        :await state.sb.auth.signUp({email,password,options:{emailRedirectTo:redirectTo}});
      if(result.error)throw result.error;
      if(state.authMode==='signup'&&!result.data?.session) authNotice('Cuenta creada. Revisa tu correo para confirmar el registro y luego inicia sesión.');
      else if(state.authMode==='signup')authNotice('¡Cuenta creada! Accediendo…');
      else authNotice('Sesión iniciada.');
    }catch(error){authNotice(errText(error),true);}finally{state.busy=false;$('auth-submit').disabled=false;}
  }
  async function recoverPassword(){
    const email=$('auth-email').value.trim()||prompt('¿A qué correo enviamos la recuperación de contraseña?');
    if(!email)return;
    const {error}=await state.sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
    if(error)authNotice(errText(error),true);else authNotice('Si el correo está registrado, recibirás un enlace para recuperar tu contraseña.');
  }
  async function updateSession(user){
    if(user?.id===state.loadedUserId)return;
    state.user=user||null;
    if(!user){state.loadedUserId=null;state.movies=[];state.profile=null;state.invites=[];closeComparePanel();show('auth-view');return;}
    state.loadedUserId=user.id;
    $('user-email').textContent=user.email||'Mi cuenta';
    show('app-view');
    await loadMovies();
    await loadProfile();
  }

  async function loadMovies(){
    if(!state.user)return;
    $('loading').hidden=false;
    try{
      const {data,error}=await state.sb.from('filmoteca_movies').select('id,user_id,tmdb_id,title,release_year,genre,poster_path,to_watch,watched_at_home,watched_date,created_at,updated_at').order('created_at',{ascending:false}).limit(2000);
      if(error)throw error;
      state.movies=Array.isArray(data)?data:[];
      render(); if(state.feature==='stats')renderStatistics();
    }catch(error){banner('No se pudo cargar tu colección: '+errText(error),8000);state.movies=[];render();}
    finally{$('loading').hidden=true;}
  }
  async function saveMovie(e){
    e.preventDefault();if(state.busy||!state.user)return;
    formNotice('');
    const title=$('movie-title').value.trim();const releaseStr=$('movie-release').value.trim();const release=releaseStr?Number(releaseStr):null;
    const genre=$('movie-genre').value;const pending=$('movie-pending').checked;
    const atHome=!pending&&$('movie-home').checked;
    const watchedDate=pending?null:$('movie-date').value;
    if(!title||title.length>250)return formNotice('Introduce un título válido.');
    if(release!==null&&(!Number.isSafeInteger(release)||release<1880||release>2200))return formNotice('El año de estreno debe ser válido.');
    if(!GENRES.includes(genre))return formNotice('Selecciona un género principal.');
    if(!pending&&(!/^\d{4}-\d{2}-\d{2}$/.test(watchedDate)||watchedDate>today()))return formNotice('Selecciona la fecha real en que viste la película (no futura).');
    const body={user_id:state.user.id,title,release_year:release,genre,poster_path:state.selected?.poster_path||null,tmdb_id:state.selected?.id||null,to_watch:pending,watched_at_home:atHome,watched_date:watchedDate};
    if(!state.editing&&state.movies.some(m => (body.tmdb_id&&m.tmdb_id===body.tmdb_id)||(norm(m.title)===norm(title)&&(m.release_year||null)===(release||null))))return formNotice('Ya guardaste esta película. Búscala en tu colección y edítala.');
    state.busy=true;$('movie-save').disabled=true;$('movie-save').textContent='Guardando…';
    try{
      const query=state.editing?state.sb.from('filmoteca_movies').update(body).eq('id',state.editing):state.sb.from('filmoteca_movies').insert(body);
      const {error}=await query;
      if(error)throw error;
      $('movie-dialog').close();banner(state.editing?'Película actualizada':'Película guardada en la nube');await loadMovies();
    }catch(error){formNotice(errText(error));}
    finally{state.busy=false;$('movie-save').disabled=false;$('movie-save').textContent='Guardar película';}
  }
  async function deleteMovie(){
    const record=state.movies.find(m=>m.id===state.editing);if(!record)return;
    if(!confirm(`¿Eliminar «${record.title}» de tu colección? Esta acción no se puede deshacer.`))return;
    const {error}=await state.sb.from('filmoteca_movies').delete().eq('id',record.id);
    if(error)return formNotice(errText(error));
    $('movie-dialog').close();banner('Película eliminada');await loadMovies();
  }

  function displayPoster(container,path,title){
    container.textContent='';
    const url=posterURL(path);
    if(!url){const span=document.createElement('span');span.textContent='🎞️';container.appendChild(span);return;}
    const img=document.createElement('img');img.src=url;img.loading='lazy';img.decoding='async';img.alt='Póster de '+title;
    img.onerror=()=>{img.remove();if(!container.childElementCount){const span=document.createElement('span');span.textContent='🎞️';container.appendChild(span);}};
    container.appendChild(img);
  }
  function togglePending(){
    const pending=$('movie-pending').checked;
    $('movie-home').disabled=pending;
    if(pending)$('movie-home').checked=false;
    $('watched-date-field').hidden=pending;
    $('movie-date').required=!pending;
    $('home-row').style.opacity=pending?'.5':'1';
  }
  function openMovie(id=null){
    state.editing=id; state.selected=null;state.results=[];state.searchSeq++;
    $('movie-form').reset();$('movie-results').innerHTML='';$('movie-search').value='';
    $('search-status').textContent='Busca por título o introduce sus datos manualmente.';formNotice('');
    $('movie-dialog-title').textContent=id?'Editar película':'Añadir película';$('movie-delete').hidden=!id;
    if(id){
      const m=state.movies.find(x=>x.id===id);if(!m)return;
      $('movie-title').value=m.title;
      $('movie-release').value=m.release_year??'';
      $('movie-genre').value=GENRES.includes(m.genre)?m.genre:'Sin clasificar';
      $('movie-pending').checked=!!m.to_watch;$('movie-home').checked=!!m.watched_at_home;
      $('movie-date').value=m.watched_date||'';
      if(m.tmdb_id)state.selected={id:m.tmdb_id,poster_path:m.poster_path};
      else if(m.poster_path)state.selected={id:null,poster_path:m.poster_path};
    }else{
      $('movie-genre').value='Sin clasificar';$('movie-pending').checked=true;$('movie-home').checked=false;$('movie-date').value='';
    }
    togglePending();refreshPoster();$('movie-dialog').showModal();
    $('movie-search').focus();
  }
  function refreshPoster(){displayPoster($('poster-preview'),state.selected?.poster_path,$('movie-title').value||'película');
    $('movie-source').textContent=state.selected?.id?'Datos vinculados a TMDB. Puedes ajustar el género principal.':'Si no aparece en TMDB, introduce el título y el género manualmente.';}
  async function searchTMDB(){
    const query=$('movie-search').value.trim();
    if(query.length<2){$('search-status').textContent='Escribe al menos dos caracteres.';return;}
    const seq=++state.searchSeq;
    $('search-status').textContent='Buscando en TMDB…';$('movie-results').innerHTML='';
    $('search-btn').disabled=true;
    try{
      const {data,error}=await state.sb.functions.invoke('tmdb-search',{body:{mode:'search',query}});
      if(seq!==state.searchSeq)return;
      if(error)throw error;
      if(data?.error)throw new Error(data.error);
      state.results=Array.isArray(data?.results)?data.results:[];
      $('search-status').textContent=state.results.length?'Selecciona una película de la lista.':'No encontramos resultados. Puedes escribir los datos manualmente.';
      drawSearchResults();
    }catch(error){
      if(seq!==state.searchSeq)return;
      // Supabase FunctionsHttpError guarda la respuesta HTTP real en error.context.
      // Mostrar el código ayuda a diferenciar sesión, permisos y errores de TMDB.
      const response=error?.context;
      const code=Number(response?.status||error?.status)||null;
      let serverError='';
      if(response && typeof response.clone==='function'){
        try{
          const payload=await response.clone().json();
          if(typeof payload?.error==='string')serverError=payload.error.slice(0,140);
        }catch{}
      }
      const diagnostic=code?' (HTTP '+code+')':'';
      let explanation=serverError||errText(error);
      if(code===401)explanation='Sesión rechazada. Cierra sesión e inicia con Google nuevamente.';
      else if(code===403)explanation='Acceso denegado. Revisa los permisos de la función.';
      else if(code===429)explanation='Demasiadas consultas. Intenta de nuevo más tarde.';
      else if(code>=500 && !serverError)explanation='Error del servidor o de TMDB. Revisa los registros de la función en Supabase.';
      $('search-status').textContent='No se pudo buscar'+diagnostic+': '+explanation+' Puedes registrar la película manualmente.';
      console.warn('Fallo tmdb-search:',{httpStatus:code,serverMessage:serverError});
    }finally{if(seq===state.searchSeq)$('search-btn').disabled=false;}
  }
  function drawSearchResults(){
    const el=$('movie-results');el.innerHTML='';
    for(const m of state.results){
      const b=document.createElement('button');b.className='search-result';b.type='button';b.dataset.tmdb=String(m.id);
      const path=posterURL(m.poster_path,'w92');
      b.innerHTML=(path?`<img loading="lazy" src="${path}" alt="">`:'<span class="result-fallback">🎞️</span>')+`<span class="result-text"><strong>${safe(m.title)}</strong><small>${m.release_year||'Año desconocido'}</small></span><span aria-hidden="true">＋</span>`;
      el.appendChild(b);
    }
  }
  function selectTMDB(id){
    const result=state.results.find(x=>String(x.id)===String(id));if(!result)return;
    state.selected={id:Number(result.id),poster_path:posterPathOK(result.poster_path)?result.poster_path:null};
    $('movie-title').value=result.title;
    $('movie-release').value=result.release_year||'';
    $('movie-genre').value=TMDB_GENRES[result.genre_ids?.[0]]||'Sin clasificar';
    $('movie-search').value=result.title;
    $('movie-results').innerHTML='';$('search-status').textContent='Película seleccionada. Completa el estado y la fecha.';
    refreshPoster();
  }

  const viewFilter = (m) => state.view==='all'||(state.view==='pending'&&m.to_watch)||(state.view==='seen'&&!m.to_watch)||(state.view==='home'&&!m.to_watch&&m.watched_at_home)||(state.view==='cinema'&&!m.to_watch&&!m.watched_at_home);
  function render(){
    const movies=state.movies;
    $('stat-all').textContent=movies.length;
    const seen=movies.filter(m=>!m.to_watch),pending=movies.filter(m=>m.to_watch);
    $('stat-seen').textContent=seen.length;$('stat-pending').textContent=pending.length;
    $('stat-location').textContent=`${seen.filter(m=>m.watched_at_home).length} / ${seen.filter(m=>!m.watched_at_home).length}`;
    const names={all:'Todas tus películas',seen:'Películas vistas',pending:'Películas por ver',home:'Vistas en casa',cinema:'Vistas en cine'};
    const name=names[state.view];$('collection-title').textContent=name;$('view-label').textContent=name.toUpperCase();
    $('collection-subtitle').textContent=`${movies.filter(viewFilter).length} película(s) en esta sección.`;
    document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===state.view));
    $('group-years').classList.toggle('active',state.group==='years');$('group-genres').classList.toggle('active',state.group==='genres');
    const years=[...new Set(movies.filter(m=>!m.to_watch&&watchYear(m)).map(watchYear))].sort((a,b)=>b.localeCompare(a));
    const genres=[...new Set(movies.map(m=>m.genre||'Sin clasificar'))].sort((a,b)=>a.localeCompare(b,'es'));
    const previousYear=$('filter-year').value||'all',previousGenre=$('filter-genre').value||'all';
    $('filter-year').innerHTML='<option value="all">Todos los años</option>'+years.map(y=>`<option value="${safe(y)}">Vistas en ${safe(y)}</option>`).join('');
    $('filter-genre').innerHTML='<option value="all">Todos los géneros</option>'+genres.map(g=>`<option value="${safe(g)}">${safe(g)}</option>`).join('');
    $('filter-year').value=years.includes(previousYear)?previousYear:'all';
    $('filter-genre').value=genres.includes(previousGenre)?previousGenre:'all';
    const q=norm($('filter-q').value),y=$('filter-year').value,g=$('filter-genre').value;
    const filtered=movies.filter(m=>viewFilter(m)&&(!q||norm(m.title).includes(q))&&(y==='all'||watchYear(m)===y)&&(g==='all'||m.genre===g));
    const sort=$('sort').value;
    filtered.sort((a,b)=>sort==='az'?a.title.localeCompare(b.title,'es'):sort==='release'?(b.release_year||0)-(a.release_year||0):sort==='watch-old'?(a.watched_date||'9999').localeCompare(b.watched_date||'9999'):(b.watched_date||b.created_at||'').localeCompare(a.watched_date||a.created_at||''));
    const root=$('collection');root.innerHTML='';
    if(!filtered.length){
      const empty=document.createElement('div');empty.className='empty';
      const initial=!movies.length;
      empty.innerHTML=`<div class="empty-icon">${initial?'🎬':'🔎'}</div><h3>${initial?'Tu filmoteca empieza aquí':'No encontramos películas'}</h3><p>${initial?'Busca una película, guárdala como vista o agrégala a tus pendientes. Tu colección aparecerá también en el celular.':'Prueba otros filtros o agrega una película nueva.'}</p><button type="button" class="btn primary" id="empty-add">+ Añadir película</button>`;
      root.appendChild(empty);$('empty-add').onclick=()=>openMovie();return;
    }
    const groups=new Map();
    for(const m of filtered){
      const key=state.group==='genres'?(m.genre||'Sin clasificar'):(m.to_watch?'Por ver':(watchYear(m)||'Sin fecha'));
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);
    }
    const keys=[...groups.keys()].sort((a,b)=>state.group==='genres'?a.localeCompare(b,'es'):a==='Por ver'?-1:b==='Por ver'?1:b.localeCompare(a));
    for(const key of keys){
      const section=document.createElement('section');section.className='group';
      section.innerHTML=`<h3>${safe(key)} <small>${groups.get(key).length}</small></h3><div class="movie-grid"></div>`;
      const grid=section.querySelector('.movie-grid');
      for(const m of groups.get(key)){
        const card=document.createElement('article');card.className='movie-card';
        const url=posterURL(m.poster_path);
        card.innerHTML=`<div class="poster-wrap"><div class="poster-fallback"><span>🎞️</span><strong>${safe(m.title)}</strong></div>${url?`<img src="${url}" alt="Póster de ${safe(m.title)}" loading="lazy" decoding="async" width="185" height="278" onerror="this.remove()">`:''}<button class="edit" type="button" data-edit="${safe(m.id)}" aria-label="Editar ${safe(m.title)}">Editar</button></div><h4>${safe(m.title)}</h4><div class="meta">${m.release_year||'Estreno sin fecha'}${!m.to_watch?' · '+fullDate(m.watched_date):''}</div><div class="genre">${safe(m.genre||'Sin clasificar')}</div><div class="status ${m.to_watch?'pending':'seen'}">${m.to_watch?'◷ Por ver':m.watched_at_home?'✓ Vista en casa':'✓ Vista en cine'}</div><div class="quick-controls"><label><input type="checkbox" data-quick-pending="${safe(m.id)}" ${m.to_watch?'checked':''}> Por ver</label><label><input type="checkbox" data-quick-home="${safe(m.id)}" ${m.watched_at_home?'checked':''} ${m.to_watch?'disabled':''}> Vista en casa</label></div>`;
        grid.appendChild(card);
      }
      root.appendChild(section);
    }
  }

  async function toggleCard(e){
    const inp=e.target.closest('input[data-quick-pending],input[data-quick-home]');
    if(!inp)return;
    const id=inp.dataset.quickPending||inp.dataset.quickHome;
    const movie=state.movies.find(m=>m.id===id);
    if(!movie || state.busy){render();return;}
    if(inp.hasAttribute('data-quick-pending') && movie.to_watch && !inp.checked){
      // Vista requiere fecha real; no suponemos que se vio hoy.
      openMovie(movie.id);
      $('movie-pending').checked=false;togglePending();
      $('movie-date').focus();
      banner('Indica la fecha en que la viste y guarda el cambio.');
      return;
    }
    let patch;
    if(inp.hasAttribute('data-quick-pending')){
      if(!inp.checked)return; // caso manejado arriba
      if(!confirm(`¿Mover «${movie.title}» a Por ver? Se borrará su fecha de visualización.`)) {render();return;}
      patch={to_watch:true,watched_date:null,watched_at_home:false};
    }else{
      if(movie.to_watch){render();return;}
      patch={watched_at_home:inp.checked};
    }
    inp.disabled=true;
    const {error}=await state.sb.from('filmoteca_movies').update(patch).eq('id',movie.id);
    if(error){banner(errText(error));render();return;}
    await loadMovies();
  }
  // Mi Filmoteca 6.0: identidad, estadísticas, respaldos y comparaciones con consentimiento.
  Object.assign(state,{feature:null,profile:null,invites:[],foundUser:null,activeComparison:null,installPrompt:null});

  function setFeature(feature){
    state.feature=feature;
    const inCollection=!feature;
    $('hero-section').hidden=!inCollection;
    $('stats-summary').hidden=!inCollection;
    $('collection-section').hidden=!inCollection;
    $('feature-page').hidden=inCollection;
    for(const name of ['profile','stats','compare','backup'])$('feature-'+name).hidden=name!==feature;
    document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',!feature&&b.dataset.view===state.view));
    document.querySelectorAll('[data-feature]').forEach(b=>b.classList.toggle('selected',b.dataset.feature===feature));
    $('view-label').textContent=feature?({profile:'MI PERFIL',stats:'ESTADÍSTICAS',compare:'COMPARAR CON',backup:'RESPALDOS E INSTALACIÓN'}[feature]):'MI COLECCIÓN';
    $('mobile-add').hidden=!!feature;
    if(feature==='stats')renderStatistics();
    if(feature==='compare')refreshInvitations();
  }
  async function loadProfile(){
    if(!state.user)return;
    const {data,error}=await state.sb.from('filmoteca_profiles').select('user_id,username,display_name,avatar_emoji,discoverable').eq('user_id',state.user.id).maybeSingle();
    if(error){banner('Necesitamos aplicar upgrade_6_0.sql en Supabase: '+errText(error),8500);return;}
    state.profile=data||null;
    $('profile-name').value=data?.display_name||state.user.user_metadata?.full_name||'';
    $('profile-username').value=data?.username||'';
    $('profile-avatar').value=data?.avatar_emoji||'🎬';
    $('profile-avatar-preview').textContent=data?.avatar_emoji||'🎬';
    $('profile-discoverable').checked=!!data?.discoverable;
    document.querySelector('.profile .avatar').textContent=data?.avatar_emoji||'◉';
    document.querySelector('.profile-text strong').textContent=data?.display_name||'Mi cuenta';
    if(!data){setFeature('profile');banner('Configura tu @usuario para poder comparar películas con amigos.',6500);}
    else loadInvitationsBadge();
  }
  async function saveProfile(e){
    e.preventDefault();if(!state.user)return;
    const username=$('profile-username').value.toLowerCase().trim();
    const name=$('profile-name').value.trim();
    if(!/^[a-z0-9_]{3,24}$/.test(username)){ $('profile-message').textContent='El usuario debe tener 3–24 caracteres: a-z, 0-9 o _.';return;}
    if(!name||name.length>40){$('profile-message').textContent='Introduce un nombre de 1–40 caracteres.';return;}
    const avatar=$('profile-avatar').value;
    const body={user_id:state.user.id,username,display_name:name,avatar_emoji:avatar,discoverable:$('profile-discoverable').checked,updated_at:new Date().toISOString()};
    $('profile-save').disabled=true;
    try{
      const {error}=await state.sb.from('filmoteca_profiles').upsert(body,{onConflict:'user_id'});
      if(error)throw error;
      state.profile=body;
      $('profile-message').textContent='Perfil guardado correctamente.';
      document.querySelector('.profile .avatar').textContent=avatar;
      document.querySelector('.profile-text strong').textContent=name;
      banner('Tu perfil está listo.');
    }catch(error){$('profile-message').textContent=/duplicate key|23505/i.test(errText(error))?'Ese @usuario ya está ocupado. Elige otro.':errText(error);}
    finally{$('profile-save').disabled=false;}
  }
  function countsFor(values,key){const a=new Map();for(const m of values){const label=key(m);if(!label)continue;a.set(label,(a.get(label)||0)+1);}return [...a.entries()].sort((x,y)=>y[1]-x[1]||String(x[0]).localeCompare(String(y[0]),'es'));}
  function chartCard(title,items,maxBars=12){
    const card=document.createElement('div');card.className='data-card';
    const h=document.createElement('h3');h.textContent=title;card.appendChild(h);
    if(!items.length){const p=document.createElement('p');p.className='muted';p.textContent='Aún no hay datos.';card.appendChild(p);return card;}
    const max=Math.max(1,...items.map(x=>x[1]));
    items.slice(0,maxBars).forEach(([name,count])=>{
      const row=document.createElement('div');row.className='data-row';
      row.innerHTML=`<div class="data-row-label"><span>${safe(name)}</span><strong>${count}</strong></div><div class="data-bar"><span style="width:${Math.round(count/max*100)}%"></span></div>`;
      card.appendChild(row);
    });return card;
  }
  function renderStatistics(){
    const seen=state.movies.filter(m=>!m.to_watch);
    const el=$('stats-detail');el.innerHTML='';
    const years=countsFor(seen,m=>watchYear(m)||'Sin fecha');
    const genres=countsFor(seen,m=>m.genre||'Sin clasificar');
    el.appendChild(chartCard('Vistas por año',years,18));
    el.appendChild(chartCard('Vistas por género principal',genres,20));
    el.appendChild(chartCard('Lugar de visualización',[['En casa',seen.filter(m=>m.watched_at_home).length],['En cine',seen.filter(m=>!m.watched_at_home).length]]));
    el.appendChild(chartCard('Tu colección',[['Vistas',seen.length],['Por ver',state.movies.length-seen.length]]));
  }
  function downloadContent(content,filename,type){
    const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');
    a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
  const backupColumns=['tmdb_id','title','release_year','genre','poster_path','to_watch','watched_at_home','watched_date'];
  function exportBackup(format){
    const rows=state.movies.map(m=>Object.fromEntries(backupColumns.map(k=>[k,m[k]??null])));
    const stamp=today(),name=`mi-filmoteca-${stamp}`;
    if(format==='json'){
      downloadContent(JSON.stringify({format:'mi-filmoteca',version:6,exported_at:new Date().toISOString(),movies:rows},null,2),name+'.json','application/json;charset=utf-8');
    }else{
      // Impide la ejecución de fórmulas al abrir CSV en una hoja de cálculo.
      const cell=x=>{let v=x==null?'':String(x);if(/^[\s\t\r]*[=+\-@]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
      downloadContent('\ufeff'+[backupColumns.join(','),...rows.map(r=>backupColumns.map(k=>cell(r[k])).join(','))].join('\r\n'),name+'.csv','text/csv;charset=utf-8');
    }
    banner('Descargaste tu respaldo de '+rows.length+' películas.');
  }

  async function searchCompareUser(e){
    e.preventDefault();
    const username=$('compare-username').value.replace(/^@/,'').toLowerCase().trim();
    const result=$('compare-search-result');state.foundUser=null;
    if(!/^[a-z0-9_]{3,24}$/.test(username)){result.textContent='Usa el @usuario exacto (3–24 letras, números o guion bajo).';return;}
    if(!state.profile){result.textContent='Primero crea tu perfil en «Mi perfil».';return;}
    $('compare-search-btn').disabled=true;result.textContent='Buscando usuario…';
    try{
      const {data,error}=await state.sb.rpc('filmoteca_lookup_user',{p_username:username});
      if(error)throw error;
      const u=data?.[0];
      if(!u){result.textContent='No aparece ese usuario. Comprueba el nombre y si permite búsquedas.';return;}
      state.foundUser=u;
      result.innerHTML=`<div class="found-profile"><span class="invite-avatar">${safe(u.avatar_emoji||'🎬')}</span><div class="invite-description"><strong>${safe(u.display_name)}</strong><small>@${safe(u.username)}</small></div><button class="btn primary" type="button" id="send-invite">Enviar solicitud</button></div>`;
      $('send-invite').onclick=sendCompareRequest;
    }catch(error){result.textContent='Error buscando usuario: '+errText(error);}
    finally{$('compare-search-btn').disabled=false;}
  }
  async function sendCompareRequest(){
    const u=state.foundUser;if(!u)return;
    const btn=$('send-invite');btn.disabled=true;
    try{
      const {error}=await state.sb.rpc('filmoteca_create_invitation',{p_username:u.username});
      if(error)throw error;
      $('compare-search-result').textContent='Solicitud enviada. Tu amigo debe aceptarla desde su Filmoteca.';
      state.foundUser=null;await refreshInvitations();
    }catch(error){banner(errText(error),7000);btn.disabled=false;}
  }
  async function loadInvitationsBadge(){
    if(!state.user)return;
    const {data,error}=await state.sb.rpc('filmoteca_list_invitations');
    if(error)return;
    state.invites=Array.isArray(data)?data:[];
    const count=state.invites.filter(r=>r.status==='pending'&&r.direction==='incoming').length;
    $('request-count').hidden=count===0;$('request-count').textContent=String(count);
    if(state.feature==='compare')drawInvitations();
  }
  async function refreshInvitations(){
    if(!state.user)return;
    const el=$('compare-inbox');el.textContent='Actualizando solicitudes…';
    try{const {data,error}=await state.sb.rpc('filmoteca_list_invitations');if(error)throw error;
      state.invites=Array.isArray(data)?data:[];
      const count=state.invites.filter(r=>r.status==='pending'&&r.direction==='incoming').length;
      $('request-count').hidden=count===0;$('request-count').textContent=String(count);
      const active=state.activeComparison;
      if(active&&!state.invites.some(r=>r.request_id===active.id&&r.status==='accepted'))closeComparePanel();
      drawInvitations();
    }catch(error){el.textContent='No se pudieron cargar las solicitudes: '+errText(error);}
  }
  function drawInvitations(){
    const el=$('compare-inbox');el.innerHTML='';
    if(!state.invites.length){el.innerHTML='<p class="muted">Aún no hay solicitudes. Puedes buscar a un amigo por su @usuario.</p>';return;}
    const labels={pending:'Pendiente',accepted:'Aceptada (acceso temporal)',declined:'Rechazada',closed:'Finalizada',expired:'Caducada'};
    for(const r of state.invites){
      const entry=document.createElement('div');entry.className='invite-item';
      const side=r.direction==='incoming'?'Recibida de':'Enviada a';
      entry.innerHTML=`<div class="invite-avatar">${safe(r.other_avatar||'🎬')}</div><div class="invite-description"><strong>${safe(r.other_display_name||r.other_username||'Usuario')}</strong><small>${safe(side)} @${safe(r.other_username||'sin_usuario')} · ${safe(labels[r.status]||r.status)}</small></div><div class="invite-actions"></div>`;
      const actions=entry.querySelector('.invite-actions');
      function addAction(label,fn,primary=false){const b=document.createElement('button');b.type='button';b.className='btn'+(primary?' primary':'');b.textContent=label;b.onclick=fn;actions.appendChild(b);}
      if(r.status==='pending'&&r.direction==='incoming'){
        addAction('Aceptar',()=>respondInvitation(r.request_id,true),true);addAction('Rechazar',()=>respondInvitation(r.request_id,false));
      }
      if(r.status==='accepted')addAction('Comparar historiales',()=>openComparison(r),true);
      if(['pending','accepted'].includes(r.status))addAction('Finalizar',()=>endInvitation(r.request_id));
      el.appendChild(entry);
    }
  }
  async function respondInvitation(id,accept){
    if(accept&&!confirm('¿Permitir comparar temporalmente tus películas vistas con esta cuenta? Podrá ver tus títulos, fechas y si los viste en casa o cine durante un máximo de 60 minutos.'))return;
    try{const {error}=await state.sb.rpc('filmoteca_reply_invitation',{p_request_id:id,p_accept:accept});if(error)throw error;
      banner(accept?'Solicitud aceptada. El acceso durará 60 minutos como máximo.':'Solicitud rechazada.');await refreshInvitations();
      if(accept){const r=state.invites.find(x=>x.request_id===id);if(r)await openComparison(r);}
    }catch(error){banner(errText(error),7000);}
  }
  async function endInvitation(id){
    if(!confirm('¿Finalizar esta solicitud y revocar el acceso a los historiales?'))return;
    try{const {error}=await state.sb.rpc('filmoteca_close_invitation',{p_request_id:id});if(error)throw error;
      if(state.activeComparison?.id===id)closeComparePanel();
      banner('Acceso revocado. Para comparar otra vez necesitarán una solicitud nueva.');await refreshInvitations();
    }catch(error){banner(errText(error),7000);}
  }
  function closeComparePanel(){state.activeComparison=null;$('compare-output').hidden=true;$('compare-movies').innerHTML='';$('compare-summary').innerHTML='';}
  async function openComparison(r){
    const out=$('compare-output'),gallery=$('compare-movies');out.hidden=false;gallery.textContent='Comprobando el permiso y cargando películas…';
    try{
      const {data,error}=await state.sb.rpc('filmoteca_read_comparison',{p_request_id:r.request_id});if(error)throw error;
      state.activeComparison={id:r.request_id,expires:r.accepted_until};
      $('compare-title').textContent='Tú y '+(r.other_display_name||r.other_username);
      const movies=Array.isArray(data)?data:[];
      const matches=movies.filter(m=>m.is_match).length,onlyMe=movies.filter(m=>m.mine&&!m.theirs).length,onlyThem=movies.filter(m=>m.theirs&&!m.mine).length;
      $('compare-summary').innerHTML=`<div class="mini-stat"><strong>${matches}</strong><span>Coincidencias</span></div><div class="mini-stat"><strong>${onlyMe}</strong><span>Solo tú</span></div><div class="mini-stat"><strong>${onlyThem}</strong><span>Solo tu amigo</span></div>`;
      gallery.innerHTML='';
      if(!movies.length){gallery.textContent='Aún no hay películas vistas en ninguno de los dos historiales.';return;}
      for(const m of movies){
        const item=document.createElement('div');item.className='compare-movie'+(m.is_match?' matched':'');
        const poster=posterURL(m.movie_poster_path,'w185');
        const who=m.is_match?'✓ La vieron ambos':m.mine?'Solo tú':'Solo '+(r.other_display_name||'tu amigo');
        let details='';
        if(m.mine)details+='Tú: '+fullDate(m.my_watched_date)+' · '+(m.my_at_home?'Casa':'Cine');
        if(m.theirs)details+=(details?' | ':'')+'Amigo: '+fullDate(m.their_watched_date)+' · '+(m.their_at_home?'Casa':'Cine');
        item.innerHTML=(poster?`<img src="${poster}" alt="" loading="lazy" decoding="async">`:'<div class="fallback">🎞️</div>')+
          `<strong>${safe(m.movie_title)}</strong><small>${m.movie_release_year||'Estreno desconocido'} · ${safe(m.movie_genre||'Sin clasificar')}</small><small class="${m.is_match?'match-flag':''}">${safe(who)}</small><small>${safe(details)}</small>`;
        gallery.appendChild(item);
      }
      out.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){gallery.textContent='No se pudo mostrar la comparación: '+errText(error);state.activeComparison=null;}
  }
  function configurePWA(){
    window.addEventListener('beforeinstallprompt',event=>{
      event.preventDefault();state.installPrompt=event;$('install-app').hidden=false;
      $('install-hint').textContent='Tu navegador permite instalar Mi Filmoteca directamente.';
    });
    window.addEventListener('appinstalled',()=>{$('install-app').hidden=true;state.installPrompt=null;banner('Mi Filmoteca se instaló correctamente.');});
    $('install-app').onclick=async()=>{if(!state.installPrompt)return;state.installPrompt.prompt();
      await state.installPrompt.userChoice;state.installPrompt=null;$('install-app').hidden=true;
    };
  }

  async function init(){
    const cfg=window.FILMOTECA_CONFIG||{};
    const url=String(cfg.supabaseUrl||'');const pub=String(cfg.supabasePublishableKey||'');
    if(!/^https:\/\/[\w-]+\.supabase\.co\/?$/.test(url)||pub.includes('REEMPLAZAR')||pub.length<15){show('setup-view');return;}
    if(!window.supabase?.createClient){show('setup-view');$('.setup-card')?.classList.add('error');document.querySelector('.setup-card p').textContent='No se cargó la biblioteca de Supabase. Verifica que tengas internet y que el navegador permita jsDelivr.';return;}
    state.sb=window.supabase.createClient(url,pub,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});
    for(const g of GENRES){const o=document.createElement('option');o.value=g;o.textContent=g;$('movie-genre').appendChild(o);}
    $('movie-date').max=today();
    $('profile-form').onsubmit=saveProfile;
    $('profile-avatar').onchange=()=>{$('profile-avatar-preview').textContent=$('profile-avatar').value;};
    $('compare-search-form').onsubmit=searchCompareUser;
    $('refresh-requests').onclick=refreshInvitations;
    $('compare-close').onclick=()=>{if(state.activeComparison)endInvitation(state.activeComparison.id);};
    $('export-json').onclick=()=>exportBackup('json');
    $('export-csv').onclick=()=>exportBackup('csv');
    document.querySelectorAll('[data-feature]').forEach(b=>b.onclick=()=>setFeature(b.dataset.feature));
    configurePWA();
    setInterval(()=>{
      if(state.activeComparison?.expires && Date.parse(state.activeComparison.expires)<=Date.now()){
        closeComparePanel();banner('La comparación caducó. Solicita una nueva para volver a ver ambos historiales.');
      }
      if(state.user&&state.feature==='compare'&&!document.hidden)refreshInvitations();
    },30000);
    $('tab-signin').onclick=()=>setAuthMode('signin');$('tab-signup').onclick=()=>setAuthMode('signup');
    $('auth-form').onsubmit=submitAuth;$('auth-google').onclick=signInGoogle;$('password-help').onclick=recoverPassword;
    $('signout').onclick=async()=>{const {error}=await state.sb.auth.signOut();if(error)banner(errText(error));};
    $('add-open').onclick=()=>openMovie();$('mobile-add').onclick=()=>openMovie();
    $('movie-close').onclick=()=> $('movie-dialog').close();$('movie-cancel').onclick=()=> $('movie-dialog').close();
    $('movie-form').onsubmit=saveMovie;$('movie-delete').onclick=deleteMovie;
    $('movie-pending').onchange=togglePending;
    $('movie-search').oninput=()=>{clearTimeout(state.searchTimer);state.searchSeq++;if($('movie-search').value.trim().length>=3)state.searchTimer=setTimeout(searchTMDB,500);};
    $('movie-search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(state.searchTimer);searchTMDB();}};
    $('search-btn').onclick=searchTMDB;
    $('movie-results').onclick=e=>{const b=e.target.closest('[data-tmdb]');if(b)selectTMDB(b.dataset.tmdb);};
    $('collection').onclick=e=>{const b=e.target.closest('[data-edit]');if(b)openMovie(b.dataset.edit);};
    $('collection').addEventListener('change',toggleCard);
    $('movie-dialog').onclick=e=>{if(e.target===$('movie-dialog'))$('movie-dialog').close();};
    document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{setFeature(null);state.view=b.dataset.view;$('filter-q').value='';$('filter-year').value='all';$('filter-genre').value='all';render();});
    $('group-years').onclick=()=>{state.group='years';render();};$('group-genres').onclick=()=>{state.group='genres';render();};
    for(const id of ['filter-q','filter-year','filter-genre','sort'])$(id).addEventListener(id==='filter-q'?'input':'change',render);
    $('password-form').onsubmit=async e=>{e.preventDefault();const password=$('new-password').value;const {error}=await state.sb.auth.updateUser({password});if(error)banner(errText(error));else{$('password-dialog').close();banner('Contraseña actualizada');}};
    state.sb.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY') setTimeout(()=>{$('password-dialog').showModal();},0);
      setTimeout(()=>updateSession(session?.user||null),0);
    });
    try{const {data:{session},error}=await state.sb.auth.getSession();if(error)throw error;await updateSession(session?.user||null);}catch(error){show('auth-view');authNotice(errText(error),true);}
    if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();