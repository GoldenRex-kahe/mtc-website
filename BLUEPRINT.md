# MTC Website Blueprint
Minecraft Tamil Community: event management, creator directory, event showcase.

Status: DRAFT for review. Nothing is built yet. Each feature is tagged so you can cut it:
- **[CORE]**: needed for the site to make sense
- **[NICE]**: useful, can come later
- **[EXTRA]**: cut first if you want it smaller

---

## 1. Goals
1. Run monthly events without chaos (registration, teams, schedule, results).
2. Show every creator in the Discord server with their YouTube channel.
3. Keep a permanent showcase of past events (screenshots, videos, winners).
4. Never lose data again (Dec 2025 lesson).

## 2. History to display
| # | Event | Date | Status |
|---|-------|------|--------|
| 1 | 7 Days Civilization | Dec 2025 | Terminated on day 3 (hosting issue, data loss) |
| 2 | Hide and Seek | Nov 2026 | Completed |

Both appear in the showcase. Event 1 gets a "Lessons learned" note. Event 2 gets the full gallery.

---

## 3. Public pages (visitors, no login)
| Page | What it shows | Tag |
|------|---------------|-----|
| Home | Hero, next event + countdown, latest showcase, creator count, Discord join button | CORE |
| Events | List of upcoming, live, and past events | CORE |
| Event detail | Rules, dates, slots, prize, registration button, participants | CORE |
| Creators | Grid of all creators: Discord avatar, name, channel link, subscriber count, search and filter | CORE |
| Creator profile | Bio, channel link, latest videos, events they joined | NICE |
| Showcase | Past events with screenshot gallery, YouTube videos by each creator, winners, highlights | CORE |
| About / Rules | Community rules, how to join, staff list | CORE |
| Tamil / English toggle | Language switch | NICE |

## 4. Member features (login with Discord)
| Feature | Tag |
|---------|-----|
| Login with Discord (no passwords to manage) | CORE |
| Register for an event (solo or team) | CORE |
| Edit own creator profile (channel link, bio, social links) | CORE |
| Submit own event video or screenshots to the showcase (admin approves) | NICE |
| Vote for best video / best build | EXTRA |
| Notifications of event start via Discord DM | EXTRA |

## 5. Admin dashboard (staff only)
| Feature | Tag |
|---------|-----|
| Create, edit, and close events (title, rules, dates, slots, banner) | CORE |
| Event status flow: Draft, Registration Open, Live, Completed, Cancelled | CORE |
| Approve or reject registrations | CORE |
| Team builder (manual assign or random) | NICE |
| Schedule and bracket (Hide and Seek rounds, elimination) | NICE |
| Enter results, winners, scoreboard | CORE |
| Showcase manager (upload screenshots, add YouTube links, approve submissions) | CORE |
| Creator manager (sync from Discord, hide or feature creators) | CORE |
| Roles: Owner, Admin, Organizer, Moderator | NICE |
| One-click full data export (JSON/CSV) and daily backup | CORE |
| Announcement post that also pushes to a Discord channel | NICE |
| Server info card per event (IP, version, plugins, world download link) | EXTRA |
| Event templates (reuse Hide and Seek setup next month) | EXTRA |

## 6. Discord integration
| Piece | How | Tag |
|-------|-----|-----|
| Login | Discord OAuth | CORE |
| Creator list | A bot reads members that have the **Creator** role: avatar, display name, join date | CORE |
| Channel link | Creator adds their YouTube link in profile; site fetches channel name, avatar, subscribers via the YouTube Data API | CORE |
| Auto-sync | Bot refreshes the list every few hours; role removed in Discord means hidden on site | NICE |
| Event announcements | Bot or webhook posts new events and results to a channel | NICE |
| Slash commands (`/events`, `/register`) | Bot commands | EXTRA |

Needs from you: a Discord application and bot token, plus the server ID and Creator role ID.

## 7. Showcase design (your key request)
Per event page:
- Cover banner and summary (dates, participants, winners)
- **Screenshot gallery** (grid and lightbox)
- **Creator videos**: embedded YouTube videos, grouped by creator, with a link to their channel
- Highlight reel (one featured video)
- Winners podium and final standings
- Stats (players, days, rounds)

Images are stored in object storage (not on the web server), so they survive host problems.

