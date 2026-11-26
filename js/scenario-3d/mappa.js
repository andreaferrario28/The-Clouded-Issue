// Lettura del modello OBJ di Lacchiarella (senza three.js: gira anche nel worker, js/lavoro.js).
// Lo stesso file serve a due cose:
//   1. il modello 3D (meshArrays → js/modello3d.js)
//   2. la pianta vista dall'alto, da cui vengono disegnati tutti gli effetti (js/disegno.js)
// Coordinate della pianta: u = (x + 0.25) / 0.5, v = (z + 0.25) / 0.5  → 0–1 sulla tavola (v verso sud).

export const MODEL_URL = new URL('../../Assets/3D/lacchiarella.obj', import.meta.url);

// Scarica l'OBJ mostrando l'avanzamento (onProgress riceve 0–1)
export async function loadMappa(url = MODEL_URL, onProgress = () => {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('OBJ non trovato: ' + url);
  const total = +res.headers.get('content-length') || 18.5e6;
  let text;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(Math.min(1, got / total));
    }
    const all = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    text = new TextDecoder().decode(all);
  } else {
    text = await res.text();
  }
  onProgress(1);
  return parseOBJ(text);
}

// ── Parser minimo (v, vn, o, f) ─────────────────────────────────────────────────
export function parseOBJ(text) {
  const V = [], VN = [];
  const objects = [];
  let cur = null;
  const newObj = (name) => { cur = { name, fv: [], fn: [], fs: [0] }; objects.push(cur); };
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const c0 = line.charCodeAt(0), c1 = line.charCodeAt(1);
    if (c0 === 118 /* v */) {
      if (c1 === 32) { const p = line.split(/\s+/); V.push(+p[1], +p[2], +p[3]); }
      else if (c1 === 110 /* n */) { const p = line.split(/\s+/); VN.push(+p[1], +p[2], +p[3]); }
    } else if (c0 === 102 /* f */ && c1 === 32) {
      if (!cur) newObj('default');
      const p = line.trim().split(/\s+/);
      const nv = V.length / 3, nn = VN.length / 3;
      for (let i = 1; i < p.length; i++) {
        const t = p[i].split('/');
        let a = parseInt(t[0], 10); a = a < 0 ? nv + a : a - 1;
        let n = t[2] ? parseInt(t[2], 10) : 0; n = t[2] ? (n < 0 ? nn + n : n - 1) : -1;
        cur.fv.push(a); cur.fn.push(n);
      }
      cur.fs.push(cur.fv.length);
    } else if (c0 === 111 /* o */ && c1 === 32) {
      newObj(line.slice(2).trim());
    }
  }
  objects.forEach((o) => { o.fv = Int32Array.from(o.fv); o.fn = Int32Array.from(o.fn); o.fs = Int32Array.from(o.fs); });
  return { V: Float32Array.from(V), VN: Float32Array.from(VN), objects: objects.filter((o) => o.fs.length > 1) };
}

// ── Modello 3D: triangoli e normali di ogni oggetto ─────────────────────────────
export function meshArrays(m) {
  const { V, VN } = m;
  return m.objects.map((o) => {
    const vertices = new Map();
    const positions = [];
    const normals = [];
    const indices = [];
    const normalStride = VN.length / 3 + 1;
    const put = (corner) => {
      const vertex = o.fv[corner];
      const normal = o.fn[corner];
      const key = vertex * normalStride + normal + 1;
      let index = vertices.get(key);
      if (index === undefined) {
        index = vertices.size;
        vertices.set(key, index);
        positions.push(V[vertex * 3], V[vertex * 3 + 1], V[vertex * 3 + 2]);
        normals.push(VN[normal * 3] || 0, VN[normal * 3 + 1] || 0, VN[normal * 3 + 2] || 0);
      }
      indices.push(index);
    };
    for (let f = 0; f < o.fs.length - 1; f++) {
      const s = o.fs[f], e = o.fs[f + 1];
      for (let j = s + 1; j < e - 1; j++) { put(s); put(j); put(j + 1); }
    }
    const IndexArray = vertices.size > 65536 ? Uint32Array : Uint16Array;
    return {
      name: o.name,
      pos: Float32Array.from(positions),
      nor: Float32Array.from(normals),
      indices: IndexArray.from(indices),
      hasNormals: o.fn[0] >= 0,
    };
  });
}

