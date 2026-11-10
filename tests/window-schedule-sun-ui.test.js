// The visual itinerary marks dawn begins / sunrise ends / sunset begins / dusk ends, timed where the trip is.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});
 try{
  for(const width of [320,448]){
   const page=await browser.newPage({viewport:{width,height:760},timezoneId:'UTC'});
   await page.route(/^https?:\/\//,route=>route.abort());
   await page.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);
   const out=await page.evaluate(()=>{
    const host=document.createElement('main');host.style.cssText='position:fixed;inset:0;overflow:auto;z-index:10000;background:white';document.body.append(host);
    const H=3600000,day=Date.parse('2030-06-12T05:00Z');   // midnight in Chicago
    // State capitols: Little Rock to Nashville. The leg starts the second day at 8:00.
    const from={lat:34.7466,lng:-92.289},to={lat:36.1659,lng:-86.7844};
    const windows=[{ds:day+28*H,de:day+34*H,as:day+40*H,ae:day+44*H}];
    WindowSchedule.bind(host,{zone:'America/Chicago',now:day,clock24:true,starts:[day+32*H],esc:__app.esc,read:i=>({...windows[i]}),
     write:(i,id,t)=>{windows[i][id]=t;return true;},rules:()=>[],skippedNights:()=>[],skippedWaits:()=>[],
     setNight(){},setWait(){},onIssues(){},legs:[{zone:'America/Chicago',point:from,endPoint:to,estimate:()=>[{kind:'drive',minutes:360}]}]});
    const marks=[...host.querySelectorAll('[data-ws-sun]')].map(e=>({kind:e.dataset.wsSun,label:e.getAttribute('aria-label'),events:getComputedStyle(e).pointerEvents}));
    // Before the leg leaves (8:00) the trip is at its start; after it arrives, at its end.
    const morning=SunCalc.getTimes(new Date(day+36*H),from.lat,from.lng),evening=SunCalc.getTimes(new Date(day+36*H),to.lat,to.lng),
          first={dawn:morning.dawn,sunriseEnd:morning.sunriseEnd,sunsetStart:evening.sunsetStart,dusk:evening.dusk};
    const fmt=t=>new Intl.DateTimeFormat([],{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',hour12:false}).format(t);
    return {marks,expected:['dawn','sunriseEnd','sunsetStart','dusk'].map(k=>fmt(first[k])),legend:document.querySelectorAll('.ws-legend').length,
     wide:document.documentElement.scrollWidth>innerWidth};
   });
   const kinds=new Set(out.marks.map(m=>m.kind));
   for(const k of ['dawn','sunriseEnd','sunsetStart','dusk'])assert(kinds.has(k),k+' is marked at '+width+'px');
   out.expected.forEach((time,i)=>assert(out.marks.some(m=>m.label.endsWith(time)),'event '+i+' at '+time+' (start point in the morning, end point in the evening)'));
   assert(out.marks.every(m=>m.events==='none'),'sun icons never block a handle');
   assert(!out.wide,'no sideways scroll at '+width+'px');
   await page.close();
  }
  console.log('Visual itinerary: dawn, sunrise end, sunset start and dusk marked where the trip is, at 320/448 px');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
