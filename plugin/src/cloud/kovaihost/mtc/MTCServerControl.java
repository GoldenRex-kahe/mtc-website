package cloud.kovaihost.mtc;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerLoginEvent;
import org.bukkit.event.server.ServerListPingEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * MTC Server Control.
 * Asks the MTC website every few seconds whether the event server should be open (the event's daily
 * server hours, or the OPEN NOW / CLOSE NOW buttons in the website admin). When it closes, everyone
 * except staff is kicked with a message and kept out until the next opening; the server-list MOTD
 * follows the same state.
 */
public final class MTCServerControl extends JavaPlugin implements Listener, TabCompleter {

    private static final String P = ChatColor.GOLD + "" + ChatColor.BOLD + "MTC " + ChatColor.DARK_GRAY + "» " + ChatColor.RESET;
    private static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("h:mm a").withZone(ZoneId.of("Asia/Kolkata"));

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
    private final AtomicBoolean polling = new AtomicBoolean();
    private BukkitTask pollTask, tickTask;

    // the last answer from the website
    private volatile boolean known, managed, open = true;
    private volatile String motd, kick = "", deny = "", forStaff = "", why = "", eventTitle = "", hours = "";
    private volatile long closesAt, opensAt;
    private volatile long lastOk;
    private volatile String lastError;
    private boolean warnedNoKey;

