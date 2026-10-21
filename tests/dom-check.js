/* Static wiring check: every element app.js reaches for must exist in index.html. */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'js', 'app.js'), 'utf8');

const htmlIds = new Set(Array.from(html.matchAll(/id="([^"]+)"/g), (m) => m[1]));
const usedIds = new Set(Array.from(app.matchAll(/\$\('([^']+)'\)/g), (m) => m[1]));
const missing = Array.from(usedIds).filter((id) => !htmlIds.has(id));

const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g), (m) => m[1]);
const missingFiles = scripts.filter((s) => !fs.existsSync(path.join(root, s)));

const styles = Array.from(html.matchAll(/href="([^"]+\.css)"/g), (m) => m[1]);
const missingCss = styles.filter((s) => !fs.existsSync(path.join(root, s)));

console.log('html ids     :', htmlIds.size);
console.log('ids used     :', usedIds.size);
console.log('missing ids  :', missing.length ? missing : 'none');
console.log('scripts      :', scripts.length, missingFiles.length ? 'MISSING ' + missingFiles : 'all present');
console.log('stylesheets  :', styles.length, missingCss.length ? 'MISSING ' + missingCss : 'all present');

const ok = missing.length === 0 && missingFiles.length === 0 && missingCss.length === 0;
console.log(ok ? 'wiring OK' : 'wiring BROKEN');
process.exit(ok ? 0 : 1);
