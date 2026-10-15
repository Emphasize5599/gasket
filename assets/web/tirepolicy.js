/* One versioned policy: the model receives these same branches and their evaluated facts/actions. */
(function(root){
  'use strict';
  var RULES={version:2,units:'tread in 32nds of an inch',classifyTread:null,
    spreadLimits:null, // Filled from TireMath, not an independent copy of its drivetrain assumptions.
    branches:[
      'Unknown or estimated depth is not a measurement; never certify safety from estimated wear.',
      'Use classifyTread for thresholds: worn means replace the named worn tires before driving; never condemn other tires solely for sharing a vehicle.',
      'Classification low: arrange replacement soon. Classification ok: plan replacement for reduced wet/snow grip.',
      'New/better pair belongs on rear of a compatible two-wheel-drive setup. Exact movements require confirmed fitment/pattern restrictions; do not invent them.',
      'AWD/full-time/on-demand four-wheel systems: compare all car tires to the applicable app spread heuristic; manufacturer requirements may differ. Matching depths do not establish matching patterns or circumference.',
      'Part-time 4WD: compare front/rear axle averages and rear side-to-side. Two-wheel drive: compare side-to-side on driven axle only. Unknown drive: request confirmation.',
      'Different size/brand/model/type or unknown pattern: inspect compatibility; do not infer pattern, direction, wheel interchangeability or manufacturer approval.',
      'Dually inner/outer pairs: inspect paired fitment/circumference and tread; no ordinary four-corner rotation plan. Trailers are evaluated separately, never swap their tires with the car.',
      'Unknown spare/age/load/pressure/manufacturer limits stay unknown. An attached trailer does not share the car drivetrain. Keep existing pressure/spare notices.',
      'Never infer replace-all from AWD alone; a tire professional/manufacturer fitment requirements decide how to restore matching rolling circumference.'
    ]};
  function text(v){return v==null||v===''?null:String(v);}
  function number(v){return v==null||v===''||!Number.isFinite(+v)?null:+v;}
  function snapshot(car,math){
    var t=JSON.parse(JSON.stringify(car.tires||{})), drive=(car.info||{}).drive||'unknown', C=t.corners||{};
    var tires=math.positions(t).map(function(p){
      var unit=p.unit||{}, split=p.trailer?!!unit.split:!!C.split, e=split?C[p.k]||{}:{}, tread=unit.tread||t.tread||{};
      var own=!!(e.type||e.model);
      var measured=split?!unit.split&&(C.mode==='depth'||!C.mode&&e.depth!=null):tread.mode==='measure';
      var depth=math.depthAt(t,p,drive);
      if(measured){var entered=split?e.depth:tread.depth;if(entered!==''&&entered!=null&&Number.isFinite(+entered)&&+entered>=0)depth=+entered;}
      var size=p.trailer?unit.size:(t.multiSize&&/^(lr|rr|lri|rri)$/.test(p.k)?t.sizeRear:unit.size);
      return {id:p.k,position:text(p.name),unit:p.trailer?'trailer':'car',axle:text(p.group),
        type:text(e.type||unit.type),brand:text(own?e.brand:unit.brand),model:text(own?e.model:unit.model),
        size:text(e.size||size),depth:Number.isFinite(depth)?depth:null,measured:measured,
        miles:number(split?e.miles:tread.miles),
        rotated:text(split?e.rotated:tread.rotated),warrantyMi:math.warrantyOf(e,unit)||null,
        pattern:text(e.pattern||unit.pattern),directional:typeof e.directional==='boolean'?e.directional:null,
        ageYears:Number.isFinite(e.ageYears)?e.ageYears:null};
    });
    return {drive:drive,dually:!!C.dually,tires:tires,spare:{kind:text((t.spare||{}).kind),location:text((t.spare||{}).location)},
      unknowns:['Manufacturer fitment/circumference limits, load/pressure and pattern restrictions are not independently verified.']};
  }
  function evaluate(setup,math){
    var rules=Object.assign({},RULES,{classifyTread:String(math.status),spreadLimits:Object.assign({},math.TD_LIMIT)}), facts=[],actions=[];
    function add(id,level,message,positions,kind){facts.push({id:id,level:level,text:message,positions:positions||[],kind:kind||'inspect'});}
    setup.tires.forEach(function(t){
      var name=t.position;
      if(t.depth==null)add('missing:'+t.id,'warn',name+': tread depth is unknown; enter details or measure it.',[t.id]);
      else {
        var depth=(t.measured?'Measured ':'Estimated ')+t.depth+'/32 in';
        var condition=math.status(t.depth);
        if(condition==='worn')add('replace:'+t.id,'warn',name+': '+depth+'. Replace this worn tire before driving; have paired fitment checked.',[t.id],'replace');
        else if(condition==='low')add('soon:'+t.id,'warn',name+': '+depth+'. Arrange replacement soon; wet and snow grip are reduced.',[t.id],'replace_soon');
        else if(condition==='ok')add('plan:'+t.id,'info',name+': '+depth+'. Plan replacement; wet and snow grip are reduced.',[t.id],'plan');
      }
    });
    if(setup.tires.some(function(t){return t.depth!=null&&!t.measured;}))add('estimate','warn','Estimated wear is generalized, not an inspection. Measure tread to verify the tire condition.');
    var car=setup.tires.filter(function(t){return t.unit==='car';}), known=car.filter(function(t){return t.depth!=null;});
    if(setup.drive==='unknown'||!rules.spreadLimits[setup.drive])add('drive','info','Confirm the drivetrain before choosing a tire arrangement.');
    if(known.length===car.length&&car.length===4){
      var d={};car.forEach(function(t){d[t.id]=t.depth;});
      // Use existing evaluated mismatch facts, but not their unconditional replace-all/movement prose.
      math.treadDiff(d,setup.drive).forEach(function(x,i){
        var depths=car.map(function(t){return t.depth;});
        add('spread:'+i,x.level,'Entered/estimated car tread spans '+Math.min.apply(null,depths)+'–'+Math.max.apply(null,depths)+'/32 in. This triggers Gasket’s drivetrain mismatch heuristic; confirm actual manufacturer fitment/circumference limits. Do not assume every AWD vehicle has a mechanical center differential.',car.map(function(t){return t.id;}));
      });
      if((setup.drive==='fwd'||setup.drive==='rwd')&&Math.min(d.lf,d.rf)>Math.min(d.lr,d.rr))
        add('rear-grip','info','Keep the new or better matched pair on the rear if fitment allows. Do not discard serviceable front tires merely because the rear tires need replacement.',car.map(function(t){return t.id;}),'fitment_review');
    }
    var variants=new Set(car.map(function(t){return [t.size,t.type,t.brand,t.model].join('|');}));
    if(variants.size>1||car.some(function(t){return !t.size||!t.brand||!t.model||!t.pattern;}))
      add('compatibility','info','Check size, model, pattern and vehicle fitment before choosing replacements or moving tires. Matching tread depths alone do not establish compatibility.',car.map(function(t){return t.id;}),'fitment_review');
    if(setup.dually)add('dually','info','Check each inner/outer dual pair for compatible size and rolling circumference. A normal four-tire rotation plan does not apply.',car.map(function(t){return t.id;}),'fitment_review');
    if(setup.tires.some(function(t){return t.unit==='trailer';}))add('trailer','info','Review each attached trailer tire separately; do not move tires between the car and trailer.',setup.tires.filter(function(t){return t.unit==='trailer';}).map(function(t){return t.id;}),'fitment_review');
    facts.forEach(function(f){actions.push({id:f.id,kind:f.kind,positions:f.positions,text:f.text});});
    return {rules:rules,setup:setup,facts:facts,actions:actions};
  }
  function prepare(car,math){return evaluate(snapshot(car,math),math);}
  function prompt(pack){return 'Explain this tire setup using only the checked findings and permitted actions below. '+
    'Return JSON {"summary":"short explanatory prose, no new actions or numbers", "actions":[{"id":"permitted action ID","why":"brief explanation grounded in facts"}],"facts":["every supplied fact ID"]}. '+
    'Reference every supplied action exactly once; prioritize urgent findings. Summary and why fields explain the reasons, not commands; the app displays the actual checked actions separately. Use no numerals in generated prose. Do not propose exact rotations, universal replacement of all tires, driving permission, prices or manufacturer specifications. '+
    'Do not repeat the full fact list in the summary; the app displays it. FULL POLICY AND DATA:\n'+JSON.stringify(pack);}
  function validate(raw,pack){
    var answer;try{answer=JSON.parse(raw);}catch(e){return null;}
    if(!answer||typeof answer.summary!=='string'||!answer.summary.trim()||answer.summary.length>800||!Array.isArray(answer.actions)||!Array.isArray(answer.facts))return null;
    var facts=pack.facts.map(function(f){return f.id;}),ids=pack.actions.map(function(a){return a.id;});
    if(answer.facts.length!==facts.length||new Set(answer.facts).size!==facts.length||answer.facts.some(function(id){return facts.indexOf(id)<0;}))return null;
    if(answer.actions.length!==ids.length||new Set(answer.actions.map(function(a){return a&&a.id;})).size!==ids.length)return null;
    if(answer.actions.some(function(a){return !a||ids.indexOf(a.id)<0||typeof a.why!=='string'||a.why.length>400;}))return null;
    var prose=answer.summary+' '+answer.actions.map(function(a){return a.why;}).join(' ');
    // The generator explains; numerical findings and exact actions remain app-owned and visible separately.
    if(prose.length>2400||/[0-9<>]|https?:/i.test(prose)||/\b(?:replace|rotate|swap|move|drive|inflate|deflate|install|remove|ignore|safe|guaranteed)\b/i.test(prose))return null;
    return {summary:answer.summary.trim(),actions:answer.actions.map(function(a){return {id:a.id,why:a.why.trim()};}),facts:answer.facts};
  }
  root.TirePolicy={version:RULES.version,prepare:prepare,evaluate:evaluate,snapshot:snapshot,prompt:prompt,validate:validate};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.TirePolicy;
})(typeof window!=='undefined'?window:globalThis);
