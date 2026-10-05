'use strict';
/* =========================================================
   TURBO ZOMBİ RALLİ — 2D üstten görünüm araba yarışı
   ========================================================= */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
// Dokunmatik cihaz algılama (ilk dokunuşta da otomatik açılır)
let isTouch = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');
function resize() {
  DPR = Math.min(isTouch ? 1.5 : 2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
}
addEventListener('resize', resize);
resize();

// ---------- Yardımcılar ----------
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const shadeCache = {};
function shade(hex, amt) {
  const k = hex + amt;
  if (shadeCache[k]) return shadeCache[k];
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return (shadeCache[k] = `rgb(${r},${g},${b})`);
}
function rr(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

// ---------- Kayıt (jeton + yükseltmeler) ----------
const SAVE_KEY = 'turboZombiRalli_v1';
const save = { coins: 0, best: 0, up: { turbo2x: false, gun: false, gun2: false, rocket: false, magnet: false, armor: false } };
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (s) { save.coins = s.coins | 0; save.best = s.best | 0; Object.assign(save.up, s.up || {}); }
} catch (e) { /* depolama yok */ }
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* yoksay */ } }

const turboCap = () => (save.up.turbo2x ? 200 : 100);
const maxHP = () => (save.up.armor ? 150 : 100);

// ---------- Ses (WebAudio sentezi) ----------
const Sound = {
  ctx: null, muted: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      const o = this.ctx.createOscillator(); o.type = 'sawtooth';
      const o2 = this.ctx.createOscillator(); o2.type = 'square';
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = this.ctx.createGain(); g.gain.value = 0;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
      o.start(); o2.start();
      this.engine = { o, o2, f, g };
    } catch (e) { this.ctx = null; }
  },
  setEngine(speed, turbo, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, e = this.engine;
    const fr = 42 + speed * 0.16 + (turbo ? 35 : 0);
    e.o.frequency.setTargetAtTime(fr, t, 0.06);
    e.o2.frequency.setTargetAtTime(fr * 0.5, t, 0.06);
    e.f.frequency.setTargetAtTime(350 + speed * 1.2 + (turbo ? 600 : 0), t, 0.08);
    e.g.gain.setTargetAtTime(on ? 0.045 : 0, t, 0.1);
  },
  tone(freq, dur, type = 'square', vol = 0.08, slide = 0, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  noiseBurst(dur, vol, freq = 1000, type = 'lowpass') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  },
  coin() { this.tone(988, 0.07, 'square', 0.05); this.tone(1319, 0.12, 'square', 0.05, 0, 0.06); },
  turbo() { this.tone(300, 0.3, 'sawtooth', 0.06, 900); },
  shoot() { this.noiseBurst(0.06, 0.07, 2500, 'bandpass'); },
  rocket() { this.noiseBurst(0.4, 0.12, 700); this.tone(200, 0.3, 'sawtooth', 0.04, 300); },
  boom(p = 1) { this.noiseBurst(0.7 * p + 0.2, 0.35 * Math.min(1.4, p), 380); this.tone(90, 0.5, 'sine', 0.25 * Math.min(1.3, p), -50); },
  crash() { this.noiseBurst(0.2, 0.25, 900); this.tone(120, 0.15, 'square', 0.08, -60); },
  splat() { this.noiseBurst(0.15, 0.15, 500); },
  splash() { this.noiseBurst(0.8, 0.3, 1200, 'highpass'); },
  jump() { this.tone(220, 0.35, 'triangle', 0.1, 400); },
  buy() { this.tone(660, 0.08, 'square', 0.06); this.tone(880, 0.08, 'square', 0.06, 0, 0.08); this.tone(1320, 0.15, 'square', 0.06, 0, 0.16); },
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.5; },
};

// ---------- Yol ve biyomlar ----------
function roadCX(y) {
  const d = -y;
  const amp = smooth(400, 2200, d);
  return amp * (380 * Math.sin(d / 1500) + 170 * Math.sin(d / 560 + 1.3) + 45 * Math.sin(d / 260 + 0.5));
}
function roadHW(y) { return 175 + 25 * Math.sin(-y / 900); }
function roadAngle(y) { return Math.atan2(roadCX(y - 8) - roadCX(y), 8); }

const SEG = 3600;
const BIOME_SEQ = ['grass', 'sea_r', 'ruins', 'desert', 'sea_l', 'ruins', 'grass', 'sea_r', 'desert', 'ruins', 'sea_l'];
const BIOME_NAME = { grass: '🌳 YEŞİL VADİ', sea_r: '🌊 SAHİL YOLU', sea_l: '🌊 SAHİL YOLU', ruins: '☣️ YIKINTI BÖLGESİ — ZOMBİLER!', desert: '🌵 ÇÖL OTOYOLU' };
const GROUND = { grass: [62, 122, 56], sea_r: [212, 190, 134], sea_l: [212, 190, 134], ruins: [88, 85, 80], desert: [204, 164, 94] };
const ASPHALT = { grass: [58, 60, 66], sea_r: [62, 64, 70], sea_l: [62, 64, 70], ruins: [72, 68, 64], desert: [70, 64, 60] };
function biomeOfSeg(s) { return s <= 0 ? 'grass' : BIOME_SEQ[s % BIOME_SEQ.length]; }
function biomeAt(y) {
  const d = Math.max(0, -y), f = d / SEG, s = Math.floor(f);
  return { b0: biomeOfSeg(s), b1: biomeOfSeg(s + 1), k: smooth(0.86, 1, f - s) };
}
function biomeMain(y) { const b = biomeAt(y); return b.k > 0.5 ? b.b1 : b.b0; }
function biomeW(y, name) { const b = biomeAt(y); return (b.b0 === name ? 1 - b.k : 0) + (b.b1 === name ? b.k : 0); }
function mixColor(table, y) {
  const b = biomeAt(y), c0 = table[b.b0], c1 = table[b.b1];
  return `rgb(${lerp(c0[0], c1[0], b.k) | 0},${lerp(c0[1], c1[1], b.k) | 0},${lerp(c0[2], c1[2], b.k) | 0})`;
}
const SHOULDER = 22, SAND = 80;
function waterLeft(y) { const s = biomeW(y, 'sea_l'); return roadCX(y) - roadHW(y) - SHOULDER - SAND - (1 - s) * 3000; }
function waterRight(y) { const s = biomeW(y, 'sea_r'); return roadCX(y) + roadHW(y) + SHOULDER + SAND + (1 - s) * 3000; }
function inWater(x, y) { return x < waterLeft(y) || x > waterRight(y); }

// Zemin dokusu
const noiseCanvas = document.createElement('canvas');
noiseCanvas.width = noiseCanvas.height = 128;
{
  const nctx = noiseCanvas.getContext('2d');
  const id = nctx.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const r = Math.random();
    const v = r < 0.5 ? 0 : 255;
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
    id.data[i * 4 + 3] = Math.random() < 0.35 ? (r < 0.5 ? 40 : 22) : 0;
  }
  nctx.putImageData(id, 0, 0);
}
const noisePat = ctx.createPattern(noiseCanvas, 'repeat');

// ---------- Oyun durumu ----------
const S = { state: 'menu', time: 0, paused: false };
let player, cam;
let coins, pickups, ramps, rubble, traffic, zombies, decos, boats, bullets, particles, decals, skids, popups;
let genY, runCoins, kills, carsBlown, maxDist, lastSeg, banner, hurtFlash, shopOpen = false, hintT = 0;
const CH = 260;

function newGame() {
  player = {
    x: 0, y: 200, a: 0, vx: 0, vy: 0, z: 0, vz: 0, w: 34, l: 62,
    turbo: 50, hp: maxHP(), inv: 0, dead: false, deadT: 0, turboOn: false,
    gunCD: 0, rocketCD: 0, drifting: false, driftTime: 0, noDrift: 0, lastSkid: null, biteT: 0,
  };
  cam = { x: 0, y: -100, zoom: baseZoom(), shake: 0 };
  coins = []; pickups = []; ramps = []; rubble = []; traffic = []; zombies = []; decos = []; boats = [];
  bullets = []; particles = []; decals = []; skids = []; popups = [];
  genY = 300; runCoins = 0; kills = 0; carsBlown = 0; maxDist = 0; lastSeg = -1; banner = null; hurtFlash = 0; hintT = 14;
  while (genY > player.y - 2800) { genChunk(genY); genY -= CH; }
}
function baseZoom() { return clamp(Math.min(W, H * 1.2) / 900, 0.55, 1.3); }

// ---------- Dünya üretimi ----------
const CAR_COLORS = ['#2f7de1', '#f2c230', '#2fae5c', '#ececec', '#8e44ad', '#ff7a1a', '#1abc9c', '#555b66', '#c0392b'];
const SHIRTS = ['#6b4f3a', '#3d5a80', '#7a2e2e', '#555', '#4a6b3a', '#8a7a5a'];

function genChunk(yA) {
  const d = -yA;
  // Dekorlar
  for (let i = 0; i < 5; i++) {
    const y = yA - rand(0, CH);
    const side = Math.random() < 0.5 ? -1 : 1;
    const hw = roadHW(y);
    let off = hw + SHOULDER + rand(25, 560);
    const bb = biomeMain(y);
    let kind;
    const seaW = side < 0 ? biomeW(y, 'sea_l') : biomeW(y, 'sea_r');
    const beach = seaW > 0.5 && off < hw + SHOULDER + SAND;
    if (bb === 'grass') kind = pick(['tree', 'tree', 'tree', 'bush', 'bush', 'rock']);
    else if (bb === 'desert') kind = pick(['cactus', 'cactus', 'rock', 'rock', 'bush']);
    else if (bb === 'ruins') kind = pick(['building', 'building', 'burnt', 'rock', 'firebarrel']);
    else kind = beach ? pick(['umbrella', 'palm']) : pick(['palm', 'palm', 'bush', 'umbrella']);
    if (kind === 'building') off += 90;
    const x = roadCX(y) + side * off;
    if (inWater(x, y)) {
      if (Math.random() < 0.12) boats.push({ x, y, a: rand(-0.3, 0.3) + (Math.random() < 0.5 ? 0 : Math.PI), sp: rand(20, 60), col: pick(['#ffffff', '#f2c230', '#e74c3c']) });
      continue;
    }
    const o = { kind, x, y, s: rand(0.8, 1.3), rot: rand(0, 6.28), c: pick(CAR_COLORS), seed: Math.random() };
    if (kind === 'tree') o.r = 20 * o.s;
    else if (kind === 'palm') o.r = 9 * o.s;
    else if (kind === 'cactus') o.r = 12 * o.s;
    else if (kind === 'rock') o.r = 16 * o.s;
    else if (kind === 'building') { o.bw = rand(110, 190); o.bh = rand(100, 170); o.r = Math.min(o.bw, o.bh) * 0.5; }
    else if (kind === 'burnt') o.r = 22;
    else if (kind === 'firebarrel') o.r = 10;
    if (o.r) {
      // Dekor yola taşmasın
      const edge = Math.abs(x - roadCX(y)) - hw - SHOULDER;
      if (edge < o.r + 8) continue;
    }
    decos.push(o);
  }
  if (d < 900) return;
  const bio = biomeMain(yA - CH / 2);

  // Jeton dizisi
  if (Math.random() < 0.45) {
    const n = 5 + (Math.random() * 5 | 0);
    const lane = rand(-0.65, 0.65);
    let y = yA - rand(0, 60);
    const curve = rand(-0.02, 0.02);
    for (let i = 0; i < n; i++) {
      coins.push({ x: roadCX(y) + clamp(lane + curve * i * 4, -0.8, 0.8) * roadHW(y), y, ph: i * 0.4 });
      y -= 55;
    }
  }
  // Turbo tüpü
  if (Math.random() < 0.17) {
    const y = yA - rand(0, CH);
    pickups.push({ x: roadCX(y) + rand(-0.65, 0.65) * roadHW(y), y, ph: 0 });
  }
  // Trafik
  if (bio !== 'ruins' && Math.random() < 0.55) spawnTraffic(yA - rand(0, CH));

  let rampHere = false;
  if (d > 2200 && Math.random() < 0.1) {
    const y = yA - 30;
    const rx = roadCX(y) + rand(-0.4, 0.4) * roadHW(y);
    ramps.push({ x: rx, y, a: roadAngle(y), w: 120, h: 80 });
    rampHere = true;
    // Rampaya giden yolu yıkıntıdan temizle
    for (const r of rubble) if (r.y > y - 60 && r.y < y + 320 && Math.abs(r.x - rx) < 120) r.dead = true;
    // Rampadan sonra jeton yayı (havada toplanır)
    for (let i = 1; i <= 6; i++) {
      const yy = y - 90 - i * 70;
      coins.push({ x: roadCX(yy) + (ramps[ramps.length - 1].x - roadCX(y)), y: yy, ph: i * 0.4, air: true });
    }
  }
  // Yıkıntılar & zombiler
  if (bio === 'ruins') {
    if (Math.random() < 0.8) {
      rubbleRow(yA - rand(rampHere ? 180 : 40, CH - 30));
    }
    const n = 2 + (Math.random() * 4 | 0);
    for (let i = 0; i < n; i++) spawnZombie(yA - rand(0, CH));
    if (Math.random() < 0.5) {
      const y = yA - rand(0, CH);
      decals.push({ kind: 'crack', x: roadCX(y) + rand(-0.7, 0.7) * roadHW(y), y, a: rand(0, 6.28), s: rand(0.8, 1.6), seed: Math.random() });
    }
  } else {
    if (Math.random() < 0.3) { spawnZombie(yA - rand(0, CH)); if (Math.random() < 0.5) spawnZombie(yA - rand(0, CH)); }
    if (Math.random() < 0.07) addRubble(roadCX(yA - 100) + rand(-0.6, 0.6) * roadHW(yA - 100), yA - 100, rand(16, 24));
  }
}