## 8. Data model (main tables)
- `users`: discord_id, name, avatar, role
- `creators`: user, youtube_url, channel_name, subscribers, bio, visible
- `events`: title, slug, type, description, rules, start/end, status, slots, banner
- `registrations`: event, user, team, status
- `teams`: event, name, members
- `rounds` / `matches`: event, round, results (NICE)
- `results`: event, placement, user or team, points
- `media`: event, type (image/video), url, creator, approved
- `announcements`: title, body, posted_to_discord

## 9. Tech stack (recommended)
| Layer | Choice | Why |
|-------|--------|-----|
| Frontend + API | Next.js (React) | One codebase, good SEO, easy to maintain |
| Database | Supabase Postgres | Managed, automatic backups, off your host |
| Images | Supabase Storage | Not tied to one server |
| Login | Discord OAuth via Supabase Auth | No passwords |
| Hosting | Vercel | Free tier, auto deploys |
| Bot | Small Node.js discord.js bot | Role sync, announcements |
| Videos | YouTube embeds | No video hosting cost |

Estimated running cost: free to start. A custom domain is about ₹800/year.

## 10. Data safety (fixing the Dec 2025 problem)
1. Database on a managed service, not on the game or web host.
2. Daily automatic backups plus a weekly export saved to Google Drive.
3. Admin "Export everything" button.
4. Images and event records are never deleted, only archived.
5. Minecraft world files are stored separately, with a link in the event.

## 11. Look and feel
Dark, Minecraft-inspired style (pixel font for headings, block-style cards), green and stone palette, mobile-first because most of your audience is on phones. Tamil text support throughout.

## 12. Build phases
| Phase | Scope | Tags included |
|-------|-------|---------------|
| 1 | Home, Events, Event detail, Showcase, Creators (manual data), About | CORE public pages |
| 2 | Discord login, registration, admin dashboard, results, backups | CORE member and admin |
| 3 | Discord bot creator sync, YouTube data, announcements | CORE and NICE integration |
| 4 | Teams, brackets, submissions, roles, Tamil toggle | NICE |
| 5 | Voting, DMs, slash commands, templates | EXTRA |

Phase 1 alone gives you a live site with both past events in the showcase.

---

## 13. Questions for you
1. Do you have a domain name, or should I plan for a free `*.vercel.app` address first?
2. Who is staff (how many admins)? Are roles needed or is one admin enough?
3. Do creators need to register as individuals, as teams, or both?
4. Should the event rules differ per event type (Hide and Seek vs Civilization), or one generic form?
5. Is the site in Tamil, English, or both?
6. Which items above would you cut? Suggest removals by section number.

---

## 14. Progress (updated 2026-11-05)

**Built (runs locally with `node server.js`, no installs needed):**

| Area | What works |
|------|-----------|
| Home | Hero, live events from the database with countdown, latest announcement, team, verified creators, showcase from real uploads |
| Event pages | `/event.html?slug=...`: details, rules, server info, day bar, register / withdraw, confirmed players, results, screenshot + video gallery, member uploads |
| Account | `/account.html`: Discord login, my events, creator profile (YouTube, Minecraft name, socials) sent for verification |
| Admin | `/admin.html`: create / edit / delete events (status flow, banner, results), approve registrations and teams, review showcase uploads, verify creator channels, announcements (also to Discord), backups and full export |
| About | `/about.html`: how to take part, rules, data promise, team |
| Data safety | One database file written safely, automatic daily backup (last 30 kept), backup before any delete, one-click export |
| Discord | Creator list synced from the Creator role, role checks for registering, announcements by the bot |

**Waiting on you (in `.env`, then restart):**
- `DISCORD_CLIENT_SECRET` and the redirect `http://localhost:4500/auth/callback` in the Developer Portal: turns on "Log in with Discord". Until then staff use `ADMIN_PASSWORD`.
- `DISCORD_ANNOUNCE_CHANNEL_ID`: lets the bot post announcements.
- `DISCORD_INVITE_URL`: makes the JOIN buttons open your server.
- Immortal_JK's Discord user ID in `ADMIN_DISCORD_IDS` (not found in the Creator list).
- Reset the bot token (it was pasted in chat).

**Not done yet:** putting the site online (hosting + a domain), Tamil language toggle, voting, Discord slash commands. The stack is plain HTML + a small Node server with a file database instead of Supabase / Vercel, so it can move to any host that runs Node.
