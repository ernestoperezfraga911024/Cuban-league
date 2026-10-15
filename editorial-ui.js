/* Presentation only. No data fetching, storage, authentication or league state. */
(()=>{
  'use strict';
  const menu=document.getElementById('editorialMenu');
  const actions=document.querySelector('.topbar-actions');
  if(!menu||!actions||typeof menu.showModal!=='function')return;
  const trigger=document.createElement('button');
  trigger.type='button';
  trigger.className='editorial-menu-trigger';
  trigger.dataset.editorialMenu='';
  trigger.setAttribute('aria-label','Abrir todas las secciones');
  trigger.setAttribute('aria-haspopup','dialog');
  trigger.setAttribute('aria-controls','editorialMenu');
  trigger.textContent='☰';
  actions.append(trigger);
  const buttons=[...document.querySelectorAll('.editorial-mobile-nav [data-go]')];
  const more=document.querySelector('.editorial-mobile-nav [data-editorial-menu]');
  const sync=()=>{
    const section=document.body.dataset.section||'home';
    let direct=false;
    for(const button of buttons){
      const active=button.dataset.go===section;
      button.classList.toggle('active',active);
      if(active){button.setAttribute('aria-current','page');direct=true;}
      else button.removeAttribute('aria-current');
    }
    more?.classList.toggle('active',!direct);
    if(more){
      if(!direct)more.setAttribute('aria-current','page');
      else more.removeAttribute('aria-current');
    }
  };
  let opener=null;
  document.addEventListener('click',event=>{
    const open=event.target.closest('[data-editorial-menu]');
    if(open){opener=open;if(!menu.open)menu.showModal();return;}
    if(event.target.closest('[data-editorial-close]') || (menu.open&&event.target.closest('#editorialMenu [data-go]'))){
      menu.close();
    }
    // Background click, not a click on the padded menu surface.
    if(event.target===menu){
      const r=menu.getBoundingClientRect();
      if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)menu.close();
    }
  });
  menu.addEventListener('close',()=>{opener?.focus({preventScroll:true});});
  new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['data-section']});
  sync();
  document.body.classList.add('editorial-ui-ready');
})();
