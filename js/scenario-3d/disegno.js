// Disegno degli effetti, direttamente dal modello OBJ (nessuna immagine esterna).
//
// Ogni ambito ha 4 livelli grafici (atlas 2×2) e due texture di dati:
//   aux1 / aux2: per ogni pixel e per ogni livello, QUANDO compare / scompare / cambia colore.
// Il valore codifica la tacca (0–3) e l'ordine dentro la tacca (0 = vicino al data center):
//   enc(k, r) = (k + 0.9·r) / 4 · 255     255 = mai
// Lo shader (js/effects.js) confronta questo valore con lo slider animato: così ogni passaggio di
// stato è una piccola animazione che parte dal data center e si allarga.
//
// Le aree di calore e rumore sono gli oggetti calore_2/3/4 e rumore2/3/4 dell'OBJ.
import { topFaces, tracePolys, parts } from './mappa.js';

// ── Colori ──────────────────────────────────────────────────────────────────────
export const PALETTE = {
  calore: '#ff5a36',
  rumore: '#982268',
  aria: '#ff9edf',
  lavoro: '#1597b3',
  crepe: '#3d3d3d',
  traliccio: '#ffb300',
  tralicciCentro: '#d8f20c',
  contorno: '#ffe82e',
  flora: '#138a52',
};

// ── Utilità ─────────────────────────────────────────────────────────────────────
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const enc = (k, r = 0) => (k == null ? 255 : Math.round(((k + 0.9 * clamp01(r)) / 4) * 255));

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Nel worker si usa OffscreenCanvas; nella pagina (ripiego) un normale <canvas>
function makeCanvas(N) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(N, N);
  const c = document.createElement('canvas');
  c.width = c.height = N;
  return c;
}
const pixels = (canvas) => new Uint8Array(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.buffer);

// Maschera binaria M×M delle facce date
function raster(polyLists, M) {
  const c = makeCanvas(M);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#000';
  x.beginPath();
  // La rete stradale ha molte facce: rasterizzarle a blocchi riduce il costo di fill().
  const batchSize = 2048;
  for (const polygons of polyLists) {
    if (polygons.length <= batchSize) {
      tracePolys(x, polygons, M);
      continue;
    }
    x.fill();
    for (let i = 0; i < polygons.length; i += batchSize) {
      x.beginPath();
      tracePolys(x, polygons.slice(i, i + batchSize), M);
      x.fill();
    }
    x.beginPath();
  }
  x.fill();
  const d = x.getImageData(0, 0, M, M).data;
  const out = new Uint8Array(M * M);
  for (let i = 0; i < M * M; i++) out[i] = d[i * 4 + 3] > 100 ? 1 : 0;
  return out;
}

// Distanza (in celle) dalla cella "1" più vicina — trasformata chamfer a due passate
function distance(mask, M) {
  const d = new Float32Array(M * M);
  for (let i = 0; i < M * M; i++) d[i] = mask[i] ? 0 : 1e9;
  const A = 1, B = Math.SQRT2;
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    const i = y * M + x;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + A);
    if (y > 0) {
      v = Math.min(v, d[i - M] + A);
      if (x > 0) v = Math.min(v, d[i - M - 1] + B);
      if (x < M - 1) v = Math.min(v, d[i - M + 1] + B);
    }
    d[i] = v;
  }
  for (let y = M - 1; y >= 0; y--) for (let x = M - 1; x >= 0; x--) {
    const i = y * M + x;
    let v = d[i];
    if (x < M - 1) v = Math.min(v, d[i + 1] + A);
    if (y < M - 1) {
      v = Math.min(v, d[i + M] + A);
      if (x < M - 1) v = Math.min(v, d[i + M + 1] + B);
      if (x > 0) v = Math.min(v, d[i + M - 1] + B);
    }
    d[i] = v;
  }
  return d;
}

function sampler(grid, M, scale = 1) {
  return (u, v) => {
    const x = Math.max(0, Math.min(M - 1, Math.floor(u * M)));
    const y = Math.max(0, Math.min(M - 1, Math.floor(v * M)));
    return grid[y * M + x] * scale;
  };
}

// Componenti connesse (4-vicini) di una maschera: etichette e aree
function label(mask, M) {
  const lab = new Int32Array(M * M);
  const areas = [0];
  const stack = [];
  let n = 0;
  for (let i = 0; i < M * M; i++) {
    if (!mask[i] || lab[i]) continue;
    n++;
    let area = 0;
    lab[i] = n; stack.push(i);
    while (stack.length) {
      const j = stack.pop(); area++;
      const x = j % M, y = (j / M) | 0;
      if (x > 0 && mask[j - 1] && !lab[j - 1]) { lab[j - 1] = n; stack.push(j - 1); }
      if (x < M - 1 && mask[j + 1] && !lab[j + 1]) { lab[j + 1] = n; stack.push(j + 1); }
      if (y > 0 && mask[j - M] && !lab[j - M]) { lab[j - M] = n; stack.push(j - M); }
      if (y < M - 1 && mask[j + M] && !lab[j + M]) { lab[j + M] = n; stack.push(j + M); }
    }
    areas.push(area);
  }
  return { lab, areas };
}

