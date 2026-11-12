package cloud.kovaihost.mtc;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;

import java.io.*;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Duration;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * World backups to Google Drive.
 * Sign-in uses Google's "TV and limited input" flow: /mtcserver backup link shows a short code to type at google.com/device.
 * The plugin only asks for the drive.file permission, so it can see and change only the files it creates itself
 * (its "MTC Backups" folder) and nothing else in the Drive.
 */
final class DriveBackup {
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm").withZone(ZoneId.of("Asia/Kolkata"));
    private static final int CHUNK = 16 * 256 * 1024;   // 4 MB pieces (Google wants multiples of 256 KB)

    private final MTCServerControl plugin;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final File stateFile;
    private final AtomicBoolean running = new AtomicBoolean();
    private JsonObject state = new JsonObject();   // refresh_token, folderId, last backup info
    private String access; private long accessUntil;
    volatile String progress = "";

    DriveBackup(MTCServerControl plugin) {
        this.plugin = plugin;
        this.stateFile = new File(plugin.getDataFolder(), "google-drive.json");
        try { if (stateFile.exists()) state = JsonParser.parseString(new String(Files.readAllBytes(stateFile.toPath()), StandardCharsets.UTF_8)).getAsJsonObject(); }
        catch (Exception e) { plugin.getLogger().warning("Could not read google-drive.json: " + e.getMessage()); }
    }

    private ConfigurationSection cfg() { ConfigurationSection c = plugin.getConfig().getConfigurationSection("backup"); return c != null ? c : plugin.getConfig().createSection("backup"); }
    boolean enabled() { return cfg().getBoolean("enabled", false); }
    boolean linked() { return state.has("refresh_token"); }
    boolean busy() { return running.get(); }
    long lastAt() { return state.has("lastAt") ? state.get("lastAt").getAsLong() : 0; }
    String lastInfo() {
        if (!state.has("lastAt")) return "never";
        String err = state.has("lastError") ? state.get("lastError").getAsString() : "";
        return STAMP.format(java.time.Instant.ofEpochMilli(lastAt())) + (err.isEmpty() ? " OK, " + human(state.has("lastSize") ? state.get("lastSize").getAsLong() : 0) : " FAILED: " + err);
    }
    /** for the website's admin card */
    String statusQuery() {
        StringBuilder q = new StringBuilder("&bk=" + (enabled() ? (linked() ? "on" : "unlinked") : "off"));
        if (state.has("lastOkAt")) q.append("&bkok=").append(state.get("lastOkAt").getAsLong()).append("&bksize=").append(state.has("lastSize") ? state.get("lastSize").getAsLong() : 0);
        if (state.has("lastError") && !state.get("lastError").getAsString().isEmpty()) q.append("&bkerr=").append(URLEncoder.encode(state.get("lastError").getAsString(), StandardCharsets.UTF_8));
        if (busy()) q.append("&bkbusy=1");
        return q.toString();
    }

    private synchronized void save() {
        try { plugin.getDataFolder().mkdirs(); Files.write(stateFile.toPath(), state.toString().getBytes(StandardCharsets.UTF_8)); }
        catch (Exception e) { plugin.getLogger().warning("Could not save google-drive.json: " + e.getMessage()); }
    }