function addRubble(x, y, r) {
  const pts = [];
  const n = 6 + (Math.random() * 3 | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
    const rr2 = r * rand(0.7, 1.15);
    pts.push([Math.cos(a) * rr2, Math.sin(a) * rr2]);
  }
  rubble.push({ x, y, r, pts, col: pick(['#8b8680', '#7a746c', '#9a9188', '#6e6a64', '#8a7560']), rebar: Math.random() < 0.4, rot: rand(0, 6) });
}
function rubbleRow(y) {
  const c = roadCX(y), hw = roadHW(y);
  const rows = Math.random() < 0.5 ? 2 : 1;
  for (let r = 0; r < rows; r++) {
    const yy = y - r * 150;
    const cc = roadCX(yy), hh = roadHW(yy);
    const g = rand(-hh + 75, hh - 75);
    for (let x = cc - hh - 8; x <= cc + hh + 8; x += rand(30, 40)) {
      if (Math.abs(x - (cc + g)) < 72) continue;
      addRubble(x + rand(-5, 5), yy + rand(-14, 14), rand(14, 23));
    }
  }
  void c; void hw;
}
function spawnTraffic(y) {
  const lane = pick([-0.62, 0, 0.62]);
  for (const t of traffic) if (Math.abs(t.y - y) < 160 && Math.abs(t.lane - lane) < 0.3) return;
  const truck = Math.random() < 0.18;
  traffic.push({
    x: roadCX(y) + lane * roadHW(y), y, lane, tLane: lane, a: roadAngle(y),
    sp: truck ? rand(170, 240) : rand(210, 360), w: truck ? 40 : rand(31, 35), l: truck ? 100 : rand(56, 64),
    col: pick(CAR_COLORS), kind: truck ? 'truck' : 'car', hp: truck ? 7 : 4,
    flying: false, z: 0, vz: 0, vx: 0, vy: 0, spin: 0,
  });
}
function spawnZombie(y) {
  const hw = roadHW(y);
  const x = roadCX(y) + rand(-hw - 220, hw + 220);
  if (inWater(x, y)) return;
  zombies.push({ x, y, a: rand(0, 6.28), sp: rand(32, 70), ph: rand(0, 6), shirt: pick(SHIRTS), wa: rand(0, 6.28), hp: 2 });
}

// ---------- Efektler ----------
function addP(o) {
  particles.push(Object.assign({ vx: 0, vy: 0, life: 1, max: 1, size: 4, grow: 0, drag: 2, kind: 'smoke', col: '#888', z: 0, vz: 0, rot: 0, vr: 0 }, o));
  if (particles.length > 2000) particles.splice(0, particles.length - 2000);
}
function popup(x, y, text, col = '#fff') { popups.push({ x, y, text, col, life: 1.2 }); }
function shake(v) { cam.shake = Math.min(28, cam.shake + v); }

function explosion(x, y, power = 1, chain = false) {
  shake(9 * power);
  Sound.boom(power);
  const n = 40 * power;
  for (let i = 0; i < n; i++) {
    const a = rand(0, 6.28), s = rand(40, 320) * power;
    addP({ kind: 'fire', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.8), size: rand(8, 22) * power, grow: -10, drag: 3 });
  }
  for (let i = 0; i < n * 0.6; i++) {
    const a = rand(0, 6.28), s = rand(20, 140) * power;
    addP({ kind: 'smoke', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(1, 2.2), size: rand(12, 26) * power, grow: 22, drag: 1.5, col: pick(['#333', '#444', '#555']) });
  }
  for (let i = 0; i < 14 * power; i++) {
    const a = rand(0, 6.28), s = rand(100, 380);
    addP({ kind: 'debris', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, z: 5, vz: rand(150, 450), life: rand(1, 2), size: rand(3, 7), drag: 1, col: pick(['#222', '#3a3a3a', '#7a2a1a', '#999']), vr: rand(-12, 12) });
  }
  for (let i = 0; i < 20 * power; i++) {
    const a = rand(0, 6.28), s = rand(200, 600);
    addP({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.2, 0.5), size: 2, drag: 2, col: '#ffd36b' });
  }
  addP({ kind: 'flash', x, y, life: 0.18, size: 90 * power });
  decals.push({ kind: 'scorch', x, y, r: rand(34, 46) * power, a: rand(0, 6.28) });
  if (chain) {
    const R = 115 * power;
    for (const zb of zombies) if (!zb.dead && dist(zb.x, zb.y, x, y) < R) killZombie(zb, true);
    for (const t of traffic) if (!t.flying && !t.dead && dist(t.x, t.y, x, y) < R * 0.9) launchCar(t, t.x - x, t.y - y, 260);
    for (const r of rubble) if (!r.dead && dist(r.x, r.y, x, y) < R * 0.8) destroyRubble(r);
  }
}
function destroyRubble(r) {
  r.dead = true;
  for (let i = 0; i < 10; i++) {
    const a = rand(0, 6.28), s = rand(80, 260);
    addP({ kind: 'debris', x: r.x, y: r.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, z: 3, vz: rand(100, 300), life: rand(0.8, 1.5), size: rand(4, 8), drag: 1.5, col: r.col, vr: rand(-10, 10) });
    addP({ kind: 'smoke', x: r.x, y: r.y, vx: Math.cos(a) * s * 0.3, vy: Math.sin(a) * s * 0.3, life: rand(0.8, 1.4), size: rand(10, 18), grow: 20, col: '#a59d92' });
  }
}
function killZombie(zb, byPlayer) {
  if (zb.dead) return;
  zb.dead = true;
  Sound.splat();
  for (let i = 0; i < 18; i++) {
    const a = rand(0, 6.28), s = rand(40, 260);
    addP({ kind: 'blood', x: zb.x, y: zb.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9), size: rand(2, 5), drag: 4, col: pick(['#4f8a2b', '#7a1010', '#2f5d1a', '#a01818']) });
  }
  decals.push({ kind: 'blood', x: zb.x, y: zb.y, r: rand(14, 22), a: rand(0, 6.28), seed: Math.random() });
  decals.push({ kind: 'body', x: zb.x, y: zb.y, a: rand(0, 6.28), shirt: zb.shirt });
  if (byPlayer) {
    kills++;
    addCoins(1);
    popup(zb.x, zb.y - 10, '+1 🧟', '#9dff6b');
  }
}
function addCoins(n) { save.coins += n; runCoins += n; }

function launchCar(t, dx, dy, power) {
  if (t.flying || t.dead) return;
  t.flying = true; t.z = 1; t.vz = rand(430, 640);
  const l = Math.hypot(dx, dy) || 1;
  t.vx = (dx / l) * power + Math.sin(t.a) * t.sp * 0.6;
  t.vy = (dy / l) * power - Math.cos(t.a) * t.sp * 0.6;
  t.spin = rand(-1, 1) * 9 + (Math.random() < 0.5 ? -3 : 3);
  carsBlown++;
  addCoins(3);
  popup(t.x, t.y - 20, '+3 💥', '#ffcc33');
  explosion(t.x, t.y, 0.7, false);
}

function hurt(amount) {
  const p = player;
  if (p.inv > 0 || p.dead) return;
  if (save.up.armor) amount *= 0.75;
  p.hp -= amount;
  hurtFlash = Math.min(1, hurtFlash + amount / 25);
  if (p.hp <= 0) die();
}
function die() {
  const p = player;
  p.hp = 0; p.dead = true; p.deadT = 0;
  explosion(p.x, p.y, 1.8, true);
  persist();
}

// ---------- Girdi ----------
const keys = {};
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  Sound.init();
  if (!e.repeat) onPress(e.code);
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  if (S.state === 'play' && !shopOpen) S.paused = true;
});

function onPress(code) {
  if (code === 'KeyM') { Sound.toggleMute(); return; }
  if (shopOpen) {
    if (code === 'KeyB' || code === 'Escape') closeShop();
    const m = code.match(/^(Digit|Numpad)([1-9])$/);
    if (m) buy(+m[2] - 1);
    return;
  }
  if (code === 'KeyB') { openShop(); return; }
  if (S.state === 'menu' && (code === 'Enter' || code === 'Space')) startGame();
  else if (S.state === 'over' && (code === 'Enter' || code === 'KeyR')) startGame();
  else if (S.state === 'play' && (code === 'KeyP' || code === 'Escape')) S.paused = !S.paused;
}

// ---------- Dokunmatik kontroller (telefon / tablet) ----------
const touchEl = document.getElementById('touch');
const TOUCH_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'ShiftLeft', 'KeyX', 'KeyC'];
let autoGas = true;
try { const v = localStorage.getItem('tzr_autogas'); if (v !== null) autoGas = v === '1'; } catch (e) { /* yoksay */ }
let touchHeld = new Set();

function enableTouch() {
  if (isTouch) return;
  isTouch = true;
  document.body.classList.add('touch');
  resize();
  refreshTouchUI();
}
function refreshTouchUI() {
  touchEl.querySelector('[data-k="KeyX"]').classList.toggle('off', !save.up.gun);
  touchEl.querySelector('[data-k="KeyC"]').classList.toggle('off', !save.up.rocket);
  const ag = touchEl.querySelector('[data-action="autogas"]');
  ag.classList.toggle('on', autoGas);
  ag.textContent = autoGas ? 'OTO GAZ ✓' : 'OTO GAZ ✗';
}
// Tüm aktif parmakları tarar: parmak bir butondan diğerine kaydırılabilir
function applyTouches(list) {
  const held = new Set();
  for (const t of list) {
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const b = el && el.closest('[data-k]');
    if (b && !b.classList.contains('off')) held.add(b.dataset.k);
  }
  touchHeld = held;
  syncTouchKeys();
  touchEl.querySelectorAll('[data-k]').forEach(b => b.classList.toggle('active', held.has(b.dataset.k)));
}
function syncTouchKeys() {
  if (!isTouch) return;
  for (const k of TOUCH_KEYS) keys[k] = touchHeld.has(k);
  if (autoGas && S.state === 'play' && !touchHeld.has('ArrowDown')) keys.ArrowUp = true;
}
function onTouch(e) {
  enableTouch();
  Sound.init();
  if (e.type === 'touchstart') {
    for (const t of e.changedTouches) {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const a = el && el.closest('[data-action]');
      if (!a) continue;
      const act = a.dataset.action;
      if (act === 'pause' && S.state === 'play') S.paused = !S.paused;
      else if (act === 'shop') openShop();
      else if (act === 'autogas') {
        autoGas = !autoGas;
        try { localStorage.setItem('tzr_autogas', autoGas ? '1' : '0'); } catch (err) { /* yoksay */ }
        refreshTouchUI();
      }
    }
    // Duraklatılmışken boş alana dokunmak oyunu sürdürür
    if (S.paused && S.state === 'play' && e.target === canvas) S.paused = false;
  }
  if (e.cancelable) e.preventDefault();
  applyTouches(e.touches);
}
for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
  touchEl.addEventListener(ev, onTouch, { passive: false });
  canvas.addEventListener(ev, onTouch, { passive: false });
}
addEventListener('touchstart', () => enableTouch(), { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.state === 'play') S.paused = true;
});
// iOS çift dokunma ile yakınlaştırmayı engelle
document.addEventListener('gesturestart', e => e.preventDefault());

