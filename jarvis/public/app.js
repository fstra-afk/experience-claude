'use strict';

const $ = id => document.getElementById(id);
const reactor = $('reactor'), statusEl = $('status'), logEl = $('log'), micBtn = $('mic');
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const cfg = {
  wake: store.get('wake', 'jarvis'),
  alwaysOn: store.get('alwaysOn', '0') === '1',
  voice: store.get('voice', ''),
  server: store.get('server', ''),
  token: store.get('token', ''),
  name: store.get('name', ''),
};
const who = () => cfg.name || 'Monsieur';

/* ---------- UI helpers ---------- */
function setState(s, label) { reactor.dataset.state = s; statusEl.textContent = label; }
function addMsg(text, me) {
  const d = document.createElement('div');
  d.className = 'msg' + (me ? ' me' : '');
  d.textContent = text;
  logEl.append(d);
  logEl.scrollTop = logEl.scrollHeight;
}
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* ---------- Voix (synthèse) ---------- */
let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices();
  const sel = $('voice');
  sel.innerHTML = '';
  voices.filter(v => v.lang.startsWith('fr')).concat(voices.filter(v => !v.lang.startsWith('fr')))
    .forEach(v => {
      const o = document.createElement('option');
      o.value = v.name; o.textContent = `${v.name} (${v.lang})`;
      if (v.name === cfg.voice) o.selected = true;
      sel.append(o);
    });
}
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

function speak(text) {
  addMsg(text, false);
  return new Promise(res => {
    if (!('speechSynthesis' in window)) return res();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find(v => v.name === cfg.voice) || voices.find(v => v.lang.startsWith('fr'));
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'fr-FR';
    u.rate = 1.02; u.pitch = 0.9;
    u.onstart = () => setState('speaking', 'Jarvis parle…');
    u.onend = u.onerror = () => { setState('idle', idleLabel()); res(); };
    speechSynthesis.speak(u);
  });
}
const idleLabel = () => cfg.alwaysOn ? `En écoute — dites « ${cfg.wake} »` : 'Système en veille';

/* ---------- Reconnaissance vocale ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, wantListening = false, awake = false, awakeTimer = 0;

function startRec() {
  if (!SR) { speak("La reconnaissance vocale n'est pas disponible sur ce navigateur. Utilisez Chrome ou Safari, ou écrivez-moi."); return; }
  if (rec) return;
  rec = new SR();
  rec.lang = 'fr-FR';
  rec.continuous = true;
  rec.interimResults = false;
  rec.onstart = () => { listening = true; micBtn.classList.add('on'); setState('listening', awake ? 'Je vous écoute…' : idleLabel()); };
  rec.onresult = e => {
    const r = e.results[e.resultIndex];
    if (r.isFinal) onHeard(r[0].transcript.trim());
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      wantListening = false; cfg.alwaysOn = false; $('alwaysOn').checked = false;
      speak("Accès au micro refusé. Autorisez-le dans les réglages du navigateur.");
    }
  };
  rec.onend = () => {
    listening = false; rec = null; micBtn.classList.remove('on');
    if (wantListening) setTimeout(startRec, 300);   // relance automatique
    else if (reactor.dataset.state === 'listening') setState('idle', idleLabel());
  };
  try { rec.start(); } catch { rec = null; }
}
function stopRec() { wantListening = false; awake = false; if (rec) rec.stop(); }

function onHeard(raw) {
  const t = norm(raw), wake = norm(cfg.wake);
  if (!cfg.alwaysOn && !awake) return handle(raw);          // mode appui sur le micro
  const i = t.indexOf(wake);
  if (i >= 0) {                                              // « Jarvis, quelle heure est-il »
    const rest = raw.slice(i + wake.length).replace(/^[\s,.:;!?-]+/, '');
    if (rest) return handle(rest);
    awake = true; clearTimeout(awakeTimer);
    awakeTimer = setTimeout(() => { awake = false; setState('listening', idleLabel()); }, 8000);
    setState('listening', 'Je vous écoute…');
    return speak(`À votre service, ${who()}.`);
  }
  if (awake) { awake = false; clearTimeout(awakeTimer); handle(raw); }
}

/* ---------- Compétences locales ---------- */
const timers = [];
const pad = n => String(n).padStart(2, '0');
const open = url => { window.open(url, '_blank', 'noopener'); };
const num = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 };
const toNum = s => /^\d+$/.test(s) ? +s : num[s];

