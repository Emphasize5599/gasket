// Full backups are gzip-compressed; restore reads both those and plain JSON (older Gasket, Fuel+ 0.0.47).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const main=fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8'),app=fs.readFileSync('assets/web/app.js','utf8');
assert(main.includes('os = BackupIO.compress(os)'),'writeBackup compresses');assert(main.includes('BackupIO.open(getContentResolver().openInputStream(uri))'),'readBackup accepts both');
assert(app.includes("'gasket-full-backup-' + stamp() + '.json.gz'"),'the backup file is named .json.gz');
if(spawnSync('javac',['-version']).error){if(process.env.GASKET_NATIVE_TESTS==='1')throw Error('JDK required');console.log('Backup compression needs a JDK; enforced in CI');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-backup-')),pkg=path.join(dir,'com/bensanzone/fuelmap');fs.mkdirSync(pkg,{recursive:true});
fs.copyFileSync(path.resolve('src/com/bensanzone/fuelmap/BackupIO.java'),path.join(pkg,'BackupIO.java'));
fs.writeFileSync(path.join(pkg,'BackupTest.java'),`package com.bensanzone.fuelmap;
import java.io.*;import java.nio.charset.StandardCharsets;
public class BackupTest {
 static String read(InputStream in) throws IOException {ByteArrayOutputStream o=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;while((n=in.read(b))>0)o.write(b,0,n);return new String(o.toByteArray(),StandardCharsets.UTF_8);}
 public static void main(String[] a) throws Exception {
  StringBuilder sb=new StringBuilder("{\\"fullBackup\\":1,\\"kv\\":{\\"trips\\":{");
  for(int i=0;i<3000;i++)sb.append("\\"k"+i+"\\":\\"{\\\\\\"t\\\\\\":1792301100733,\\\\\\"v\\\\\\":{\\\\\\"name\\\\\\":\\\\\\"Murphy USA\\\\\\",\\\\\\"lat\\\\\\":34."+(i%997)+",\\\\\\"prices\\\\\\":{\\\\\\"regular\\\\\\":3."+(i%89)+"}}}\\",");
  sb.append("\\"end\\":\\"1\\"}}}");String json=sb.toString();
  ByteArrayOutputStream gz=new ByteArrayOutputStream();Writer w=new OutputStreamWriter(BackupIO.compress(gz),StandardCharsets.UTF_8);w.write(json);w.close();
  byte[] z=gz.toByteArray();if(z[0]!=(byte)0x1f||z[1]!=(byte)0x8b)throw new AssertionError("gzip header");
  if(!read(BackupIO.open(new ByteArrayInputStream(z))).equals(json))throw new AssertionError("compressed backup reads back the same");
  if(!read(BackupIO.open(new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)))).equals(json))throw new AssertionError("a plain JSON backup reads as before");
  if(!read(BackupIO.open(new ByteArrayInputStream(new byte[0]))).equals(""))throw new AssertionError("empty file");
  System.out.println("ratio "+(json.length()/(double)z.length));
  if(z.length*4>json.length())throw new AssertionError("saved trips compress at least 4x: "+json.length()+" -> "+z.length);
 }
}`);
for(const [cmd,args] of [['javac',['com/bensanzone/fuelmap/BackupIO.java','com/bensanzone/fuelmap/BackupTest.java']],['java',['-cp',dir,'com.bensanzone.fuelmap.BackupTest']]]){const r=spawnSync(cmd,args,{cwd:dir,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);}
console.log('Full backups are gzip-compressed and plain JSON backups still restore');