    // ------------------------------------------------------------------ sign-in (device flow)
    void link(CommandSender who) {
        String id = cfg().getString("google.client-id", "").trim(), secret = cfg().getString("google.client-secret", "").trim();
        if (id.isEmpty() || secret.isEmpty()) { tell(who, "§cFirst put backup.google.client-id and client-secret in config.yml (see the README), then /mtcserver reload."); return; }
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                JsonObject d = postForm("https://oauth2.googleapis.com/device/code", "client_id=" + enc(id) + "&scope=" + enc("https://www.googleapis.com/auth/drive.file"));
                if (!d.has("device_code")) { tell(who, "§cGoogle said: " + d); return; }
                String url = d.has("verification_url") ? d.get("verification_url").getAsString() : "https://www.google.com/device";
                tell(who, "§eOpen §f" + url + " §eand type the code §f§l" + d.get("user_code").getAsString() + "§e, then allow access. Waiting...");
                long until = System.currentTimeMillis() + d.get("expires_in").getAsLong() * 1000; int every = Math.max(5, d.has("interval") ? d.get("interval").getAsInt() : 5);
                while (System.currentTimeMillis() < until) {
                    Thread.sleep(every * 1000L);
                    JsonObject t = postForm("https://oauth2.googleapis.com/token", "client_id=" + enc(id) + "&client_secret=" + enc(secret) + "&device_code=" + enc(d.get("device_code").getAsString())
                            + "&grant_type=" + enc("urn:ietf:params:oauth:grant-type:device_code"));
                    if (t.has("refresh_token")) {
                        state.addProperty("refresh_token", t.get("refresh_token").getAsString()); state.remove("folderId"); save();
                        access = t.get("access_token").getAsString(); accessUntil = System.currentTimeMillis() + (t.get("expires_in").getAsLong() - 60) * 1000;
                        tell(who, "§aGoogle Drive is linked. Backups go to the folder \"" + folderName() + "\". Try /mtcserver backup now");
                        return;
                    }
                    String e = t.has("error") ? t.get("error").getAsString() : "";
                    if (e.equals("slow_down")) every += 5; else if (!e.equals("authorization_pending")) { tell(who, "§cGoogle sign-in failed: " + e); return; }
                }
                tell(who, "§cThe code expired. Run /mtcserver backup link again.");
            } catch (Exception ex) { tell(who, "§cGoogle sign-in failed: " + ex.getMessage()); }
        });
    }
    void unlink(CommandSender who) { state.remove("refresh_token"); state.remove("folderId"); access = null; save(); tell(who, "§eGoogle Drive is unlinked on this server. (You can also remove the app's access in your Google account settings.)"); }

    private String token() throws Exception {
        if (access != null && System.currentTimeMillis() < accessUntil) return access;
        JsonObject t = postForm("https://oauth2.googleapis.com/token", "client_id=" + enc(cfg().getString("google.client-id", "")) + "&client_secret=" + enc(cfg().getString("google.client-secret", ""))
                + "&refresh_token=" + enc(state.get("refresh_token").getAsString()) + "&grant_type=refresh_token");
        if (!t.has("access_token")) throw new IOException("Google refused the saved sign-in (" + (t.has("error") ? t.get("error").getAsString() : t) + "). Run /mtcserver backup link again.");
        access = t.get("access_token").getAsString(); accessUntil = System.currentTimeMillis() + (t.get("expires_in").getAsLong() - 60) * 1000;
        return access;
    }

    // ------------------------------------------------------------------ the backup
    /** called every minute: is a timed backup due? */
    void maybeRun() {
        if (!enabled() || !linked() || busy()) return;
        double hours = cfg().getDouble("every-hours", 6);
        if (hours > 0 && System.currentTimeMillis() - lastAt() >= hours * 3600_000L) run(Bukkit.getConsoleSender(), "timed");
    }

    void run(CommandSender who, String reason) {
        if (!linked()) { tell(who, "§cGoogle Drive is not linked yet: /mtcserver backup link"); return; }
        if (!running.compareAndSet(false, true)) { tell(who, "§eA backup is already running: " + progress); return; }
        // 1) on the main thread: save the worlds and pause auto-save while they are copied
        List<World> worlds = new ArrayList<>(); List<String> only = cfg().getStringList("worlds");
        for (World w : Bukkit.getWorlds()) if (only.isEmpty() || only.contains(w.getName())) worlds.add(w);
        Map<World, Boolean> auto = new HashMap<>();
        for (World w : worlds) { w.save(); auto.put(w, w.isAutoSave()); w.setAutoSave(false); }
        if (cfg().getBoolean("announce", true)) Bukkit.broadcastMessage(MTCServerControl.P + "§7Backing up the world... §8(a small lag spike is normal)");
        tell(who, "§eBackup started (" + reason + ").");
        // 2) off the main thread: zip, then upload
        Bukkit.getScheduler().runTaskLaterAsynchronously(plugin, () -> {
            File zip = null; long size = 0; String err = "";
            try {
                File dir = new File(plugin.getDataFolder(), "backup-temp"); dir.mkdirs();
                for (File old : Objects.requireNonNull(dir.listFiles())) old.delete();
                String name = cfg().getString("name-prefix", "mtc-backup") + "_" + STAMP.format(java.time.Instant.now()) + ".zip";
                zip = new File(dir, name);
                progress = "zipping"; zipWorlds(worlds, zip);
                Bukkit.getScheduler().runTask(plugin, () -> auto.forEach(World::setAutoSave));   // copying is done: auto-save back on
                size = zip.length();
                progress = "uploading 0%"; upload(zip, name);
                progress = "cleaning up"; prune();
            } catch (Exception ex) {
                err = ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
                plugin.getLogger().warning("Backup failed: " + err);
            } finally {
                Bukkit.getScheduler().runTask(plugin, () -> auto.forEach(World::setAutoSave));
                if (zip != null) zip.delete();
                state.addProperty("lastAt", System.currentTimeMillis()); state.addProperty("lastError", err);
                if (err.isEmpty()) { state.addProperty("lastOkAt", System.currentTimeMillis()); state.addProperty("lastSize", size); }
                save(); progress = ""; running.set(false);
                final String e2 = err; final long s2 = size;
                tell(who, e2.isEmpty() ? "§aBackup uploaded to Google Drive (" + human(s2) + ")." : "§cBackup failed: " + e2);
                if (e2.isEmpty() && cfg().getBoolean("announce", true)) Bukkit.getScheduler().runTask(plugin, () -> Bukkit.broadcastMessage(MTCServerControl.P + "§aWorld backup saved."));
            }
        }, 40L);
    }

    private void zipWorlds(List<World> worlds, File out) throws IOException {
        Path root = Bukkit.getWorldContainer().toPath().toAbsolutePath().normalize();
        try (ZipOutputStream z = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(out), 1 << 16))) {
            z.setLevel(Deflater.BEST_SPEED);
            for (World w : worlds) {
                Path dir = w.getWorldFolder().toPath().toAbsolutePath().normalize();
                Files.walkFileTree(dir, new SimpleFileVisitor<Path>() {
                    @Override public FileVisitResult visitFile(Path f, BasicFileAttributes a) throws IOException {
                        String n = f.getFileName().toString();
                        if (n.equals("session.lock")) return FileVisitResult.CONTINUE;
                        String rel = root.relativize(f).toString().replace('\\', '/');
                        try (InputStream in = Files.newInputStream(f)) { z.putNextEntry(new ZipEntry(rel)); in.transferTo(z); z.closeEntry(); }
                        catch (IOException skipped) { /* a file that is busy is skipped, the rest still backs up */ }
                        return FileVisitResult.CONTINUE;
                    }
                });
            }
        }
    }

    private String folderName() { return cfg().getString("google.folder", "MTC Backups"); }

    private String folder() throws Exception {
        if (state.has("folderId")) return state.get("folderId").getAsString();
        JsonObject meta = new JsonObject(); meta.addProperty("name", folderName()); meta.addProperty("mimeType", "application/vnd.google-apps.folder");
        HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create("https://www.googleapis.com/drive/v3/files?fields=id")).header("Authorization", "Bearer " + token())
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(meta.toString())).timeout(Duration.ofSeconds(30)).build(), HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() >= 300) throw new IOException("could not make the Drive folder: " + r.statusCode() + " " + r.body());
        String id = JsonParser.parseString(r.body()).getAsJsonObject().get("id").getAsString();
        state.addProperty("folderId", id); save(); return id;
    }

    /** resumable upload, in pieces, retrying a piece a few times */
    private void upload(File f, String name) throws Exception {
        long total = f.length();
        JsonObject meta = new JsonObject(); meta.addProperty("name", name); JsonArray parents = new JsonArray(); parents.add(folder()); meta.add("parents", parents);
        HttpResponse<String> start = http.send(HttpRequest.newBuilder(URI.create("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id"))
                .header("Authorization", "Bearer " + token()).header("Content-Type", "application/json; charset=UTF-8")
                .header("X-Upload-Content-Type", "application/zip").header("X-Upload-Content-Length", String.valueOf(total))
                .POST(HttpRequest.BodyPublishers.ofString(meta.toString())).timeout(Duration.ofSeconds(30)).build(), HttpResponse.BodyHandlers.ofString());
        if (start.statusCode() == 404 && state.has("folderId")) { state.remove("folderId"); save(); throw new IOException("the Drive folder was deleted; it will be made again next time"); }
        String session = start.headers().firstValue("Location").orElseThrow(() -> new IOException("Google did not start the upload: " + start.statusCode() + " " + start.body()));
        long sent = 0; int fails = 0; byte[] buf = new byte[CHUNK];
        try (RandomAccessFile in = new RandomAccessFile(f, "r")) {
            while (sent < total) {
                int n = (int) Math.min(CHUNK, total - sent); in.seek(sent); in.readFully(buf, 0, n);
                try {
                    HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create(session)).header("Content-Range", "bytes " + sent + "-" + (sent + n - 1) + "/" + total)
                            .PUT(HttpRequest.BodyPublishers.ofByteArray(Arrays.copyOf(buf, n))).timeout(Duration.ofMinutes(5)).build(), HttpResponse.BodyHandlers.ofString());
                    if (r.statusCode() == 200 || r.statusCode() == 201) { sent = total; break; }
                    if (r.statusCode() == 308) {   // Google says how much it has
                        sent = r.headers().firstValue("Range").map(v -> Long.parseLong(v.replaceAll(".*-", "")) + 1).orElse(0L);
                        fails = 0; progress = "uploading " + (sent * 100 / total) + "%"; continue;
                    }
                    if (r.statusCode() >= 500 || r.statusCode() == 429) throw new IOException("Google " + r.statusCode());
                    throw new IOException("upload refused: " + r.statusCode() + " " + r.body());
                } catch (IOException ex) {
                    if (++fails > 6 || ex.getMessage() != null && ex.getMessage().startsWith("upload refused")) throw ex;
                    Thread.sleep(2000L * fails);
                    // ask Google how far it got, then carry on from there
                    HttpResponse<String> q = http.send(HttpRequest.newBuilder(URI.create(session)).header("Content-Range", "bytes */" + total)
                            .PUT(HttpRequest.BodyPublishers.noBody()).timeout(Duration.ofSeconds(30)).build(), HttpResponse.BodyHandlers.ofString());
                    if (q.statusCode() == 200 || q.statusCode() == 201) { sent = total; break; }
                    sent = q.headers().firstValue("Range").map(v -> Long.parseLong(v.replaceAll(".*-", "")) + 1).orElse(0L);
                }
            }
        }
    }

    /** keep only the newest N backups in the folder */
    private void prune() throws Exception {
        int keep = Math.max(1, cfg().getInt("keep", 10));
        String q = enc("'" + folder() + "' in parents and trashed=false and mimeType='application/zip'");
        HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create("https://www.googleapis.com/drive/v3/files?q=" + q + "&orderBy=createdTime%20desc&pageSize=200&fields=files(id,name)"))
                .header("Authorization", "Bearer " + token()).GET().timeout(Duration.ofSeconds(30)).build(), HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() >= 300) return;
        JsonArray files = JsonParser.parseString(r.body()).getAsJsonObject().getAsJsonArray("files");
        for (int i = keep; i < files.size(); i++) {
            String id = files.get(i).getAsJsonObject().get("id").getAsString();
            http.send(HttpRequest.newBuilder(URI.create("https://www.googleapis.com/drive/v3/files/" + id)).header("Authorization", "Bearer " + token()).DELETE().timeout(Duration.ofSeconds(30)).build(), HttpResponse.BodyHandlers.discarding());
        }
    }

    // ------------------------------------------------------------------ helpers
    private JsonObject postForm(String url, String body) throws Exception {
        HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create(url)).header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body)).timeout(Duration.ofSeconds(20)).build(), HttpResponse.BodyHandlers.ofString());
        JsonElement e = JsonParser.parseString(r.body().isEmpty() ? "{}" : r.body());
        return e.isJsonObject() ? e.getAsJsonObject() : new JsonObject();
    }
    private void tell(CommandSender who, String msg) { Bukkit.getScheduler().runTask(plugin, () -> { if (who != null) who.sendMessage(MTCServerControl.P + msg); if (who != Bukkit.getConsoleSender()) plugin.getLogger().info(msg.replaceAll("§.", "")); }); }
    private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }
    static String human(long b) { return b >= 1L << 30 ? String.format("%.2f GB", b / (double) (1L << 30)) : b >= 1L << 20 ? String.format("%.1f MB", b / (double) (1L << 20)) : (b / 1024) + " KB"; }
}
