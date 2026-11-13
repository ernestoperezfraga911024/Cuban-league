/* Browser preference; optional audience module receives only the validated profile ID. Never authentication. */
(()=>{
  'use strict';
  const KEY='cuban-league-viewer-v1';
  const $=id=>document.getElementById(id);
  let participants=[],choice=null,pendingId=null,initialized=false;
  let standings=[],hasPublishedPoints=false,closeTimer=null,returnFocus=null;
  let storageAvailable=true;
  const participant=id=>participants.find(person=>person.id===id)||null;
  const selected=()=>choice?.kind==='participant'?participant(choice.participantId):null;
  const normalize=text=>String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim();
  const reducedMotion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;

  function validChoice(value){
    if(!value||value.version!==1)return null;
    if(value.kind==='guest')return {version:1,kind:'guest'};
    if(value.kind==='participant'&&Number.isInteger(value.participantId)&&participant(value.participantId)){
      return {version:1,kind:'participant',participantId:value.participantId};
    }
    return null;
  }
  function readChoice(){
    let raw;
    try{raw=localStorage.getItem(KEY);}
    catch{storageAvailable=false;return null;}
    try{return validChoice(JSON.parse(raw||'null'));}
    catch{return null;}
  }
  function announce(message){if($('viewerStatus'))$('viewerStatus').textContent=message;}
  function updateControls(){
    const person=selected();
    $('viewerMenuLabel').textContent=person?`Tu perfil · ${person.name}`:choice?.kind==='guest'?'Tu perfil · Invitado':'Elegir mi perfil';
    $('viewerForget').hidden=!choice;
    $('viewerPreferenceNote').textContent=storageAvailable
      ?'Te recordaremos en este navegador.'
      :'Tu elección se mantendrá durante esta visita.';
  }
  function saveChoice(value){
    choice=validChoice(value);
    if(!choice)return;
    try{localStorage.setItem(KEY,JSON.stringify(choice));storageAvailable=true;}
    catch{storageAvailable=false;}
    updateControls();
    renderStandings();
    window.CubanLeagueAnalytics?.identify(choice);
    announce(storageAvailable
      ?(selected()?`Perfil elegido: ${selected().name}.`:'Entraste como invitado.')
      :'No se pudo recordar la elección en este navegador. Se mantendrá durante esta visita.');
    close();
  }
  function forget(){
    choice=null;
    pendingId=null;
    try{localStorage.removeItem(KEY);storageAvailable=true;}
    catch{storageAvailable=false;}
    updateControls();
    renderStandings();
    window.CubanLeagueAnalytics?.identify(choice);
    announce(storageAvailable?'Elección olvidada. Puedes elegir otro perfil cuando quieras.':'Elección borrada de esta visita; el navegador no permitió borrar el dato guardado.');
    // Deliberately do not reopen the prompt in the same visit.
    $('viewerChoose').focus();
  }
  function updatePending(){
    const person=participant(pendingId);
    $('viewerContinue').disabled=!person;
    $('viewerContinueLabel').textContent=person?`Continuar como ${person.name}`:'Elige tu perfil';
    for(const input of $('viewerList').querySelectorAll('input')){
      input.checked=Number(input.value)===pendingId;
      input.closest('label').classList.toggle('is-selected',input.checked);
    }
  }
  function renderList(){
    const query=normalize($('viewerSearch').value);
    const matches=participants.filter(person=>normalize(person.name).includes(query));
    const fragment=document.createDocumentFragment();
    for(const person of matches){
      const label=document.createElement('label');
      label.className='viewer-option';
      const input=document.createElement('input');
      input.type='radio';input.name='viewer-participant';input.value=String(person.id);
      const avatar=document.createElement('img');
      avatar.src=person.shield;avatar.alt='';avatar.width=44;avatar.height=44;
      const name=document.createElement('span');
      name.className='viewer-option-name';name.textContent=person.name;
      const mark=document.createElement('span');
      mark.className='viewer-option-check';mark.setAttribute('aria-hidden','true');mark.textContent='✓';
      label.append(input,avatar,name,mark);fragment.append(label);
    }
    $('viewerList').replaceChildren(fragment);
    $('viewerEmpty').hidden=matches.length>0;
    $('viewerResults').textContent=`${matches.length} ${matches.length===1?'participante':'participantes'}`;
    updatePending();
  }
  function open(){
    const dialog=$('viewerDialog');
    if(!initialized||typeof dialog?.showModal!=='function')return;
    if(closeTimer!==null){clearTimeout(closeTimer);closeTimer=null;}
    dialog.classList.remove('is-closing');
    returnFocus=document.activeElement;
    const menu=$('editorialMenu');
    if(menu?.open){
      returnFocus=[...document.querySelectorAll('[data-editorial-menu]')].find(button=>button.getClientRects().length)||returnFocus;
      menu.close();
    }
    pendingId=selected()?.id??null;
    $('viewerSearch').value='';
    renderList();
    updateControls();
    if(!dialog.open)dialog.showModal();
    document.body.classList.add('viewer-dialog-open');
    // Focus the heading, so opening on mobile never summons the keyboard.
    $('viewerTitle').focus({preventScroll:true});
  }
  function close(){
    const dialog=$('viewerDialog');
    if(!dialog?.open||closeTimer!==null)return;
    const finish=()=>{
      closeTimer=null;
      dialog.classList.remove('is-closing');
      dialog.close();
    };
    if(reducedMotion()){finish();return;}
    dialog.classList.add('is-closing');
    closeTimer=setTimeout(finish,180);
  }

  function renderStandings(rows=standings,{published=hasPublishedPoints}={}){
    standings=rows;hasPublishedPoints=published;
    const person=selected();
    const own=person&&standings.find(row=>row.id===person.id);
    const comparable=hasPublishedPoints&&Number.isFinite(own?.points);
    const byId=new Map(standings.map(row=>[row.id,row]));
    for(const element of document.querySelectorAll('#currentRows [data-participant-id]')){
      const row=byId.get(Number(element.dataset.participantId));
      const self=Boolean(person&&row?.id===person.id);
      element.classList.toggle('is-viewer',self);
      element.querySelector('.viewer-you')?.remove();
      element.querySelector('.viewer-difference')?.remove();
      const points=element.querySelector(':scope > .num');
      points?.classList.remove('viewer-points');
      if(self){
        const badge=document.createElement('span');badge.className='viewer-you';badge.textContent='Tú';
        element.querySelector('.standings-team-copy .name')?.append(badge);
      }
      if(!comparable||!Number.isFinite(row?.points)||!points)continue;
      // Independent signed differences; sorting, totals and tie-breaks stay unchanged.
      const difference=row.points-own.points;
      const label=difference>0?`+${difference.toLocaleString('es')}`:difference.toLocaleString('es');
      const unit=Math.abs(difference)===1?'punto':'puntos';
      const meaning=self?'Tu puntuación de referencia':difference>0
        ?`${row.name} está ${difference.toLocaleString('es')} ${unit} por delante de ti`
        :difference<0?`${row.name} está ${Math.abs(difference).toLocaleString('es')} ${unit} detrás de ti`
        :`${row.name} tiene los mismos puntos que tú`;
      const delta=document.createElement('small');
      delta.className=`viewer-difference ${difference>0?'is-ahead':difference<0?'is-behind':'is-level'}`;
      delta.textContent=label;delta.title=meaning;delta.setAttribute('aria-label',meaning);
      points.classList.add('viewer-points');points.append(delta);
    }
    const note=$('viewerStandingsNote');
    if(note){
      note.hidden=!person;
      $('viewerStandingsName').textContent=person?`Diferencia contigo · ${person.name}`:'';
      $('viewerStandingsLegend').textContent=comparable?'+ por delante · − por detrás · 0 empate':'Disponible al cargar los puntos publicados.';
    }
  }
  function init(people){
    if(initialized||!$('viewerDialog'))return;
    participants=people.filter(person=>person.active!==false&&Number.isInteger(person.id)&&typeof person.name==='string');
    if(!participants.length)return;
    initialized=true;
    choice=readChoice();
    $('viewerChoose').onclick=open;
    $('viewerForget').onclick=forget;
    $('viewerChange').onclick=open;
    $('viewerClose').onclick=close;
    $('viewerGuest').onclick=()=>saveChoice({version:1,kind:'guest'});
    $('viewerContinue').onclick=()=>{
      if(participant(pendingId))saveChoice({version:1,kind:'participant',participantId:pendingId});
    };
    $('viewerSearch').addEventListener('input',renderList);
    $('viewerList').addEventListener('change',event=>{
      if(event.target.matches('input[name="viewer-participant"]')){
        pendingId=Number(event.target.value);updatePending();
      }
    });
    $('viewerDialog').addEventListener('cancel',event=>{event.preventDefault();close();});
    $('viewerDialog').addEventListener('close',()=>{
      if(closeTimer!==null){clearTimeout(closeTimer);closeTimer=null;}
      document.body.classList.remove('viewer-dialog-open');
      if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
    });
    window.addEventListener('storage',event=>{
      if(event.key!==KEY&&event.key!==null)return;
      choice=readChoice();updateControls();renderStandings();
      window.CubanLeagueAnalytics?.identify(choice);
      if($('viewerDialog').open){pendingId=selected()?.id??null;updatePending();}
    });
    updateControls();renderStandings();
    window.CubanLeagueAnalytics?.start(participants,choice);
    if(!choice)requestAnimationFrame(()=>{
      // A choice in another tab may arrive before this frame.
      if(!choice)open();
    });
  }
  window.CubanLeagueViewer=Object.freeze({init,renderStandings});
})();