// ---------- Mağaza ----------
const ITEMS = [
  { id: 'turbo2x', name: '2x Turbo', icon: '🔥', price: 30, desc: 'Turbo deposu 2 katı, tüpler 2 kat doldurur, turbo çok daha hızlı.' },
  { id: 'gun', name: 'Makineli Tüfek', icon: '🔫', price: 40, desc: 'Ateş et (X tuşu / 🔫 butonu). Zombileri ve arabaları vur.' },
  { id: 'gun2', name: 'Çift Namlu', icon: '💥', price: 70, desc: 'Tüfek aynı anda iki mermi atar.', req: 'gun' },
  { id: 'rocket', name: 'Roketatar', icon: '🚀', price: 90, desc: 'Patlayan roket (C tuşu / 🚀 butonu). Yıkıntıları bile parçalar.' },
  { id: 'magnet', name: 'Jeton Mıknatısı', icon: '🧲', price: 35, desc: 'Yakındaki jetonlar sana doğru uçar.' },
  { id: 'armor', name: 'Zırhlı Tampon', icon: '🛡️', price: 50, desc: '+50 maksimum can, araç çarpışmalarında hasar yok.' },
  { id: 'repair', name: 'Tamir Kiti', icon: '🔧', price: 15, desc: 'Canını tamamen doldurur (yarış sırasında).', consumable: true },
];
const shopEl = document.getElementById('shop');
const shopGrid = document.getElementById('shopGrid');
const shopCoinsEl = document.getElementById('shopCoins');
function openShop() { shopOpen = true; renderShop(); shopEl.classList.remove('hidden'); persist(); }
function closeShop() { shopOpen = false; shopEl.classList.add('hidden'); lastT = performance.now(); persist(); }
function canBuy(it) {
  if (!it.consumable && save.up[it.id]) return false;
  if (it.req && !save.up[it.req]) return false;
  if (it.id === 'repair' && (S.state !== 'play' || player.dead || player.hp >= maxHP())) return false;
  return save.coins >= it.price;
}
function renderShop() {
  shopCoinsEl.textContent = save.coins;
  shopGrid.innerHTML = '';
  ITEMS.forEach((it, i) => {
    const owned = !it.consumable && save.up[it.id];
    const el = document.createElement('div');
    el.className = 'card' + (owned ? ' owned' : canBuy(it) ? '' : ' cant');
    let price = owned ? '✔ ALINDI' : `${it.price} 🪙`;
    if (!owned && it.req && !save.up[it.req]) price = `🔒 Önce ${ITEMS.find(x => x.id === it.req).name}`;
    el.innerHTML = `<span class="num">${i + 1}</span><div class="icon">${it.icon}</div><div class="name">${it.name}</div><div class="desc">${it.desc}</div><div class="price">${price}</div>`;
    el.addEventListener('click', () => buy(i));
    shopGrid.appendChild(el);
  });
}
function buy(i) {
  const it = ITEMS[i];
  if (!it || !canBuy(it)) { Sound.tone(150, 0.15, 'square', 0.06); return; }
  save.coins -= it.price;
  if (it.consumable) player.hp = maxHP();
  else { save.up[it.id] = true; if (it.id === 'armor' && S.state === 'play') player.hp += 50; }
  Sound.buy();
  persist();
  renderShop();
  if (isTouch) refreshTouchUI();
}

// ---------- Ekranlar ----------
const startEl = document.getElementById('startScreen');
const overEl = document.getElementById('gameOver');
document.getElementById('startBtn').onclick = () => { Sound.init(); startGame(); };
document.getElementById('restartBtn').onclick = () => { Sound.init(); startGame(); };
document.getElementById('shopBtn').onclick = () => openShop();
document.getElementById('shopClose').onclick = () => closeShop();

function startGame() {
  newGame();
  S.state = 'play'; S.paused = false;
  startEl.classList.add('hidden'); overEl.classList.add('hidden');
  if (isTouch) {
    refreshTouchUI();
    // Telefonlarda tam ekran (destekleniyorsa)
    const de = document.documentElement;
    if (!document.fullscreenElement && de.requestFullscreen) de.requestFullscreen().catch(() => {});
  }
}
function gameOver() {
  S.state = 'over';
  const dm = Math.floor(maxDist);
  const newBest = dm > save.best;
  save.best = Math.max(save.best, dm);
  persist();
  document.getElementById('stats').innerHTML =
    `Mesafe: <b>${dm} m</b>${newBest ? ' 🏆 YENİ REKOR!' : ''}<br>` +
    `En iyi: <b>${save.best} m</b><br>` +
    `Vurulan zombi: <b>${kills}</b> · Patlatılan araç: <b>${carsBlown}</b><br>` +
    `Bu turda kazanılan: <b>${runCoins} 🪙</b> · Toplam: <b>${save.coins} 🪙</b>`;
  overEl.classList.remove('hidden');
}

// ---------- Güncelleme ----------
function update(dt) {
  S.time += dt;
  hintT = Math.max(0, hintT - dt);
  updatePlayer(dt);
  while (genY > player.y - 2800) { genChunk(genY); genY -= CH; }
  updateTraffic(dt);
  updateZombies(dt);
  updateBullets(dt);
  updateItems(dt);
  updateWorldFx(dt);
  updateParticles(dt);
  cleanup();
  updateCamera(dt);
  hurtFlash = Math.max(0, hurtFlash - dt * 1.5);

  const seg = Math.floor(Math.max(0, -player.y) / SEG + 0.08);
  if (seg !== lastSeg) {
    const name = biomeOfSeg(seg);
    if (lastSeg === -1 || name !== biomeOfSeg(lastSeg)) banner = { text: BIOME_NAME[name], life: 3 };
    lastSeg = seg;
  }
  if (banner) { banner.life -= dt; if (banner.life <= 0) banner = null; }
  maxDist = Math.max(maxDist, -player.y / 10);
}

function updatePlayer(dt) {
  const p = player;
  if (p.dead) {
    p.deadT += dt;
    p.vx *= Math.exp(-2 * dt); p.vy *= Math.exp(-2 * dt);
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (Math.random() < 0.6) addP({ kind: 'smoke', x: p.x + rand(-10, 10), y: p.y + rand(-10, 10), vx: rand(-20, 20), vy: rand(-40, -10), life: 1.5, size: 12, grow: 18, col: '#2a2a2a' });
    if (Math.random() < 0.4) addP({ kind: 'fire', x: p.x + rand(-12, 12), y: p.y + rand(-20, 20), vy: -30, life: 0.5, size: 10, grow: -12 });
    if (p.deadT > 1.8 && S.state === 'play') gameOver();
    Sound.setEngine(0, false, false);
    return;
  }
  p.inv = Math.max(0, p.inv - dt);
  p.gunCD -= dt; p.rocketCD -= dt;

  const up = keys.ArrowUp, down = keys.ArrowDown, left = keys.ArrowLeft, right = keys.ArrowRight;
  const hb = keys.Space, sh = keys.ShiftLeft || keys.ShiftRight;
  const fx = Math.sin(p.a), fy = -Math.cos(p.a), rx = Math.cos(p.a), ry = Math.sin(p.a);
  let vf = p.vx * fx + p.vy * fy, vr = p.vx * rx + p.vy * ry;
  const c = roadCX(p.y), hw = roadHW(p.y);
  const onRoad = Math.abs(p.x - c) < hw + SHOULDER;
  const air = p.z > 0;

  const wasTurbo = p.turboOn;
  p.turboOn = sh && p.turbo > 0 && vf > -10;
  if (p.turboOn && !wasTurbo) Sound.turbo();
  const tmul = save.up.turbo2x ? 1.75 : 1.4;
  let maxSp = onRoad ? 560 : 320;
  let acc = 430;
  if (p.turboOn) {
    maxSp *= tmul; acc = save.up.turbo2x ? 1300 : 950;
    p.turbo = Math.max(0, p.turbo - 24 * dt);
    shake(0.4);
  }

  if (!air) {
    if (up || p.turboOn) { if (vf < maxSp) vf += acc * dt; }
    if (down) { vf -= (vf > 0 ? 950 : 320) * dt; if (vf < -220) vf = -220; }
    if (!up && !down && !p.turboOn) vf -= vf * 0.55 * dt;
    if (vf > maxSp) vf -= (vf - maxSp) * 2.5 * dt;
    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    const spF = clamp(Math.abs(vf) / 190, 0, 1) * (vf < 0 ? -1 : 1);
    const turn = 2.7 * (hb ? 1.6 : 1) * (p.turboOn ? 0.85 : 1);
    const grip = hb ? 0.9 : (onRoad ? 7.5 : 4.5);
    vr *= Math.exp(-grip * dt);
    if (hb) vf -= vf * 0.4 * dt;
    p.vx = fx * vf + rx * vr; p.vy = fy * vf + ry * vr;
    p.a += steer * turn * spF * dt;

    // Drift
    const drifting = Math.abs(vr) > 75 && Math.abs(vf) > 140;
    p.drifting = drifting;
    if (drifting) {
      p.driftTime += dt; p.noDrift = 0;
      if (Math.random() < 0.7) {
        const bx = p.x - fx * (p.l / 2 - 10), by = p.y - fy * (p.l / 2 - 10);
        const side = Math.random() < 0.5 ? -1 : 1;
        addP({ kind: 'smoke', x: bx + rx * side * 14, y: by + ry * side * 14, vx: rand(-30, 30), vy: rand(-30, 30), life: rand(0.6, 1.1), size: rand(6, 10), grow: 30, col: '#d8d8d8', alpha: 0.5 });
      }
    } else {
      p.noDrift += dt;
      if (p.noDrift > 0.3 && p.driftTime > 0) {
        if (p.driftTime > 0.9) {
          const bonus = Math.floor(p.driftTime * 2);
          addCoins(bonus);
          p.turbo = Math.min(turboCap(), p.turbo + p.driftTime * 8);
          popup(p.x, p.y - 40, `DRIFT! +${bonus} 🪙`, '#6bd3ff');
          Sound.coin();
        }
        p.driftTime = 0;
      }
    }
    // Lastik izi
    const marking = drifting || (down && vf > 220) || (p.turboOn && vf < 250);
    if (marking) {
      const bx = p.x - fx * (p.l / 2 - 12), by = p.y - fy * (p.l / 2 - 12);
      const wl = [bx - rx * 13, by - ry * 13], wr = [bx + rx * 13, by + ry * 13];
      if (p.lastSkid) {
        skids.push([p.lastSkid[0][0], p.lastSkid[0][1], wl[0], wl[1]]);
        skids.push([p.lastSkid[1][0], p.lastSkid[1][1], wr[0], wr[1]]);
        if (skids.length > 1400) skids.splice(0, skids.length - 1400);
      }
      p.lastSkid = [wl, wr];
    } else p.lastSkid = null;
    // Arazi tozu
    if (!onRoad && Math.abs(vf) > 120 && Math.random() < 0.5) {
      addP({ kind: 'smoke', x: p.x - fx * 30, y: p.y - fy * 30, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.8, size: 8, grow: 25, col: mixColor(GROUND, p.y), alpha: 0.6 });
    }
  } else {
    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    p.a += steer * 1.4 * dt;
    p.lastSkid = null;
  }

  p.x += p.vx * dt; p.y += p.vy * dt;

  // Zıplama fiziği
  if (air || p.vz > 0) {
    p.z += p.vz * dt; p.vz -= 950 * dt;
    if (p.z <= 0) {
      p.z = 0;
      const impact = -p.vz; p.vz = 0;
      shake(Math.min(14, impact / 50));
      Sound.crash();
      for (let i = 0; i < 16; i++) {
        const a = rand(0, 6.28);
        addP({ kind: 'smoke', x: p.x, y: p.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, life: 0.7, size: 10, grow: 30, col: '#bbb', alpha: 0.5 });
      }
      p.lastSkid = null;
    }
  }

  // Turbo alevi
  if (p.turboOn) {
    const ex = p.x - fx * (p.l / 2 + 2), ey = p.y - fy * (p.l / 2 + 2);
    for (let i = 0; i < 3; i++) {
      addP({ kind: 'fire', x: ex + rx * rand(-6, 6), y: ey + ry * rand(-6, 6), z: p.z, vx: -fx * rand(150, 300) + p.vx * 0.6, vy: -fy * rand(150, 300) + p.vy * 0.6, life: rand(0.12, 0.25), size: rand(6, 11), grow: -20, drag: 1, blue: Math.random() < 0.5 });
    }
  }

  // Denize düşme
  if (p.z === 0 && inWater(p.x, p.y)) {
    Sound.splash();
    for (let i = 0; i < 40; i++) {
      const a = rand(0, 6.28), s = rand(50, 300);
      addP({ kind: 'water', x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, z: 2, vz: rand(100, 350), life: rand(0.6, 1.2), size: rand(3, 7), drag: 1.5 });
    }
    decals.push({ kind: 'ripple', x: p.x, y: p.y, t: 0 });
    popup(p.x, p.y, 'DENİZE DÜŞTÜN! -25', '#6bd3ff');
    p.inv = 0;
    hurt(25);
    if (!p.dead) {
      const ny = p.y;
      p.x = roadCX(ny); p.a = roadAngle(ny); p.vx = p.vy = 0; p.inv = 2;
    }
    return;
  }

  // Rampalar
  if (p.z === 0) {
    for (const r of ramps) {
      if (Math.abs(r.y - p.y) > 90) continue;
      const dx = p.x - r.x, dy = p.y - r.y;
      const ca = Math.cos(r.a), sa = Math.sin(r.a);
      const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
      if (Math.abs(lx) < r.w / 2 && Math.abs(ly) < r.h / 2 && vf > 150) {
        p.vz = 220 + vf * 0.55; p.z = 0.5;
        Sound.jump();
        popup(p.x, p.y - 40, 'UÇUŞ! ✈', '#ffe066');
        break;
      }
    }
  }

  // Katı cisimlerle çarpışma (yıkıntı, ağaç, bina...)
  if (p.z < 12) {
    for (const r of rubble) if (!r.dead && Math.abs(r.y - p.y) < 70) collideSolid(r.x, r.y, r.r);
    for (const o of decos) if (o.r && Math.abs(o.y - p.y) < 140) collideSolid(o.x, o.y, o.r);
  }

  // Trafik arabaları
  if (p.z < 28) {
    const pc = carCircles(p);
    for (const t of traffic) {
      if (t.flying || t.dead || Math.abs(t.y - p.y) > 120) continue;
      const tc = carCircles(t);
      let hit = false;
      for (const a of pc) { for (const b of tc) if (dist(a[0], a[1], b[0], b[1]) < a[2] + b[2]) { hit = true; break; } if (hit) break; }
      if (hit) {
        const speed = Math.hypot(p.vx, p.vy);
        launchCar(t, t.x - p.x, t.y - p.y, 160 + speed * 0.7);
        if (!p.turboOn) { p.vx *= 0.72; p.vy *= 0.72; } else { p.vx *= 0.94; p.vy *= 0.94; }
        if (!p.turboOn && !save.up.armor) hurt(7);
      }
    }
  }

  // Zombiler
  const speed = Math.hypot(p.vx, p.vy);
  for (const zb of zombies) {
    if (zb.dead || Math.abs(zb.y - p.y) > 60) continue;
    if (p.z < 18 && dist(zb.x, zb.y, p.x, p.y) < 30) {
      if (speed > 90) { killZombie(zb, true); shake(2); }
      else {
        hurt(14 * dt);
        p.biteT -= dt;
        if (p.biteT <= 0) { popup(p.x, p.y - 30, 'ISIRIYOR! 🧟', '#ff6b6b'); p.biteT = 1; }
      }
    }
  }

  // Silahlar
  if (save.up.gun && keys.KeyX && p.gunCD <= 0) {
    p.gunCD = 0.085;
    const nf = save.up.gun2 ? [-9, 9] : [0];
    for (const o of nf) {
      const sp = rand(-0.04, 0.04);
      const bfx = Math.sin(p.a + sp), bfy = -Math.cos(p.a + sp);
      bullets.push({ kind: 'bullet', x: p.x + fx * 30 + rx * o, y: p.y + fy * 30 + ry * o, z: p.z, vx: bfx * 1400 + p.vx, vy: bfy * 1400 + p.vy, life: 0.7 });
    }
    addP({ kind: 'flash', x: p.x + fx * 34, y: p.y + fy * 34, life: 0.05, size: 18 });
    Sound.shoot();
  }
  if (save.up.rocket && keys.KeyC && p.rocketCD <= 0) {
    p.rocketCD = 0.9;
    bullets.push({ kind: 'rocket', x: p.x + fx * 30, y: p.y + fy * 30, z: p.z, a: p.a, vx: fx * 500 + p.vx, vy: fy * 500 + p.vy, life: 1.6 });
    Sound.rocket();
  }

  Sound.setEngine(Math.abs(vf), p.turboOn, S.state === 'play');
}

