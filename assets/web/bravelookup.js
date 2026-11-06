/* Read normally first. Human checks are completed by the user in the same
 * cookie-sharing WebView, never bypassed or replaced with manual research. */
(function(root){'use strict';
 var A=root.__app,LG=root.FLog||{info:function(){},warn:function(){}};
 var active=null;
 function progress(label,kind){
  return A.ldBar(label)+(A.N.siteWatchBrave?'<button type="button" class="btn tonal sm" data-brave-watch="'+kind+'">Watch Brave lookup</button>':'');
 }
 document.addEventListener('click',function(e){
  var button=e.target.closest('[data-brave-watch]');if(!button)return;
  if(active&&active.kind===button.dataset.braveWatch&&active.current())A.N.siteWatchBrave(active.url);
  else A.toast('This Brave lookup is queued or has just finished.');
 });
 async function read(args,options){
  var o=options||{},call=o.call||root.__trip.call,valid=o.valid||function(r){return !!(r&&r.text&&!r.error&&!r.blocked);},current=o.current||function(){return !root.__erasing;};
  async function ask(shown){
   if(!current())return {closed:true};
   var lookup={url:args.url,kind:args.kind||'tank',current:current};
   if(!shown)active=lookup;
   try{return await call(shown?'siteShow':'siteRead','brave',JSON.stringify(Object.assign({},args,{bg:!shown,aiOnly:true})));}
   catch(e){return {error:String(e&&e.message||e),code:'bridge'};}
   finally{if(active===lookup)active=null;}
  }
  var r=await ask(!!o.shown);
  if(valid(r))LG.info('car','Brave answer',{kind:args.kind||'tank',page:/\/ask\?/.test(args.url)?'ask':'search',src:r.src});
  if(valid(r)||!current()||o.shown||r&&(r.closed||r.cancelled||r.code==='cancelled'||r.code==='bridge'))return r;
  if(!root.Native||!A.N.siteShow||r&&r.error==='No Native bridge')return r; // browser-only preview has no interactive website surface
  // Background completion must not replace an active erase/discard/download
  // confirmation (confirmDel otherwise removes its DOM and strands its promise).
  while(document.getElementById('cfm')){if(!current())return Object.assign({},r,{closed:true});await new Promise(function(ok){setTimeout(ok,100);});}
  if(!current())return Object.assign({},r,{closed:true});
  LG.warn('car','Brave lookup needs user verification',{kind:args.kind||'tank',blocked:!!(r&&r.blocked),error:r&&r.error||'unusable answer'});
  var yes=await A.confirmDel({always:true,title:r&&r.blocked?'Confirm you’re not a bot':'Brave lookup needs attention',body:'Brave did not return a usable '+(o.label||'vehicle')+' answer. It may be asking for a bot check. Open Brave and complete any check; Gasket will read the answer and return automatically. You do not need to search or copy anything.',action:'Open verification',no:'Not now',goClass:'primary'});
  if(!yes||!current())return Object.assign({},r,{closed:true});
  r=await ask(true);LG.info('car','Brave verification finished',{kind:args.kind||'tank',usable:valid(r),closed:!!(r&&r.closed)});
  if(current()&&!valid(r)&&!(r&&r.closed))A.toast('Brave still has no usable answer. You can retry the lookup.');
  return r;
 }
 root.BraveLookup={read:read,progress:progress};
})(window);
