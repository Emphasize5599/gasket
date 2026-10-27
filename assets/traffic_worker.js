// Same-origin verification fallback. Session state remains inside Google's page;
// the application receives route data only, never cookies or credentials.
async function(reqId,args){
 const send=o=>GasketSite.result(reqId,JSON.stringify(o));
 try{
  if(location.origin!=='https://www.google.com'||!args.pb||args.pb.length>5000||!/^[A-Za-z0-9!.,_%-]+$/.test(args.pb))throw Error('Invalid traffic page or request');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  try{
   const r=await fetch('/maps/preview/directions?hl=en&gl=us&pb='+encodeURIComponent(args.pb),{signal:controller.signal});
   const reader=r.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
   for(;;){const x=await reader.read();if(x.done)break;bytes+=x.value.byteLength;if(bytes>6000000){await reader.cancel();throw Error('Traffic answer too large');}text+=decoder.decode(x.value,{stream:true});}text+=decoder.decode();
   if(r.status===403||r.status===429||/\/sorry\//.test(r.url)||/unusual traffic|g-recaptcha/i.test(text.slice(0,16000)))return send({blocked:true,verificationUrl:r.url});
   if(!r.ok)throw Error('Google traffic HTTP '+r.status);
   if(!text.startsWith(")]}'")&&!text.startsWith('['))throw Error('Google did not return forecast data');
   send({body:text});
  }finally{clearTimeout(timer);}
 }catch(e){send({error:e.name==='AbortError'?'Traffic page timed out':String(e.message||e)});}
}
