/* Shared menu presentation. Move live controls; never reconstruct their values or handlers. */
(function(root){'use strict';
 var serial=0,disclosures=new Map();
 // Behavior preferences use switches. Memberships, vehicle facts, filters and acknowledgements stay checkboxes.
 var toggles='#prefClock24,[data-clock24],#tTraffic,#obRound,#obHide,#obGuestApps,#gPrecondition,[data-rest-unsightly],[data-night-enabled],[data-rs][data-option="enabled"]';
 function animation(label){return '<div class="ux-animation-slot" role="img" aria-label="'+String(label).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];})+'"></div>';}
 function name(input,host){if(input.hasAttribute('aria-label')||input.hasAttribute('aria-labelledby'))return;var text=host&&host.querySelector(':scope > .lbl,:scope > span:not(.switch)');if(text){if(!text.id)text.id='ux-label-'+(++serial);input.setAttribute('aria-labelledby',text.id);}}
 function enhance(scope){if(!scope||!scope.querySelectorAll)return;
  scope.querySelectorAll('.card').forEach(function(card){var h=card.querySelector(':scope > h3');if(!h)return;var kind={'Website workers':'station','Traffic readers':'traffic','Rest-stop readers':'rest'}[h.textContent.trim()];if(!kind)return;var key=(card.closest('#onboarding')?'setup':'settings')+':'+kind,d=document.createElement('details');d.className='ux-performance';d.dataset.uxPerformance=kind;d.open=disclosures.get(key)===true;d.addEventListener('toggle',function(){if(d.isConnected)disclosures.set(key,d.open);});var summary=document.createElement('summary');summary.textContent=h.textContent;h.remove();d.appendChild(summary);while(card.firstChild)d.appendChild(card.firstChild);card.appendChild(d);});
  scope.querySelectorAll('input[type="checkbox"]').forEach(function(input){var existing=input.closest('.switch'),host=existing&&existing.parentElement||input.closest('label,.field');if(!host)return;
   if(existing&&input.matches('[data-k="walmartPlus"]')){name(input,host);input.removeAttribute('role');var choice=document.createElement('label');choice.className='ux-check-control';existing.replaceWith(choice);choice.appendChild(input);host.classList.add('ux-check');return;}
   if(existing){input.setAttribute('role','switch');name(input,host);return;}
   if(input.matches(toggles)){
    host.classList.add('ux-toggle');name(input,host);input.setAttribute('role','switch');var wrap=document.createElement('span');wrap.className='switch';input.replaceWith(wrap);wrap.appendChild(input);wrap.appendChild(document.createElement('span'));
   }else if(host.matches('label')&&!host.classList.contains('ux-toggle')){host.classList.add('ux-check');name(input,host);}
  });
  // Static technical explanations are secondary; counters, errors, values and live status stay visible.
  scope.querySelectorAll('.worker-settings p.lead.small.keep:not([id]),[data-rest-provider] > p.lead.small.keep:not([id]),p.ux-secondary').forEach(function(p){if(p.textContent.length<100||p.closest('.ux-explanation')||p.parentElement.matches('[data-rest-provider]')&&!p.parentElement.querySelector('[data-rs]'))return;var d=document.createElement('details');d.className='ux-explanation';var s=document.createElement('summary');s.textContent='Details';p.replaceWith(d);d.appendChild(s);d.appendChild(p);});
 }
 root.UIKit={enhance:enhance,animation:animation};
})(window);
