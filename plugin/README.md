# MTC Server Control (Minecraft plugin)

Opens and closes the event server on the website's schedule (each event's **daily server hours**, or the
OPEN NOW / CLOSE NOW buttons in **Admin > Events > Server control**).

- At closing time everyone except staff is kicked with a message and cannot join until the next opening.
- Staff can always join: `/op`, the `mtc.bypass` permission, or the LuckPerms groups admin, dev, founder, owner
  (LuckPerms gives group members `group.<name>`; edit `bypass-permissions` in config.yml for other groups).
- The server-list MOTD shows OPEN / CLOSED, the opening time and the day (Day 3 of 7).
- Players get warnings 10, 5 and 1 minutes before closing.

## Install
1. Download `MTCServerControl.jar` from Admin > Events > Server control and put it in `plugins/` (Paper, Purpur or Spigot 1.18+, Java 17+). Restart.
2. In `plugins/MTCServerControl/config.yml` paste the key from the same admin card into `key:`.
   Optionally set `event:` to the event slug (e.g. `hide-and-seek`); empty = the live event.
3. Run `mtcserver reload` in the console. The admin card shows PLUGIN CONNECTED.
4. Geyser (Bedrock): `passthrough-motd: true` in Geyser's config so Bedrock players see the same MOTD.

Commands (`mtc.admin`, ops by default): `/mtcserver status`, `/mtcserver refresh`, `/mtcserver reload` (alias `/mtcs`).

If the website cannot be reached, the plugin keeps its last known state (a fresh start with no answer leaves the server open).

## Build
`build.bat` (needs JDK 17+). `libs/` has the Spigot API and Gson, used only to compile.
