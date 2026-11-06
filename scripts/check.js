'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', '.runtime', 'dist', 'node_modules'].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(p);
    else if (p.endsWith('.js') || p.endsWith('.gs')) new vm.Script(fs.readFileSync(p, 'utf8'), { filename: p });
    else if (p.endsWith('.json')) JSON.parse(fs.readFileSync(p, 'utf8'));
  }
}
visit(path.join(__dirname, '..'));
console.log('JavaScript syntax and JSON checks passed.');
