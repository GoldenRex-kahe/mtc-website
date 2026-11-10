# Running MTC on Pterodactyl (KovaiHost)

The site has no npm packages, so any **Node.js egg** works (often called "Generic Node.js" or "NodeJS").

1. Create the server with the Node.js egg, **Node 20 or newer** (22 or 24 is best).
2. Upload everything in this folder **except** `.env` and `data/backups/` (you can upload `data/` to keep your events and members).
3. In the panel's file manager create `.env` and fill it in (Discord token, client secret, guild ID, role IDs, `ADMIN_PASSWORD`, `SESSION_SECRET`).
   Set `PUBLIC_URL=https://your-domain` so Discord login and links point to the right address.
4. Startup / main file: `server.js` (or the egg's "npm start" option; `package.json` has it).
5. Start it. The console shows `listening on 0.0.0.0:<port>`.

Nothing else is needed:

- **Port**: inside the panel the site always uses the port Pterodactyl gives it (`SERVER_PORT`) and listens on all addresses, even if `.env` (copied from a PC) says `PORT=4500`.
- **Stop button**: the site saves its data and shuts down cleanly on Stop (Ctrl+C / SIGTERM, or typing `stop` in the console). The console also takes `save` and `backup`.
- **Health check**: `GET /healthz` answers `ok` (for uptime monitors).
- **Data folder**: `data/` by default; `DATA_DIR=/home/container/data` in `.env` moves it.

## Domain with HTTPS

Pterodactyl gives the server an `ip:port`. To serve it on your domain through Cloudflare:

1. In Cloudflare DNS add an **A record** for the subdomain (for example `mtc`) pointing to the node's IP, **proxied** (orange cloud).
2. Rules → **Origin Rules** → create a rule for that hostname → **Destination port** = your server's port.
3. SSL/TLS mode **Flexible** (the panel serves plain HTTP), or Full if the host gives you a certificate.

Or ask KovaiHost if they already offer a domain / reverse proxy for servers.
