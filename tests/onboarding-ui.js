// Fixture setup: activate every real Next handler. Pointer/layout coverage lives in ui-flow.
module.exports=async function(p){
 if(!await p.locator('#onboarding').count())return p.click('#sDone');
 await p.evaluate(()=>{for(let i=0;i<7&&document.getElementById('onboarding');i++){const button=document.getElementById('obExplore')||document.getElementById('obNext');if(!button||button.disabled)throw new Error('Missing onboarding action');button.click();}if(document.getElementById('onboarding'))throw new Error('Onboarding did not finish');});
};
