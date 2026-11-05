'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hash } = require('../src/gateway/runtime');
const dir = path.resolve('.runtime');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const roles = { writer: ['read', 'write', 'propose'], reader: ['read'], proposer: ['read', 'propose'], verifier: ['read', 'verify'] };
const files = ['principals.json', ...Object.keys(roles).map(a => a + '.json')];
if (files.some(p => fs.existsSync(path.join(dir, p)))) throw new Error('Configuration exists; refusing to replace credentials.');
const principals = Object.entries(roles).map(([actor_id, permissions]) => {
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dir, actor_id + '.json'), JSON.stringify({ token }), { mode: 0o600, flag: 'wx' });
  return { actor_id, permissions, token_hash: hash(token) };
});
fs.writeFileSync(path.join(dir, 'principals.json'), JSON.stringify(principals, null, 2), { mode: 0o600, flag: 'wx' });
console.log('Local credentials created under ignored .runtime/ (mode 0600). No token values printed.');
