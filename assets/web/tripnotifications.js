(function(root){'use strict';var A=root.__app,lastChecks={},pendingSite=null;
 function send(action,data){if(!A.N.tripQueue)return Promise.resolve({unavailable:true});return root.__trip.call('tripQueue',action,JSON.stringify(data||{}));}
 root.TripNotify={send:send,pendingSite:function(){return pendingSite;}};
 root.addEventListener('sitecheckneeded',function(e){var d=e.detail||{},now=Date.now();pendingSite=d.key;if(now-(lastChecks[d.key]||0)<60000)return;lastChecks[d.key]=now;
  send('check',{title:'Website check needed',text:(d.label||'A station website')+' needs you to confirm you are human. The scan is paused; progress is kept.',site:d.key}).catch(function(){});
 });
})(window);
