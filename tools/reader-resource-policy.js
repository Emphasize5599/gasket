// Benchmark mirror of GasReaderResources.java. reader-resources.test.js executes
// both against the same allow/omit cases (the actual Java class is required in CI).
function omission(host,path,method,mainFrame=false,visible=false,lean=true){
  if(mainFrame||visible||host==null||path==null)return 0;
  const get=method==='GET';
  if(get&&(host==='fonts.gstatic.com'||host==='fonts.googleapis.com'||/\.(woff2?|ttf|otf|mp4|webm|mp3|ogg|wav)$/.test(path)))return 1;
  if(!lean)return 0;
  if(get&&(host==='www.google.com'&&(path.startsWith('/maps/_/wa/')&&path.includes('.mapcore.')&&path.endsWith('.wasm')||path.startsWith('/maps/vt/'))||host==='www.gstatic.com'&&path.startsWith('/maps/res/compactlegend-')))return 2;
  if((get||method==='POST')&&host==='www.google.com'&&path==='/maps/preview/log204')return 3;
  return 0;
}
module.exports=omission;
