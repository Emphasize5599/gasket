async function(reqId,args){
 const start=Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms));let last='',stable=0;
 const send=r=>GasketSite.result(reqId,JSON.stringify(r));
 while(Date.now()-start<18000){
  const body=document.body&&document.body.innerText||'',href=location.href;
  if(/\/sorry\/|consent\.google/.test(href)||/unusual traffic|not a robot|verify (?:that )?you are human|before you continue to Google|access denied/i.test(body)){send({blocked:true,verificationUrl:/^https:\/\/(www|consent)\.google\.com\//.test(href)?href:null});return;}
  const places=RestMaps.extract(document,href),match=RestMaps.choose(args.site,places);
  if(match){send({places:[match],complete:true});return;}
  const signature=JSON.stringify(places.map(p=>[p.url,p.name]));stable=signature===last?stable+1:0;last=signature;
  if(/no results found|couldn.t find|can.t find/.test(body.toLowerCase())||places.length&&stable>=4){send({places,complete:true});return;}
  await sleep(500);
 }
 send({error:'Maps lookup did not finish',code:'timeout'});
}