// ── Pianta 2D ───────────────────────────────────────────────────────────────────
export const toU = (x) => (x + 0.25) / 0.5;

export function objectsNamed(m, name) {
  const re = name instanceof RegExp ? name : null;
  return m.objects.filter((o) => (re ? re.test(o.name) : o.name === name));
}

// Facce rivolte verso l'alto (o verso il basso), proiettate sulla pianta: array di [[u,v],...]
export function topFaces(m, name, { all = false } = {}) {
  const out = [];
  for (const o of objectsNamed(m, name)) {
    for (let f = 0; f < o.fs.length - 1; f++) {
      const face = projectedFace(m, o, f, all);
      if (face) out.push(face);
    }
  }
  return out;
}

function projectedFace({ V, VN }, o, f, all = false) {
  const s = o.fs[f], e = o.fs[f + 1];
  if (e - s < 3) return null;
  const n = o.fn[s];
  if (!all && n >= 0 && Math.abs(VN[n * 3 + 1]) < 0.5) return null;
  const pts = [];
  for (let j = s; j < e; j++) {
    const a = o.fv[j];
    pts.push([toU(V[a * 3]), toU(V[a * 3 + 2])]);
  }
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  if (Math.abs(area) < 1e-12) return null;
  if (area < 0) pts.reverse();
  return pts;
}

// Aggiunge al percorso corrente del contesto le facce date, scalate a S pixel
export function tracePolys(ctx, polys, S) {
  for (const p of polys) {
    ctx.moveTo(p[0][0] * S, p[0][1] * S);
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0] * S, p[i][1] * S);
    ctx.closePath();
  }
}

// Parti separate di un oggetto (es. i singoli tralicci): punti 2D di ciascuna
export function parts(m, name, { withFaces = false } = {}) {
  const { V } = m;
  const out = [];
  for (const o of objectsNamed(m, name)) {
    const par = new Map();
    const find = (a) => {
      if (!par.has(a)) { par.set(a, a); return a; }
      let r = a;
      while (par.get(r) !== r) r = par.get(r);
      while (par.get(a) !== r) { const nx = par.get(a); par.set(a, r); a = nx; }
      return r;
    };
    for (let f = 0; f < o.fs.length - 1; f++) {
      const s = o.fs[f], e = o.fs[f + 1];
      const r0 = find(o.fv[s]);
      for (let j = s + 1; j < e; j++) { const r = find(o.fv[j]); if (r !== r0) par.set(r, r0); }
    }
    const groups = new Map();
    for (let j = 0; j < o.fv.length; j++) {
      const a = o.fv[j], r = find(a);
      if (!groups.has(r)) groups.set(r, new Set());
      groups.get(r).add(a);
    }
    const faces = new Map();
    if (withFaces) {
      for (let f = 0; f < o.fs.length - 1; f++) {
        const polygon = projectedFace(m, o, f);
        if (!polygon) continue;
        const root = find(o.fv[o.fs[f]]);
        if (!faces.has(root)) faces.set(root, []);
        faces.get(root).push(polygon);
      }
    }
    for (const [root, set] of groups) {
      const pts = [...set].map((a) => [toU(V[a * 3]), toU(V[a * 3 + 2])]);
      let cx = 0, cy = 0;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) {
        cx += x; cy += y;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      out.push({ pts, c: [cx / pts.length, cy / pts.length], box: [x0, y0, x1, y1], faces: faces.get(root) ?? [] });
    }
  }
  return out;
}