function carCircles(o) {
  const fx = Math.sin(o.a), fy = -Math.cos(o.a);
  const r = o.w / 2;
  const n = Math.max(2, Math.round(o.l / o.w));
  const span = o.l / 2 - r;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : -span + (2 * span * i) / (n - 1);
    out.push([o.x + fx * t, o.y + fy * t, r]);
  }
  return out;
}

function collideSolid(sx, sy, sr) {
  const p = player;
  for (const [cx, cy, cr] of carCircles(p)) {
    const dx = cx - sx, dy = cy - sy;
    const d = Math.hypot(dx, dy), m = sr + cr;
    if (d < m && d > 0.001) {
      const nx = dx / d, ny = dy / d;
      p.x += nx * (m - d); p.y += ny * (m - d);
      const vn = p.vx * nx + p.vy * ny;
      if (vn < 0) {
        p.vx -= 1.5 * vn * nx; p.vy -= 1.5 * vn * ny;
        const imp = -vn;
        if (imp > 110) {
          hurt((imp - 110) * 0.06);
          shake(imp / 60);
          Sound.crash();
          for (let i = 0; i < 10; i++) {
            const a = rand(0, 6.28);
            addP({ kind: 'spark', x: sx + nx * sr, y: sy + ny * sr, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, life: 0.3, size: 2, col: '#ffd36b' });
          }
        }
      }
      return;
    }
  }
}

function updateTraffic(dt) {
  for (const t of traffic) {
    if (t.dead) continue;
    if (t.flying) {
      t.x += t.vx * dt; t.y += t.vy * dt;
      t.vx *= Math.exp(-0.4 * dt); t.vy *= Math.exp(-0.4 * dt);
      t.z += t.vz * dt; t.vz -= 950 * dt;
      t.a += t.spin * dt;
      if (Math.random() < 0.9) addP({ kind: 'fire', x: t.x + rand(-8, 8), y: t.y + rand(-8, 8), z: t.z, vx: rand(-30, 30), vy: rand(-30, 30), life: rand(0.2, 0.45), size: rand(8, 14), grow: -15 });
      if (Math.random() < 0.6) addP({ kind: 'smoke', x: t.x, y: t.y, z: t.z, vx: rand(-20, 20), vy: rand(-20, 20), life: rand(0.8, 1.5), size: 12, grow: 22, col: '#333' });
      if (t.z <= 0 && t.vz < 0) {
        t.dead = true;
        if (inWater(t.x, t.y)) {
          Sound.splash();
          for (let i = 0; i < 30; i++) { const a = rand(0, 6.28), s = rand(50, 250); addP({ kind: 'water', x: t.x, y: t.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, z: 2, vz: rand(100, 300), life: 1, size: rand(3, 7), drag: 1.5 }); }
          decals.push({ kind: 'ripple', x: t.x, y: t.y, t: 0 });
        } else {
          explosion(t.x, t.y, t.kind === 'truck' ? 1.5 : 1.15, true);
          decals.push({ kind: 'wreck', x: t.x, y: t.y, a: t.a, w: t.w, l: t.l, kind2: t.kind, fire: 4 });
        }
      }
      continue;
    }
    t.y -= t.sp * dt;
    if (Math.random() < 0.002) t.tLane = pick([-0.62, 0, 0.62]);
    // Önündeki araca çarpmasın
    for (const o of traffic) {
      if (o === t || o.flying || o.dead) continue;
      if (Math.abs(o.lane - t.lane) < 0.35 && o.y < t.y && t.y - o.y < (t.l + o.l) / 2 + 30) { t.sp = Math.min(t.sp, o.sp); if (Math.random() < 0.01) t.tLane = pick([-0.62, 0, 0.62]); }
    }
    t.lane = lerp(t.lane, t.tLane, 1 - Math.exp(-1.2 * dt));
    t.x = roadCX(t.y) + t.lane * roadHW(t.y);
    t.a = roadAngle(t.y) + (t.tLane - t.lane) * 0.3;
    // Yıkıntıya çarparsa patlar
    for (const r of rubble) if (!r.dead && Math.abs(r.y - t.y) < 50 && dist(r.x, r.y, t.x, t.y) < r.r + t.w / 2) { launchCarNoReward(t); break; }
    // Zombi ezme
    for (const zb of zombies) if (!zb.dead && Math.abs(zb.y - t.y) < 40 && dist(zb.x, zb.y, t.x, t.y) < 26) killZombie(zb, false);
  }
}
function launchCarNoReward(t) {
  t.flying = true; t.z = 1; t.vz = rand(350, 500);
  t.vx = Math.sin(t.a) * t.sp * 0.5; t.vy = -Math.cos(t.a) * t.sp * 0.5; t.spin = rand(-8, 8);
  explosion(t.x, t.y, 0.6, false);
}

function updateZombies(dt) {
  const p = player;
  for (const zb of zombies) {
    if (zb.dead) continue;
    const dx = p.x - zb.x, dy = p.y - zb.y, d = Math.hypot(dx, dy);
    let tx, ty;
    if (d < 520 && !p.dead) { tx = dx / d; ty = dy / d; }
    else { zb.wa += rand(-2, 2) * dt; tx = Math.cos(zb.wa); ty = Math.sin(zb.wa); }
    const nx = zb.x + tx * zb.sp * dt, ny = zb.y + ty * zb.sp * dt;
    if (!inWater(nx, ny)) { zb.x = nx; zb.y = ny; } else zb.wa += Math.PI;
    const ta = Math.atan2(tx, -ty);
    let da = ta - zb.a; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283;
    zb.a += da * Math.min(1, 6 * dt);
    zb.ph += dt * zb.sp * 0.09;
  }
}

