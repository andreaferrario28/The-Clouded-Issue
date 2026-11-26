// Traffico: triangolini che si muovono lungo le strade verso il data center.
// Tacca bassa: pochi e veloci. Salendo: rallentano e aumentano, fino all'ingorgo (fermi).
// Percorsi ricavati dal livello "traffico" del file Illustrator (tools/percorsi_traffico.py).
import * as THREE from 'three';

// valori per tacca 0, 1, 2, 3
export const TRAFFIC = {
  density: [7, 14, 28, 58],          // triangoli per unità di percorso (1 = lato della tavola)
  speed: [0.05, 0.026, 0.009, 0.0],  // velocità (lati della tavola al secondo)
  color: '#005068',
};

const lerpTbl = (t, s) => {
  if (s >= 3) return t[3];
  const i = Math.floor(s);
  return t[i] + (t[i + 1] - t[i]) * (s - i);
};

export async function loadTraffic() {
  const response = await fetch(new URL('../../Assets/3D/traffic.json', import.meta.url));
  if (!response.ok) throw new Error('Percorsi del traffico non disponibili');
  const data = await response.json();
  data.paths.forEach((p) => {
    p.cum = [0];
    for (let i = 1; i < p.points.length; i++) {
      const [x0, y0] = p.points[i - 1], [x1, y1] = p.points[i];
      p.cum.push(p.cum[i - 1] + Math.hypot(x1 - x0, y1 - y0));
    }
    p.length = p.cum[p.cum.length - 1];
    p.offset = Math.random() * p.length;
  });
  return data;
}

function pointAt(p, d) {
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < d) i++;
  const [x0, y0] = p.points[i - 1], [x1, y1] = p.points[i];
  const seg = p.cum[i] - p.cum[i - 1] || 1e-6;
  const t = Math.min(1, Math.max(0, (d - p.cum[i - 1]) / seg));
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, x1 - x0, y1 - y0];
}

const MAX = 400;

// toModel(u, v) → [x, y, z]; plane: 'xz' (modello 3D) oppure 'xy' (mini-mappa)
export function createTrafficMesh(data, { plane = 'xz', scale = 1, lift = 0 } = {}) {
  const r = data.size * 1.0 * scale;
  const g = new THREE.BufferGeometry();
  // triangolo con la punta verso +X
  const v = plane === 'xz'
    ? [r, 0, 0, -r * 0.7, 0, -r * 0.75, -r * 0.7, 0, r * 0.75]
    : [r, 0, 0, -r * 0.7, -r * 0.75, 0, -r * 0.7, r * 0.75, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  const mat = new THREE.MeshBasicMaterial({ color: TRAFFIC.color, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.InstancedMesh(g, mat, MAX);
  mesh.renderOrder = 100;
  mesh.count = 0;
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  const axis = plane === 'xz' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);

  // aggiorna: s = tacca (0–3, anche frazionaria durante il passaggio),
  // vis = visibilità dell'ambito economia (0–1): i triangoli compaiono via via
  mesh.userData.update = (dt, s, vis) => {
    vis = +vis;
    mesh.visible = vis > 0.001;
    if (!mesh.visible) return;
    const step = Math.round(s);
    const speed = lerpTbl(TRAFFIC.speed, s);
    let k = 0;
    for (const p of data.paths) {
      p.offset = (p.offset + speed * dt) % p.length;
      const n = Math.round(Math.max(1, Math.round(p.length * TRAFFIC.density[step])) * Math.min(1, vis));
      const gap = p.length / n;
      for (let i = 0; i < n && k < MAX; i++) {
        const jitter = step >= 2 ? (Math.sin(i * 12.9898 + p.length * 78.2) * 0.5) * gap * 0.35 : 0;
        const d = ((p.offset + i * gap + jitter) % p.length + p.length) % p.length;
        const [u, w, du, dw] = pointAt(p, d);
        if (plane === 'xz') {
          pos.set(u * 0.5 - 0.25, lift, w * 0.5 - 0.25);
          q.setFromAxisAngle(axis, Math.atan2(-dw, du));
        } else {
          pos.set(u, w, lift);
          q.setFromAxisAngle(axis, Math.atan2(dw, du));
        }
        m.compose(pos, q, sc);
        mesh.setMatrixAt(k++, m);
      }
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
  };
  return mesh;
}
