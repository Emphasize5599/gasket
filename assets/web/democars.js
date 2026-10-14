/* Opt-in vehicle examples. Only EPA ratings are authoritative; configuration, wear and presets are illustrative.
 * No station, price, route, VIN or recall fixtures belong here. */
(function(root){'use strict';
  function create(){
    var cars=[
      {id:'demo-prime',year:2021,make:'Toyota',model:'Prius Prime',trim:'LE',epaId:'42814',epa:{city:55,hwy:53,comb:54,fuel:'Regular Gasoline'},type:'hybrid',power:'phev',grade:'regular',tank:11.4,
       info:{engine:'1.8L Inline 4 Cyl',asp:'na',trans:'ecvt',drive:'fwd',features:['Atkinson cycle','Regenerative braking']},demoFeatures:'Gasoline, hybrid/plug-in settings, mileage log and estimated tire wear.',tires:{size:'195/65R15',type:'Grand Touring All-Season',warrantyMi:65000,tread:{mode:'miles',miles:26000,rotated:'yes'},spare:{kind:'kit'}}},
      {id:'demo-ram3500',year:2024,make:'RAM',model:'3500',trim:'Tradesman',epa:null,type:'truck',power:'diesel',grade:'diesel',tank:32,obs:{city:12,hwy:17},catalog:{source:'nhtsa',makeId:'496',modelId:'13622'},
       info:{engine:'6.7L Inline 6 Cyl',asp:'turbo',trans:'auto',drive:'4wd',drw:'yes',body:'Pickup',features:['Turbocharged']},demoFeatures:'Diesel, no EPA rating, six tires, mixed tire mileage, hooked and saved trailers.',tires:{size:'235/80R17',type:'Highway All-Season',warrantyMi:60000,tread:{mode:'miles',miles:18000,rotated:'sometimes'},towMode:true,corners:{split:true,dually:true,mode:'miles'},spare:{kind:'full',location:'under'},trailers:[{id:'demo-cargo',name:'Demo cargo trailer',hooked:true,axles:3,per:4,split:true,size:'235/80R16',type:'Trailer',warrantyMi:40000,geometry:{lengthFt:24,leftFt:4,rightFt:4,symmetric:true},axlePositions:[.55,.7,.85]},{id:'demo-utility',name:'Demo utility trailer',hooked:false,axles:1,per:2,size:'205/75R15',type:'Trailer',warrantyMi:40000}]}},
      {id:'demo-tesla',year:2021,make:'Tesla',model:'Model 3 Long Range AWD',trim:'',epaId:'43401',epa:{city:100/23.9556,hwy:100/26.5188,comb:100/25.109,fuel:'Electricity',range:353,kwh:{city:23.9556,hwy:26.5188,comb:25.109}},type:'car',power:'ev',grade:'electric',tank:75,dcKw:250,plug:'NACS',adapter:true,
       info:{engine:'Electric motors',trans:'single',drive:'awd',features:['Regenerative braking']},demoFeatures:'EV charging, adapter options, measured tread and no spare.',tires:{size:'235/45R18',type:'Performance All-Season',tread:{mode:'measure',depth:5},spare:{kind:'none'}}},
      {id:'demo-mirai',year:2021,make:'Toyota',model:'Mirai XLE',trim:'',epaId:'47543',epa:{city:76,hwy:71,comb:74,fuel:'Hydrogen',range:402},type:'car',power:'h2',grade:'hydrogen',tank:5.6,
       info:{engine:'Hydrogen fuel-cell electric motor',trans:'single',drive:'rwd',features:['Regenerative braking']},demoFeatures:'Hydrogen locations, kg units, generalized wear warning and spare-location choices.',tires:{size:'235/55R19',tread:{mode:'miles',miles:14000,rotated:'unsure'},spare:{kind:'compact',location:'inside'}}}
    ];
    cars.forEach(function(c,i){c.name=[c.year,c.make,c.model,c.trim].join(' ').trim();c.demoMileage=true;c.demoSet=2;c.picMode='';c.paint={hex:['#457ea2','#aa3939','#d8dce3','#417c62'][i]};c.tankSrc='illustrative demo capacity';c.obs=c.obs||{};c.entries=i===0?[{id:'demo-log',date:'2026-10-01',loggedAt:Date.UTC(2026,9,1,18,30),mpg:50.8,kind:'hwy',speed:60}]:[];c.tires.sizeSrc='user';
      var caps=i===1?{auto:false,fanMax:5,rear:true,seatHeat:true,noFilter:true}:{auto:true,dual:true,rearDefrost:true,seatHeat:true,wheelHeat:i===0,seatCool:i===3,sunroof:i===2};
      c.climate={caps:caps,presets:[]};if(root.ClimateMath){['winter','spring','summer','fall'].forEach(function(s){c.climate.presets.push(root.ClimateMath.starter('season',s,caps));root.ClimateMath.situations(s).forEach(function(w){var p=root.ClimateMath.starter('weather',w[0],caps);p.season=s;c.climate.presets.push(p);});});var p=root.ClimateMath.starter('custom','',caps);p.name='Demo road-trip comfort';c.climate.presets.push(p);}
      c.climate.presets.forEach(function(p,j){p.id=c.id+'-preset-'+j;});c.paint.rgb=c.paint.hex;delete c.paint.hex;
    });
    var t=cars[1].tires;['lf','rf','lr','lri','rri','rr'].forEach(function(k,i){t.corners[k]={size:t.size,miles:18000+i*2000,warrantyMi:60000,rotated:i<2?'yes':'sometimes'};});for(var a=1;a<=3;a++)['lo','li','ri','ro'].forEach(function(side){t.corners['demo-cargo:a'+a+side]={size:'235/80R16',type:'Trailer',miles:8000+a*1000,warrantyMi:40000,rotated:'yes'};});return cars;
  }
  root.DemoCars={create:create};
})(typeof window==='object'?window:globalThis);
