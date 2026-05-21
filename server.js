#!/usr/bin/env node
/* zuko-lens: PowerBook web prepress renderer */
const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const HOST = process.env.ZUKO_LENS_HOST || '10.0.1.2';
const PORT = parseInt(process.env.ZUKO_LENS_PORT || '8090', 10);
const CACHE = process.env.ZUKO_LENS_CACHE || '/home/zuko/opt/zuko-lens/cache';
const DEFAULT_WIDTH = parseInt(process.env.ZUKO_LENS_WIDTH || '700', 10);
const MIN_WIDTH = parseInt(process.env.ZUKO_LENS_MIN_WIDTH || '560', 10);
const MAX_WIDTH = parseInt(process.env.ZUKO_LENS_MAX_WIDTH || '760', 10);
const MAX_HEIGHT = parseInt(process.env.ZUKO_LENS_MAX_HEIGHT || '12000', 10);
const SLICE_H = parseInt(process.env.ZUKO_LENS_SLICE_HEIGHT || '600', 10);
const QUALITY = parseInt(process.env.ZUKO_LENS_JPEG_QUALITY || '62', 10);
const HOME_URL = process.env.ZUKO_LENS_HOME || 'https://weather.gov/55901';
const USER_AGENT = process.env.ZUKO_LENS_USER_AGENT || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

fs.mkdirSync(CACHE, { recursive: true });
const app = express();
let browserPromise;
const sessions = new Map();
const recent = [];

