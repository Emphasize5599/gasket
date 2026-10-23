package com.bensanzone.fuelmap;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;

/** User-started route discovery/processing. Checkpoints live in the app; never restart consent on boot. */
public final class TripQueueService extends Service {
    private static final int PROGRESS=7301, READY=7302, CHECK=7303;
    private PowerManager.WakeLock wake;
    public android.os.IBinder onBind(Intent i){return null;}
    @Override public void onCreate(){super.onCreate();
        channels(this);
        wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,getPackageName()+":trip-queue");wake.setReferenceCounted(false);
    }
    private static void channels(Context context){
        NotificationManager n=context.getSystemService(NotificationManager.class);
        n.createNotificationChannel(new NotificationChannel("trip-progress","Trip planning progress",NotificationManager.IMPORTANCE_LOW));
        n.createNotificationChannel(new NotificationChannel("trip-ready","Trip planning updates",NotificationManager.IMPORTANCE_DEFAULT));
    }
    private static PendingIntent open(Context context,String car,String hist,String site){
        Intent i=new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra("tripQueueOpen",true).putExtra("queueCar",car).putExtra("queueTrip",hist).putExtra("queueSite",site);
        return PendingIntent.getActivity(context,(site.isEmpty()?car:site).hashCode(),i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    private static Notification note(Context context,String title,String text,String car,String hist,String site,boolean progress){
        Notification.Builder b=new Notification.Builder(context,progress?"trip-progress":"trip-ready")
            .setSmallIcon(android.R.drawable.ic_menu_directions).setContentTitle(title).setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text)).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(open(context,car,hist,site)).setAutoCancel(!progress).setOnlyAlertOnce(progress).setOngoing(progress);
        return b.build();
    }
    public static void alert(Context context,String title,String text,String car,String hist,String site){channels(context);context.getSystemService(NotificationManager.class).notify(site.isEmpty()?READY:CHECK,note(context,title,text,car,hist,site,false));}
    @Override public int onStartCommand(Intent i,int flags,int id){
        if(i==null){stopSelf();return START_NOT_STICKY;}
        String action=i.getStringExtra("action"),title=value(i,"title"),text=value(i,"text"),car=value(i,"car"),hist=value(i,"trip"),site=value(i,"site");
        if("stop".equals(action)||"finish".equals(action)){
            stopForeground(STOP_FOREGROUND_REMOVE);if(wake.isHeld())wake.release();
            if("finish".equals(action))alert(this,title,text,car,hist,"");
            stopSelf();return START_NOT_STICKY;
        }
        if("ready".equals(action)||"check".equals(action)){
            alert(this,title,text,car,hist,site);
            if(!wake.isHeld())stopSelf();return START_NOT_STICKY;
        }
        startForeground(PROGRESS,note(this,title,text,car,hist,"",true),ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        if(!wake.isHeld())wake.acquire(30*60*1000L);else {wake.release();wake.acquire(30*60*1000L);}
        return START_NOT_STICKY;
    }
    private static String value(Intent i,String key){String s=i.getStringExtra(key);return s==null?"":s.substring(0,Math.min(240,s.length()));}
    @Override public void onTimeout(int startId,int fgsType){MainActivity.queueTimeout();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
    @Override public void onTaskRemoved(Intent i){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
    @Override public void onDestroy(){if(wake!=null&&wake.isHeld())wake.release();super.onDestroy();}
}