// Contorni (marching squares) di una maschera binaria: anelli chiusi in coordinate 0–1
function contours(g, M) {
  const W = M + 2;
  const val = (x, y) => (x >= 1 && x <= M && y >= 1 && y <= M ? g[(y - 1) * M + (x - 1)] : 0);
  const Hid = (x, y) => (y * W + x) * 2, Vid = (x, y) => (y * W + x) * 2 + 1;
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b); adj.get(b).push(a);
  };
  for (let y = 0; y <= M; y++) for (let x = 0; x <= M; x++) {
    const code = (val(x, y) << 3) | (val(x + 1, y) << 2) | (val(x + 1, y + 1) << 1) | val(x, y + 1);
    if (code === 0 || code === 15) continue;
    const t = Hid(x, y), b = Hid(x, y + 1), l = Vid(x, y), r = Vid(x + 1, y);
    switch (code) {
      case 1: case 14: link(l, b); break;
      case 2: case 13: link(b, r); break;
      case 3: case 12: link(l, r); break;
      case 4: case 11: link(t, r); break;
      case 6: case 9: link(t, b); break;
      case 7: case 8: link(t, l); break;
      case 5: link(t, r); link(l, b); break;
      case 10: link(t, l); link(b, r); break;
    }
  }
  const pos = (id) => {
    const c = id >> 1, x = c % W, y = (c / W) | 0;
    const p = id & 1 ? [x, y + 0.5] : [x + 0.5, y];
    return [(p[0] - 0.5) / M, (p[1] - 0.5) / M];
  };
  const seen = new Set();
  const loops = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = -1, cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      loop.push(pos(cur));
      const nb = adj.get(cur);
      const nxt = nb.find((n) => n !== prev && !seen.has(n));
      prev = cur; cur = nxt;
    }
    if (loop.length > 8) loops.push(loop);
  }
  return loops;
}

// Semplifica il contorno conservando gli spigoli.
function simplifyLoop(loop, tolerance) {
  const points = [...loop, loop[0]];
  const keep = [points[0]];
  function simplify(first, last) {
    const [x, y] = points[first], [ex, ey] = points[last];
    const dx = ex - x, dy = ey - y, length2 = dx * dx + dy * dy;
    let split = -1, maxDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const px = points[i][0] - x, py = points[i][1] - y;
      const t = length2 ? clamp01((px * dx + py * dy) / length2) : 0;
      const distance = Math.hypot(px - t * dx, py - t * dy);
      if (distance > maxDistance) { split = i; maxDistance = distance; }
    }
    if (split !== -1) {
      simplify(first, split);
      keep.push(points[split]);
      simplify(split, last);
    }
  }
  simplify(0, points.length - 1);
  return keep.length >= 3 ? keep : loop;
}

// Punti a distanza costante lungo una polilinea (chiusa o aperta): [{p:[u,v], dir:[du,dv], s}]
function resample(poly, step, closed) {
  const pts = closed ? [...poly, poly[0]] : poly;
  const out = [];
  let acc = 0, next = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L === 0) continue;
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    while (next <= acc + L) {
      const t = (next - acc) / L;
      out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir, s: next });
      next += step;
    }
    acc += L;
  }
  return { pts: out, length: acc };
}

// Punti casuali distanziati (almeno r) dentro una condizione
function scatter(rand, r, ok, tries = 6000) {
  const cell = r / Math.SQRT2, G = Math.ceil(1 / cell);
  const grid = new Map();
  const out = [];
  for (let t = 0; t < tries; t++) {
    const p = [rand(), rand()];
    if (!ok(p[0], p[1])) continue;
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
    let good = true;
    for (let y = gy - 2; y <= gy + 2 && good; y++) for (let x = gx - 2; x <= gx + 2 && good; x++) {
      const q = grid.get(y * G + x);
      if (q && Math.hypot(q[0] - p[0], q[1] - p[1]) < r) good = false;
    }
    if (!good) continue;
    grid.set(gy * G + gx, p);
    out.push(p);
  }
  return out;
}

// Ordine dentro ciascuna tacca: r = 0 per il più vicino al data center, 1 per il più lontano
function order(items, kKey = 'k', dKey = 'd', rKey = 'r') {
  const lo = {}, hi = {};
  for (const it of items) {
    const k = it[kKey];
    if (k == null) continue;
    lo[k] = Math.min(lo[k] ?? Infinity, it[dKey]);
    hi[k] = Math.max(hi[k] ?? -Infinity, it[dKey]);
  }
  for (const it of items) {
    const k = it[kKey];
    it[rKey] = k == null ? 0 : (it[dKey] - lo[k]) / ((hi[k] - lo[k]) || 1);
  }
  return items;
}