function updateBullets(dt) {
  for (const b of bullets) {
    b.life -= dt;
    if (b.kind === 'rocket') {
      const fx = Math.sin(b.a), fy = -Math.cos(b.a);
      b.vx += fx * 1600 * dt; b.vy += fy * 1600 * dt;
      addP({ kind: 'smoke', x: b.x, y: b.y, z: b.z, vx: rand(-15, 15), vy: rand(-15, 15), life: 0.7, size: 5, grow: 18, col: '#bbb', alpha: 0.6 });
      addP({ kind: 'fire', x: b.x - fx * 8, y: b.y - fy * 8, z: b.z, life: 0.08, size: 7, grow: -30 });
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    let hit = false;
    for (const zb of zombies) {
      if (zb.dead || Math.abs(zb.y - b.y) > 30) continue;
      if (dist(zb.x, zb.y, b.x, b.y) < 18) {
        hit = true;
        if (b.kind === 'bullet') { zb.hp--; addP({ kind: 'blood', x: zb.x, y: zb.y, vx: b.vx * 0.1, vy: b.vy * 0.1, life: 0.4, size: 3, col: '#4f8a2b' }); if (zb.hp <= 0) killZombie(zb, true); }
        break;
      }
    }
    if (!hit) for (const t of traffic) {
      if (t.flying || t.dead || Math.abs(t.y - b.y) > 70) continue;
      if (carCircles(t).some(c => dist(c[0], c[1], b.x, b.y) < c[2])) {
        hit = true;
        if (b.kind === 'bullet') {
          t.hp--;
          addP({ kind: 'spark', x: b.x, y: b.y, vx: -b.vx * 0.2 + rand(-100, 100), vy: -b.vy * 0.2 + rand(-100, 100), life: 0.2, size: 2, col: '#ffd36b' });
          if (t.hp <= 0) launchCar(t, b.vx, b.vy, 200);
        }
        break;
      }
    }
    if (!hit) for (const r of rubble) {
      if (r.dead || Math.abs(r.y - b.y) > 30) continue;
      if (dist(r.x, r.y, b.x, b.y) < r.r) {
        hit = true;
        if (b.kind === 'bullet') for (let i = 0; i < 3; i++) addP({ kind: 'spark', x: b.x, y: b.y, vx: rand(-200, 200), vy: rand(-200, 200), life: 0.2, size: 2, col: '#ffe9a8' });
        break;
      }
    }
    if (hit || b.life <= 0) {
      b.dead = true;
      if (b.kind === 'rocket') explosion(b.x, b.y, 1.3, true);
    }
  }
  bullets = bullets.filter(b => !b.dead);
}

function updateItems(dt) {
  const p = player;
  if (p.dead) return;
  for (const c of coins) {
    if (c.dead) continue;
    c.ph += dt;
    const d = dist(c.x, c.y, p.x, p.y);
    if (save.up.magnet && d < 260) {
      const s = 700 * dt / Math.max(d, 1);
      c.x += (p.x - c.x) * Math.min(1, s); c.y += (p.y - c.y) * Math.min(1, s);
    }
    const zOk = c.air ? true : p.z < 90;
    if (d < 34 && zOk) {
      c.dead = true; addCoins(1); Sound.coin();
      for (let i = 0; i < 6; i++) addP({ kind: 'spark', x: c.x, y: c.y, vx: rand(-120, 120), vy: rand(-120, 120), life: 0.3, size: 2, col: '#ffe066' });
    }
  }
  for (const k of pickups) {
    if (k.dead) continue;
    k.ph += dt;
    if (dist(k.x, k.y, p.x, p.y) < 40 && p.z < 90) {
      k.dead = true;
      const add = save.up.turbo2x ? 90 : 45;
      p.turbo = Math.min(turboCap(), p.turbo + add);
      popup(k.x, k.y - 20, '+TURBO ⚡', '#6bd3ff');
      Sound.turbo();
      for (let i = 0; i < 16; i++) { const a = rand(0, 6.28); addP({ kind: 'spark', x: k.x, y: k.y, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, life: 0.4, size: 3, col: '#6bd3ff' }); }
    }
  }
}

function updateWorldFx(dt) {
  const p = player;
  for (const o of decos) {
    if (o.kind !== 'firebarrel' || Math.abs(o.y - p.y) > 900) continue;
    if (Math.random() < 0.5) addP({ kind: 'fire', x: o.x + rand(-4, 4), y: o.y + rand(-4, 4), vx: rand(-10, 10), vy: rand(-40, -10), life: rand(0.3, 0.6), size: rand(6, 10), grow: -12 });
    if (Math.random() < 0.08) addP({ kind: 'smoke', x: o.x, y: o.y - 8, vx: rand(-10, 10), vy: rand(-40, -20), life: 1.6, size: 8, grow: 14, col: '#444', alpha: 0.5 });
  }
  for (const d of decals) {
    if (d.kind === 'wreck' && d.fire > 0) {
      d.fire -= dt;
      if (Math.abs(d.y - p.y) < 900 && Math.random() < 0.5) addP({ kind: 'fire', x: d.x + rand(-10, 10), y: d.y + rand(-14, 14), vy: rand(-30, 0), life: rand(0.3, 0.6), size: rand(6, 12), grow: -14 });
      if (Math.random() < 0.2) addP({ kind: 'smoke', x: d.x, y: d.y, vx: rand(-10, 10), vy: rand(-40, -10), life: 1.8, size: 10, grow: 18, col: '#333', alpha: 0.6 });
    }
    if (d.kind === 'ripple') d.t += dt;
  }
  for (const b of boats) {
    const nx = b.x + Math.sin(b.a) * b.sp * dt, ny = b.y - Math.cos(b.a) * b.sp * dt;
    if (inWater(nx, ny) && inWater(nx + Math.sin(b.a) * 40, ny - Math.cos(b.a) * 40)) { b.x = nx; b.y = ny; } else b.a += 1.5 * dt;
  }
}

function updateParticles(dt) {
  for (const q of particles) {
    q.life -= dt;
    const dr = Math.exp(-q.drag * dt);
    q.vx *= dr; q.vy *= dr;
    q.x += q.vx * dt; q.y += q.vy * dt;
    q.size = Math.max(0.1, q.size + q.grow * dt);
    q.rot += q.vr * dt;
    if (q.kind === 'debris' || q.kind === 'water') {
      q.z += q.vz * dt; q.vz -= 900 * dt;
      if (q.z < 0) { q.z = 0; q.vz *= -0.3; q.vx *= 0.5; q.vy *= 0.5; q.vr *= 0.5; }
    }
  }
  particles = particles.filter(q => q.life > 0);
  for (const pp of popups) { pp.life -= dt; pp.y -= 40 * dt; }
  popups = popups.filter(pp => pp.life > 0);
}

function cleanup() {
  const behind = player.y + 1500, ahead = player.y - 4200;
  const keep = o => !o.dead && o.y < behind && o.y > ahead;
  coins = coins.filter(keep); pickups = pickups.filter(keep); ramps = ramps.filter(keep);
  rubble = rubble.filter(keep); traffic = traffic.filter(keep); zombies = zombies.filter(keep);
  decos = decos.filter(keep); boats = boats.filter(keep);
  decals = decals.filter(d => d.y < behind && d.y > ahead && !(d.kind === 'ripple' && d.t > 2));
  if (decals.length > 300) decals.splice(0, decals.length - 300);
  if (skids.length && skids[0][1] > behind) skids = skids.filter(s => s[1] < behind);
}

function updateCamera(dt) {
  const p = player;
  const sp = Math.hypot(p.vx, p.vy);
  const tz = baseZoom() * (1 - clamp(sp / 2400, 0, 0.3));
  cam.zoom = lerp(cam.zoom, tz, 1 - Math.exp(-2 * dt));
  const tx = p.x + p.vx * 0.32, ty = p.y + p.vy * 0.42 - 70 + (isTouch ? 70 / cam.zoom : 0);
  cam.x = lerp(cam.x, tx, 1 - Math.exp(-5 * dt));
  cam.y = lerp(cam.y, ty, 1 - Math.exp(-5 * dt));
  cam.shake = Math.max(0, cam.shake - 40 * dt);
}

// ---------- Çizim ----------
function viewRect() {
  const hw = W / 2 / cam.zoom, hh = H / 2 / cam.zoom;
  return { x0: cam.x - hw - 120, x1: cam.x + hw + 120, y0: cam.y - hh - 160, y1: cam.y + hh + 160 };
}
const inView = (v, x, y, m = 0) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#0b0f17'; ctx.fillRect(0, 0, W, H);
  const sx = (Math.random() - 0.5) * cam.shake, sy = (Math.random() - 0.5) * cam.shake;
  ctx.save();
  ctx.translate(W / 2 + sx, H / 2 + sy);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  const v = viewRect();

  drawGround(v);
  drawSea(v, -1); drawSea(v, 1);
  for (const b of boats) if (inView(v, b.x, b.y, 60)) drawBoat(b);
  drawRoad(v);
  drawDecals(v, false);
  drawSkids();
  for (const r of ramps) if (inView(v, r.x, r.y, 100)) drawRamp(r);
  for (const o of decos) if (inView(v, o.x, o.y, 120) && isLowDeco(o)) drawDeco(o);
  drawDecals(v, true);
  for (const r of rubble) if (inView(v, r.x, r.y, 40)) drawRubble(r);
  for (const k of pickups) if (inView(v, k.x, k.y, 40)) drawPickup(k);
  for (const c of coins) if (!c.air && inView(v, c.x, c.y, 30)) drawCoin(c, 0);
  for (const zb of zombies) if (inView(v, zb.x, zb.y, 30)) drawZombie(zb);
  for (const t of traffic) if (!t.flying && inView(v, t.x, t.y, 80)) drawVehicle(t, false);
  if (player.z <= 0) drawPlayer();
  for (const o of decos) if (inView(v, o.x, o.y, 160) && !isLowDeco(o)) drawDeco(o);
  for (const c of coins) if (c.air && inView(v, c.x, c.y, 30)) drawCoin(c, 60);
  for (const t of traffic) if (t.flying && inView(v, t.x, t.y, 200)) drawVehicle(t, false);
  if (player.z > 0) drawPlayer();
  drawBullets();
  drawParticles(v);
  drawPopups();
  ctx.restore();

  drawHUD();
}

function drawGround(v) {
  const step = 24;
  for (let y = Math.floor(v.y0 / step) * step; y < v.y1; y += step) {
    ctx.fillStyle = mixColor(GROUND, y + step / 2);
    ctx.fillRect(v.x0, y, v.x1 - v.x0, step + 1);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = noisePat;
  ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
}

function drawSea(v, side) {
  const step = 20;
  const fn = side < 0 ? waterLeft : waterRight;
  const pts = [];
  let visible = false;
  for (let y = Math.floor(v.y0 / step) * step; y <= v.y1 + step; y += step) {
    const x = fn(y);
    pts.push([x, y]);
    if (side < 0 ? x > v.x0 : x < v.x1) visible = true;
  }
  if (!visible) return;
  const far = side < 0 ? v.x0 - 50 : v.x1 + 50;
  const clampX = x => (side < 0 ? Math.max(x, far) : Math.min(x, far));
  // Sığ su
  ctx.beginPath();
  ctx.moveTo(far, pts[0][1]);
  for (const [x, y] of pts) ctx.lineTo(clampX(x + side * -8 + Math.sin(y * 0.02 + S.time * 1.5) * 4), y);
  ctx.lineTo(far, pts[pts.length - 1][1]);
  ctx.closePath();
  ctx.fillStyle = '#4fb6d8'; ctx.fill();
  // Derin su
  ctx.beginPath();
  ctx.moveTo(far, pts[0][1]);
  for (const [x, y] of pts) ctx.lineTo(clampX(x + side * 40), y);
  ctx.lineTo(far, pts[pts.length - 1][1]);
  ctx.closePath();
  ctx.fillStyle = '#1f78b4'; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(far, pts[0][1]);
  for (const [x, y] of pts) ctx.lineTo(clampX(x + side * 220), y);
  ctx.lineTo(far, pts[pts.length - 1][1]);
  ctx.closePath();
  ctx.fillStyle = '#17609a'; ctx.fill();
  // Köpük
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 4;
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const xx = clampX(x + Math.sin(y * 0.035 + S.time * 2.2) * 5 - side * 4);
    i ? ctx.lineTo(xx, y) : ctx.moveTo(xx, y);
  });
  ctx.stroke();
  // Dalgacıklar
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  const gs = 95;
  for (let gy = Math.floor(v.y0 / gs) * gs; gy < v.y1; gy += gs) {
    const row = Math.round(gy / gs);
    for (let gx = Math.floor(v.x0 / 120) * 120; gx < v.x1; gx += 120) {
      const x = gx + (row % 2) * 60 + Math.sin(S.time * 1.3 + row) * 12, y = gy;
      if (!(side < 0 ? x < fn(y) - 30 : x > fn(y) + 30)) continue;
      ctx.moveTo(x - 12, y); ctx.quadraticCurveTo(x, y - 6, x + 12, y);
    }
  }
  ctx.stroke();
}

function drawRoad(v) {
  const step = 20;
  const y0 = Math.floor(v.y0 / step) * step;
  const rows = [];
  for (let y = y0; y <= v.y1 + step; y += step) rows.push([y, roadCX(y), roadHW(y)]);
  const poly = (off) => {
    ctx.beginPath();
    rows.forEach(([y, c, h], i) => (i ? ctx.lineTo(c - h - off, y) : ctx.moveTo(c - h - off, y)));
    for (let i = rows.length - 1; i >= 0; i--) { const [y, c, h] = rows[i]; ctx.lineTo(c + h + off, y); }
    ctx.closePath();
  };
  // Banket
  poly(SHOULDER); ctx.fillStyle = '#2b2c30'; ctx.fill();
  // Asfalt (biyoma göre renk bantları)
  ctx.save();
  poly(0); ctx.clip();
  const band = 60;
  for (let y = Math.floor(v.y0 / band) * band; y < v.y1; y += band) {
    ctx.fillStyle = mixColor(ASPHALT, y + band / 2);
    ctx.fillRect(v.x0, y, v.x1 - v.x0, band + 1);
  }
  ctx.globalAlpha = 0.6; ctx.fillStyle = noisePat; ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0); ctx.globalAlpha = 1;
  ctx.restore();
  // Bordür (kırmızı-beyaz)
  for (let i = 0; i < rows.length - 1; i++) {
    const [ya, ca, ha] = rows[i], [yb, cb, hb] = rows[i + 1];
    ctx.fillStyle = (Math.floor(ya / 40) & 1) ? '#d63031' : '#f5f5f5';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(ca + s * ha, ya); ctx.lineTo(ca + s * (ha + 11), ya);
      ctx.lineTo(cb + s * (hb + 11), yb); ctx.lineTo(cb + s * hb, yb);
      ctx.closePath(); ctx.fill();
    }
  }
  // Kenar çizgileri
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 4;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    rows.forEach(([y, c, h], i) => (i ? ctx.lineTo(c + s * (h - 10), y) : ctx.moveTo(c + s * (h - 10), y)));
    ctx.stroke();
  }
  // Şerit çizgileri (kesik)
  ctx.strokeStyle = 'rgba(255,230,120,0.85)'; ctx.lineWidth = 5;
  ctx.beginPath();
  for (const s of [-1 / 3, 1 / 3]) {
    for (let i = 0; i < rows.length - 1; i++) {
      const [ya, ca, ha] = rows[i], [yb, cb, hb] = rows[i + 1];
      if ((Math.floor(ya / 60) & 1) === 0) continue;
      ctx.moveTo(ca + s * 2 * ha * 0.98, ya); ctx.lineTo(cb + s * 2 * hb * 0.98, yb);
    }
  }
  ctx.stroke();
  // Başlangıç çizgisi
  if (v.y0 < 40 && v.y1 > -10) {
    const h = roadHW(0), sq = 14;
    for (let x = -h, i = 0; x < h; x += sq, i++) for (let r = 0; r < 2; r++) {
      ctx.fillStyle = (i + r) & 1 ? '#111' : '#fff';
      ctx.fillRect(x, r * sq - sq, sq, sq);
    }
  }
}

