/* The car's fastest DC charging rate, read from Brave Search's answer text ("charges at up to 250 kW").
 * Pure: runs in Node for the tests. Never invents a figure: no kW stated = null. */
(function(root){'use strict';
 // "250 kW", "250-kW", "250kW" (not kWh); a car's DC peak is between 20 and 400 kW
 var KW=/(\d{2,3}(?:\.\d)?)\s*-?\s*kw(?!h)\b/gi;
 function near(s,i,len,back,ahead){return s.slice(Math.max(0,i-back),i+len+ahead);}
 /** {kw, text} or null: the best-ranked figure (the first of those). DC / peak / maximum beside it count for it;
  *  AC / onboard / motor / horsepower / battery against it, and a charger's own rating ("on 350 kW chargers") a little. */
 function parseDcKw(text){
  var s=String(text||'').replace(/\s+/g,' '),m,best=null;KW.lastIndex=0;
  while((m=KW.exec(s))){
   var v=parseFloat(m[1]);if(!(v>=20&&v<=400))continue;
   // its own clause: "a 75 kWh battery and a peak DC rate of 250 kW" is about the 250, not the battery
   var pre=s.slice(Math.max(0,m.index-120),m.index),cut=Math.max(pre.search(/[^,;:.!?(]*$/),0),post=s.slice(m.index+m[0].length,m.index+m[0].length+60).split(/[,;.!?(]/)[0];
   pre=pre.slice(cut).split(/\b(?:and|but|while|whereas)\b/i).pop();
   var close=pre+m[0]+post,after=post;
   var rank=(/\bdc\b|fast[- ]charg|supercharg|peak|max(imum)?|up to|charging (rate|speed|power)/i.test(close)?2:0)
    -(/\bac\b|level 2|on-?board|home|wall|motor|horsepower|\bhp\b|power output|battery|pack|kwh/i.test(close)?3:0)
    -(/^\s*(dc\s+)?(fast\s+)?(chargers?|stations?|stalls?|units?)\b/i.test(after)?1:0);
   if(rank<0)continue;
   if(!best||rank>best.rank)best={kw:Math.round(v),text:near(s,m.index,m[0].length,120,60).trim(),rank:rank};
  }
  return best?{kw:best.kw,text:best.text}:null;
 }
 var api={parseDcKw:parseDcKw};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EvSpecs=api;
})(typeof window!=='undefined'?window:globalThis);
