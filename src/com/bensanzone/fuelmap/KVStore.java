package com.bensanzone.fuelmap;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

/** Never truncate the last good record before a replacement is ready. */
final class KVStore {
    private KVStore() { }
    static void write(File target, String value, boolean durable) throws Exception {
        byte[] bytes=value.getBytes(StandardCharsets.UTF_8);
        File temp=File.createTempFile(".kv-", ".tmp", target.getParentFile());
        try {
            try (FileOutputStream out=new FileOutputStream(temp)) {
                out.write(bytes);
                if(durable)out.getFD().sync();
            }
            try { Files.move(temp.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING); }
            catch(AtomicMoveNotSupportedException e) { Files.move(temp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING); }
        } finally { if(temp.exists())temp.delete(); }
    }
}