// ── Livello grafico: colore + canali di dati ────────────────────────────────────
class Layer {
  constructor(N) {
    this.N = N;
    this.canvas = makeCanvas(N);
    this.x = this.canvas.getContext('2d');
    this.aux = {};
    this.pad = Math.max(1.6, N / 1024); // i dati coprono anche il bordo sfumato del disegno
  }
  ch(name) {
    if (!this.aux[name]) {
      const c = makeCanvas(this.N).getContext('2d', { willReadFrequently: true });
      c.fillStyle = '#fff';
      c.fillRect(0, 0, this.N, this.N);
      this.aux[name] = c;
    }
    return this.aux[name];
  }
  // path(ctx) aggiunge le forme; style: { fill } oppure { stroke, width }; codes: { canale: 0–255 }
  draw(path, style, codes) {
    const x = this.x;
    x.beginPath(); path(x);
    if (style.fill) { x.fillStyle = style.fill; x.fill(); }
    if (style.stroke) {
      x.strokeStyle = style.stroke; x.lineWidth = style.width;
      x.lineCap = style.cap || 'round'; x.lineJoin = 'round'; x.stroke();
    }
    for (const name in codes) {
      const a = this.ch(name), v = codes[name], g = `rgb(${v},${v},${v})`;
      a.beginPath(); path(a);
      if (style.fill) { a.fillStyle = g; a.fill(); }
      const width = (style.stroke ? style.width : 0) + (style.pad ?? this.pad);
      if (width > 0) {
        a.strokeStyle = g; a.lineWidth = width;
        a.lineCap = style.cap || 'round'; a.lineJoin = 'round'; a.stroke();
      }
    }
  }
}

function pack(N, chans) {
  const out = new Uint8Array(N * N * 4).fill(255);
  chans.forEach((c, ci) => {
    if (!c) return;
    const [L, name] = c;
    if (!L.aux[name]) return;
    const d = L.aux[name].getImageData(0, 0, N, N).data;
    for (let i = 0, j = ci; i < d.length; i += 4, j += 4) out[j] = d[i];
  });
  return out;
}

// Risultato di un ambito: atlas 2N×2N (RGBA non premoltiplicato) + due texture di dati N×N
function finish(N, layers, aux1, aux2) {
  const atlas = makeCanvas(2 * N);
  const x = atlas.getContext('2d', { willReadFrequently: true });
  layers.forEach((L, i) => { if (L) x.drawImage(L.canvas, (i % 2) * N, Math.floor(i / 2) * N); });
  return { atlas: pixels(atlas), aux1: pack(N, aux1), aux2: pack(N, aux2), N };
}

// ── Glifi ───────────────────────────────────────────────────────────────────────
const diamond = (x, cx, cy, s) => {
  x.moveTo(cx - s, cy); x.lineTo(cx, cy - s); x.lineTo(cx + s, cy); x.lineTo(cx, cy + s); x.closePath();
};

