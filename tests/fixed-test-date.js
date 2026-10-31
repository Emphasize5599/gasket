// Keep relative-time fixtures away from the host's upcoming DST change. Timers still run normally;
// explicit gap/fold tests keep their own dates and must still choose an occurrence.
module.exports=async function(page){
  await page.addInitScript(epoch=>{
    const RealDate=Date,started=RealDate.now(),now=()=>epoch+RealDate.now()-started;
    window.Date=new Proxy(RealDate,{
      construct(target,args,newTarget){return Reflect.construct(target,args.length?args:[now()],newTarget);},
      apply(){return new RealDate(now()).toString();},
      get(target,key,receiver){return key==='now'?now:Reflect.get(target,key,receiver);}
    });
  },Date.UTC(2026,9,24,12));
};