    // closing warnings already sent for the current closing time
    private final Set<Integer> warned = new HashSet<>();
    private long warnedFor, refreshedFor;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        getServer().getPluginManager().registerEvents(this, this);
        Objects.requireNonNull(getCommand("mtcserver")).setTabCompleter(this);
        start();
        getLogger().info("MTC Server Control is on. It checks " + site() + " every " + pollSeconds() + "s.");
    }

    @Override
    public void onDisable() {
        if (pollTask != null) pollTask.cancel();
        if (tickTask != null) tickTask.cancel();
    }

    private String site() { return getConfig().getString("site", "https://mtc.kovaihost.cloud").replaceAll("/+$", ""); }
    private int pollSeconds() { return Math.max(5, getConfig().getInt("poll-seconds", 15)); }

    private void start() {
        if (pollTask != null) pollTask.cancel();
        if (tickTask != null) tickTask.cancel();
        warnedNoKey = false;
        pollTask = Bukkit.getScheduler().runTaskTimerAsynchronously(this, this::poll, 20L, pollSeconds() * 20L);
        tickTask = Bukkit.getScheduler().runTaskTimer(this, this::tick, 20L, 20L);
    }

    // ------------------------------------------------------------------ talking to the website
    private void poll() {
        if (!polling.compareAndSet(false, true)) return;
        try {
            String key = getConfig().getString("key", "").trim();
            if (key.isEmpty()) {
                lastError = "No key in config.yml. Copy it from the website: Admin > Events > Server control.";
                if (!warnedNoKey) { getLogger().warning(lastError); warnedNoKey = true; }
                return;
            }
            Collection<? extends Player> online = Bukkit.getOnlinePlayers();
            int staff = 0; for (Player p : online) if (bypass(p)) staff++;
            String url = site() + "/api/plugin/state?event=" + enc(getConfig().getString("event", "").trim())
                    + "&players=" + online.size() + "&max=" + Bukkit.getMaxPlayers() + "&staff=" + staff
                    + "&mc=" + enc(Bukkit.getName() + " " + Bukkit.getBukkitVersion()) + "&v=" + enc(getDescription().getVersion());
            HttpRequest req = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(10))
                    .header("Authorization", "Bearer " + key).header("User-Agent", "MTCServerControl/" + getDescription().getVersion()).GET().build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonObject j = JsonParser.parseString(res.body()).getAsJsonObject();
            if (res.statusCode() != 200) {
                String msg = "Website said " + res.statusCode() + ": " + str(j, "error");
                if (!msg.equals(lastError)) getLogger().warning(msg);
                lastError = msg;
                return;
            }
            Bukkit.getScheduler().runTask(this, () -> apply(j));
        } catch (Exception ex) {
            String msg = "Cannot reach the website (" + ex.getClass().getSimpleName() + (ex.getMessage() != null ? ": " + ex.getMessage() : "") + "). Keeping the last state.";
            if (!msg.equals(lastError)) getLogger().warning(msg);
            lastError = msg;
        } finally {
            polling.set(false);
        }
    }

    private void apply(JsonObject j) {
        boolean wasOpen = !known || !managed || open;
        managed = bool(j, "managed");
        open = !managed || bool(j, "open");
        motd = managed ? str(j, "motd") : null;
        kick = str(j, "kick"); deny = str(j, "deny"); forStaff = str(j, "closedForStaff");
        why = str(j, "why"); hours = str(j, "hours");
        JsonElement ev = j.get("event");
        eventTitle = ev != null && ev.isJsonObject() ? str(ev.getAsJsonObject(), "title") : "";
        closesAt = time(j, "closesAt"); opensAt = time(j, "opensAt");
        known = true; lastOk = System.currentTimeMillis(); lastError = null;

        if (managed && !open) {
            if (wasOpen) getLogger().info("The server is now CLOSED (" + why + "). Kicking everyone except staff.");
            for (Player p : new ArrayList<>(Bukkit.getOnlinePlayers())) {
                if (bypass(p)) { if (wasOpen) p.sendMessage(P + forStaff); }
                else p.kickPlayer(kick.isEmpty() ? "The server is closed." : kick);
            }
        } else if (!wasOpen) {
            getLogger().info("The server is now OPEN (" + why + ").");
            Bukkit.broadcastMessage(P + ChatColor.GREEN + "The server is open for players now!");
        }
    }

    // ------------------------------------------------------------------ every second: warnings before closing
    private void tick() {
        if (!known || !managed || !open || closesAt <= 0) return;
        long left = closesAt - System.currentTimeMillis();
        if (warnedFor != closesAt) { warned.clear(); warnedFor = closesAt; }
        for (int m : getConfig().getIntegerList("warn-minutes")) {
            long at = m * 60_000L;
            if (left <= at && left > at - 60_000L && warned.add(m)) {
                Bukkit.broadcastMessage(P + ChatColor.YELLOW + "The server closes in " + ChatColor.WHITE + m + " minute" + (m == 1 ? "" : "s")
                        + ChatColor.YELLOW + " (" + CLOCK.format(Instant.ofEpochMilli(closesAt)) + "). Get to a safe spot!");
                if (m <= 1) for (Player p : Bukkit.getOnlinePlayers())
                    p.sendTitle(ChatColor.RED + "" + ChatColor.BOLD + "CLOSING SOON", ChatColor.YELLOW + "The server closes in 1 minute", 10, 70, 20);
            }
        }
        // closing time: ask the website straight away instead of waiting for the next check
        if (left <= 0 && refreshedFor != closesAt) {
            refreshedFor = closesAt;
            Bukkit.getScheduler().runTaskLaterAsynchronously(this, this::poll, 30L);
        }
    }

    // ------------------------------------------------------------------ players
    private boolean bypass(Player p) {
        if (getConfig().getBoolean("ops-bypass", true) && p.isOp()) return true;
        for (String perm : getConfig().getStringList("bypass-permissions")) if (p.hasPermission(perm)) return true;
        return false;
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onLogin(PlayerLoginEvent e) {
        if (e.getResult() != PlayerLoginEvent.Result.ALLOWED) return;
        if (known && managed && !open && !bypass(e.getPlayer()))
            e.disallow(PlayerLoginEvent.Result.KICK_OTHER, deny.isEmpty() ? "The server is closed." : deny);
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onPing(ServerListPingEvent e) {
        if (known && managed && motd != null && !motd.isEmpty() && getConfig().getBoolean("change-motd", true)) e.setMotd(motd);
    }

    // ------------------------------------------------------------------ /mtcserver
    @Override
    public boolean onCommand(CommandSender s, Command cmd, String label, String[] args) {
        String sub = args.length > 0 ? args[0].toLowerCase(Locale.ROOT) : "status";
        switch (sub) {
            case "reload":
                reloadConfig(); start();
                Bukkit.getScheduler().runTaskAsynchronously(this, this::poll);
                s.sendMessage(P + ChatColor.GREEN + "Config reloaded. Checking the website now...");
                return true;
            case "refresh":
                Bukkit.getScheduler().runTaskAsynchronously(this, this::poll);
                s.sendMessage(P + ChatColor.GREEN + "Checking the website now...");
                return true;
            case "status":
                s.sendMessage(P + ChatColor.WHITE + "MTC Server Control " + getDescription().getVersion());
                s.sendMessage(ChatColor.GRAY + " Website: " + ChatColor.WHITE + site()
                        + (lastOk > 0 ? ChatColor.GRAY + " (last answer " + (System.currentTimeMillis() - lastOk) / 1000 + "s ago)" : ChatColor.RED + " (no answer yet)"));
                if (lastError != null) s.sendMessage(ChatColor.RED + " Problem: " + lastError);
                if (!known) return true;
                if (!managed) { s.sendMessage(ChatColor.GRAY + " No live or upcoming event: the server is left open."); return true; }
                s.sendMessage(ChatColor.GRAY + " Event: " + ChatColor.YELLOW + eventTitle + (hours.isEmpty() ? "" : ChatColor.GRAY + "  hours " + ChatColor.WHITE + hours));
                s.sendMessage(ChatColor.GRAY + " State: " + (open ? ChatColor.GREEN + "OPEN" : ChatColor.RED + "CLOSED") + ChatColor.GRAY + " (" + why + ")");
                if (open && closesAt > 0) s.sendMessage(ChatColor.GRAY + " Closes at " + ChatColor.WHITE + CLOCK.format(Instant.ofEpochMilli(closesAt)));
                if (!open && opensAt > 0) s.sendMessage(ChatColor.GRAY + " Opens at " + ChatColor.WHITE + CLOCK.format(Instant.ofEpochMilli(opensAt)));
                return true;
            default:
                s.sendMessage(P + ChatColor.GRAY + "/" + label + " <status|refresh|reload>");
                return true;
        }
    }

    @Override
    public List<String> onTabComplete(CommandSender s, Command cmd, String alias, String[] args) {
        if (args.length != 1) return Collections.emptyList();
        List<String> out = new ArrayList<>();
        for (String o : new String[]{"status", "refresh", "reload"}) if (o.startsWith(args[0].toLowerCase(Locale.ROOT))) out.add(o);
        return out;
    }

    // ------------------------------------------------------------------ small helpers
    private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }
    private static String str(JsonObject j, String k) { JsonElement e = j.get(k); return e == null || e.isJsonNull() ? "" : e.getAsString(); }
    private static boolean bool(JsonObject j, String k) { JsonElement e = j.get(k); return e != null && !e.isJsonNull() && e.getAsBoolean(); }
    private static long time(JsonObject j, String k) {
        String v = str(j, k);
        try { return v.isEmpty() ? 0 : Instant.parse(v).toEpochMilli(); } catch (Exception e) { return 0; }
    }
}
