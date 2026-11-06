'use strict';
const fs = require('node:fs');
async function main() {
  const [credentialPath, requestPath] = process.argv.slice(2);
  if (!credentialPath || !requestPath) throw new Error('Usage: node scripts/client.js <slot-credential.json> <request.json>');
  const url = new URL(process.env.HIVEMIND_GATEWAY_URL || 'http://127.0.0.1:8787/gateway');
  const local = url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/gateway';
  const gas = url.protocol === 'https:' && url.hostname === 'script.google.com' && /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname);
  if ((!local && !gas) || url.search || url.username || url.password || url.hash) throw new Error('Only loopback or an approved Apps Script URL without query credentials is supported');
  const { token } = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  let response = await fetch(url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, request }), signal: AbortSignal.timeout(15000) });
  // ContentService serves output via a one-time GET redirect. Never forward bearer body to a redirect.
  if ([301, 302, 303].includes(response.status) && gas) {
    const redirect = new URL(response.headers.get('location'), url);
    if (redirect.protocol !== 'https:' || redirect.hostname !== 'script.googleusercontent.com') throw new Error('Unexpected gateway redirect; outcome unverified');
    response = await fetch(redirect, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  }
  if (response.status >= 300 && response.status < 400) throw new Error('Unexpected redirect; outcome unverified');
  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
main().catch(() => { console.error('Request failed; outcome unverified. Reread or retry the same operation_id. No credentials logged.'); process.exitCode = 1; });