// ════════════════════════════════════════════════════════════════════════════════
export function buildEffects(m, N = 2048, traffic = null, onProgress = () => {}) {
  const f = N / 2048;   // le misure dei glifi sono pensate per una tavola di 2048 px
  const G = 512;        // risoluzione delle maschere di lavoro
  const R = rng(20251123);

  // ── Geometria di base ─────────────────────────────────────────────────────────
  const F = {
    dc: topFaces(m, 'DATACENTER'),
    case: topFaces(m, 'ABITAZIONI'),
    scuole: topFaces(m, 'SCUOLE'),
    campi: topFaces(m, 'CAMPI'),
    parchi: topFaces(m, 'PARCHI'),
    industrie: topFaces(m, 'INDUSTRIE'),
    cascine: topFaces(m, 'CASCINE'),
    strade: topFaces(m, 'STRADE'),
    acqua: topFaces(m, /^(?:ACQUA|CORS[OI][ _]D[' _-]?ACQUA|FIUM[EI]|ROGGI[AE]|CANAL[EI]|NAVIGLI[O]?)(?:[._ -]|$)/i, { all: true }),
    reti: topFaces(m, 'RETI_ELETTRICHE', { all: true }),
    tralicci: topFaces(m, 'TRALICCI_ELETTRICITA'),
  };
  const zonePolys = (re) => topFaces(m, re, { all: true });

  const dcMask = raster([F.dc], G);
  const dcD = distance(dcMask, G);
  const dcd = sampler(dcD, G, 1 / G);           // distanza dal data center (unità tavola)
  let ox = 0, oy = 0, on = 0;
  for (let i = 0; i < G * G; i++) if (dcMask[i]) { ox += i % G; oy += (i / G) | 0; on++; }
  const O = on ? [(ox / on + 0.5) / G, (oy / on + 0.5) / G] : [0.41, 0.2];

  const campi = sampler(raster([F.campi], G), G);
  const parchi = sampler(raster([F.parchi], G), G);
  const builtMask = raster([F.case, F.scuole, F.industrie, F.cascine, F.dc, F.strade], G);
  const builtNear = sampler(distance(builtMask, G), G, 1 / G);

  // ── Centro abitato: case raggruppate, contorno ────────────────────────────────
  const houses = raster([F.case, F.scuole], G);
  const dH = distance(houses, G);
  const grown = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) grown[i] = dH[i] < 0.03 * G ? 1 : 0;
  const outside = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) outside[i] = grown[i] ? 0 : 1;
  const dOut = distance(outside, G);
  let town = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) town[i] = dOut[i] > 0.018 * G ? 1 : 0;
  {
    // riempie i buchi
    const bg = new Uint8Array(G * G);
    for (let i = 0; i < G * G; i++) bg[i] = town[i] ? 0 : 1;
    const { lab } = label(bg, G);
    const border = new Set();
    for (let i = 0; i < G; i++) { border.add(lab[i]); border.add(lab[(G - 1) * G + i]); border.add(lab[i * G]); border.add(lab[i * G + G - 1]); }
    for (let i = 0; i < G * G; i++) if (bg[i] && !border.has(lab[i])) town[i] = 1;
    // via i gruppi piccoli (cascine isolate)
    const { lab: tl, areas } = label(town, G);
    for (let i = 0; i < G * G; i++) if (town[i] && areas[tl[i]] < 0.004 * G * G) town[i] = 0;
  }
  const inTown = sampler(town, G);
  let tx = 0, ty = 0, tn = 0;
  for (let i = 0; i < G * G; i++) if (town[i]) { tx += i % G; ty += (i / G) | 0; tn++; }
  const T = tn ? [(tx / tn + 0.5) / G, (ty / tn + 0.5) / G] : [0.62, 0.72];
  const townLoops = contours(town, G).map((l) => simplifyLoop(l, 0.0035));

  // ── Aree di calore e rumore (oggetti dell'OBJ) ────────────────────────────────
  const zones = (names) => {
    const masks = names.map((re) => raster([zonePolys(re)], G));
    const z = new Int8Array(G * G).fill(-1);
    for (let i = 0; i < G * G; i++) {
      for (let k = 0; k < masks.length; k++) if (masks[k][i]) { z[i] = k + 1; break; }
    }
    return z;
  };
  const calZ = zones([/^calore_?2$/i, /^calore_?3$/i, /^calore_?4$/i]);
  for (let i = 0; i < G * G; i++) if (dcD[i] < 0.045 * G) calZ[i] = 0; // tacca 0: solo attorno al sito
  const calore = sampler(calZ, G);
  const noiseZones = zones([/^rumore_?2$/i, /^rumore_?3$/i, /^rumore_?4$/i]);
  const rumore = sampler(noiseZones, G);
  const noiseEdge = sampler(distance(noiseZones.map((k) => Number(k < 0)), G), G, 1 / G);

  const out = { origin: O };

  // ════ SALUTE: rumore · calore · aria ════════════════════════════════════════
  {
    const Lcal = new Layer(N), Lrum = new Layer(N), Laria = new Layer(N);
    // calore: griglia di pallini, più grandi vicino al data center
    const heatRadiusFar = 3.75, heatRadiusExtra = 0.95;
    const sp = 9 * f, items = [];
    for (let y = sp / 2; y < N; y += sp) for (let x = sp / 2; x < N; x += sp) {
      const u = x / N, v = y / N, k = calore(u, v);
      if (k < 0) continue;
      const d = dcd(u, v);
      items.push({ k, d, x, y, rad: f * (heatRadiusFar + heatRadiusExtra * clamp01(1 - d / 0.45)) });
    }
    order(items).forEach((it) => Lcal.draw((c) => { c.moveTo(it.x + it.rad, it.y); c.arc(it.x, it.y, it.rad, 0, TAU); },
      { fill: PALETTE.calore }, { a: enc(it.k, it.r * 0.92) }));

    // Tratteggio viola inclinato, più spesso vicino al data center.
    const angle = Math.PI / 6, dx = Math.cos(angle), dy = -Math.sin(angle);
    const noiseStrokeFar = 3.7, noiseStrokeExtra = 9.2;
    const hatches = [], step = 4 * f;
    for (let offset = -N; offset < N; offset += 11 * f) {
      for (let t = -N; t < N; t += step) {
        const x = N / 2 + t * dx - offset * dy, y = N / 2 + t * dy + offset * dx;
        const u = x / N, v = y / N;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const k = rumore(u, v);
        if (k < 1) continue;
        const d = dcd(u, v);
        const proximity = clamp01(1 - d / 0.24);
        const strength = proximity ** 2 * clamp01(noiseEdge(u, v) / 0.024);
        hatches.push({ k, d, x, y, width: (noiseStrokeFar + noiseStrokeExtra * strength) * f });
      }
    }
    order(hatches).forEach((h) => Lrum.draw((c) => {
      const half = step * 0.52;
      c.moveTo(h.x - half * dx, h.y - half * dy);
      c.lineTo(h.x + half * dx, h.y + half * dy);
    }, { stroke: PALETTE.rumore, width: h.width, cap: 'butt' }, { a: enc(h.k, h.r * 0.92) }));

    // Emissioni: gruppetti distanziati e quadratini isolati lungo la nube.
    const airRandom = rng(7315);
    const du = T[0] - O[0], dv = T[1] - O[1], length = Math.hypot(du, dv) || 1;
    const plume = (u, v) => {
      const x = u - O[0], y = v - O[1];
      const t = (x * du + y * dv) / (length * length);
      const w = Math.abs(x * dv - y * du) / length;
      return dcd(u, v) < 0.055 || (t > 0 && t < 1.25 && w < 0.045 + 0.095 * t);
    };
    const squareSize = 24 * f;
    const centers = scatter(airRandom, 0.037, (u, v) => dcd(u, v) < 0.065);
    const satellites = scatter(airRandom, 0.041, (u, v) => plume(u, v) && dcd(u, v) >= 0.065);
    const clusters = [];
    const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const addCluster = (u, v, count, k) => {
      const seed = Math.round(airRandom() * 250);
      const cells = [[0, 0]];
      const used = new Set(['0,0']);
      const frontier = new Map(neighbors.map(([x, y]) => [`${x},${y}`, [x, y]]));
      while (cells.length < count) {
        const options = [...frontier];
        const [key, [x, y]] = options[Math.floor(airRandom() * options.length)];
        frontier.delete(key);
        used.add(key);
        cells.push([x, y]);
        for (const [dx, dy] of neighbors) {
          const nx = x + dx, ny = y + dy, adjacent = `${nx},${ny}`;
          if (!used.has(adjacent)) frontier.set(adjacent, [nx, ny]);
        }
      }
      // Una griglia comune fa combaciare anche i quadratini di gruppi vicini.
      const cx = Math.round(u * N / squareSize), cy = Math.round(v * N / squareSize);
      clusters.push({ cells: cells.map(([x, y]) => [(cx + x) * squareSize, (cy + y) * squareSize]),
        k, d: dcd(u, v), seed });
    };
    addCluster(O[0], O[1], 48, 1);
    centers.forEach(([u, v]) => addCluster(u, v, 9 + Math.floor(airRandom() * 15), 2));
    satellites.forEach(([u, v]) => {
      const d = dcd(u, v);
      addCluster(u, v, 1 + Math.floor(airRandom() * (d < 0.24 ? 7 : 4)), d < 0.24 ? 2 : 3);
    });
    order(clusters).sort((a, b) => b.k - a.k).forEach((cluster) => Laria.draw((c) => {
      cluster.cells.forEach(([x, y]) => c.rect(x - squareSize / 2, y - squareSize / 2, squareSize, squareSize));
    }, { fill: PALETTE.aria }, { a: enc(cluster.k, cluster.r * 0.92), s: cluster.seed }));

    out.salute = finish(N, [Lcal, Lrum, Laria, null],
      [[Lcal, 'a'], [Lrum, 'a'], [Laria, 'a'], null],
      [null, null, [Laria, 's'], null]);
    onProgress(0.25);
  }

  // ════ ECONOMIA: lavoro · traffico · valore delle case ═══════════════════════
  {
    const Ltown = new Layer(N), Llav = new Layer(N), Lsegni = new Layer(N);
    // La maschera del centro abitato ritaglia i rombi disegnati nello shader.
    Ltown.draw((c) => tracePolys(c, townLoops, N), { fill: '#fff' }, {});

    // Posti di lavoro sul sito e nelle immediate vicinanze.
    const jobs = scatter(R, 0.019, (u, v) => dcd(u, v) < 0.036, 12000).map(([u, v]) => {
      const q = R();
      return { u, v, k: 0, d: dcd(u, v), kd: q < 0.35 ? 1 : q < 0.68 ? 2 : q < 0.90 ? 3 : null, rnd: R() };
    });
    order(jobs); order(jobs, 'kd', 'rnd', 'rd');
    jobs.forEach((j) => {
      const x = j.u * N, y = j.v * N, r = 12 * f;
      Llav.draw((c) => c.arc(x, y, r, 0, TAU),
        { fill: '#fff', stroke: PALETTE.lavoro, width: 6 * f }, { a: enc(0, j.r), d: enc(j.kd, j.rd) });
    });

    // strade rovinate dai camion (crepe lungo i percorsi del traffico)
    if (traffic) {
      const cracks = [];
      traffic.paths.forEach((p) => {
        resample(p.points, 0.02, false).pts.forEach((q, i) => {
          if (i === 0) return;
          cracks.push({ ...q, k: i % 2 ? 2 : 3, d: dcd(q.p[0], q.p[1]) });
        });
      });
      order(cracks).forEach((q) => {
        const x = q.p[0] * N, y = q.p[1] * N, nx = -q.dir[1], ny = q.dir[0], s = 13 * f, t = 4.5 * f;
        Lsegni.draw((c) => {
          c.moveTo(x - nx * s, y - ny * s);
          c.lineTo(x - nx * s / 3 + q.dir[0] * t, y - ny * s / 3 + q.dir[1] * t);
          c.lineTo(x + nx * s / 3 - q.dir[0] * t, y + ny * s / 3 - q.dir[1] * t);
          c.lineTo(x + nx * s, y + ny * s);
        }, { stroke: PALETTE.crepe, width: 2.8 * f }, { a: enc(q.k, q.r) });
      });
    }
    out.economia = finish(N, [Ltown, null, Llav, Lsegni],
      [null, null, [Llav, 'a'], [Lsegni, 'a']],
      [[Llav, 'd'], null, null, null]);
    onProgress(0.5);
  }

  // ════ ENERGIA: corrente in casa · bollette · tralicci ══════════════════════
  {
    const Lbol = new Layer(N), Lcont = new Layer(N), Ltr = new Layer(N);
    // Un ordine casuale e stabile per ogni edificio.
    const billRandom = rng(9182);
    for (const house of parts(m, 'ABITAZIONI', { withFaces: true })) {
      const rank = billRandom();
      Lbol.draw((c) => tracePolys(c, house.faces, N), { fill: '#fff', stroke: '#fff', width: 2.1 * f, pad: 0 },
        { a: enc(0, rank * 0.92), s: Math.round(rank * 255) });
    }

    // Contorno continuo, spesso e spigoloso.
    townLoops.forEach((loop) => {
      let best = 0, nearest = Infinity;
      loop.forEach(([u, v], i) => {
        const d = dcd(u, v);
        if (d < nearest) { nearest = d; best = i; }
      });
      const ring = [...loop.slice(best), ...loop.slice(0, best)];
      const edges = ring.map((a, i) => {
        const b = ring[(i + 1) % ring.length];
        return { a, b, length: Math.hypot(b[0] - a[0], b[1] - a[1]) };
      });
      const length = edges.reduce((total, edge) => total + edge.length, 0);
      let offset = 0;
      for (const edge of edges) {
        const { a, b } = edge;
        const segments = Math.max(1, Math.ceil(edge.length / 0.006));
        for (let i = 0; i < segments; i++) {
          const start = i / segments, end = (i + 1) / segments;
          const distance = offset + edge.length * start;
          const seed = Math.floor(distance / 0.045) * 37 % 251;
          Lcont.draw((c) => {
            c.moveTo((a[0] + (b[0] - a[0]) * start) * N, (a[1] + (b[1] - a[1]) * start) * N);
            c.lineTo((a[0] + (b[0] - a[0]) * end) * N, (a[1] + (b[1] - a[1]) * end) * N);
          }, { stroke: PALETTE.contorno, width: 12 * f }, { a: enc(0, 0.92 * distance / length), s: seed });
        }
        offset += edge.length;
      }
    });

    // tralicci
    const pyl = parts(m, 'TRALICCI_ELETTRICITA');
    const chainParts = pyl.filter((p) => Math.max(p.box[2] - p.box[0], p.box[3] - p.box[1]) > 0.06);
    const singles = pyl.filter((p) => !chainParts.includes(p)).map((p) => p.c);
    const items = [];
    const crossAt = (u, v, k, d = dcd(u, v)) => items.push({ type: 'x', u, v, k, d });
    const chainAt = (a, b, k) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.round(L / 0.012));
      for (let i = 0; i < n; i++) {
        const p0 = [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n];
        const p1 = [a[0] + (b[0] - a[0]) * (i + 1) / n, a[1] + (b[1] - a[1]) * (i + 1) / n];
        items.push({ type: 'c', a: p0, b: p1, k, d: dcd((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2) });
      }
    };
    const line = (pts, k, spacing = 0.05, fromStart = true) => {
      for (let i = 1; i < pts.length; i++) chainAt(pts[i - 1], pts[i], k);
      const { pts: q } = resample(pts, spacing, false);
      q.forEach((p, i) => { if (i || fromStart) crossAt(p.p[0], p.p[1], k); });
    };

    // 1 · la linea fitta vicino al data center (tacca 0)
    chainParts.forEach((p) => {
      let mx = 0, my = 0;
      p.pts.forEach(([x, y]) => { mx += x; my += y; });
      mx /= p.pts.length; my /= p.pts.length;
      let sxx = 0, syy = 0, sxy = 0;
      p.pts.forEach(([x, y]) => { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); });
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), dx = Math.cos(ang), dy = Math.sin(ang);
      let lo = Infinity, hi = -Infinity;
      p.pts.forEach(([x, y]) => { const t = (x - mx) * dx + (y - my) * dy; lo = Math.min(lo, t); hi = Math.max(hi, t); });
      const r = 0.0107;
      const a = [mx + dx * (lo + r), my + dy * (lo + r)], b = [mx + dx * (hi - r), my + dy * (hi - r)];
      line([a, b], 0, 0.0213);
    });

    // Dorsali esistenti, presenti dal primo scenario.
    singles.forEach(([u, v]) => crossAt(u, v, 0));
    for (const network of parts(m, 'RETI_ELETTRICHE')) {
      const [left, top, right, bottom] = network.box;
      const axis = right - left >= bottom - top ? 0 : 1;
      const towers = singles.filter(([u, v]) => network.pts.some(([x, y]) => Math.hypot(x - u, y - v) < 0.015));
      towers.sort((a, b) => a[axis] - b[axis]);
      for (let i = 1; i < towers.length; i++) {
        const a = towers[i - 1], b = towers[i];
        chainAt(a, b, 0);
        for (const t of [1 / 3, 2 / 3]) {
          crossAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0);
        }
      }
    }
    // nuove linee: prima attorno al data center, poi verso il paese, poi su tutto il comune
    NEW_LINES.forEach(({ k, pts }) => line(pts, k, 0.045, false));

    order(items).sort((a, b) => b.k - a.k).forEach((it) => {
      const code = { a: enc(it.k, it.r * 0.92) };
      if (it.type === 'x') {
        const x = it.u * N, y = it.v * N, s = 12 * f, o = 6 * f;
        Ltr.draw((c) => { for (const [ax, ay] of [[-o, -o], [o, o], [-o, o], [o, -o]]) diamond(c, x + ax, y + ay, s); }, { fill: PALETTE.traliccio }, code);
        Ltr.draw((c) => diamond(c, x, y, 10 * f), { fill: PALETTE.tralicciCentro }, code);
      } else {
        const ax = it.a[0] * N, ay = it.a[1] * N, bx = it.b[0] * N, by = it.b[1] * N;
        const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / (4.5 * f)));
        for (const col of [0, 1]) {
          Ltr.draw((c) => {
            for (let i = col; i <= n; i += 2) diamond(c, ax + (bx - ax) * i / n, ay + (by - ay) * i / n, 5 * f);
          }, { fill: col ? PALETTE.traliccio : PALETTE.tralicciCentro }, code);
        }
      }
    });
    out.energia = finish(N, [Lbol, Lcont, Ltr, null],
      [[Lbol, 'a'], [Lcont, 'a'], [Ltr, 'a'], null],
      [[Lbol, 's'], [Lcont, 's'], null, null]);
    onProgress(0.75);
  }

  // ════ AMBIENTE: suolo · animali e piante · acqua sotto terra ════════════════
  {
    const Lfal = new Layer(N), Lsuo = new Layer(N), Lflo = new Layer(N);
    // Preferisci i corsi d'acqua dell'OBJ. In loro assenza usa i tracciati della reference.
    const waterCode = { water: 0 };
    if (F.acqua.length) {
      Lfal.draw((c) => tracePolys(c, F.acqua, N), { fill: '#fff', pad: 0 }, waterCode);
    } else {
      for (const path of WATER_REFERENCE) {
        Lfal.draw((c) => {
          c.moveTo(path[0][0] * N, path[0][1] * N);
          for (let i = 1; i < path.length - 1; i++) {
            const [u, v] = path[i], [nextU, nextV] = path[i + 1];
            c.quadraticCurveTo(u * N, v * N, (u + nextU) * N / 2, (v + nextV) * N / 2);
          }
          c.lineTo(path.at(-1)[0] * N, path.at(-1)[1] * N);
        }, { stroke: '#fff', width: N * 0.016 }, waterCode);
      }
    }
    // pozzi (cascine)
    // un pozzo per cascina: gli edifici vicini sono la stessa cascina
    const farms = [];
    parts(m, 'CASCINE').forEach((p) => {
      const g = farms.find((q) => Math.hypot(q.c[0] / q.n - p.c[0], q.c[1] / q.n - p.c[1]) < 0.03);
      if (g) { g.c[0] += p.c[0]; g.c[1] += p.c[1]; g.n++; } else farms.push({ c: [...p.c], n: 1 });
    });
    const wells = farms.map((q) => ({ c: [q.c[0] / q.n, q.c[1] / q.n] })).map((p) => {
      const d = dcd(p.c[0], p.c[1]);
      return { u: p.c[0], v: p.c[1], k: 0, d, kb: d < 0.12 ? 1 : d < 0.35 ? 2 : 3 };
    });
    order(wells); order(wells, 'kb', 'd', 'rb');
    wells.forEach((w) => {
      const x = w.u * N, y = w.v * N, r = 11 * f;
      const code = { a: enc(0, w.r), b: enc(w.kb, w.rb) };
      Lfal.draw((c) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }, { stroke: '#ffffff', width: 3.2 * f }, code);
      Lfal.draw((c) => { c.moveTo(x + 3.5 * f, y); c.arc(x, y, 3.5 * f, 0, TAU); }, { fill: '#ffffff' }, code);
    });

    // Rete continua ritagliata sulle singole parcelle dell'OBJ.
    const tile = makeCanvas(Math.round(13 * f));
    const grid = tile.getContext('2d');
    const meshSize = tile.width;
    grid.fillStyle = 'rgba(255,255,255,0.22)';
    grid.fillRect(0, 0, meshSize, meshSize);
    grid.fillStyle = '#fff';
    grid.fillRect(0, 0, meshSize, 1.8 * f);
    grid.fillRect(0, 0, 1.8 * f, meshSize);
    const mesh = Lsuo.x.createPattern(tile, 'repeat');
    const fields = parts(m, 'CAMPI', { withFaces: true }).filter((field) => field.faces.length);
    fields.forEach((field) => {
      field.distance = Math.min(...field.pts.map(([u, v]) => dcd(u, v)));
    });
    fields.sort((a, b) => a.distance - b.distance);
    fields.forEach((field, i) => {
      // Le soglie sono distribuite all'interno dei tre passaggi dello slider.
      const share = (i + 0.5) / fields.length;
      const start = share < 0.23 ? share / 0.23 :
        share < 0.56 ? 1 + (share - 0.23) / 0.33 : 2 + (share - 0.56) / 0.44;
      const threshold = Math.round((0.04 + start * 0.94) / 3 * 255);
      Lsuo.draw((c) => tracePolys(c, field.faces, N), { fill: mesh, pad: 0 }, { b: threshold });
    });

    // animali e piante: cerchi verdi che si allontanano e spariscono
    const wild = (u, v) => (campi(u, v) || parchi(u, v)) && builtNear(u, v) > 0.006;
    const fl = scatter(R, 0.05, wild).map(([u, v]) => {
      const d = dcd(u, v), q = R();
      const kd = d < 0.13 ? 1 : d < 0.35 ? (q < 0.6 ? 2 : 3) : (q < 0.25 ? 2 : q < 0.93 ? 3 : null);
      return { u, v, k: 0, d, kd, rnd: R() };
    });
    // si spostano poco più in là (compaiono alla tacca 1)
    scatter(R, 0.06, (u, v) => wild(u, v) && dcd(u, v) > 0.14 && dcd(u, v) < 0.24, 1500)
      .forEach(([u, v]) => fl.push({ u, v, k: 1, d: dcd(u, v), kd: R() < 0.5 ? 2 : 3, rnd: R() }));
    // nuovi spazi verdi vicino al sito (solo tacca 0)
    scatter(R, 0.04, (u, v) => builtNear(u, v) > 0.008 && !campi(u, v) && dcd(u, v) > 0.01 && dcd(u, v) < 0.07 && !inTown(u, v), 1500)
      .forEach(([u, v]) => fl.push({ u, v, k: 0, d: dcd(u, v), kd: 1, rnd: R() }));
    order(fl); order(fl, 'kd', 'd', 'rd');
    fl.forEach((p) => {
      const x = p.u * N, y = p.v * N, r = 13 * f;
      Lflo.draw((c) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }, { fill: '#fff', stroke: PALETTE.flora, width: 6 * f },
        { a: enc(p.k, p.r), d: enc(p.kd, p.rd) });
    });

    out.ambiente = finish(N, [Lfal, Lsuo, Lflo, null],
      [[Lfal, 'a'], null, [Lflo, 'a'], [Lfal, 'water']],
      [[Lfal, 'b'], [Lsuo, 'b'], [Lflo, 'd'], null]);
    onProgress(1);
  }

  return out;
}