function drawSkids() {
  if (!skids.length) return;
  ctx.strokeStyle = 'rgba(20,20,22,0.45)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath();
  for (const s of skids) { ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); }
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawDecals(v, overlay) {
  for (const d of decals) {
    if (!inView(v, d.x, d.y, 80)) continue;
    const isOver = d.kind === 'body' || d.kind === 'wreck';
    if (isOver !== overlay) continue;
    ctx.save(); ctx.translate(d.x, d.y);
    if (d.kind === 'scorch') {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, d.r);
      g.addColorStop(0, 'rgba(10,8,6,0.75)'); g.addColorStop(0.6, 'rgba(20,15,10,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, d.r, 0, 6.29); ctx.fill();
    } else if (d.kind === 'blood') {
      ctx.rotate(d.a); ctx.fillStyle = 'rgba(70,110,30,0.75)';
      ctx.beginPath(); ctx.ellipse(0, 0, d.r, d.r * 0.7, 0, 0, 6.29); ctx.fill();
      ctx.fillStyle = 'rgba(110,15,15,0.7)';
      ctx.beginPath(); ctx.ellipse(d.r * 0.5, 3, d.r * 0.5, d.r * 0.35, 0.5, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.arc(-d.r, -d.r * 0.5, 3, 0, 6.29); ctx.arc(d.r * 0.9, -d.r * 0.8, 2.5, 0, 6.29); ctx.fill();
    } else if (d.kind === 'body') {
      ctx.rotate(d.a);
      ctx.fillStyle = d.shirt; ctx.beginPath(); ctx.ellipse(0, 0, 10, 6, 0, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#6a9a4c'; ctx.beginPath(); ctx.arc(0, -11, 5, 0, 6.29); ctx.fill();
      ctx.fillRect(-14, -3, 6, 3); ctx.fillRect(9, 2, 7, 3);
    } else if (d.kind === 'wreck') {
      ctx.rotate(d.a);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; rr(-d.w / 2 + 4, -d.l / 2 + 5, d.w, d.l, 8); ctx.fill();
      ctx.fillStyle = '#2a2523'; rr(-d.w / 2, -d.l / 2, d.w, d.l, 8); ctx.fill();
      ctx.fillStyle = '#141110'; rr(-d.w / 2 + 5, -d.l / 2 + d.l * 0.28, d.w - 10, d.l * 0.42, 4); ctx.fill();
      ctx.strokeStyle = '#5a3a20'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-d.w / 2 + 3, -d.l / 4); ctx.lineTo(d.w / 2 - 6, d.l / 5); ctx.stroke();
    } else if (d.kind === 'crack') {
      ctx.rotate(d.a); ctx.scale(d.s, d.s);
      ctx.strokeStyle = 'rgba(25,22,20,0.7)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-15, 6); ctx.lineTo(0, -4); ctx.lineTo(20, 5); ctx.lineTo(42, -2);
      ctx.moveTo(0, -4); ctx.lineTo(6, -22); ctx.moveTo(-15, 6); ctx.lineTo(-20, 20); ctx.stroke();
      ctx.fillStyle = 'rgba(30,28,26,0.5)'; ctx.beginPath(); ctx.ellipse(10, 18, 16, 9, 0.3, 0, 6.29); ctx.fill();
    } else if (d.kind === 'ripple') {
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - d.t / 2)})`; ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) { const r = 10 + d.t * 60 + i * 18; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.29); ctx.stroke(); }
    }
    ctx.restore();
  }
}

function drawRamp(r) {
  ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.a);
  const w = r.w, h = r.h;
  // Gölge (yüksek uç)
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(w / 2 + 10, -h / 2 - 18); ctx.lineTo(-w / 2 + 10, -h / 2 - 18); ctx.closePath(); ctx.fill();
  const g = ctx.createLinearGradient(0, h / 2, 0, -h / 2);
  g.addColorStop(0, '#5d4a33'); g.addColorStop(1, '#b8945e');
  ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h);
  // Sarı-siyah çizgiler
  ctx.save(); ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, 12); ctx.clip();
  for (let x = -w / 2 - 20; x < w / 2 + 20; x += 16) { ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.moveTo(x, -h / 2); ctx.lineTo(x + 8, -h / 2); ctx.lineTo(x + 20, -h / 2 + 12); ctx.lineTo(x + 12, -h / 2 + 12); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  ctx.fillStyle = '#111'; ctx.fillRect(-w / 2, -h / 2 + 12, w, 2);
  // Oklar
  ctx.fillStyle = 'rgba(255,240,180,0.85)';
  for (const ox of [-30, 0, 30]) {
    ctx.beginPath(); ctx.moveTo(ox, -8); ctx.lineTo(ox + 10, 6); ctx.lineTo(ox + 4, 6); ctx.lineTo(ox + 4, 22); ctx.lineTo(ox - 4, 22); ctx.lineTo(ox - 4, 6); ctx.lineTo(ox - 10, 6); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#3a2d1e'; ctx.fillRect(-w / 2 - 4, -h / 2, 4, h); ctx.fillRect(w / 2, -h / 2, 4, h);
  ctx.restore();
}

function drawRubble(r) {
  ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.rot);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); r.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + 5, y + 6) : ctx.moveTo(x + 5, y + 6))); ctx.closePath(); ctx.fill();
  ctx.fillStyle = r.col;
  ctx.beginPath(); r.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath(); ctx.moveTo(r.pts[0][0] * 0.6, r.pts[0][1] * 0.6); ctx.lineTo(r.pts[1][0] * 0.6, r.pts[1][1] * 0.6); ctx.lineTo(r.pts[2][0] * 0.6, r.pts[2][1] * 0.6); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
  if (r.rebar) {
    ctx.strokeStyle = '#6b3d1f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-r.r * 0.3, 0); ctx.lineTo(r.r * 1.3, -r.r * 0.5); ctx.moveTo(0, r.r * 0.3); ctx.lineTo(r.r * 0.9, r.r * 1.1); ctx.stroke();
  }
  ctx.restore();
}

function drawCoin(c, lift) {
  const s = Math.abs(Math.cos(c.ph * 3));
  const y = c.y - lift;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(c.x + 4 + lift * 0.3, c.y + 6 + lift * 0.4, 11, 6, 0, 0, 6.29); ctx.fill();
  ctx.save(); ctx.translate(c.x, y); ctx.scale(Math.max(0.15, s), 1);
  ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#ffd34a'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#fff3a8'; ctx.beginPath(); ctx.arc(-3, -3, 4, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#b8860b'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 1);
  ctx.restore();
}

function drawPickup(k) {
  const pulse = 1 + Math.sin(k.ph * 6) * 0.12;
  ctx.save(); ctx.translate(k.x, k.y);
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 38 * pulse);
  g.addColorStop(0, 'rgba(80,190,255,0.55)'); g.addColorStop(1, 'rgba(80,190,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 38 * pulse, 0, 6.29); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(160,230,255,0.9)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 24 * pulse, k.ph * 3, k.ph * 3 + 4.5); ctx.stroke();
  ctx.rotate(Math.sin(k.ph * 2) * 0.3);
  ctx.fillStyle = '#1565c0'; rr(-8, -15, 16, 30, 6); ctx.fill();
  ctx.fillStyle = '#42a5f5'; rr(-6, -13, 6, 26, 3); ctx.fill();
  ctx.fillStyle = '#ccc'; ctx.fillRect(-4, -20, 8, 6);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.save(); ctx.rotate(-Math.PI / 2); ctx.fillText('N₂O', 0, 2); ctx.restore();
  ctx.restore();
}

function drawZombie(zb) {
  ctx.save(); ctx.translate(zb.x, zb.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(4, 5, 12, 9, 0, 0, 6.29); ctx.fill();
  ctx.rotate(zb.a);
  const sw = Math.sin(zb.ph * 6) * 4;
  // Bacaklar
  ctx.fillStyle = '#2c2c3a';
  ctx.fillRect(-6, 2 + sw, 5, 9); ctx.fillRect(1, 2 - sw, 5, 9);
  // Kollar (öne uzanmış)
  ctx.fillStyle = '#7cab5c';
  ctx.fillRect(-11, -16 + sw * 0.5, 4, 14); ctx.fillRect(7, -16 - sw * 0.5, 4, 14);
  ctx.fillStyle = zb.shirt;
  ctx.beginPath(); ctx.ellipse(0, 0, 11, 7, 0, 0, 6.29); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-4, -2, 3, 5);
  // Kafa
  ctx.fillStyle = '#8fbf6a'; ctx.beginPath(); ctx.arc(0, -3, 6.5, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#4a3a2a'; ctx.beginPath(); ctx.arc(0, -1, 5, 0, Math.PI); ctx.fill();
  ctx.fillStyle = '#ff2a2a'; ctx.fillRect(-3.5, -8, 2, 2); ctx.fillRect(1.5, -8, 2, 2);
  ctx.restore();
}

function drawCarBody(w, l, col, kind, isPlayer) {
  const hw = w / 2, hl = l / 2;
  ctx.fillStyle = '#111';
  if (kind === 'truck') {
    for (const sy of [-hl + 8, hl - 34, hl - 18]) { ctx.fillRect(-hw - 3, sy, 6, 13); ctx.fillRect(hw - 3, sy, 6, 13); }
    ctx.fillStyle = col; rr(-hw, -hl, w, 30, 7); ctx.fill();
    ctx.fillStyle = '#16222e'; rr(-hw + 4, -hl + 6, w - 8, 9, 3); ctx.fill();
    ctx.fillStyle = '#fff6c0'; ctx.fillRect(-hw + 3, -hl + 1, 7, 3); ctx.fillRect(hw - 10, -hl + 1, 7, 3);
    ctx.fillStyle = '#d9d9d9'; rr(-hw + 1, -hl + 33, w - 2, l - 33, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1.5;
    for (let y = -hl + 42; y < hl; y += 10) { ctx.beginPath(); ctx.moveTo(-hw + 3, y); ctx.lineTo(hw - 3, y); ctx.stroke(); }
    ctx.fillStyle = '#ff3030'; ctx.fillRect(-hw + 2, hl - 3, 6, 3); ctx.fillRect(hw - 8, hl - 3, 6, 3);
    return;
  }
  for (const sy of [-hl + 9, hl - 21]) { ctx.fillRect(-hw - 3, sy, 6, 13); ctx.fillRect(hw - 3, sy, 6, 13); }
  const g = ctx.createLinearGradient(-hw, 0, hw, 0);
  g.addColorStop(0, shade(col, -45)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -45));
  ctx.fillStyle = g; rr(-hw, -hl, w, l, 9); ctx.fill();
  if (isPlayer) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(-5, -hl + 2, 3.5, l - 4); ctx.fillRect(1.5, -hl + 2, 3.5, l - 4);
  }
  ctx.fillStyle = '#15202c'; rr(-hw + 4, -hl + l * 0.26, w - 8, l * 0.17, 4); ctx.fill();
  ctx.fillStyle = 'rgba(160,210,255,0.25)'; ctx.fillRect(-hw + 6, -hl + l * 0.27, (w - 12) * 0.4, 3);
  ctx.fillStyle = shade(col, -20); rr(-hw + 5, -hl + l * 0.44, w - 10, l * 0.23, 4); ctx.fill();
  if (isPlayer) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(-5, -hl + l * 0.44, 3.5, l * 0.23); ctx.fillRect(1.5, -hl + l * 0.44, 3.5, l * 0.23); }
  ctx.fillStyle = '#15202c'; rr(-hw + 5, -hl + l * 0.69, w - 10, l * 0.1, 3); ctx.fill();
  ctx.fillStyle = '#fff6c0'; ctx.fillRect(-hw + 3, -hl + 1, 7, 4); ctx.fillRect(hw - 10, -hl + 1, 7, 4);
  ctx.fillStyle = '#ff2a2a'; ctx.fillRect(-hw + 3, hl - 4, 7, 3); ctx.fillRect(hw - 10, hl - 4, 7, 3);
}

function drawVehicle(o) {
  const s = 1 + o.z / 220;
  ctx.save();
  ctx.translate(o.x + 5 + o.z * 0.35, o.y + 7 + o.z * 0.5); ctx.rotate(o.a);
  ctx.fillStyle = `rgba(0,0,0,${0.35 / (1 + o.z / 120)})`;
  rr(-o.w / 2, -o.l / 2, o.w, o.l, 8); ctx.fill();
  ctx.restore();
  ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.a); ctx.scale(s, s);
  drawCarBody(o.w, o.l, o.col, o.kind, false);
  if (o.flying) { ctx.fillStyle = 'rgba(20,10,0,0.35)'; rr(-o.w / 2, -o.l / 2, o.w, o.l, 8); ctx.fill(); }
  ctx.restore();
}

function drawPlayer() {
  const p = player;
  if (p.dead) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
    ctx.fillStyle = '#2a2523'; rr(-p.w / 2, -p.l / 2, p.w, p.l, 9); ctx.fill();
    ctx.fillStyle = '#141110'; rr(-p.w / 2 + 5, -p.l / 2 + 16, p.w - 10, 26, 4); ctx.fill();
    ctx.restore();
    return;
  }
  const s = 1 + p.z / 200;
  ctx.save();
  ctx.translate(p.x + 5 + p.z * 0.35, p.y + 7 + p.z * 0.5); ctx.rotate(p.a);
  ctx.fillStyle = `rgba(0,0,0,${0.38 / (1 + p.z / 120)})`;
  rr(-p.w / 2, -p.l / 2, p.w, p.l, 9); ctx.fill();
  ctx.restore();

  if (p.inv > 0 && Math.floor(S.time * 14) % 2) ctx.globalAlpha = 0.35;
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(s, s);
  // Farlar
  ctx.globalCompositeOperation = 'lighter';
  const lg = ctx.createRadialGradient(0, -p.l / 2 - 40, 5, 0, -p.l / 2 - 40, 70);
  lg.addColorStop(0, 'rgba(255,245,200,0.18)'); lg.addColorStop(1, 'rgba(255,245,200,0)');
  ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(-12, -p.l / 2); ctx.lineTo(-45, -p.l / 2 - 110); ctx.lineTo(45, -p.l / 2 - 110); ctx.lineTo(12, -p.l / 2); ctx.closePath(); ctx.fill();
  if (p.turboOn) {
    const tg = ctx.createRadialGradient(0, 0, 10, 0, 0, 60);
    tg.addColorStop(0, 'rgba(80,180,255,0.35)'); tg.addColorStop(1, 'rgba(80,180,255,0)');
    ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(0, 0, 60, 0, 6.29); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  drawCarBody(p.w, p.l, '#e8202a', 'car', true);
  // Silahlar
  if (save.up.gun) {
    ctx.fillStyle = '#222';
    const offs = save.up.gun2 ? [-8, 8] : [0];
    for (const o of offs) { ctx.fillRect(o - 2.5, -p.l * 0.1 - 22, 5, 26); ctx.fillStyle = '#444'; ctx.fillRect(o - 4, -p.l * 0.1, 8, 8); ctx.fillStyle = '#222'; }
  }
  if (save.up.rocket) {
    ctx.fillStyle = '#3c4a2a';
    rr(-p.w / 2 - 6, -6, 6, 22, 2); ctx.fill(); rr(p.w / 2, -6, 6, 22, 2); ctx.fill();
    ctx.fillStyle = '#c0392b'; ctx.fillRect(-p.w / 2 - 5, -8, 4, 4); ctx.fillRect(p.w / 2 + 1, -8, 4, 4);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function isLowDeco(o) { return o.kind === 'rock' || o.kind === 'bush' || o.kind === 'umbrella' || o.kind === 'burnt' || o.kind === 'firebarrel'; }
function drawDeco(o) {
  ctx.save(); ctx.translate(o.x, o.y);
  const s = o.s;
  switch (o.kind) {
    case 'tree': {
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.arc(14 * s, 16 * s, 30 * s, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#2d5e2a'; ctx.beginPath(); ctx.arc(0, 0, 30 * s, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#3b7a34'; ctx.beginPath(); ctx.arc(-6 * s, -6 * s, 22 * s, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#4f9a44'; ctx.beginPath(); ctx.arc(-10 * s, -10 * s, 12 * s, 0, 6.29); ctx.fill();
      break;
    }
    case 'bush': {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(5, 6, 14 * s, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#3e7a35'; ctx.beginPath(); ctx.arc(-6 * s, 0, 10 * s, 0, 6.29); ctx.arc(6 * s, 2 * s, 11 * s, 0, 6.29); ctx.arc(0, -6 * s, 9 * s, 0, 6.29); ctx.fill();
      break;
    }
    case 'rock': {
      ctx.rotate(o.rot);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(5, 6, 18 * s, 13 * s, 0, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#7d7a74'; ctx.beginPath(); ctx.moveTo(-18 * s, 2); ctx.lineTo(-8 * s, -14 * s); ctx.lineTo(10 * s, -12 * s); ctx.lineTo(18 * s, 4 * s); ctx.lineTo(6 * s, 13 * s); ctx.lineTo(-12 * s, 11 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#9a968e'; ctx.beginPath(); ctx.moveTo(-8 * s, -14 * s); ctx.lineTo(10 * s, -12 * s); ctx.lineTo(2, 0); ctx.closePath(); ctx.fill();
      break;
    }
    case 'palm': {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(22 * s, 26 * s, 26 * s, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#7a5a34'; ctx.beginPath(); ctx.arc(0, 0, 8 * s, 0, 6.29); ctx.fill();
      for (let i = 0; i < 7; i++) {
        ctx.save(); ctx.rotate(o.rot + (i / 7) * 6.283);
        ctx.fillStyle = i % 2 ? '#2f8a3a' : '#3fa34a';
        ctx.beginPath(); ctx.ellipse(0, -18 * s, 6 * s, 20 * s, 0, 0, 6.29); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#6b4a1f'; ctx.beginPath(); ctx.arc(0, 0, 5 * s, 0, 6.29); ctx.fill();
      break;
    }
    case 'umbrella': {
      ctx.fillStyle = '#e8d6a8'; ctx.save(); ctx.rotate(o.rot); ctx.fillRect(14, -8, 14, 26); ctx.fillStyle = o.c; ctx.fillRect(14, -8, 14, 4); ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.arc(6, 8, 22 * s, 0, 6.29); ctx.fill();
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#fff' : o.c;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 22 * s, o.rot + i * 0.785, o.rot + (i + 1) * 0.785); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'cactus': {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(10, 12, 16 * s, 10 * s, 0.6, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#3a8a46';
      rr(-6 * s, -18 * s, 12 * s, 36 * s, 6 * s); ctx.fill();
      rr(-18 * s, -8 * s, 12 * s, 8 * s, 4 * s); ctx.fill(); rr(-18 * s, -16 * s, 7 * s, 14 * s, 3 * s); ctx.fill();
      rr(6 * s, 0, 12 * s, 7 * s, 3 * s); ctx.fill(); rr(11 * s, -10 * s, 7 * s, 15 * s, 3 * s); ctx.fill();
      ctx.fillStyle = '#5bb067'; ctx.fillRect(-2 * s, -16 * s, 2 * s, 32 * s);
      break;
    }
    case 'building': {
      const w = o.bw, h = o.bh;
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-w / 2 + 16, -h / 2 + 20, w, h);
      ctx.fillStyle = '#6e6862';
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w * 0.1, -h / 2); ctx.lineTo(w * 0.2, -h * 0.3); ctx.lineTo(w * 0.32, -h / 2); ctx.lineTo(w / 2, -h / 2);
      ctx.lineTo(w / 2, h * 0.15); ctx.lineTo(w * 0.35, h * 0.28); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4a4540'; ctx.fillRect(-w / 2 + 10, -h / 2 + 10, w - 30, h - 20);
      ctx.fillStyle = '#5c5650';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if ((i + j + Math.floor(o.seed * 9)) % 3) ctx.fillRect(-w / 2 + 16 + i * (w - 40) / 3, -h / 2 + 16 + j * (h - 32) / 3, (w - 50) / 3, (h - 50) / 3);
      ctx.strokeStyle = '#2e2a26'; ctx.lineWidth = 3; ctx.strokeRect(-w / 2 + 10, -h / 2 + 10, w - 30, h - 20);
      ctx.fillStyle = '#8b8680';
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(w * 0.3 + i * 6 - 10, h * 0.3 + (i % 2) * 8, 6 + (i % 3) * 2, 0, 6.29); ctx.fill(); }
      break;
    }
    case 'burnt': {
      ctx.rotate(o.rot);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; rr(-14, -26, 32, 58, 8); ctx.fill();
      ctx.fillStyle = '#3a302a'; rr(-17, -30, 32, 58, 8); ctx.fill();
      ctx.fillStyle = '#1e1a17'; rr(-12, -14, 22, 26, 4); ctx.fill();
      ctx.fillStyle = '#6b3a1a'; ctx.fillRect(-15, 18, 8, 6);
      break;
    }
    case 'firebarrel': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(4, 5, 11, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#5a3a24'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#ff9a1c'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 6.29); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

function drawBoat(b) {
  ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-10, 28); ctx.lineTo(-24, 70); ctx.moveTo(10, 28); ctx.lineTo(24, 70); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(5, 6, 15, 32, 0, 0, 6.29); ctx.fill();
  ctx.fillStyle = b.col;
  ctx.beginPath(); ctx.moveTo(0, -34); ctx.quadraticCurveTo(16, -10, 13, 28); ctx.lineTo(-13, 28); ctx.quadraticCurveTo(-16, -10, 0, -34); ctx.fill();
  ctx.fillStyle = '#8a5a2a'; rr(-8, -6, 16, 22, 3); ctx.fill();
  ctx.fillStyle = '#9fd3f2'; ctx.fillRect(-7, -10, 14, 5);
  ctx.restore();
}

function drawBullets() {
  for (const b of bullets) {
    if (b.kind === 'bullet') {
      ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 3;
      const l = Math.hypot(b.vx, b.vy) || 1;
      ctx.beginPath(); ctx.moveTo(b.x, b.y - b.z * 0.5); ctx.lineTo(b.x - b.vx / l * 16, b.y - b.vy / l * 16 - b.z * 0.5); ctx.stroke();
    } else {
      ctx.save(); ctx.translate(b.x, b.y - b.z * 0.5); ctx.rotate(b.a);
      ctx.fillStyle = '#556b2f'; rr(-3, -10, 6, 20, 3); ctx.fill();
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(-3, -10); ctx.lineTo(0, -15); ctx.lineTo(3, -10); ctx.fill();
      ctx.restore();
    }
  }
}

function drawParticles(v) {
  // Normal karışım
  for (const q of particles) {
    if (q.kind === 'fire' || q.kind === 'flash' || q.kind === 'spark') continue;
    if (!inView(v, q.x, q.y, 50)) continue;
    const t = q.life / q.max;
    const y = q.y - q.z * 0.5;
    if (q.kind === 'smoke') {
      ctx.globalAlpha = clamp(t, 0, 1) * (q.alpha || 0.55);
      ctx.fillStyle = q.col; ctx.beginPath(); ctx.arc(q.x, y, q.size, 0, 6.29); ctx.fill();
    } else if (q.kind === 'debris') {
      ctx.globalAlpha = clamp(q.life * 2, 0, 1);
      ctx.save(); ctx.translate(q.x, y); ctx.rotate(q.rot); ctx.fillStyle = q.col; ctx.fillRect(-q.size / 2, -q.size / 2, q.size, q.size * 0.7); ctx.restore();
    } else if (q.kind === 'blood') {
      ctx.globalAlpha = clamp(q.life * 2, 0, 1);
      ctx.fillStyle = q.col; ctx.beginPath(); ctx.arc(q.x, y, q.size, 0, 6.29); ctx.fill();
    } else if (q.kind === 'water') {
      ctx.globalAlpha = clamp(q.life * 1.5, 0, 1);
      ctx.fillStyle = Math.random() < 0.5 ? '#ffffff' : '#9fdcff'; ctx.beginPath(); ctx.arc(q.x, y, q.size, 0, 6.29); ctx.fill();
    }
  }
  // Toplamsal (ateş, kıvılcım)
  ctx.globalCompositeOperation = 'lighter';
  for (const q of particles) {
    if (!(q.kind === 'fire' || q.kind === 'flash' || q.kind === 'spark')) continue;
    if (!inView(v, q.x, q.y, 100)) continue;
    const y = q.y - q.z * 0.5;
    if (q.kind === 'fire') {
      const t = clamp(q.life / q.max, 0, 1);
      ctx.globalAlpha = clamp(q.life * 3, 0, 1) * 0.9;
      ctx.fillStyle = q.blue ? (t > 0.5 ? '#9fe6ff' : '#2f7dff') : (t > 0.6 ? '#fff1a0' : t > 0.3 ? '#ff9a1c' : '#d63a10');
      ctx.beginPath(); ctx.arc(q.x, y, q.size, 0, 6.29); ctx.fill();
    } else if (q.kind === 'flash') {
      ctx.globalAlpha = clamp(q.life * 6, 0, 1);
      const g = ctx.createRadialGradient(q.x, y, 0, q.x, y, q.size);
      g.addColorStop(0, 'rgba(255,240,200,0.9)'); g.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.x, y, q.size, 0, 6.29); ctx.fill();
    } else {
      ctx.globalAlpha = clamp(q.life * 4, 0, 1);
      ctx.strokeStyle = q.col; ctx.lineWidth = q.size;
      ctx.beginPath(); ctx.moveTo(q.x, y); ctx.lineTo(q.x - q.vx * 0.03, y - q.vy * 0.03); ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function drawPopups() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(20 / cam.zoom)}px "Russo One", system-ui`;
  for (const pp of popups) {
    ctx.globalAlpha = clamp(pp.life * 2, 0, 1);
    ctx.lineWidth = 4 / cam.zoom; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(pp.text, pp.x, pp.y);
    ctx.fillStyle = pp.col; ctx.fillText(pp.text, pp.x, pp.y);
  }
  ctx.globalAlpha = 1;
}