function esc(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function sid() { return crypto.randomBytes(8).toString('hex'); }
function clampWidth(w) { w = parseInt(w || DEFAULT_WIDTH, 10); if (!Number.isFinite(w)) w = DEFAULT_WIDTH; return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w)); }
function looksLikeUrl(u) { return /^https?:\/\//i.test(u) || /^[a-z0-9.-]+\.[a-z]{2,}([\/:?#].*)?$/i.test(u); }
function searchUrl(q, provider='yahoo') {
  q = String(q || '').trim();
  const e = encodeURIComponent(q);
  if (provider === 'yahoo') return `https://search.yahoo.com/search?p=${e}`;
  if (provider === 'bing') return `https://www.bing.com/search?q=${e}`;
  if (provider === 'frog') return `http://frogfind.com/?q=${e}`;
  if (provider === 'duck') return `https://duckduckgo.com/html/?q=${e}`;
  if (provider === 'google') return `https://www.google.com/search?q=${e}`;
  if (provider === 'lycos') return `https://www.lycos.com/search?q=${e}`;
  if (provider === 'ask') return `https://www.ask.com/web?q=${e}`;
  return `https://search.yahoo.com/search?p=${e}`;
}
function targetFromInput(u, provider) { u = String(u || '').trim(); if (!u) return HOME_URL; return looksLikeUrl(u) ? absUrl(u) : searchUrl(u, provider); }
function remember(sess) {
  const url = sess.url || '';
  if (!url || url === 'zuko-lens:home') return;
  const item = { url, title: sess.title || url, at: new Date().toISOString() };
  const key = url.toLowerCase();
  for (let i = recent.length - 1; i >= 0; i--) if ((recent[i].url || '').toLowerCase() === key) recent.splice(i, 1);
  recent.unshift(item);
  if (recent.length > 40) recent.length = 40;
}
function absUrl(u) { if (!/^https?:\/\//i.test(u)) return 'https://' + u; return u; }
async function browser() {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true, args: ['--disable-gpu','--no-sandbox','--disable-dev-shm-usage'] });
  return browserPromise;
}
function session(id) {
  if (!id || !sessions.has(id)) {
    id = sid(); sessions.set(id, { id, url: HOME_URL, history: [], title: '', links: [], slices: [], stats: {}, rev: 0, width: DEFAULT_WIDTH, created: Date.now() });
  }
  return sessions.get(id);
}
function shellQuoteForMeta(s) { return String(s).replace(/[\r\n]+/g, ' ').slice(0, 180); }

async function render(sess, targetUrl, width) {
  sess.width = clampWidth(width || sess.width || DEFAULT_WIDTH);
  targetUrl = absUrl(targetUrl || sess.url || HOME_URL);
  const widthPx = sess.width;
  if (sess.url && sess.url !== targetUrl) sess.history.push(sess.url);
  sess.url = targetUrl;
  const dir = path.join(CACHE, sess.id);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: widthPx, height: 900 }, deviceScaleFactor: 1, userAgent: USER_AGENT });
  const page = await ctx.newPage();
  await page.route('**/*', route => {
    const rt = route.request().resourceType();
    const url = route.request().url();
    if (['media','font'].includes(rt) || /doubleclick|googlesyndication|google-analytics|adservice|facebook\.net|scorecardresearch|taboola|outbrain/i.test(url)) return route.abort().catch(()=>{});
    route.continue().catch(()=>{});
  });
  try { await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch(e) {}
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch(e) {}
  try { await page.evaluate(() => { for (const el of document.querySelectorAll('button, [role=button], input[type=button], input[type=submit]')) { const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase(); if (/^(agree|accept|accept all|continue|i agree)$/.test(t)) { el.click(); return true; } } return false; }); await page.waitForTimeout(1200); } catch(e) {}
  try { await page.evaluate(() => { for (const el of document.querySelectorAll('[aria-label*=close i], [class*=modal i], [class*=overlay i], [id*=modal i], [id*=overlay i]')) { const r = el.getBoundingClientRect(); if (r.width > innerWidth*0.5 && r.height > innerHeight*0.2) el.remove(); } }); } catch(e) {}
  try {
    await page.evaluate(async (maxH) => {
      const pageHeight = () => Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement ? document.documentElement.scrollHeight : 0, innerHeight);
      let last = 0;
      for (let y = 0, n = 0; y < Math.min(maxH, pageHeight()) && n < 24; n++, y += Math.max(500, Math.floor(innerHeight * 0.75))) {
        scrollTo(0, y);
        await new Promise(r => setTimeout(r, 180));
        const now = pageHeight();
        if (y + innerHeight >= now && now === last) break;
        last = now;
      }
      scrollTo(0, 0);
    }, MAX_HEIGHT);
    await page.waitForTimeout(300);
  } catch(e) {}
  const meta = await page.evaluate((maxH) => {
    const height = Math.min(maxH, Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement ? document.documentElement.scrollHeight : 0, innerHeight));
    const candidates = Array.from(document.querySelectorAll('a[href]')).map((a, i) => {
      const r = a.getBoundingClientRect();
      const href = a.href;
      const text = (a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || href || '').replace(/\s+/g,' ').trim();
      return {i, href, text, x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height)};
    }).filter(l => l.href && l.w > 3 && l.h > 3 && l.y < height && l.x < innerWidth && l.x + l.w > 0)
      .slice(0, 180);
    return { title: document.title || location.href, height, links: candidates };
  }, MAX_HEIGHT);
  await page.setViewportSize({ width: widthPx, height: Math.max(200, meta.height) });
  const png = path.join(dir, 'full.png');
  await page.screenshot({ path: png, fullPage: false, type: 'png' });
  await ctx.close();
  const slices = [];
  for (let y=0, idx=0; y<meta.height; y += SLICE_H, idx++) {
    const h = Math.min(SLICE_H, meta.height - y);
    const out = path.join(dir, `${String(idx).padStart(3,'0')}.jpg`);
    execFileSync('convert', [png, '-crop', `${widthPx}x${h}+0+${y}`, '+repage', '-colorspace', 'sRGB', '-interlace', 'none', '-quality', String(QUALITY), out]);
    const st = fs.statSync(out);
    slices.push({ idx, y, h, file: `${String(idx).padStart(3,'0')}.jpg`, bytes: st.size });
  }
  sess.title = meta.title; sess.links = meta.links; sess.slices = slices;
  sess.rev = (sess.rev || 0) + 1;
  sess.stats = { width: widthPx, height: meta.height, bytes: slices.reduce((a,s)=>a+s.bytes,0), quality: QUALITY, sliceHeight: SLICE_H, rendered: new Date().toISOString() };
  remember(sess);
}

