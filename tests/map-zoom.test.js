const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await b.newPage({viewport:{width:360,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route(/^https?:\/\//,r=>r.abort());
 await p.addInitScript(()=>sessionStorage.setItem('standinRestored',JSON.stringify({s:JSON.stringify({setupDone:true,autoRefresh:false}),c:JSON.stringify({g:[],o:{}})})));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href+'#restored');
 await p.waitForSelector('#btnLocate.live');
 const result=await p.evaluate(async()=>{
  const map=__app.map,wait=ms=>new Promise(r=>setTimeout(r,ms));map.setView([35,-119],13,{animate:false});
  const canvas=L.canvas();
  const dots=['gas','ev','h2','chosen'].map((k,i)=>L.circleMarker([35+i*.1,-119],{renderer:i===1||i===2?canvas:undefined,radius:k==='chosen'?5:6,weight:2,color:'#fff',fillColor:k==='h2'?'#0e7fc0':'#18a957'}).addTo(map));
  const pts=[[35,-119],[36,-120]],route=L.polyline(pts,{weight:5}).addTo(map),road=L.polyline(pts,{weight:8}).addTo(map),halo=L.polyline(pts,{weight:13}).addTo(map),hit=L.polyline(pts,{weight:22,opacity:.001}).addTo(map),coverage=L.circle([35,-119],{radius:1000}).addTo(map);
  const snap=()=>({r:dots.map(d=>d.getRadius()),border:dots[0].options.weight,line:route.options.weight,road:road.options.weight,halo:halo.options.weight,hit:hit.options.weight,coverage:coverage.getRadius()});
  const near=snap();map.setZoom(7,{animate:false});await wait(40);const far=snap();
  // Removed/re-added paths must retain their original widths, not shrink twice or lose registration.
  map.removeLayer(route);route.addTo(map);map.setZoom(13,{animate:false});await wait(40);const restored=snap();
  MapVisuals.style(route,{weight:6});map.setZoom(8,{animate:false});await wait(40);const selected=route.options.weight;
  map.setZoom(13,{animate:false});await wait(40);
  const samples=[];map.on('zoom',()=>requestAnimationFrame(()=>{const d=dots[2],renderer=d._renderer,rect=renderer._container.getBoundingClientRect(),mr=map.getContainer().getBoundingClientRect(),scale=map.getZoomScale(map.getZoom(),renderer._zoom),screen=map.latLngToContainerPoint(d.getLatLng()),drawn=rect.top-mr.top+(d._point.y-renderer._bounds.min.y)*scale;samples.push({z:map.getZoom(),r:d.getRadius()*scale,error:Math.abs(drawn-screen.y)});}));map.flyTo([35,-119],5,{duration:.55});await wait(850);
  return {near,far,restored,selected,expected:6*MapVisuals.scale(8),samples};
 });
 for(let i=0;i<4;i++)assert(result.far.r[i]<result.near.r[i],'every station kind shrinks zoomed out');
 for(const k of ['line','road','halo','border'])assert(result.far[k]<result.near[k],k+' scales');
 assert.equal(result.far.hit,22,'invisible route tap targets remain usable');assert.equal(result.far.coverage,1000,'real-world radii unchanged');
 assert(Math.abs(result.restored.line-result.near.line)<1e-8,'re-add preserves original geometry sizing');assert(Math.abs(result.selected-result.expected)<1e-8,'selection styles remain zoom-aware');
 assert(result.samples.some(s=>s.z>5.2&&s.z<7.8&&s.r>result.samples.at(-1).r),'automatic zoom resizes before zoomend: '+JSON.stringify(result.samples));
 assert(Math.max(...result.samples.map(s=>s.error))<4,'dots stay anchored during animated zoom; worst error '+Math.max(...result.samples.map(s=>s.error)));
 // Reproduce the screenshot: main-map H2 dots/coverage must not overlay a trip.
 await p.evaluate(async()=>{__app.S.fuelMode='h2';__app.KV.put('afdc','hy-all',[{id:901,fuel_type_code:'HY',station_name:'Synthetic H2',latitude:35,longitude:-119,hy_pressures:['700'],status_code:'E',access_code:'public'}]);await AltFuel.refresh();});
 await p.waitForFunction(()=>AltFuel.h2().length===1&&__app.map.hasLayer(AltFuel.coverage()));
 const afCount=()=>p.evaluate(()=>{let n=0;__app.map.eachLayer(l=>{if(l instanceof L.CircleMarker&&l.options.renderer&&l.options.renderer.options.pane==='afdots')n++;});return n;});
 assert.equal(await afCount(),1);await p.evaluate(()=>document.body.classList.add('trip-on'));
 await p.waitForFunction(()=>!__app.map.hasLayer(AltFuel.coverage()));assert.equal(await afCount(),0);assert.equal(await p.locator('#afLegend').count(),0);
 await p.evaluate(()=>AltFuel.modeChanged());assert.equal(await afCount(),0,'background redraw cannot reintroduce main-map dots');
 await p.evaluate(()=>document.body.classList.remove('trip-on'));await p.waitForFunction(()=>__app.map.hasLayer(AltFuel.coverage()));assert.equal(await afCount(),1,'main-map stations return when closing trip');
 assert.equal(errors.length,0,errors.join('\n'));console.log('All-fuel dot/route sizing, animated zoom, fixed hit targets, selection and main-map H2 layer isolation passed');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