// Tracciati indicativi ricavati dalla reference, in coordinate normalizzate.
const WATER_REFERENCE = [
  [[-0.02, 0.38], [0.02, 0.37], [0.04, 0.392], [0.055, 0.36], [0.075, 0.384],
    [0.10, 0.353], [0.128, 0.394], [0.147, 0.371], [0.18, 0.375], [0.167, 0.41],
    [0.20, 0.428], [0.205, 0.45], [0.25, 0.449], [0.266, 0.493], [0.289, 0.505],
    [0.287, 0.53], [0.323, 0.57], [0.348, 0.646], [0.383, 0.652], [0.398, 0.68],
    [0.432, 0.699], [0.451, 0.76], [0.482, 0.764], [0.52, 0.742], [0.548, 0.759],
    [0.596, 0.768], [0.613, 0.793], [0.645, 0.795], [0.668, 0.819], [0.70, 0.771],
    [0.713, 0.797], [0.738, 0.831], [0.773, 0.834], [0.814, 0.803], [0.844, 0.816],
    [0.818, 0.788], [0.858, 0.757], [0.891, 0.775], [0.858, 0.809], [0.892, 0.812],
    [0.903, 0.776], [0.934, 0.8], [0.967, 0.793], [1.02, 0.807]],
  [[0.573, -0.018], [0.583, 0.032], [0.601, 0.044], [0.593, 0.061], [0.619, 0.071],
    [0.605, 0.106], [0.642, 0.082], [0.625, 0.136], [0.661, 0.154], [0.687, 0.164],
    [0.68, 0.183], [0.705, 0.209], [0.759, 0.215], [0.752, 0.249], [0.755, 0.277],
    [0.806, 0.327], [0.765, 0.344], [0.775, 0.369], [0.798, 0.365], [0.797, 0.397],
    [0.821, 0.417], [0.797, 0.434], [0.828, 0.459], [0.81, 0.465], [0.825, 0.494],
    [0.788, 0.518], [0.819, 0.517], [0.791, 0.558], [0.817, 0.554], [0.818, 0.592],
    [0.837, 0.603], [0.877, 0.598], [0.895, 0.63], [0.917, 0.635], [0.916, 0.662],
    [0.951, 0.702], [1.02, 0.735]],
];

// Nuove linee elettriche (coordinate 0–1 sulla tavola) e tacca in cui compaiono
const NEW_LINES = [
  { k: 1, pts: [[0.575, 0.105], [0.6, 0.15], [0.51, 0.2]] },
  { k: 1, pts: [[0.681, 0.181], [0.62, 0.33], [0.5, 0.29]] },
  { k: 2, pts: [[0.62, 0.33], [0.7, 0.5]] },
  { k: 2, pts: [[0.5, 0.29], [0.47, 0.31], [0.52, 0.46]] },
  { k: 2, pts: [[0.776, 0.261], [0.8, 0.48]] },
  { k: 3, pts: [[0.137, 0.482], [0.42, 0.6]] },
  { k: 3, pts: [[0.126, 0.58], [0.3, 0.92]] },
  { k: 3, pts: [[0.8, 0.48], [0.88, 0.6], [0.99, 0.82]] },
  { k: 3, pts: [[0.3, 0.92], [0.42, 0.86], [0.6, 0.99]] },
];