function waitHref(next, msg='Opening') { return `/wait?next=${encodeURIComponent(next)}&amp;msg=${encodeURIComponent(msg)}`; }
function openHref(sess, url) { return waitHref(`/open?url=${encodeURIComponent(url)}&s=${encodeURIComponent(sess.id)}&w=${clampWidth(sess.width)}`, 'Opening'); }
function goHref(sess, i) { return waitHref(`/go?i=${i}&s=${encodeURIComponent(sess.id)}&w=${clampWidth(sess.width)}`, 'Opening'); }
function waitPage(next, msg='Opening') {
 return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN"><html><head><title>${esc(msg)}</title><meta http-equiv="refresh" content="0;url=${esc(next)}"></head><body bgcolor="#ffffff" text="#000000"><br><br><center><font size="+1">${esc(msg)}...</font></center></body></html>`;
}
function toolbar(sess, opts={}) {
 const inputValue = opts.clear ? '' : sess.url;
 const width = clampWidth(sess.width);
 return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN"><html><head><title>zuko-lens toolbar</title></head><body bgcolor="#cccccc" text="#000000" link="#0000cc" vlink="#551a8b" marginwidth="1" marginheight="1" leftmargin="1" topmargin="1"><table border="0" cellspacing="1" cellpadding="0" width="100%"><tr><td nowrap><form action="/nav" method="get" target="_top"><input type="hidden" name="s" value="${esc(sess.id)}"><input type="hidden" name="a" value="back"><input type="hidden" name="w" value="${width}"><input type="submit" value="Back"></form></td><td nowrap><form action="/home" method="get" target="_top"><input type="hidden" name="s" value="${esc(sess.id)}"><input type="hidden" name="w" value="${width}"><input type="submit" value="Home"></form></td><td nowrap><form action="/open" method="get" target="_top"><input type="hidden" name="s" value="${esc(sess.id)}"><input type="hidden" name="url" value="${esc(sess.url)}"><input type="hidden" name="w" value="${width}"><input type="submit" value="Reload"></form></td><td width="100%"><form action="/open" method="get" target="_top"><input type="hidden" name="s" value="${esc(sess.id)}"><font size="-1">Addr/Search:</font> <input type="text" name="url" value="${esc(inputValue)}" size="48" onFocus="this.select()"> <input type="submit" value="Go"></td></tr><tr><td colspan="3" nowrap><font size="-1">Search <select name="search"><option value="yahoo">Yahoo</option><option value="bing">Bing</option><option value="frog">FrogFind</option><option value="duck">DuckDuckGo</option><option value="google">Google</option><option value="lycos">Lycos</option><option value="ask">Ask</option></select> Width <input type="text" name="w" value="${width}" size="3"> <a href="/open?url=${encodeURIComponent(sess.url)}&amp;s=${esc(sess.id)}&amp;w=680" target="_top">680</a> <a href="/open?url=${encodeURIComponent(sess.url)}&amp;s=${esc(sess.id)}&amp;w=700" target="_top">700</a> <a href="/open?url=${encodeURIComponent(sess.url)}&amp;s=${esc(sess.id)}&amp;w=720" target="_top">720</a> <a href="/toolbar?s=${esc(sess.id)}&amp;w=${width}&amp;clear=1" target="toolbar">Clear</a></font></td><td nowrap align="right"><font size="-1">${width}x${sess.stats.height||0} ${sess.slices.length} sl ${Math.round((sess.stats.bytes||0)/1024)} KB ${sess.links.length} ln</font></form></td></tr><tr><td colspan="4"><font size="-1">${esc(shellQuoteForMeta(sess.title))} | JPEG ${QUALITY}</font></td></tr></table></body></html>`;
}
function shell(sess) {
 return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Frameset//EN"><html><head><title>zuko-lens: ${esc(sess.title||sess.url)}</title></head><frameset rows="76,*" border="1" framespacing="1"><frame src="/toolbar?s=${esc(sess.id)}&amp;r=${sess.rev||0}" name="toolbar" scrolling="no" noresize><frame src="/view?s=${esc(sess.id)}&amp;r=${sess.rev||0}" name="view"></frameset><noframes><body><a href="/view?s=${esc(sess.id)}&amp;r=${sess.rev||0}">Open zuko-lens view</a></body></noframes></html>`;
}
function home(sess) {
 sess.url = 'zuko-lens:home'; sess.title = 'zuko-lens home'; sess.slices = []; sess.links = []; sess.rev = (sess.rev || 0) + 1;
 sess.stats = { width: clampWidth(sess.width), height: 0, bytes: 0, quality: QUALITY, sliceHeight: SLICE_H, rendered: new Date().toISOString() };
}
function homeView(sess) {
 const width = clampWidth(sess.width);
 let html = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN"><html><head><title>zuko-lens home</title></head><body bgcolor="#ffffff" text="#000000" link="#0000cc" vlink="#551a8b"><h2>zuko-lens home</h2><form action="/open" method="get" target="_top"><input type="hidden" name="s" value="${esc(sess.id)}"><input type="hidden" name="w" value="${width}">Search or URL: <input type="text" name="url" size="46"> <select name="search"><option value="yahoo">Yahoo</option><option value="bing">Bing</option><option value="frog">FrogFind</option><option value="duck">DuckDuckGo</option><option value="google">Google</option><option value="lycos">Lycos</option><option value="ask">Ask</option></select> <input type="submit" value="Go"></form><p><a href="${openHref(sess, HOME_URL)}" target="_top">Weather.gov 55901</a></p><h3>History</h3>`;
 const items = recent.length ? recent : [{url: HOME_URL, title: 'Weather.gov 55901'}];
 html += '<ol>';
 for (const r of items) html += `<li><a href="${openHref(sess, r.url)}" target="_top">${esc((r.title || r.url).slice(0,120))}</a><br><font size="-1">${esc(r.url)}${r.at ? ' | ' + esc(r.at.slice(0,16).replace('T',' ')) : ''}</font></li>`;
 html += `</ol><hr><font size="-1">Width ${width}. This home page is local HTML, not a screenshot, so it stays light for Netscape.</font></body></html>`;
 return html;
}
function view(sess) {
 const width = clampWidth(sess.width || sess.stats.width);
 let html = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN"><html><head><title>${esc(sess.title)}</title></head><body bgcolor="#ffffff" text="#000000" link="#0000cc" vlink="#551a8b" marginwidth="0" marginheight="0" leftmargin="0" topmargin="0"><table border="0" cellspacing="0" cellpadding="0">`;
 for (const sl of sess.slices) {
   const map = `m${sl.idx}`;
   html += `<tr><td><img src="/img/${esc(sess.id)}/${esc(sl.file)}?r=${sess.rev||0}" width="${width}" height="${sl.h}" border="0" usemap="#${map}"></td></tr>\n`;
 }
 html += `</table>\n`;
 for (const sl of sess.slices) {
   html += `<map name="m${sl.idx}">\n`;
   for (let i=0; i<sess.links.length; i++) {
     const l = sess.links[i]; const y1 = Math.max(l.y, sl.y), y2 = Math.min(l.y + l.h, sl.y + sl.h);
     if (y2 > y1) {
       const x1 = Math.max(0, Math.min(width-1, l.x)); const x2 = Math.max(0, Math.min(width, l.x + l.w));
       if (x2 > x1) html += `<area shape="rect" coords="${x1},${y1-sl.y},${x2},${y2-sl.y}" href="${goHref(sess, i)}" target="_top" alt="${esc(l.text||l.href)}">\n`;
     }
   }
   html += `</map>\n`;
 }
 html += `<hr><a name="links"></a><h3>Links</h3><ol>`;
 sess.links.forEach((l, i) => { html += `<li><a href="${goHref(sess, i)}" target="_top">${esc((l.text||l.href).slice(0,140))}</a></li>`; });
 html += `</ol><p><font size="-1">Rendered ${esc(sess.url)} by zuko-lens. ${width}x${sess.stats.height}, ${Math.round(sess.stats.bytes/1024)} KB.</font></p></body></html>`;
 return html;
}

