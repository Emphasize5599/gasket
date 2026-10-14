const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/web/carpics.js','utf8'),java=fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8');
assert.match(java,/PIC_HOSTS[^;]*"thumb.wikimedia.org"/);
assert.match(java,/Gasket\/[^;]*https:\/\/github.com\/Emphasize5599\/gasket/);
async function run(brokenNhtsa,brokenWiki){
 const calls=[],kv={},events=[];const c={id:'mirai',year:2021,make:'Toyota',model:'Mirai XLE',pic:{wiki:{sig:'2021|toyota|mirai xle',fail:Date.now()}}};
 const ctx={document:{},console,Date,Promise,CustomEvent:function(t,o){this.detail=o.detail;},dispatchEvent:e=>events.push(e),__app:{S:{},save(){},KV:{get:(n,k)=>kv[k],put:(n,k,v)=>{kv[k]={v};}}},__trip:{call:async(name,url)=>{
  calls.push([name,url]);if(name==='fetchJson')return {body:JSON.stringify(url.includes('nhtsa.gov')?{results:[{vehiclePicture:brokenNhtsa?'https://static.nhtsa.gov/broken.png':null}]}:{query:{pages:{1:{title:'File:Toyota-mirai-2021-009.jpg',imageinfo:[{thumburl:'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/41/Toyota-mirai-2021-009.jpg/960px-Toyota-mirai-2021-009.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:Toyota-mirai-2021-009.jpg',extmetadata:{Artist:{value:'DrivenAutos'},LicenseShortName:{value:'CC BY-SA 4.0'}}}]}}}})};
  if(name==='fetchImage')return url.includes('static.nhtsa')||brokenWiki?{error:'HTTP 404'}:{body:'data:image/webp;base64,test'};
 }} };ctx.window=ctx;vm.runInNewContext(source,ctx);
 await Promise.all([ctx.CarPics.ensure(c),ctx.CarPics.ensure(c)]);
 assert.ok(calls.some(([n,u])=>n==='fetchJson'&&u.includes('iiurlwidth=960')));
 assert.ok(calls.some(([n,u])=>n==='fetchJson'&&u.includes('model=Mirai&')));
 assert.equal(calls.filter(([n,u])=>n==='fetchImage'&&u.includes('thumb.wikimedia')).length,1);
 assert.equal(ctx.CarPics.pending(c),false);
 assert.equal(ctx.CarPics.which(c),brokenWiki?null:'wiki');
 if(!brokenWiki){assert.equal(ctx.CarPics.src(c),'data:image/webp;base64,test');assert.match(ctx.CarPics.credit(c).text,/DrivenAutos.*CC BY-SA/);}
 const count=calls.length,notices=events.length;await ctx.CarPics.ensure(c);assert.equal(calls.length,count,'redraw must not repeatedly download failed or cached pictures');assert.equal(events.length,notices,'completed redraw must not notify itself forever');
}
(async()=>{await run(false,false);await run(true,false);await run(false,true);console.log('photo download, fallback, retry and attribution tests passed');})().catch(e=>{console.error(e);process.exitCode=1;});
