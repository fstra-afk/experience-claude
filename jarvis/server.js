// Serveur minimal sans dépendance (Node >= 18) : sert la PWA et relaie /api/chat vers l'API Anthropic.
// La clé API reste côté serveur, jamais dans le téléphone.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8787;
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const TOKEN = process.env.JARVIS_TOKEN;            // optionnel : protège /api/chat
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const SYSTEM = name => `Tu es J.A.R.V.I.S., l'assistant personnel de ${name}, sur son téléphone, façon Iron Man.
Ton: courtois, concis, légèrement pince-sans-rire, jamais servile. Tu réponds en français.
Tes réponses sont lues à voix haute : 1 à 3 phrases courtes, sans markdown, sans listes, sans émojis.
Si tu ignores quelque chose ou ne peux pas agir sur le téléphone, dis-le simplement.`;

function readBody(req, limit = 64 * 1024) {
  return new Promise((ok, ko) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > limit) { ko(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks).toString()));
    req.on('error', ko);
  });
}
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization' }); res.end(body); };

async function chat(req, res) {
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, '{"error":"unauthorized"}');
  if (!KEY) return send(res, 500, '{"error":"ANTHROPIC_API_KEY manquante"}');
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, '{"error":"bad json"}'); }
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-20);
  if (!messages.length || messages[0].role !== 'user') return send(res, 400, '{"error":"bad messages"}');
  const name = String(body.name || 'Monsieur').slice(0, 40);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, system: SYSTEM(name), messages }),
  });
  if (!r.ok) { console.error('Anthropic', r.status, await r.text()); return send(res, 502, '{"error":"upstream"}'); }
  const data = await r.json();
  const reply = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  send(res, 200, JSON.stringify({ reply }));
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (url.pathname === '/api/chat' && req.method === 'POST') return await chat(req, res);
    const rel = path.normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
    fs.readFile(file, (err, buf) => err ? send(res, 404, 'not found', 'text/plain') : send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream'));
  } catch (e) { console.error(e); send(res, 500, '{"error":"server"}'); }
}).listen(PORT, () => console.log(`Jarvis prêt sur http://localhost:${PORT}${KEY ? '' : '  (ANTHROPIC_API_KEY absente : fonctions locales seulement)'}`));