function q(req, name) { return req.query[name] || req.query['amp;' + name]; }
app.get('/', async (req,res) => { const s = session(q(req, 's')); home(s); res.type('html').send(shell(s)); });
app.get('/home', (req,res) => { const s = session(q(req, 's')); s.width = clampWidth(q(req, 'w') || s.width); home(s); res.type('html').send(shell(s)); });
app.get('/wait', (req,res) => { const next = String(q(req, 'next') || '/'); const msg = String(q(req, 'msg') || 'Rendering'); res.type('html').send(waitPage(next, msg)); });
app.get('/open', async (req,res) => { const s = session(q(req, 's')); await render(s, targetFromInput(q(req, 'url') || s.url, q(req, 'search')), q(req, 'w')); res.type('html').send(shell(s)); });
app.get('/go', async (req,res) => { const s = session(q(req, 's')); const l = s.links[parseInt(q(req, 'i') || '-1', 10)]; await render(s, l && l.href ? l.href : s.url, q(req, 'w')); res.type('html').send(shell(s)); });
app.get('/nav', async (req,res) => { const s = session(q(req, 's')); s.width = clampWidth(q(req, 'w') || s.width); if (q(req, 'a') === 'back' && s.history.length) await render(s, s.history.pop(), s.width); res.type('html').send(shell(s)); });
app.get('/toolbar', (req,res) => { const s = session(q(req, 's')); s.width = clampWidth(q(req, 'w') || s.width); res.type('html').send(toolbar(s, { clear: !!q(req, 'clear') })); });
app.get('/view', async (req,res) => { const s = session(q(req, 's')); if (s.url === 'zuko-lens:home') return res.type('html').send(homeView(s)); if (!s.slices.length) await render(s, s.url || HOME_URL, q(req, 'w')); res.type('html').send(view(s)); });
app.use('/img', express.static(CACHE, { setHeaders: r => { r.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate'); r.set('Pragma','no-cache'); r.set('Expires','0'); } }));

app.listen(PORT, HOST, () => console.log(`zuko-lens listening on http://${HOST}:${PORT}/`));

async function shutdown(sig) {
  console.log(`zuko-lens ${sig}: closing browser and exiting`);
  try { if (browserPromise) await (await browserPromise).close(); } catch(e) {}
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