const skills = [
  { re: /\bquelle heure|\bl'heure\b/, run: () => { const d = new Date(); return `Il est ${d.getHours()} heures ${pad(d.getMinutes())}.`; } },
  { re: /quel jour|quelle date|on est quel/, run: () => `Nous sommes le ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.` },
  { re: /batterie|niveau de charge/, run: async () => {
      if (!navigator.getBattery) return "Je n'ai pas accès à la batterie sur ce navigateur.";
      const b = await navigator.getBattery();
      return `La batterie est à ${Math.round(b.level * 100)} pour cent${b.charging ? ', en charge' : ''}.`;
  } },
  { re: /(minuteur|timer|chrono|rappelle[- ]moi dans)\D*(\d+|\w+)\s*(seconde|minute|heure)/, run: m => {
      const n = toNum(m[2]); if (!n) return null;
      const unit = m[3], ms = n * (unit === 'heure' ? 3600e3 : unit === 'minute' ? 60e3 : 1e3);
      timers.push(setTimeout(() => { speak(`${who()}, votre minuteur de ${n} ${unit}${n > 1 ? 's' : ''} est terminé.`); navigator.vibrate?.([300, 100, 300]); }, ms));
      return `Minuteur réglé sur ${n} ${unit}${n > 1 ? 's' : ''}.`;
  } },
  { re: /(\d+(?:[.,]\d+)?)\s*(plus|moins|fois|multiplie par|divise par|\+|-|x|\*|\/)\s*(\d+(?:[.,]\d+)?)/, run: m => {
      const a = parseFloat(m[1].replace(',', '.')), b = parseFloat(m[3].replace(',', '.'));
      const op = { plus: '+', '+': '+', moins: '-', '-': '-', fois: '*', 'multiplie par': '*', x: '*', '*': '*', 'divise par': '/', '/': '/' }[m[2]];
      const r = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : b ? a / b : NaN;
      return Number.isFinite(r) ? `Le résultat est ${+r.toFixed(6)}.` : `Division par zéro, ${who()}. Même moi, j'ai mes limites.`;
  } },
  { re: /meteo|quel temps|temperature/, run: weather },
  { re: /(?:ouvre|lance|va sur)\s+youtube/, run: () => { open('https://www.youtube.com'); return 'J\'ouvre YouTube.'; } },
  { re: /(?:mets?|joue|lance)\s+(?:de la musique|la musique|(.+?) sur youtube)/, run: m => { open('https://www.youtube.com/results?search_query=' + encodeURIComponent(m[1] || 'musique')); return 'Je lance ça sur YouTube.'; } },
  { re: /(?:itineraire|navigue|emmene[- ]moi|route) (?:vers|a|pour)\s+(.+)/, run: m => { open('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(m[1])); return `Itinéraire vers ${m[1]} dans Maps.`; } },
  { re: /(?:cherche|recherche|google)\s+(.+)/, run: m => { open('https://www.google.com/search?q=' + encodeURIComponent(m[1])); return `Je cherche « ${m[1]} ».`; } },
  { re: /(?:appelle|telephone a)\s+([\d\s+]{6,})/, run: m => { location.href = 'tel:' + m[1].replace(/\s/g, ''); return 'J\'appelle.'; } },
  { re: /(?:ouvre|lance)\s+whatsapp/, run: () => { open('https://wa.me/'); return 'J\'ouvre WhatsApp.'; } },
  { re: /lampe|torche|lumiere/, run: torch },
  { re: /\b(blague|fais moi rire)\b/, run: () => pick([
      "Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon ils tombent dans le bateau.",
      "Un SMS, c'est un message qui court plus vite que son auteur. Le mien arrive toujours avant que j'aie fini de réfléchir.",
      "J'ai calculé 14 millions de futurs possibles. Dans un seul, vous finissez votre café avant qu'il refroidisse.",
  ]) },
  { re: /^(salut|bonjour|coucou|hello|hey)\b|ca va\b/, run: () => pick([`Bonjour ${who()}. Tous les systèmes sont opérationnels.`, `Heureux de vous entendre, ${who()}.`]) },
  { re: /qui es[- ]tu|presente[- ]toi/, run: () => "Je suis Jarvis, votre assistant personnel. Enfin, une humble imitation. Mais je fais de mon mieux." },
  { re: /merci/, run: () => pick(['Avec plaisir.', 'Toujours à votre service.', 'Ce fut un honneur.']) },
  { re: /(arrete|tais[- ]toi|stop|silence)\b/, run: () => { speechSynthesis.cancel(); timers.splice(0).forEach(clearTimeout); return null; } },
];
const pick = a => a[Math.floor(Math.random() * a.length)];

async function weather() {
  const pos = await new Promise((ok, ko) => navigator.geolocation
    ? navigator.geolocation.getCurrentPosition(ok, ko, { timeout: 8000 }) : ko()).catch(() => null);
  if (!pos) return "Je n'ai pas pu vous localiser. Autorisez la position dans le navigateur.";
  const { latitude: la, longitude: lo } = pos.coords;
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`);
  const c = (await r.json()).current;
  const codes = [[0, 'dégagé'], [3, 'nuageux'], [48, 'brumeux'], [57, 'sous la bruine'], [67, 'pluvieux'], [77, 'neigeux'], [82, 'sous les averses'], [86, 'sous la neige'], [99, 'orageux']];
  const desc = codes.find(([k]) => c.weather_code <= k)?.[1] ?? 'variable';
  return `Il fait ${Math.round(c.temperature_2m)} degrés, ciel ${desc}, vent à ${Math.round(c.wind_speed_10m)} kilomètres heure.`;
}

let torchStream = null;
async function torch() {
  if (torchStream) { torchStream.getTracks().forEach(t => t.stop()); torchStream = null; return 'Lampe éteinte.'; }
  try {
    torchStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const track = torchStream.getVideoTracks()[0];
    await track.applyConstraints({ advanced: [{ torch: true }] });
    return 'Lampe allumée.';
  } catch {
    torchStream?.getTracks().forEach(t => t.stop()); torchStream = null;
    return "Mon navigateur ne me laisse pas piloter la lampe sur cet appareil.";
  }
}

/* ---------- Cerveau Claude (via le serveur) ---------- */
const history = [];
async function askClaude(text) {
  history.push({ role: 'user', content: text });
  const base = cfg.server.replace(/\/$/, '');
  const res = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cfg.token && { authorization: 'Bearer ' + cfg.token }) },
    body: JSON.stringify({ messages: history.slice(-20), name: who() }),
  });
  if (!res.ok) { history.pop(); throw new Error(res.status); }
  const { reply } = await res.json();
  history.push({ role: 'assistant', content: reply });
  return reply;
}

/* ---------- Orchestration ---------- */
async function handle(raw) {
  addMsg(raw, true);
  setState('thinking', 'Analyse…');
  const t = norm(raw).replace(/[?!.]+$/, '');
  try {
    for (const s of skills) {
      const m = t.match(s.re);
      if (!m) continue;
      const out = await s.run(m);
      if (out === null) { setState('idle', idleLabel()); return; }
      if (out) return speak(out);
    }
    return speak(await askClaude(raw));
  } catch (err) {
    return speak(String(err.message) === '401'
      ? "Jeton refusé par le serveur."
      : `Mon cerveau distant est injoignable, ${who()}. Mes fonctions locales restent disponibles.`);
  }
}

/* ---------- Événements ---------- */
$('form').addEventListener('submit', e => { e.preventDefault(); const v = $('text').value.trim(); $('text').value = ''; if (v) handle(v); });
micBtn.addEventListener('click', () => {
  if (listening) { stopRec(); return; }
  awake = true;                       // un appui = déjà réveillé
  wantListening = cfg.alwaysOn;
  startRec();
});

const dlg = $('settings');
$('settingsBtn').onclick = () => {
  $('wakeWord').value = cfg.wake; $('alwaysOn').checked = cfg.alwaysOn;
  $('server').value = cfg.server; $('token').value = cfg.token; $('userName').value = cfg.name;
  dlg.showModal();
};
dlg.addEventListener('close', () => {
  cfg.wake = $('wakeWord').value.trim() || 'jarvis';
  cfg.alwaysOn = $('alwaysOn').checked;
  cfg.voice = $('voice').value; cfg.server = $('server').value.trim();
  cfg.token = $('token').value; cfg.name = $('userName').value.trim();
  store.set('wake', cfg.wake); store.set('alwaysOn', cfg.alwaysOn ? '1' : '0');
  store.set('voice', cfg.voice); store.set('server', cfg.server);
  store.set('token', cfg.token); store.set('name', cfg.name);
  if (cfg.alwaysOn) { wantListening = true; startRec(); } else stopRec();
  setState('idle', idleLabel());
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
setState('idle', idleLabel());
addMsg(`Bonsoir ${who()}. Appuyez sur le micro, ou activez l'écoute permanente dans ⚙ pour m'appeler par mon nom.`, false);
