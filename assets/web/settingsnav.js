/* Keep live settings controls in the DOM: submenu navigation never discards a draft. */
(function(root){'use strict';
 var groups=[['downloads','Data downloads','Chargers, campgrounds and AI model'],['map','Map & stations','Display, discovery and refresh'],['rest','Rest stops','Sources and source-specific filters'],['trip','Trip defaults','Routes, speed limits and energy prices'],['savings','Savings','Memberships and rewards'],['ai','Local AI','AI model settings and processor'],['connections','Connections & usage','Optional keys and API budgets'],['data','Your data','Backups, exports and deletion'],['help','Help & troubleshooting','Setup guide, logs and app information']];
 var current='',page=null;
 function attach(A,pg){
  page=pg;current='';var body=pg.querySelector('.settings-body'),bar=pg.querySelector('.settings-bar'),views={};
  var home=document.createElement('div');home.className='settings-home';home.innerHTML=groups.map(function(g){return '<button type="button" class="settings-link" data-settings-group="'+g[0]+'"><span><b>'+A.esc(g[1])+'</b><small>'+A.esc(g[2])+'</small></span><span aria-hidden="true">›</span></button>';}).join('');
  groups.forEach(function(g){var e=document.createElement('div');e.className='settings-group hidden';e.dataset.settingsView=g[0];views[g[0]]=e;});
  var buckets={'Station discovery':'map','Website readers':'map','Traffic readers':'map','Website workers':'map','Official price sources':'map','Prices':'map','Search':'map','Trip planner':'trip','EV & hydrogen':'trip','Discounts':'savings','Station lists':'savings','Bad CITGO stations':'savings','Google API key · recommended':'connections','Routes API — separate budget':'connections','Local AI explanations · optional':'ai','General':'data','Your data':'data','Debugging':'help','About':'help'};
  buckets['Visual diagnostics']='help';
  Array.from(body.children).forEach(function(e){if(e.id==='sDone')return;var title=e.querySelector('h3'),key=e.id==='gemmaSettings'?'ai':buckets[title&&title.textContent.trim()]||'help';views[key].appendChild(e);});
  function section(tag,title,destination){var el=document.createElement(tag);el.className='card';var head=document.createElement(tag==='details'?'summary':'h3');head.textContent=title;el.appendChild(head);destination.appendChild(el);return el;}
  function move(id,destination,selector){var el=Object.values(views).map(function(v){return v.querySelector('#'+id);}).find(Boolean);if(el)destination.appendChild(selector?el.closest(selector):el);}
  var trip=views.trip.querySelector('.card'),connections=views.connections,ev=views.trip.querySelector('#chargerSettings');
  var google=section('details','Google Maps API key',connections);
  Array.from(connections.children).slice(0,-1).forEach(function(card){if(card.querySelector('#apiKey,#routesMonthlyCap'))google.appendChild(card);});
  var general=section('div','Traffic providers',connections);connections.prepend(general);move('googleTraffic',general,'.field');
  var here=section('details','HERE routing key',connections);['hereKey','hereTraffic','hereMonthlyCap'].forEach(function(id){move(id,here,'.field');});
  var fuel=section('details','Fuel API vehicle images key',connections);move('fuelKey',fuel,'.field');
  var model=views.ai.querySelector('#gemmaSettings');
  if(model){
   var modelDownload=section('div','Gemma AI model',views.downloads),state=model.querySelector('#gemmaState');
   modelDownload.append(state,state.nextElementSibling,model.querySelector('.gemma-controls'));
  }
  var campground=section('div','Recreation.gov campgrounds',views.downloads);move('ridbSettings',campground);
  if(ev){
   var chargers=section('div','DOE charger inventory',views.downloads);
   move('evDownload',chargers,'.btns');
   var note=document.createElement('p');note.className='lead small keep';note.textContent='Uses the DOE key from Connections & usage. A personal key can help with large downloads.';chargers.append(note);move('evInventoryStatus',chargers);
   var evTile=section('details','EV data sources and keys',connections);evTile.appendChild(ev);
   var doe=section('details','DOE station-finder key',ev),ocm=section('details','Open Charge Map key',ev);
   ['nrelKey','ocmKey'].forEach(function(id){
    var input=ev.querySelector('#'+id),control=input.closest('.key-secret')||input,tile=id==='nrelKey'?doe:ocm;
    tile.append(control.previousElementSibling,control,control.nextElementSibling);
   });
   move('evUseDOE',doe,'label');move('evQuotaStatus',doe);move('evUseOCM',ocm,'label');
   ev.prepend(doe,ocm);
   var guestToggle=ev.querySelector('#evGuestApps'),guestLabel=guestToggle&&guestToggle.closest('label');
   if(guestLabel){
    var description=guestLabel.nextElementSibling,config=description.nextElementSibling;
    var advanced=section('details','Advanced guest price sources',ev);
    advanced.append(guestLabel,description,config);move('evGuestStatus',advanced);
   }
  }
  Array.from(views.trip.children).filter(function(card){return card!==trip&&!card.querySelector('input,button,select');}).forEach(function(card){card.remove();});
  views.rest.innerHTML=root.RestSettings?RestSettings.html(A):'';if(root.RestSettings)RestSettings.bind(A,views.rest);
  var t=A.S.trip||{},defaults=document.createElement('div');defaults.className='card';defaults.innerHTML='<h3>Planning defaults</h3><div class="grid2">'+[['prefBuffer','Buffer (miles)',t.bufferMi,1],['prefMinSave','Minimum savings ($)',t.minSave,.01],['prefDetour','Max. extra time (min)',t.maxDetourMin,.5],['prefAltSave','Worth switching for ($)',t.altMinSave,.01]].map(function(x){return '<label class="nf"><span>'+x[1]+'</span><input type="number" inputmode="decimal" min="0" step="'+x[3]+'" id="'+x[0]+'" value="'+A.esc(x[2]==null?'':x[2])+'"></label>';}).join('')+'</div>';views.trip.prepend(defaults);
  ['earlyDepartOn','earlyDepartMin','earlyDepartAutoRaise','trafficEnergy','limitLookup'].forEach(function(id){var field=trip&&trip.querySelector('#'+id+',[data-k="'+id+'"]');if(field)defaults.appendChild(field.closest('.field'));});
  var prices=section('div','Trip prices and discovery',views.trip);
  ['xomCheck','priceRefreshMode','alwaysRefresh'].forEach(function(id){var field=views.trip.querySelector('#'+id+',[data-k="'+id+'"]');if(field)prices.appendChild(field.closest('.field'));});
  var history=section('div','Saved trips',views.data);move('histClear',history,'.field');
  var behavior=trip&&trip.querySelector('h3');if(behavior)behavior.textContent='Route display';
  var mapSettings=views.map.querySelector('h3');if(mapSettings){var refresh=views.trip.querySelector('[data-k="autoRefresh"]');if(refresh)views.map.querySelector('.card').appendChild(refresh.closest('.field'));}
  var hazard=document.createElement('details'),rules=TimeWindows.approvalRules(A.S.hourlyHazardApproval);hazard.className='disclosure-tile';hazard.id='hazardPrefs';hazard.innerHTML='<summary>Automatic hazard approval</summary>'+HazardApproval.html(rules,RouteWx.KINDS,A.esc,'pref');hazard.onchange=function(){A.S.hourlyHazardApproval=HazardApproval.read(hazard,'pref');A.save();};views.trip.appendChild(hazard);
  var timeFormat=document.createElement('label');timeFormat.className='nf chk';timeFormat.innerHTML='<span>Use 24-hour time</span><input type="checkbox" id="prefClock24"'+(A.S.clock24?' checked':'')+'>';timeFormat.onchange=function(){A.S.clock24=timeFormat.querySelector('input').checked;A.save();};views.trip.prepend(timeFormat);
  var tour=document.createElement('button');tour.type='button';tour.className='btn tonal';tour.id='settingsTour';tour.textContent='Show setup walkthrough';tour.onclick=function(){A.$('sDone').click();if(root.Onboarding)Onboarding.start(true);};views.help.prepend(tour);
  // Hide long descriptions, not values, counters, warnings or controls.
  pg.querySelectorAll('.lbl > small:not(.keep):not([id])').forEach(function(s){var d=document.createElement('details');d.className='settings-help';d.innerHTML='<summary>Details</summary>';s.replaceWith(d);d.appendChild(s);});
  var done=A.$('sDone'),footer=document.createElement('footer');footer.className='settings-footer';footer.appendChild(done);pg.appendChild(footer);
  if(root.UIKit){Object.keys(views).forEach(function(k){UIKit.enhance(views[k]);});}
  body.appendChild(home);groups.forEach(function(g){body.appendChild(views[g[0]]);});
  bar.innerHTML='<button type="button" class="sub-back hidden" id="settingsBack" aria-label="Back to Settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg></button><h2 id="settingsTitle">Settings</h2>';
  function show(key){current=key||'';home.classList.toggle('hidden',!!current);groups.forEach(function(g){views[g[0]].classList.toggle('hidden',g[0]!==current);});A.$('settingsBack').classList.toggle('hidden',!current);A.$('settingsTitle').textContent=current?groups.filter(function(g){return g[0]===current;})[0][1]:'Settings';body.scrollTop=0;}
  home.querySelectorAll('button').forEach(function(b){b.onclick=function(){show(b.dataset.settingsGroup);};});A.$('settingsBack').onclick=function(){show('');};pg._settingsHome=function(){show('');};
 }
 root.SettingsNav={attach:attach,back:function(){if(!page||page.classList.contains('hidden')||!current)return false;page._settingsHome();return true;}};
})(window);
