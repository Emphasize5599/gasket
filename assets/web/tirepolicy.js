/* One versioned policy: the checked findings (computed here, from TireMath) are what the model explains; it adds no facts. */
(function(root){
  'use strict';
  var RULES={version:3,units:'tread in 32nds of an inch',
    branches:[
      'Estimated depth comes from miles, warranty and rotation, not a gauge; it never proves a tire is fine.',
      'Tread: 6/32 or more is good; under 4/32 wet and snow grip fade (plan new tires); under 4/32 replace soon; 2/32 or less is worn out.',
      'Age (from the DOT date code): from 5 years a yearly inspection; at 6 to 10 years some vehicle and tire makers say to replace whatever the tread; 10 years or more is past what makers allow.',
      'A better pair belongs on the rear of a two-wheel-drive car. All-wheel drive needs closely matched tread on all four.',
      'Tires that differ in size, type, brand or model need a fitment check before moving or replacing any.',
      'Duals and trailers are checked on their own; trailer tires never swap with the car.'
    ]};
  function text(v){return v==null||v===''?null:String(v);}
  function number(v){return v==null||v===''||!Number.isFinite(+v)?null:+v;}
  var ROT_WORD={yes:'yes',sometimes:'sometimes',no:'never',unsure:'not sure'};
  /** The setup the findings are about, from the car's saved tires (no lookups). now: for tests. */
  function snapshot(car,math,now){
    var t=JSON.parse(JSON.stringify(car.tires||{})), drive=(car.info||{}).drive||'unknown', C=t.corners||{};
    var tires=math.positions(t).map(function(p){
      var unit=p.unit||{}, split=p.trailer?!!unit.split:!!C.split, e=split?C[p.k]||{}:{}, tread=p.trailer?{}:t.tread||{};
      var own=!!(e.type||e.model);
      var measured=split?!p.trailer&&C.mode==='depth':tread.mode==='measure';
      var depth=math.depthAt(t,p,drive);
      if(measured){var entered=split?e.depth:tread.depth;if(entered!==''&&entered!=null&&Number.isFinite(+entered)&&+entered>=0)depth=+entered;}
      var size=p.trailer?unit.size:(t.multiSize&&/^(lr|rr|lri|rri)$/.test(p.k)?t.sizeRear:unit.size);
      var type=text(e.type||unit.type), miles=number(split?e.miles:tread.miles), rotated=text(split?e.rotated:tread.rotated);
      var warranty=math.warrantyOf(e,unit)||(!split&&!p.trailer?+t.warrantyMi||0:0)||null;
      var dot=text(split?e.dot:p.trailer?unit.dot:tread.dot), age=math.dotOk(dot,now)?math.ageYears(dot,now):null;
      var nd=+(e.newDepth||unit.newDepth)||math.newDepth(type), life=math.lifeMiles({type:type,warrantyMi:warranty,utqg:e.utqg||unit.utqg});
      // tread lost per mile at this tire's rate (the same straight line the estimate uses), for "miles left"
      var rate=measured||miles==null?null:(nd-2)/(life*(math.ROT[rotated]||math.ROT.unsure));
      return {id:p.k,position:text(p.name),unit:p.trailer?'trailer':'car',trailer:p.trailer?text(unit.name||'Trailer'):null,axle:text(p.group),
        type:type,brand:text(own?e.brand:unit.brand),model:text(own?e.model:unit.model),size:text(e.size||size),
        depth:Number.isFinite(depth)?depth:null,measured:measured,newDepth:nd,miles:miles,rotated:rotated,warrantyMi:warranty,rate:rate,
        made:age==null?null:dot,ageYears:age};
    });
    var sp=t.spare||{}, kind=text(sp.kind), spDot=null, assumed=false;
    if(kind==='full'||kind==='compact'){spDot=math.dotOk(sp.dot,now)?sp.dot:null;if(!spDot){spDot=math.spareDot(car.year)||null;assumed=!!spDot;}}
    return {drive:drive,dually:!!C.dually,year:number(car.year),tires:tires,
      spare:{kind:kind,location:text(sp.location),made:spDot,madeAssumed:assumed,ageYears:spDot?math.ageYears(spDot,now):null}};
  }
  var COND={good:'Plenty of tread left.',ok:'Plan new tires: wet and snow grip fade below 4/32 in.',low:'Replace soon: below 4/32 in, wet stopping distances grow quickly.',worn:'Worn to 2/32 in or less (the legal minimum in most states): replace before driving.'};
  function k1000(n){return Math.max(0,Math.round(n/1000)*1000).toLocaleString('en-US');}
  /** Plain names for a group of tires: "All four tires", "Front tires", "Rear inner tires", "Cargo trailer, axle 1" … */
  function who(group,all,dually){
    var ids=group.map(function(t){return t.id;}),n=group.length,unit=group[0];
    if(unit.unit==='trailer'){
      if(n===all.length)return unit.trailer+(n>1?': all '+n+' tires':'');
      var axles=[];all.forEach(function(t){var a=/:a(\d+)/.exec(t.id);a=a&&+a[1];if(a&&axles.indexOf(a)<0)axles.push(a);});
      var whole=axles.filter(function(a){var on=all.filter(function(t){return new RegExp(':a'+a+'[a-z]+$').test(t.id);});return on.length&&on.every(function(t){return ids.indexOf(t.id)>=0;});});
      var covered=all.filter(function(t){return whole.some(function(a){return new RegExp(':a'+a+'[a-z]+$').test(t.id);});}).length;
      if(whole.length&&covered===n)return unit.trailer+', axle'+(whole.length>1?'s '+whole.slice(0,-1).join(', ')+' and '+whole[whole.length-1]:' '+whole[0]);
      return group.map(function(t){return t.position;}).join('; ');
    }
    var word={2:'two',4:'four',6:'six'}[n]||String(n);
    if(n===all.length&&n>1)return 'All '+word+' tires';
    if(n===all.length-1&&n>1){var out=all.filter(function(t){return ids.indexOf(t.id)<0;})[0];return 'All tires but the '+out.position.charAt(0).toLowerCase()+out.position.slice(1);}
    var has=function(k){return ids.indexOf(k)>=0;};
    if(n===2&&has('lf')&&has('rf'))return 'Front tires';
    if(n===2&&has('lr')&&has('rr'))return dually?'Rear outer tires':'Rear tires';
    if(n===2&&has('lri')&&has('rri'))return 'Rear inner tires';
    if(n===4&&has('lr')&&has('rr')&&has('lri')&&has('rri'))return 'Rear tires';
    return group.map(function(t){return t.position;}).join('; ');
  }
  function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);}
  function evaluate(setup,math){
    var facts=[];
    function add(id,title,level,message,positions,kind){facts.push({id:id,title:title,level:level,text:message,positions:positions||[],kind:kind||'info'});}
    var units=[], byUnit={};
    setup.tires.forEach(function(t){var u=t.unit==='car'?'car':'tr:'+t.trailer;if(!byUnit[u]){byUnit[u]=[];units.push(u);}byUnit[u].push(t);});
    units.forEach(function(u){
      var all=byUnit[u], pre=u==='car'?'':u.slice(3).replace(/\W+/g,'-').toLowerCase()+':';
      // tires that share every answer are one group (a set bought together reads as one finding)
      if(u!=='car')pre=slug(u.slice(3))+':';
      var groups=[],keyOf=function(t){return [t.depth,t.measured,t.miles,t.rotated,t.warrantyMi,t.made,t.type,t.brand,t.model,t.size].join('|');};
      all.forEach(function(t){var g=groups.filter(function(g){return keyOf(g[0])===keyOf(t);})[0];if(g)g.push(t);else groups.push([t]);});
      groups.forEach(function(g,gi){
        var t=g[0],name=who(g,all,setup.dually),ids=g.map(function(x){return x.id;}),id=pre+(groups.length===1?'all':slug(name));
        if(t.depth==null)add('tread:'+id,'Tread','warn',name+': tread depth unknown. Enter the details or measure it.',ids,'inspect');
        else{
          var st=math.status(t.depth);
          add('tread:'+id,'Tread',st==='good'?'info':'warn',name+': '+(t.measured?'measured ':'estimated ')+t.depth+'/32 in (new tires have about '+t.newDepth+'/32). '+COND[st],ids,st==='worn'?'replace':st==='low'?'replace_soon':st==='ok'?'plan':'none');
          if(t.rate>0&&st!=='worn'){
            var to4=(t.depth-4)/t.rate,to2=(t.depth-2)/t.rate;
            add('life:'+id,'Miles left','info',name+': at this rate, about '+(to4>=1000?k1000(to4)+' more miles until 4/32 in and ':'')+k1000(to2)+' until 2/32 in.',ids,'plan');
          }
          if(t.warrantyMi&&t.miles>t.warrantyMi)add('warranty:'+id,'Warranty','info',name+': '+t.miles.toLocaleString('en-US')+' miles, past the '+t.warrantyMi.toLocaleString('en-US')+'-mile tread warranty.',ids,'plan');
        }
      });
      var by=function(f){var gs=[];all.forEach(function(t){var g=gs.filter(function(g){return f(g[0])===f(t);})[0];if(g)g.push(t);else gs.push([t]);});return gs;};
      by(function(t){return t.measured?'m':t.rotated;}).forEach(function(g){var t=g[0],name=who(g,all,setup.dually),ids=g.map(function(x){return x.id;}),id=pre+(g.length===all.length?'all':slug(name));
        if(t.rotated&&t.rotated!=='yes'&&!t.measured)add('rotate:'+id,'Rotation',t.rotated==='no'?'warn':'info',name+': rotated regularly? '+ROT_WORD[t.rotated]+'. Unrotated tires wear unevenly (the driven axle first), so the estimate assumes faster wear. Rotation every 5,000–7,500 miles is common; the owner’s manual gives the interval and pattern.',ids,'rotate');
      });
      by(function(t){return t.made||'';}).forEach(function(g){var t=g[0],name=who(g,all,setup.dually),ids=g.map(function(x){return x.id;}),id=pre+(g.length===all.length?'all':slug(name));
        if(t.ageYears==null)add('age:'+id,'Age','warn',name+': when they were made is unknown. Enter the DOT date code (its last 4 digits) to check their age.',ids,'inspect');
        else{
          var as=math.ageStatus(t.ageYears),d=math.dotDate(t.made),made='made week '+d.week+' of '+d.year+', '+t.ageYears+' years ago';
          if(as==='replace')add('age:'+id,'Age','warn',name+': '+made+'. Ten years is past what tire and vehicle makers allow: replace whatever the tread.',ids,'replace');
          else if(as==='old')add('age:'+id,'Age','warn',name+': '+made+'. From 6 years some vehicle and tire makers say to replace tires whatever the tread; at least have them inspected.',ids,'inspect');
          else if(as==='inspect')add('age:'+id,'Age','info',name+': '+made+'. Tire makers suggest a yearly inspection from year 5.',ids,'inspect');
          else add('age:'+id,'Age','info',name+': '+made+'. Well within the age makers allow.',ids,'none');
        }
      });
      // different tires on one car or trailer
      var kinds={};all.forEach(function(t){var k=[t.brand&&t.model?t.brand+' '+t.model:t.brand||t.model||'',t.type||'',t.size||''].filter(Boolean).join(', ')||'unspecified';(kinds[k]=kinds[k]||[]).push(t);});
      var ks=Object.keys(kinds);
      if(ks.length>1){
        ks.sort(function(a,b){return kinds[b].length-kinds[a].length;});
        var most=ks[0],odd=ks.slice(1).map(function(k){var g=kinds[k];return who(g,all,setup.dually)+(g.length>1?' are ':' is ')+k;});
        add(pre+'compatibility','Matching','warn','Not all '+(u==='car'?'the car’s':u.slice(3)+'’s')+' tires match: '+odd.join('; ')+'; the others are '+most+'. Have the fitment checked before moving or replacing any.',all.map(function(t){return t.id;}),'fitment_review');
      }
    });
    if(setup.tires.some(function(t){return t.depth!=null&&!t.measured;}))add('estimate','Estimates','info','Estimated depths come from miles, warranty and rotation, not a gauge. A tread depth gauge gives the real depth.',[],'inspect');
    var car=setup.tires.filter(function(t){return t.unit==='car';}), known=car.filter(function(t){return t.depth!=null;});
    if(setup.drive==='unknown'||!math.TD_LIMIT[setup.drive])add('drive','Drivetrain','info','The drivetrain isn’t known, so tread differences between tires can’t be judged. Add it under About this car.',[],'inspect');
    if(known.length===car.length&&car.length>=4){
      var d={};car.forEach(function(t){d[t.id]=Math.max(t.depth,0.5);});   // treadDiff skips a tire at 0 (an estimate can reach it)
      math.treadDiff(d,setup.drive).forEach(function(x,i){
        var depths=car.map(function(t){return t.depth;});
        add('spread:'+i,'Tread difference',x.level,'Car tread ranges from '+Math.min.apply(null,depths)+' to '+Math.max.apply(null,depths)+'/32 in. '+x.title.replace(/^Tires: /,'').replace(/^./,function(c){return c.toUpperCase();})+'. '+x.text+(/awd|4wdf/.test(setup.drive)?' A tire shop can say whether more than the worn tires need replacing, or whether new ones can be shaved to match.':x.fix?' '+x.fix:''),car.map(function(t){return t.id;}),'fitment_review');
      });
      if((setup.drive==='fwd'||setup.drive==='rwd')&&Math.min(d.lf,d.rf)>Math.min(d.lr,d.rr)+1)
        add('rear-grip','Better pair','warn','The front tires have more tread than the rear. The better pair belongs on the rear, where it keeps the back from sliding out on a wet curve: '+(/low|worn/.test(math.status(Math.min(d.lr,d.rr)))?'new rear tires go on the rear.':'the tires can swap axles if they fit there.'),car.map(function(t){return t.id;}),'fitment_review');
    }
    if(setup.dually)add('dually','Duals','info','Each inner and outer dual pair should match in size and wear, so both carry their share of the load.',car.map(function(t){return t.id;}),'fitment_review');
    var s=setup.spare||{};
    if(s.kind==='full'||s.kind==='compact'){
      var sa=s.ageYears,ss=math.ageStatus(sa),sd=s.made&&math.dotDate(s.made),when=sd?(s.madeAssumed?'assumed made around week 1 of '+sd.year+' (the earliest a '+setup.year+' model year could be built; its DOT code wasn’t entered)':'made week '+sd.week+' of '+sd.year)+', about '+sa+' years ago':'its age is unknown';
      add('spare-age','Spare',ss==='replace'||ss==='old'?'warn':'info',(s.kind==='compact'?'Compact spare':'Full-size spare')+': '+when+'.'+(ss==='replace'?' A spare that old is past what makers allow, even unused.':ss==='old'?' Spares age even unused; some makers say to replace at 6 years.':ss==='inspect'?' From year 5 tire makers suggest a yearly inspection, spares included.':' Well within the age makers allow.'),[],ss==='replace'?'replace':ss==='old'?'inspect':'none');
      if(s.kind==='compact')add('spare-compact','Spare','info','A compact spare is for getting to a tire shop: its speed and distance limits are printed on it, and it usually needs more air (often 60 psi).',[],'none');
    } else if(s.kind==='kit')add('spare-kit','Spare','info','No spare, a repair kit: its sealant expires (the date is on the bottle) and it can’t fix sidewall damage or a blowout.',[],'inspect');
    else if(s.kind==='runflat')add('spare-runflat','Spare','info','Run-flat tires, no spare: after a puncture they go a limited distance at reduced speed (the owner’s manual says how far).',[],'none');
    else if(s.kind==='none')add('spare-none','Spare','warn','No spare and no kit: a flat means roadside assistance or a tow.',[],'none');
    else add('spare-unknown','Spare','info','What the car has for a flat isn’t confirmed yet.',[],'inspect');
    return {rules:RULES,setup:setup,facts:facts,actions:facts.map(function(f){return {id:f.id,kind:f.kind,positions:f.positions,text:f.text};})};
  }
  function prepare(car,math,now){return evaluate(snapshot(car,math,now),math);}
  // most urgent first: a replace-now finding, then soon, then checks, then notes (the model reads them in that order)
  var URG=['urgent','soon','check','note'];
  function urgency(f){return f.kind==='replace'&&f.level==='warn'?'urgent':f.kind==='replace_soon'||f.level==='warn'&&f.kind==='inspect'&&/^age:/.test(f.id)?'soon':f.level==='warn'?'check':'note';}
  function ordered(pack){return pack.facts.map(function(f,i){return {f:f,i:i,u:URG.indexOf(urgency(f))};}).sort(function(a,b){return a.u-b.u||a.i-b.i;}).map(function(x){return x.f;});}
  /** What the model gets: the checked findings, numbered, most urgent first (not the raw setup: it explains them, it doesn't redo them). */
  function prompt(pack){
    var list=ordered(pack),lines=list.map(function(f,i){return (i+1)+'. ['+urgency(f).toUpperCase()+'] '+f.text;}).join('\n');
    var urgent=list.filter(function(f){return urgency(f)==='urgent';}).length;
    return 'These are the checked findings about one vehicle\'s tires, most urgent first. They are correct and complete; do not change, recalculate or add to them.\n\nFINDINGS:\n'+lines+
      '\n\nWrite for the driver, in plain everyday words:\n'+
      '- "summary": 2 or 3 sentences: '+(urgent?'every URGENT finding first, then what else needs attention':'what needs attention first')+', then what is fine. You may repeat numbers from the findings exactly; never make up a number.\n'+
      '- "top": the 1 to 3 findings that matter most, by their number, most urgent first, each with "why": one sentence on what it means for this driver or what could happen. Do not repeat the finding\'s wording.\n'+
      (list.some(function(f){return urgency(f)!=='note';})?'':'Nothing here needs attention: say so plainly, and don\'t turn a NOTE into a concern. ')+'A NOTE is not a problem. Each finding stands on its own: do not link findings the list doesn\'t link, and do not compare tires except as the findings do. Describe; don\'t give orders: write "these tires are due for replacement", not "replace them". Never say the tires are safe.\n'+
      'Reply with only this JSON: {"summary":"…","top":[{"n":1,"why":"…"}]}';
  }
  // A generated explanation is checked before it shows; check() says why one was turned away (logged, not shown).
  var COMMAND=/(?:^|[.!?;:]\s+|\b(?:you|we)\s+(?:should|must|need to|have to)\s+)(?:replace|rotate|swap|move|drive|inflate|deflate|install|remove|ignore)\b/i;
  function jsonOf(raw){
    var t=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'');   // small models fence their JSON
    try{return JSON.parse(t);}catch(e){}
    var a=t.indexOf('{'),b=t.lastIndexOf('}');if(a<0||b<=a)return null;
    try{return JSON.parse(t.slice(a,b+1));}catch(e){return null;}
  }
  function check(raw,pack){
    var answer=jsonOf(raw);if(!answer)return {reason:'not JSON'};
    if(typeof answer.summary!=='string'||!answer.summary.trim()||!Array.isArray(answer.top))return {reason:'missing summary/top'};
    if(answer.summary.length>700)return {reason:'summary too long'};
    var list=ordered(pack);   // "n" is a finding's number in the prompt's list
    var top=answer.top.map(function(a){var f=a&&list[(+a.n)-1];return f&&typeof a.why==='string'&&a.why.trim()?{id:f.id,why:a.why}:null;}).filter(Boolean);
    if(!top.length||top.length>3||new Set(top.map(function(a){return a.id;})).size!==top.length)return {reason:'top IDs do not match'};
    if(top.some(function(a){return a.why.length>300;}))return {reason:'why too long'};
    var prose=answer.summary+' '+top.map(function(a){return a.why;}).join(' ');
    if(/[<>]|https?:/i.test(prose))return {reason:'markup or link'};
    // numbers only as the checked findings state them
    var known={};pack.facts.forEach(function(f){(String(f.text||'').match(/\d+(?:\.\d+)?/g)||[]).forEach(function(n){known[n]=1;});});
    var odd=(prose.match(/\d+(?:\.\d+)?/g)||[]).filter(function(n){return !known[n];});if(odd.length)return {reason:'numbers not in the findings: '+odd.slice(0,4).join(', ')};
    // it explains; it doesn't instruct (the checked findings do), and it never promises safety
    if(COMMAND.test(prose))return {reason:'gives an instruction'};
    if(/\b(?:safe|safely|guaranteed?)\b/i.test(prose))return {reason:'promises safety'};
    return {ok:{summary:answer.summary.trim(),top:top.map(function(a){return {id:a.id,why:a.why.trim()};})}};
  }
  function validate(raw,pack){var r=check(raw,pack);return r.ok||null;}
  root.TirePolicy={ordered:ordered,urgency:urgency,version:RULES.version,prepare:prepare,evaluate:evaluate,snapshot:snapshot,prompt:prompt,validate:validate,check:check};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.TirePolicy;
})(typeof window!=='undefined'?window:globalThis);
