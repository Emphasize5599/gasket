const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const main=fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8');assert.match(main,/KVStore.write\(kvFile\(ns,key\),value,"trips".equals\(ns\)\)/);assert.match(main,/Persistent write failed/);assert.match(main,/startsWith\("\.kv-"\)/);
if(spawnSync('javac',['-version']).error){if(process.env.GASKET_NATIVE_TESTS==='1')throw Error('JDK required');console.log('Atomic KV store native tests need a JDK; enforced in CI');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-kv-')),pkg=path.join(dir,'com/bensanzone/fuelmap');fs.mkdirSync(pkg,{recursive:true});fs.copyFileSync('src/com/bensanzone/fuelmap/KVStore.java',path.join(pkg,'KVStore.java'));
fs.writeFileSync(path.join(pkg,'StoreTest.java'),`package com.bensanzone.fuelmap;
import java.io.*;import java.nio.file.*;import java.nio.charset.StandardCharsets;
public class StoreTest {public static void main(String[] args)throws Exception {
 File dir=Files.createTempDirectory("kv-data").toFile(),f=new File(dir,"trip");KVStore.write(f,"previous",true);
 try {KVStore.write(f,null,true);throw new AssertionError("must reject invalid input");}catch(NullPointerException expected){}
 if(!new String(Files.readAllBytes(f.toPath()),StandardCharsets.UTF_8).equals("previous"))throw new AssertionError("last good record lost on failed write");
 StringBuilder s=new StringBuilder();for(int i=0;i<300000;i++)s.append("route\\u2192station ");String large=s.toString();KVStore.write(f,large,true);
 if(!new String(Files.readAllBytes(f.toPath()),StandardCharsets.UTF_8).equals(large))throw new AssertionError("large UTF-8 record corrupted");
 KVStore.write(f,"replacement",false);if(f.length()!=11)throw new AssertionError("replacement not written");
 File blocked=new File(dir,"blocked");blocked.mkdir();new File(blocked,"child").createNewFile();try{KVStore.write(blocked,"bad",true);throw new AssertionError("must fail replacement");}catch(IOException expected){}
 for(File x:dir.listFiles())if(x.getName().startsWith(".kv-"))throw new AssertionError("temporary write leaked");
 System.out.println("Atomic KV replacement, failed-write preservation, multi-MB UTF-8 and temporary cleanup passed");
}}`);
for(const [cmd,args]of [['javac',['com/bensanzone/fuelmap/KVStore.java','com/bensanzone/fuelmap/StoreTest.java']],['java',['-cp',dir,'com.bensanzone.fuelmap.StoreTest']]]){const r=spawnSync(cmd,args,{cwd:dir,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);}
