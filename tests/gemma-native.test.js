// Compile/run the actual streaming downloader against a small local fixture server, never the real model.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
if(spawnSync('javac',['-version']).error){if(process.env.GASKET_NATIVE_TESTS==='1')throw Error('JDK required');console.log('Native model downloader needs a JDK; enforced in CI');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-model-')),pkg=path.join(dir,'com/bensanzone/fuelmap');fs.mkdirSync(pkg,{recursive:true});
fs.copyFileSync(path.resolve('src/com/bensanzone/fuelmap/ModelDownload.java'),path.join(pkg,'ModelDownload.java'));
const java=`package com.bensanzone.fuelmap;
import java.io.*;import java.net.*;import java.nio.file.*;import java.security.*;import com.sun.net.httpserver.*;
public class DownloadTest {
 static byte[] data=new byte[1024*1024];static String hash;static File folder;static String base;static int requests;
 static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 static class Control implements ModelDownload.Control {long bytes;boolean cancel=false;public boolean cancelled(){return cancel;}public void progress(long b,boolean verify){bytes=b;}}
 static void run(String mode,int pre,boolean fail,boolean cancel) throws Exception {
  final boolean stopEarly=cancel;File part=new File(folder,mode+".part"),dest=new File(folder,mode+".model");if(pre>0)Files.write(part.toPath(),java.util.Arrays.copyOf(data,pre));Control control=new Control(){public void progress(long b,boolean v){super.progress(b,v);if(stopEarly&&b>=262144)cancel=true;}};
  boolean failed=false;try{ModelDownload.fetch(new URL(base+mode),part,dest,data.length,hash,control);}catch(Exception expected){failed=true;}
  check(failed==fail,"Unexpected outcome "+mode);check(dest.exists()!=fail,"Unverified destination "+mode);
  if(!fail)check(java.util.Arrays.equals(Files.readAllBytes(dest.toPath()),data),"Wrong bytes "+mode);
 }
 public static void main(String[] args)throws Exception{
  folder=Files.createTempDirectory("gasket-model-fixture-").toFile();for(int i=0;i<data.length;i++)data[i]=(byte)(i*31);
  StringBuilder digest=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(data))digest.append(String.format("%02x",b&255));hash=digest.toString();
  HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/",e->{try{requests++;String mode=e.getRequestURI().getPath();String range=e.getRequestHeaders().getFirst("Range");int start=range==null||mode.contains("ignored")?0:Integer.parseInt(range.substring(6,range.length()-1));
   if(mode.contains("error")){e.sendResponseHeaders(503,-1);return;}
   if(start>0)e.getResponseHeaders().set("Content-Range","bytes "+(mode.contains("bad-range")?start+1:start)+"-"+(data.length-1)+"/"+data.length);
   byte[] body=java.util.Arrays.copyOfRange(data,start,data.length);if(mode.contains("corrupt"))body[0]++;
   e.sendResponseHeaders(start>0?206:200,body.length);e.getResponseBody().write(body);
  }finally{e.close();}});server.start();base="http://127.0.0.1:"+server.getAddress().getPort()+"/";
  try{run("fresh",0,false,false);run("resume",12345,false,false);run("ignored",12345,false,false);run("bad-range",12345,true,false);run("corrupt",0,true,false);run("cancelled",0,true,true);run("error",0,true,false);
   check(!new File(folder,"corrupt.part").exists(),"Corrupt partial retained");check(new File(folder,"cancelled.part").length()>0,"Cancelled partial lost");
   File part=new File(folder,"complete.part"),dest=new File(folder,"complete.model");Files.write(part.toPath(),data);int before=requests;ModelDownload.fetch(new URL(base+"complete"),part,dest,data.length,hash,new Control());check(requests==before,"Complete partial was downloaded again");
   System.out.println("Native model download: fresh, resume, ignored/bad range, checksum, cancellation, HTTP failure and promotion passed");
  }finally{server.stop(0);}
 }
}`;
fs.writeFileSync(path.join(pkg,'DownloadTest.java'),java);
for(const [cmd,args] of [['javac',['com/bensanzone/fuelmap/ModelDownload.java','com/bensanzone/fuelmap/DownloadTest.java']],['java',['-cp',dir,'com.bensanzone.fuelmap.DownloadTest']]]){const r=spawnSync(cmd,args,{cwd:dir,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout)process.stdout.write(r.stdout);}