// ---------- HUD ----------
function panel(x, y, w, h) {
  ctx.fillStyle = 'rgba(10,14,24,0.62)'; rr(x, y, w, h, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1.5; ctx.stroke();
}
function drawHUD() {
  const p = player;
  ctx.textBaseline = 'middle';
  const F = s => `${s}px "Russo One", system-ui`;

  // Turbo hız çizgileri
  if (p.turboOn && S.state === 'play') {
    ctx.strokeStyle = 'rgba(180,230,255,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 26; i++) {
      const a = rand(0, 6.28), r1 = rand(Math.min(W, H) * 0.35, Math.max(W, H) * 0.5), r2 = r1 + rand(60, 160);
      ctx.moveTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1); ctx.lineTo(W / 2 + Math.cos(a) * r2, H / 2 + Math.sin(a) * r2);
    }
    ctx.stroke();
  }
  // Hasar / düşük can efekti
  const low = p.hp / maxHP() < 0.3 && !p.dead ? 0.25 + Math.sin(S.time * 6) * 0.1 : 0;
  const vig = Math.max(hurtFlash * 0.6, low);
  if (vig > 0.01) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(255,0,0,0)'); g.addColorStop(1, `rgba(220,0,0,${vig})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  if (isTouch) drawTouchHUD(F);
  else {
  // Sol üst: jeton, mesafe
  panel(14, 14, 210, 92);
  ctx.fillStyle = '#ffd34a'; ctx.beginPath(); ctx.arc(38, 40, 13, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#b8860b'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center'; ctx.fillText('$', 38, 41);
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = F(24); ctx.fillText(save.coins, 60, 41);
  ctx.font = F(14); ctx.fillStyle = '#9fb0cf';
  ctx.fillText(`📏 ${Math.floor(maxDist)} m   🏆 ${Math.max(save.best, Math.floor(maxDist))} m`, 26, 72);
  ctx.fillText(`🧟 ${kills}   💥 ${carsBlown}`, 26, 92);

  // Üst orta: can barı
  const bw = Math.min(320, W * 0.4), bx = W / 2 - bw / 2;
  panel(bx - 12, 14, bw + 24, 42);
  ctx.fillStyle = '#2a1416'; rr(bx + 26, 26, bw - 30, 18, 6); ctx.fill();
  const hpT = clamp(p.hp / maxHP(), 0, 1);
  const hg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  hg.addColorStop(0, '#ff3b3b'); hg.addColorStop(1, hpT > 0.5 ? '#6dff6b' : '#ffb03b');
  ctx.fillStyle = hg; rr(bx + 26, 26, (bw - 30) * hpT, 18, 6); ctx.fill();
  ctx.font = F(18); ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.fillText('❤', bx, 36);
  ctx.font = F(12); ctx.textAlign = 'center'; ctx.fillText(`${Math.ceil(p.hp)} / ${maxHP()}`, bx + 26 + (bw - 30) / 2, 36);

  // Sağ üst: yükseltmeler
  const ups = [];
  if (save.up.turbo2x) ups.push(['🔥', '2x']);
  if (save.up.gun) ups.push(['🔫', 'X']);
  if (save.up.rocket) ups.push(['🚀', 'C']);
  if (save.up.magnet) ups.push(['🧲', '']);
  if (save.up.armor) ups.push(['🛡️', '']);
  const uw = Math.max(1, ups.length) * 46 + 16;
  panel(W - uw - 14, 14, uw, 54);
  if (!ups.length) { ctx.font = F(11); ctx.fillStyle = '#8a9abb'; ctx.textAlign = 'center'; ctx.fillText('B: Garaj', W - uw / 2 - 14, 41); }
  ups.forEach(([ic, k], i) => {
    const x = W - uw - 14 + 12 + i * 46;
    ctx.font = '24px system-ui'; ctx.textAlign = 'left'; ctx.fillText(ic, x, 38);
    if (k) { ctx.font = F(10); ctx.fillStyle = '#ffd84a'; ctx.fillText(k, x + 24, 56); ctx.fillStyle = '#fff'; }
  });
  if (save.up.rocket) {
    const t = clamp(1 - p.rocketCD / 0.9, 0, 1);
    const i = ups.findIndex(u => u[0] === '🚀');
    const x = W - uw - 14 + 12 + i * 46;
    ctx.fillStyle = t >= 1 ? '#6dff9b' : '#ff9a1c'; ctx.fillRect(x, 60, 30 * t, 3);
  }

  // Sol alt: hız göstergesi
  const sp = Math.hypot(p.vx, p.vy) * 0.32;
  const gx = 90, gy = H - 90, gr = 62;
  ctx.fillStyle = 'rgba(10,14,24,0.7)'; ctx.beginPath(); ctx.arc(gx, gy, gr + 12, 0, 6.29); ctx.fill();
  ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(gx, gy, gr, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
  const st = clamp(sp / 330, 0, 1);
  ctx.strokeStyle = p.turboOn ? '#5cc8ff' : st > 0.6 ? '#ff7b1c' : '#ffd84a';
  ctx.beginPath(); ctx.arc(gx, gy, gr, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * st); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = F(30); ctx.fillText(Math.round(sp), gx, gy - 2);
  ctx.font = F(11); ctx.fillStyle = '#9fb0cf'; ctx.fillText('km/s', gx, gy + 22);
  if (p.z > 0) { ctx.fillStyle = '#ffe066'; ctx.fillText('HAVADA!', gx, gy + 40); }

  // Alt orta: turbo barı
  const tw = Math.min(360, W * 0.45), tx = W / 2 - tw / 2, ty = H - 58;
  panel(tx - 12, ty - 26, tw + 24, 58);
  ctx.textAlign = 'left'; ctx.font = F(13); ctx.fillStyle = p.turboOn ? '#9fe6ff' : '#cfe3ff';
  ctx.fillText(`⚡ TURBO ${save.up.turbo2x ? '2x ' : ''}— SHIFT`, tx, ty - 10);
  ctx.textAlign = 'right'; ctx.fillText(`${Math.round(p.turbo)}/${turboCap()}`, tx + tw, ty - 10);
  ctx.fillStyle = '#10223a'; rr(tx, ty + 2, tw, 16, 6); ctx.fill();
  const tt = clamp(p.turbo / turboCap(), 0, 1);
  const tg = ctx.createLinearGradient(tx, 0, tx + tw, 0);
  tg.addColorStop(0, '#1f6fff'); tg.addColorStop(1, '#6bf0ff');
  ctx.fillStyle = tg; rr(tx, ty + 2, tw * tt, 16, 6); ctx.fill();
  if (p.turboOn) { ctx.fillStyle = `rgba(255,255,255,${0.3 + Math.sin(S.time * 30) * 0.2})`; rr(tx, ty + 2, tw * tt, 16, 6); ctx.fill(); }
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2;
  for (let i = 1; i < (save.up.turbo2x ? 8 : 4); i++) { const x = tx + tw * i / (save.up.turbo2x ? 8 : 4); ctx.beginPath(); ctx.moveTo(x, ty + 2); ctx.lineTo(x, ty + 18); ctx.stroke(); }
  }

  // Drift göstergesi
  if (p.driftTime > 0.4 && !p.dead) {
    const dy = isTouch ? H * 0.4 : H * 0.28;
    ctx.textAlign = 'center'; ctx.font = F(26);
    ctx.fillStyle = '#6bd3ff'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 5;
    const txt = `DRIFT ${p.driftTime.toFixed(1)}s`;
    ctx.strokeText(txt, W / 2, dy); ctx.fillText(txt, W / 2, dy);
  }

  // Biyom başlığı
  if (banner && S.state === 'play') {
    const by = isTouch ? 145 : H * 0.18;
    const a = clamp(Math.min(banner.life, 3 - banner.life) * 2, 0, 1);
    ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.font = F(clamp(W / 22, 16, 36));
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(banner.text, W / 2, by); ctx.fillStyle = '#ffe066'; ctx.fillText(banner.text, W / 2, by);
    ctx.globalAlpha = 1;
  }

  // Kontrol ipucu
  if (S.state === 'play' && hintT > 0 && W > 700 && !isTouch) {
    ctx.globalAlpha = clamp(hintT, 0, 1);
    panel(W - 290, H - 150, 276, 136);
    ctx.textAlign = 'left'; ctx.font = '13px system-ui'; ctx.fillStyle = '#d6deee';
    ['↑ ↓ ← →  sür', 'SPACE  el freni / drift', 'SHIFT  turbo', 'X  tüfek · C  roket', 'B  garaj · P  duraklat · M  ses']
      .forEach((l, i) => ctx.fillText(l, W - 274, H - 128 + i * 24));
    ctx.globalAlpha = 1;
  }

  if (S.paused && S.state === 'play' && !shopOpen) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffe066'; ctx.font = F(48); ctx.fillText('DURAKLATILDI', W / 2, H / 2 - 10);
    ctx.font = F(16); ctx.fillStyle = '#cfd8ea';
    ctx.fillText(isTouch ? 'Devam etmek için ekrana dokun' : 'Devam etmek için P · Garaj için B', W / 2, H / 2 + 34);
  }
}

