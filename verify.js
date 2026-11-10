// Admin tool: verify a creator's YouTube channel so they appear on the site (with their channel logo only).
// The admin page can do the same thing; this is the command-line version.
//   node verify.js add <discord-username|discord-id> <youtube-channel-url> [minecraft-username]
//   node verify.js remove <discord-username|discord-id>
//   node verify.js list
const fs = require('fs'), path = require('path');
const yt = require('./server/youtube');

const memberList = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'creators.json'), 'utf8')).members || null; } catch { return null; } };
(async () => {
  const [cmd, who, link, mc] = process.argv.slice(2);
  if (cmd === 'list') {
    for (const [k, v] of Object.entries(yt.readExtras())) if (k[0] !== '_') console.log((v.verified ? '  verified  ' : '  NOT shown ') + k.padEnd(24) + (v.channelName || '') + '  ' + (v.socials && v.socials.youtube || ''));
    return;
  }
  if (cmd === 'remove' && who) { if (!yt.unverifyCreator(who)) throw new Error('No entry for ' + who); console.log('\n  Hidden from the site: ' + who + '\n'); return; }
  if (cmd !== 'add' || !who || !link) throw new Error('Usage:\n    node verify.js add <discord-username|id> <youtube-channel-url> [minecraft-username]\n    node verify.js remove <discord-username|id>\n    node verify.js list');
  const members = memberList();
  if (members && !members.some(m => m.id === who || m.username.toLowerCase() === who.toLowerCase()))
    throw new Error(who + ' is not in the saved list of members with the Creator role. Check the spelling, or open /api/creators?refresh first.');
  const r = await yt.verifyCreator(who, link, { mc });
  console.log(`\n  Verified: ${who}\n    channel : ${r.name}\n    link    : ${r.url}\n    logo    : test-site${r.logo}\n    They now appear on the Creators page (no restart needed).\n`);
})().catch(e => { console.error('\n  x ' + e.message + '\n'); process.exitCode = 1; });
