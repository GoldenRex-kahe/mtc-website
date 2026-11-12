# MTC Server Control (Minecraft plugin)

Opens and closes the event server on the website's schedule (each event's **daily server hours**, or the
OPEN NOW / CLOSE NOW buttons in **Admin > Events > Server control**).

- At closing time everyone except staff is kicked with a message and cannot join until the next opening.
- Staff can always join: `/op`, the `mtc.bypass` permission, or the LuckPerms groups admin, dev, founder, owner
  (LuckPerms gives group members `group.<name>`; edit `bypass-permissions` in config.yml for other groups).
- The server-list MOTD shows OPEN / CLOSED, the opening time and the day (Day 3 of 7).
- Before closing: chat warnings with a sound at 30, 15, 10, 5, 2 and 1 minutes, big titles in the last 5 minutes,
  a countdown boss bar for the last 10 minutes and a 10-to-1 seconds countdown. A title when it opens.
- World backups to Google Drive: every few hours and right after the server closes; keeps the newest 10.

## Install
1. Download `MTCServerControl.jar` from Admin > Events > Server control and put it in `plugins/` (Paper, Purpur or Spigot 1.18+, Java 17+). Restart.
2. In `plugins/MTCServerControl/config.yml` paste the key from the same admin card into `key:`.
   Optionally set `event:` to the event slug (e.g. `hide-and-seek`); empty = the live event.
3. Run `mtcserver reload` in the console. The admin card shows PLUGIN CONNECTED.
4. Geyser (Bedrock): `passthrough-motd: true` in Geyser's config so Bedrock players see the same MOTD.

## Google Drive backups (one-time setup, about 5 minutes)
The plugin signs in with Google's "TV" sign-in (a short code you type at google.com/device) and asks only for
**drive.file**: it can see and change only the files it makes itself (its "MTC Backups" folder), nothing else in the Drive.

1. Go to https://console.cloud.google.com/ and make a project (any name, e.g. "MTC Backups").
2. APIs & Services → Library → **Google Drive API** → Enable.
3. APIs & Services → OAuth consent screen (Google Auth Platform) → External → fill in the app name and your email.
   Under **Audience**, press **Publish app** (otherwise Google signs you out every 7 days). It is fine that it is not verified:
   only you sign in.
4. Credentials → Create credentials → **OAuth client ID** → type **TVs and Limited Input devices** → Create.
5. Put the Client ID and Client secret in `config.yml` under `backup.google`, set `backup.enabled: true`, then run `mtcserver reload`.
6. Run `mtcserver backup link` in the console. Open the link it shows, type the code, pick the Google account and press **Allow**.
   (Google may say the app is unverified: Advanced → Go to … (unsafe) — it is your own app.)
7. Run `mtcserver backup now` to test. The zip appears in "MTC Backups" in that Google Drive.

The sign-in is saved in `plugins/MTCServerControl/google-drive.json` — keep that file private. `mtcserver backup unlink` removes it.
Backups need free space on the server for one zip of the worlds while it uploads.
`mtcserver backup` shows the status; the website's Admin → Events → Server control card shows the last backup too.

Commands (`mtc.admin`, ops by default): `/mtcserver status`, `/mtcserver refresh`, `/mtcserver reload`,
`/mtcserver backup` (status), `/mtcserver backup now`, `/mtcserver backup link`, `/mtcserver backup unlink` (alias `/mtcs`).

If the website cannot be reached, the plugin keeps its last known state (a fresh start with no answer leaves the server open).

## Build
`build.bat` (needs JDK 17+; compiles every file in `src`). `libs/` has the Spigot API and Gson, used only to compile.
