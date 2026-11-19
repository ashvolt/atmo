// Headless smoke test: loads the app, optionally clicks Simulate, saves screenshots and console errors.
// usage: node scripts/shot.mjs <url> <outdir> [actions...]
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const [url = 'http://localhost:5173/', out = 'shots', ...actions] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1600,900'],
  defaultViewport: { width: 1600, height: 900 },
  protocolTimeout: 600000,
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
await page.goto(url, { waitUntil: 'networkidle2', timeout: 180000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(6000);
await page.screenshot({ path: `${out}/01-start.png` });
let n = 2;
for (const a of actions) {
  const cmd = a.slice(0, a.indexOf('=')), arg = a.slice(a.indexOf('=') + 1);
  if (cmd === 'wait') await sleep(Number(arg));
  else if (cmd === 'click') await page.evaluate((sel) => { const el = [...document.querySelectorAll('button, .obj, .seg button')].find((b) => b.textContent.includes(sel)); el?.click(); }, arg);
  else if (cmd === 'select') { const [sel, val] = arg.split(':'); await page.evaluate((s, v) => { const el = document.querySelectorAll('select')[Number(s)]; el.value = v; el.dispatchEvent(new Event('change')); }, sel, val); }
  else if (cmd === 'shot') { await page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}-${arg}.png` }); }
  else if (cmd === 'eval') logs.push('[eval] ' + JSON.stringify(await page.evaluate(arg)));
}
writeFileSync(`${out}/console.txt`, logs.join('\n'));
console.log(logs.filter((l) => /error|fail|warn/i.test(l)).slice(0, 40).join('\n') || 'no errors');
await browser.close();
