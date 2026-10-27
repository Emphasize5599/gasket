// Recreation.gov RIDB campgrounds (user-started download): only Facilities_API_v1.json is fetched from the ~570 MB
// zip by byte ranges read from its central directory, streamed (never held whole), filtered to enabled campgrounds with
// coordinates, CRC-checked, and refused when the CDN switches export versions mid-download. Generated zips only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const main=fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8');
assert(main.includes('RidbCampgrounds.download('),'native bridge uses the ranged reader');assert(/public void restInventory\(/.test(main),'restInventory bridge');
assert(!/RIDB[^\n]*(apikey|api_key)/i.test(main),'no RIDB key: the public export needs none');
// web side: rows -> rest places (fee text is not a price; only "N days/nights" is a stay limit), merged into searches
{const R=require('../assets/web/restplaces'),T=require('../assets/web/trip');const camps=R.ridb({at:5,rows:[['c1','Lake View',34.5,-92.25,1,'14 days','$20 per night'],['c2','Bare',34.6,-92.2,0,'Check with the office',''],['bad','No spot',null,null,0,'','']]});
 assert.equal(camps.length,2);assert.deepEqual([camps[0].id,camps[0].kind,camps[0].price,camps[0].stayMinutes,camps[0].reservable,camps[0].feeText,camps[0].checkedAt],['ridb:c1','campground',null,14*1440,true,'$20 per night',5]);
 assert.equal(camps[1].stayMinutes,null);assert.equal(camps[1].stayText,'Check with the office');assert.match(camps[0].sourceUrl,/^https:\/\/www\.recreation\.gov\/camping\/campgrounds\/c1$/);assert.deepEqual(R.ridb(null),[]);
 const pts=[{lat:34.4,lng:-92.3},{lat:34.7,lng:-92.1}],mi=T.hav(pts[0],pts[1]),model=T.buildRoute({distanceMeters:mi*1609.344,duration:'3600s',polyline:{encodedPolyline:T.encodePolyline(pts)},legs:[]},{city:30,hwy:30,comb:30});
 const kv={ridb:{at:5,rows:[['c1','Lake View',34.5,-92.25,1,'14 days','$20 per night']]},national:[]},fetched=[];
 const store=R.create({get:k=>kv[k]||null,put:(k,v)=>{kv[k]=v;},fetch:async u=>{fetched.push(u);return {elements:[{type:'node',id:7,lat:34.5005,lon:-92.2505,tags:{tourism:'camp_site',name:'Lake View CG'}},{type:'node',id:8,lat:34.65,lon:-92.15,tags:{tourism:'camp_site',name:'Other camp'}}]};}});
 store.search(model,mi/2,{kinds:['campground'],radius:25}).then(out=>{const ids=out.map(x=>x.site.id);assert(ids.includes('ridb:c1'),'downloaded campground offered');assert(!ids.includes('osm:node:7'),'OSM copy of the same campground dropped');assert(ids.includes('osm:node:8'),'other OSM campgrounds kept');}).catch(e=>{console.error(e);process.exitCode=1;});}
if(spawnSync('javac',['-version']).error){if(process.env.GASKET_NATIVE_TESTS==='1')throw Error('JDK required');console.log('RIDB reader needs a JDK; enforced in CI');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-ridb-')),pkg=path.join(dir,'com/bensanzone/fuelmap');fs.mkdirSync(pkg,{recursive:true});
fs.copyFileSync(path.resolve('src/com/bensanzone/fuelmap/RidbCampgrounds.java'),path.join(pkg,'RidbCampgrounds.java'));
fs.writeFileSync(path.join(pkg,'RidbTest.java'),`package com.bensanzone.fuelmap;
import java.io.*;import java.util.*;import java.util.zip.*;import java.nio.charset.StandardCharsets;import java.util.concurrent.atomic.AtomicBoolean;
public class RidbTest {
 static String fac(){StringBuilder s=new StringBuilder("{\\"RECDATA\\":[");
  s.append("{\\"FacilityID\\":\\"c1\\",\\"FacilityName\\":\\"Lake <b>View</b> \\\\\\"North\\\\\\" Campground\\",\\"FacilityTypeDescription\\":\\"Campground\\",\\"FacilityLatitude\\":\\"34.5\\",\\"FacilityLongitude\\":\\"-92.25\\",\\"Reservable\\":\\"True\\",\\"Enabled\\":\\"True\\",\\"StayLimit\\":\\"14 days\\",\\"FacilityUseFeeDescription\\":\\"$20 per night\\",\\"GEOJSON\\":{\\"TYPE\\":\\"Point\\",\\"COORDINATES\\":[-92.25,34.5]},\\"MEDIA\\":[1,2,{\\"x\\":[3]}]}");
  s.append(",{\\"FacilityID\\":\\"v1\\",\\"FacilityName\\":\\"Visitor Center\\",\\"FacilityTypeDescription\\":\\"Visitor Center\\",\\"FacilityLatitude\\":\\"34\\",\\"FacilityLongitude\\":\\"-92\\",\\"Enabled\\":\\"True\\"}");
  s.append(",{\\"FacilityID\\":\\"c2\\",\\"FacilityName\\":\\"Closed Camp\\",\\"FacilityTypeDescription\\":\\"Campground\\",\\"FacilityLatitude\\":\\"35\\",\\"FacilityLongitude\\":\\"-93\\",\\"Enabled\\":\\"False\\"}");
  s.append(",{\\"FacilityID\\":\\"c3\\",\\"FacilityName\\":\\"No Location\\",\\"FacilityTypeDescription\\":\\"Campground\\",\\"FacilityLatitude\\":\\"\\",\\"FacilityLongitude\\":\\"\\",\\"Enabled\\":\\"True\\"}");
  s.append(",{\\"FacilityID\\":\\"c4\\",\\"FacilityName\\":\\"Zero Zero\\",\\"FacilityTypeDescription\\":\\"Campground\\",\\"FacilityLatitude\\":0,\\"FacilityLongitude\\":0,\\"Enabled\\":true}");
  for(int i=0;i<3000;i++)s.append(",{\\"FacilityID\\":\\"g").append(i).append("\\",\\"FacilityName\\":\\"Camp \\\\u00e9").append(i).append("\\",\\"FacilityTypeDescription\\":\\"Campground\\",\\"FacilityLatitude\\":\\"").append(30+i%10).append(".1\\",\\"FacilityLongitude\\":\\"-").append(90+i%20).append(".2\\",\\"Reservable\\":\\"False\\",\\"Enabled\\":\\"True\\",\\"StayLimit\\":null}");
  return s.append("],\\"METADATA\\":{\\"SOURCE\\":\\"https://ridb.recreation.gov/\\"}}").toString();}
 static byte[] zip(boolean deflate) throws IOException{ByteArrayOutputStream o=new ByteArrayOutputStream();ZipOutputStream z=new ZipOutputStream(o);
  for(String[] e:new String[][]{{"Media_API_v1.json",new String(new char[300000]).replace('\\0','m')},{"Facilities_API_v1.json",fac()},{"Tours_API_v1.json","{}"}}){byte[] b=e[1].getBytes(StandardCharsets.UTF_8);ZipEntry ze=new ZipEntry(e[0]);
   if(!deflate||!e[0].startsWith("Fac")){ze.setMethod(ZipEntry.STORED);ze.setSize(b.length);CRC32 c=new CRC32();c.update(b);ze.setCrc(c.getValue());}z.putNextEntry(ze);z.write(b);z.closeEntry();}
  z.close();return o.toByteArray();}
 static String[] etag={"\\"v1\\""};static int[] requests={0};
 static RidbCampgrounds.Fetch serve(byte[] f){return (range,ifRange)->{requests[0]++;if(ifRange!=null&&!ifRange.equals(etag[0]))return new RidbCampgrounds.Answer(200,null,etag[0],new ByteArrayInputStream(f));
  String r=range.substring(6);long a,b;if(r.startsWith("-")){long n=Long.parseLong(r.substring(1));a=Math.max(0,f.length-n);b=f.length-1;}else{String[] p=r.split("-");a=Long.parseLong(p[0]);b=Math.min(f.length-1,Long.parseLong(p[1]));}
  return new RidbCampgrounds.Answer(206,"bytes "+a+"-"+b+"/"+f.length,etag[0],new ByteArrayInputStream(Arrays.copyOfRange(f,(int)a,(int)b+1)));};}
 public static void main(String[] x) throws Exception{
  for(boolean deflate:new boolean[]{false,true}){byte[] z=zip(deflate);long[] seen={0,0};
   RidbCampgrounds.Result r=RidbCampgrounds.download(serve(z),(d,t)->{seen[0]=d;seen[1]=t;},new AtomicBoolean());
   if(r.count!=3001)throw new AssertionError("only enabled campgrounds with coordinates: "+r.count);
   if(!r.rows.startsWith("[[\\"c1\\",\\"Lake View \\\\\\"North\\\\\\" Campground\\",34.5,-92.25,1,\\"14 days\\",\\"$20 per night\\"]"))throw new AssertionError(r.rows.substring(0,160));
   if(r.rows.contains("\\"v1\\"")||r.rows.contains("c2")||r.rows.contains("c3")||r.rows.contains("c4"))throw new AssertionError("filtered out");
   if(!r.rows.contains("Camp \\u00e90"))throw new AssertionError("unicode escape");if(seen[0]!=seen[1]||seen[1]<=0)throw new AssertionError("progress reaches the end");}
  byte[] z=zip(false);
  requests[0]=0;RidbCampgrounds.download(serve(z),null,new AtomicBoolean());if(requests[0]!=3)throw new AssertionError("index tail + local header + entry only: "+requests[0]);
  // a corrupted byte inside the campground file fails the CRC
  byte[] bad=z.clone();int at=new String(bad,StandardCharsets.ISO_8859_1).indexOf("Visitor Center");bad[at]='X';
  try{RidbCampgrounds.download(serve(bad),null,new AtomicBoolean());throw new AssertionError("CRC");}catch(IOException e){if(!e.getMessage().contains("integrity"))throw e;}
  // the CDN switches export versions between requests
  RidbCampgrounds.Fetch flip=(range,ifRange)->{RidbCampgrounds.Answer a=serve(z).get(range,ifRange);etag[0]="\\"v2\\"";return a;};
  try{RidbCampgrounds.download(flip,null,new AtomicBoolean());throw new AssertionError("version switch");}catch(IOException e){if(!e.getMessage().contains("updated its export"))throw e;}
  etag[0]="\\"v1\\"";
  // cancel stops the stream
  try{RidbCampgrounds.download(serve(z),null,new AtomicBoolean(true));throw new AssertionError("cancel");}catch(IOException e){if(!e.getMessage().contains("cancelled"))throw e;}
  // a server that ignores ranges is refused instead of downloading 570 MB
  try{RidbCampgrounds.download((r,i)->new RidbCampgrounds.Answer(200,null,null,new ByteArrayInputStream(z)),null,new AtomicBoolean());throw new AssertionError("no ranges");}catch(IOException e){if(!e.getMessage().contains("partial"))throw e;}
  System.out.println("ok");
 }
}`);
for(const [cmd,args] of [['javac',['com/bensanzone/fuelmap/RidbCampgrounds.java','com/bensanzone/fuelmap/RidbTest.java']],['java',['-cp',dir,'com.bensanzone.fuelmap.RidbTest']]]){const r=spawnSync(cmd,args,{cwd:dir,encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stdout+r.stderr);}
console.log('RIDB campgrounds: ranged read of only the facilities file (stored and deflated), campground filter, escapes, progress, CRC, version switch, cancel, no-range refusal');
