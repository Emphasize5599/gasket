// Navigate the real UI; never unhide controls or bypass settings validation.
module.exports=async function(p,group){
 const first=await p.locator('#onboarding').count();if(first)await require('./onboarding-ui')(p);
 if(!await p.locator('#settings:not(.hidden)').count())await p.click('#btnSettings');
 if(await p.locator('#settingsBack:visible').count())await p.click('#settingsBack');
 if(first&&group==='connections'){await p.click('[data-settings-group="map"]');await p.uncheck('[data-k="keylessRegular"]');await p.click('#settingsBack');}
 await p.click('[data-settings-group="'+group+'"]');
};
