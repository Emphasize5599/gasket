const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{const p=await b.newPage();p.setDefaultTimeout(5000);
 await p.addInitScript(()=>{
  const key='persistent-native-settings',s=localStorage.getItem(key);if(s)sessionStorage.setItem('standinRestored',JSON.stringify({s}));
  addEventListener('DOMContentLoaded',()=>{const N=__app.N,save=N.saveSettings;N.saveSettings=function(s){localStorage.setItem(key,s);save(s);
   // An already queued completion tries to save the old state during teardown.
   if(s===''||s==='{"debug":true,"logLevel":5}')queueMicrotask(()=>__app.save());
  };});
 });
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);
 await p.evaluate(()=>{__app.S.debug=false;__app.S.logLevel=2;__app.save();});await require('./settings-ui')(p,'data');await p.click('#eraseAll');await p.click('#cfmYes');
 await p.waitForSelector('#onboarding');await require('./onboarding-ui')(p);assert.deepEqual(await p.evaluate(()=>[__app.S.debug,__app.S.logLevel,FLog.level()]),[true,5,5]);
 await require('./settings-ui')(p,'help');assert(await p.isChecked('[data-k="debug"]'));assert.equal(await p.inputValue('#logLevel'),'5');
 await p.reload();await p.waitForFunction(()=>window.__app);assert.deepEqual(await p.evaluate(()=>[__app.S.debug,__app.S.logLevel,FLog.level()]),[true,5,5]);console.log('Persistent native-style settings: erase beats late old-state saves; detailed logging and Settings switch stay enabled after restart.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
