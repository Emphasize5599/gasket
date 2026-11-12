const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/web/restui.js','utf8'),windowSource=fs.readFileSync('assets/web/windowplanning.js','utf8');
(async()=>{
 for(const legacy of [false,true]){
  const calls=[],trip={windowPlan:{enabled:true,planningMode:'overnight',autoFirstNight:legacy}},s={route:{},model:{}};
  const c={A:{S:{trip}},state:{token:1,sites:[{}]},screen:{holding:()=>false},focusedTraffic:0,root:{},C:{snapshot:()=>s,prepareForecasts:()=>calls.push('enable')},
   bgAccess:async()=>calls.push('access'),autoReco:async()=>calls.push('suggestions'),autoChargerDirectories:async()=>calls.push('chargers'),warmNightTraffic:async()=>calls.push('later-night-coverage'),
   prepareFirstNight:()=>assert.fail('saved first-night setting must not start a bulk slider sweep')};
  vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  async function runRestFollowups('),source.indexOf('  async function autoReco(')),c);
  await c.runRestFollowups(s,1);assert.deepEqual(calls,['enable','access','suggestions','suggestions','chargers','later-night-coverage']);
  const ui={config:()=>trip.windowPlan,enabled:()=>true,C:{}};vm.createContext(ui);vm.runInContext(windowSource.split('\n').find(l=>l.includes('function modeHtml(')),ui);
  const html=ui.modeHtml();assert(!html.includes('twAutoRests'));assert(!/Prepare every first-night/.test(html));assert(html.includes('Plan around overnight rests'),'overnight window planning remains available');
 }
 assert(!source.includes('preparedFirstNight'),'bulk preview cache and sweep are removed');
 console.log('Legacy first-night setting cannot start bulk forecasts; quick suggestions, charger discovery and overnight planning remain');
})().catch(e=>{console.error(e);process.exitCode=1;});