// Dokunmatik cihazlar için sade, üstte toplanmış HUD (alt kısım butonlara ayrılır)
function drawTouchHUD(F) {
  const p = player;
  const sp = Math.hypot(p.vx, p.vy) * 0.32;
  // Sol üst: jeton + mesafe
  panel(10, 10, 150, 44);
  ctx.fillStyle = '#ffd34a'; ctx.beginPath(); ctx.arc(30, 32, 11, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#b8860b'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('$', 30, 33);
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = F(18); ctx.fillText(save.coins, 48, 33);
  ctx.font = F(12); ctx.fillStyle = '#9fb0cf'; ctx.textAlign = 'right'; ctx.fillText(`${Math.floor(maxDist)} m`, 150, 33);
  // Can + turbo barları (üstte, butonların altında kalmaz)
  const bw = Math.min(380, W - 20), bx = W / 2 - bw / 2;
  const y1 = 62;
  panel(bx, y1, bw, 58);
  const iw = bw - 24;
  ctx.textAlign = 'left'; ctx.font = F(11); ctx.fillStyle = '#fff';
  ctx.fillText(`❤ ${Math.ceil(p.hp)}`, bx + 12, y1 + 13);
  ctx.textAlign = 'right'; ctx.fillStyle = p.z > 0 ? '#ffe066' : '#cfe3ff';
  ctx.fillText(p.z > 0 ? `HAVADA! ${Math.round(sp)} km/s` : `${Math.round(sp)} km/s`, bx + bw - 12, y1 + 13);
  ctx.fillStyle = '#2a1416'; rr(bx + 12, y1 + 21, iw, 10, 4); ctx.fill();
  const hpT = clamp(p.hp / maxHP(), 0, 1);
  ctx.fillStyle = hpT > 0.5 ? '#5ee05c' : hpT > 0.25 ? '#ffb03b' : '#ff3b3b'; rr(bx + 12, y1 + 21, iw * hpT, 10, 4); ctx.fill();
  ctx.fillStyle = '#10223a'; rr(bx + 12, y1 + 37, iw, 12, 4); ctx.fill();
  const tt = clamp(p.turbo / turboCap(), 0, 1);
  const tg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  tg.addColorStop(0, '#1f6fff'); tg.addColorStop(1, '#6bf0ff');
  ctx.fillStyle = tg; rr(bx + 12, y1 + 37, iw * tt, 12, 4); ctx.fill();
  if (p.turboOn) { ctx.fillStyle = `rgba(255,255,255,${0.3 + Math.sin(S.time * 30) * 0.2})`; rr(bx + 12, y1 + 37, iw * tt, 12, 4); ctx.fill(); }
  ctx.textAlign = 'center'; ctx.font = F(9); ctx.fillStyle = '#fff'; ctx.fillText(`⚡ TURBO ${save.up.turbo2x ? '2x' : ''}`, bx + bw / 2, y1 + 44);
}

// ---------- Ana döngü ----------
let lastT = performance.now();
let menuT = 0;
function frame(now) {
  const dt = Math.min(0.033, (now - lastT) / 1000);
  lastT = now;
  syncTouchKeys();
  if (S.state === 'play' && !S.paused && !shopOpen) update(dt);
  else if (S.state === 'over') { S.time += dt; updateParticles(dt); updateCamera(dt); Sound.setEngine(0, false, false); }
  else if (S.state === 'menu') {
    menuT += dt; S.time += dt;
    cam.y = -100 - menuT * 120; cam.x = roadCX(cam.y);
    while (genY > cam.y - 2800) { genChunk(genY); genY -= CH; }
    updateTraffic(dt); updateZombies(dt); updateWorldFx(dt); updateParticles(dt);
  } else Sound.setEngine(0, false, false);
  render();
  requestAnimationFrame(frame);
}
newGame();
if (isTouch) refreshTouchUI();
requestAnimationFrame(frame);
