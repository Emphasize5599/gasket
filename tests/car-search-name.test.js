// The car as Brave's tank / spare questions name it: the model's own name, never the EPA's base model that drops
// "Hybrid" (a 2020 Corolla Hybrid was asked about as a plain Corolla).
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
  const p=await b.newPage();await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);
  const k=c=>p.evaluate(c=>Garage.carKey(c),c);
  assert.equal(await k({year:2020,make:'Toyota',model:'Corolla Hybrid',epaBase:'Corolla',trim:'LE',power:'hybrid'}),'2020 Toyota Corolla Hybrid LE');
  assert.equal(await k({year:2020,make:'Toyota',model:'Corolla',trim:'LE',power:'hybrid'}),'2020 Toyota Corolla Hybrid LE','a VIN name without Hybrid gets it');
  assert.equal(await k({year:2021,make:'Toyota',model:'Prius Prime',power:'phev'}),'2021 Toyota Prius Prime');
  assert.equal(await k({year:2008,make:'Dodge',model:'Charger AWD',trim:'SXT',power:'gas'}),'2008 Dodge Charger SXT');
  console.log('Brave questions name the car by its own model name (Hybrid kept)');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
