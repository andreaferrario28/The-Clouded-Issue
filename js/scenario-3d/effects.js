// Effetti proiettati dall'alto sul modello (del territorio).
// Le immagini degli effetti sono disegnate da js/disegno.js a partire dall'OBJ.
//
// Ogni ambito ha 4 tacche (0–3 = scenari 1–4).
// Animazione: P = visibilità (0→1) × (tacca + 1). Un elemento della tacca k compare quando P supera
// k + 0.9·r, dove r è la sua distanza (relativa) dal data center: ogni passaggio parte dal sito e si allarga.
import * as THREE from 'three';

export const CAT_KEYS = ['salute', 'economia', 'energia', 'ambiente']; // = componenti x,y,z,w

// Velocità delle animazioni
const STEP_SPEED = 1.6; // tacche al secondo
const SHOW_SPEED = 0.9; // comparsa di un ambito (0→1) al secondo

export function makeEffectTextures(fx, renderer) {
  const aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  const tex = {};
  const image = (arr, size, premultiply) => {
    const t = new THREE.DataTexture(arr, size, size, THREE.RGBAFormat);
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    t.premultiplyAlpha = premultiply;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = aniso;
    t.needsUpdate = true;
    return t;
  };
  CAT_KEYS.forEach((k) => {
    const c = fx[k];
    const t = image(c.atlas, 2 * c.N, true);
    const data = (arr) => {
      const d = new THREE.DataTexture(arr, c.N, c.N, THREE.RGBAFormat);
      d.magFilter = d.minFilter = THREE.NearestFilter;
      d.generateMipmaps = false;
      d.flipY = false;
      d.needsUpdate = true;
      return d;
    };
    tex[k] = { C: t, A: data(c.aux1), B: data(c.aux2) };
  });
  return tex;
}

export function effectUniforms(tex, origin, effect = -1) {
  return {
    uSC: { value: tex.salute.C }, uSA: { value: tex.salute.A }, uSB: { value: tex.salute.B },
    uEC: { value: tex.economia.C }, uEA: { value: tex.economia.A }, uEB: { value: tex.economia.B },
    uNC: { value: tex.energia.C }, uNA: { value: tex.energia.A }, uNB: { value: tex.energia.B },
    uAC: { value: tex.ambiente.C }, uAA: { value: tex.ambiente.A }, uAB: { value: tex.ambiente.B },
    uStep: { value: new THREE.Vector4(0, 0, 0, 0) }, // tacca (0–3), animata
    uShow: { value: new THREE.Vector4(0, 0, 0, 0) }, // visibilità dell'ambito (0–1), animata
    uTime: { value: 0 },
    uEffect: { value: effect },
    uOrigin: { value: new THREE.Vector2(...origin) },
  };
}

export const FX_GLSL = /* glsl */`
uniform sampler2D uSC; uniform sampler2D uSA; uniform sampler2D uSB;
uniform sampler2D uEC; uniform sampler2D uEA; uniform sampler2D uEB;
uniform sampler2D uNC; uniform sampler2D uNA; uniform sampler2D uNB;
uniform sampler2D uAC; uniform sampler2D uAA; uniform sampler2D uAB;
uniform vec4 uStep;
uniform vec4 uShow;
uniform float uTime;
uniform int uEffect;
bool allowsEffect(int effect) { return uEffect < 0 || uEffect == effect; }
uniform vec2 uOrigin;

vec4 fxCol(sampler2D t, vec2 uv, int i) {
  vec2 q = vec2(float(i - (i / 2) * 2), float(i / 2));
  return texture(t, (q + uv) * 0.5);           // premoltiplicato
}
// 0 → 1 quando P supera la soglia codificata (v = 1: mai)
float reach(float v, float P) { return v > 0.985 ? 0.0 : smoothstep(v * 4.0, v * 4.0 + 0.14, P); }
// peso della tacca k (1 sulla tacca, 0 a una tacca di distanza)
float near(float s, float k) { return max(0.0, 1.0 - abs(s - k)); }
// tacca "locale": durante un passaggio, gli elementi vicini al data center cambiano per primi
float locS(float s, float r) {
  if (s >= 3.0) return 3.0;
  float k = floor(s);
  return k + clamp((s - k - r * 0.6) / 0.4, 0.0, 1.0);
}
vec3 tbl3(vec3 a, vec3 b, vec3 c, vec3 d, float s) {
  if (s < 1.0) return mix(a, b, s);
  if (s < 2.0) return mix(b, c, s - 1.0);
  return mix(c, d, min(s - 2.0, 1.0));
}
float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
// spento a scatti, a caso: rate = cambi al secondo, p = probabilità di essere spento
float off(float seed, float rate, float p) {
  float t = floor(uTime * rate + seed * 17.0);
  return step(hash1(t + seed * 91.7), p);
}
// pulsazione lenta 0–1 diversa per ogni elemento
float puff(float seed, float speed) { return smoothstep(0.25, 0.85, 0.5 + 0.5 * sin(uTime * speed + seed * 40.0)); }
vec3 over(vec3 col, vec4 c, float vis) { return col * (1.0 - c.a * vis) + c.rgb * vis; }

vec3 applyEffects(vec3 col, vec2 uv) {
  const float diamondDensity = 40.0;
  float diamondEdge = clamp(diamondDensity * (fwidth(uv.x) + fwidth(uv.y)) * 0.5, 0.001, 0.12);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return col;
  uv = clamp(uv, vec2(0.0006), vec2(0.9994));
  vec4 c;

  vec4 p = uShow * (uStep + 1.0);
  vec4 ea = uShow.y > 0.001 ? texture(uEA, uv) : vec4(1.0);
  vec4 aa = uShow.w > 0.001 ? texture(uAA, uv) : vec4(1.0);
  vec4 ab = uShow.w > 0.001 ? texture(uAB, uv) : vec4(1.0);

  // Dal livello più basso al più alto.
  if (uShow.x > 0.001) {
    vec4 sa = texture(uSA, uv);
    if (allowsEffect(0)) col = over(col, fxCol(uSC, uv, 0), reach(sa.r, p.x) * 0.86);             // calore
    float phase = fract(uTime / 5.0);
    float burst = smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.32, 0.5, phase));
    float loud = mix(1.0, 0.76 + 0.24 * burst, near(uStep.x, 1.0));
    if (allowsEffect(1)) col = over(col, fxCol(uSC, uv, 1), reach(sa.g, p.x) * loud);              // rumore
  }

  if (uShow.y > 0.001 && allowsEffect(8)) {
    c = fxCol(uEC, uv, 0);                                                   // svalutazione
    vec2 grid = uv * diamondDensity;
    vec2 point = abs(fract(grid) - 0.5);
    vec2 cell = floor(grid);
    vec2 group = floor(cell * 0.5);
    float variation = hash1(dot(cell, vec2(59.0, 113.0)) + 0.7);
    float cluster = hash1(dot(group, vec2(43.0, 71.0)) + 1.3);
    // Alcuni gruppi raggiungono la dimensione massima e si toccano all'ultima tacca.
    float size = cluster > 0.76 ? 1.0 : mix(0.54, 0.94, variation);
    float radius = tbl3(vec3(0.26), vec3(0.34), vec3(0.43), vec3(0.50), uStep.y).r * size;
    float diamonds = 1.0 - smoothstep(radius - diamondEdge, radius + diamondEdge, point.x + point.y);
    c.rgb *= tbl3(vec3(0.16, 0.43, 0.76), vec3(0.12, 0.29, 0.69), vec3(0.27, 0.17, 0.60), vec3(0.32, 0.10, 0.40), uStep.y);
    col = over(col, c, diamonds * uShow.y * 0.97);
  }

  if (uShow.w > 0.001) {
    c = fxCol(uAC, uv, 1);                                                   // consumo di suolo
    float start = ab.g * 3.0;
    float brown = smoothstep(start, start + 0.12, uStep.w);
    c.rgb *= mix(vec3(0.21, 0.62, 0.32), vec3(0.46, 0.26, 0.12), brown);
    if (allowsEffect(3)) col = over(col, c, uShow.w * 0.85);

    c = fxCol(uAC, uv, 0);                                                   // falda e pozzi
    float water = 1.0 - aa.a;
    float dirtyRadius = tbl3(vec3(0.0), vec3(0.40), vec3(0.67), vec3(1.02), uStep.w).r;
    float dirt = smoothstep(0.0, 0.075, dirtyRadius - distance(uv, uOrigin));
    float row = uv.y * 220.0;
    float brick = fract(uv.x * 78.0 + mod(floor(row), 2.0) * 0.5);
    bool stripe = fract(row) < 0.70 && brick < 0.87;
    vec3 turquoise = vec3(0.10, 0.76, 0.80);
    vec3 waterColor = stripe ? mix(turquoise, vec3(0.48, 0.25, 0.06), dirt) : turquoise;
    if (fract(row) > 0.90) waterColor = vec3(0.79, 0.96, 0.95);
    vec3 wellColor = mix(turquoise, vec3(0.48, 0.25, 0.06), max(reach(ab.r, p.w), dirt));
    c.rgb *= mix(wellColor, waterColor, water);
    if (allowsEffect(5)) col = over(col, c, mix(reach(aa.r, p.w), uShow.w, water) * 0.95);
  }

  if (uShow.y > 0.001 && allowsEffect(6)) {                                  // posti di lavoro
    col = over(col, fxCol(uEC, uv, 2), reach(ea.b, p.y) * (1.0 - reach(texture(uEB, uv).r, p.y)));
  }
  if (uShow.w > 0.001 && allowsEffect(4)) {                                  // flora e fauna
    col = over(col, fxCol(uAC, uv, 2), reach(aa.b, p.w) * (1.0 - reach(ab.b, p.w)));
  }

  if (uShow.z > 0.001) {
    vec4 na = texture(uNA, uv), nb = texture(uNB, uv);
    float s = uStep.z;
    float pLine = near(s, 2.0) * off(nb.g, 1.1, 0.30) + near(s, 3.0) * off(nb.g, 3.0, 0.70);
    c = fxCol(uNC, uv, 1);                                                   // pressione sulle case
    vec3 outlineTint = tbl3(vec3(1.0, 0.81, 0.02), vec3(1.0, 0.64, 0.01), vec3(1.0, 0.51, 0.13), vec3(0.95, 0.29, 0.10), s);
    vec3 litOutline = outlineTint * c.a;
    c.rgb = mix(litOutline, vec3(0.5, 0.5, 0.47) * c.a, pLine);
    if (allowsEffect(9)) col = over(col, c, reach(na.g, p.z));

    c = fxCol(uNC, uv, 0);                                                   // bollette
    float billStage = locS(s, nb.r) * mix(0.87, 1.0, nb.r);
    c.rgb *= tbl3(vec3(1.0, 0.85, 0.05), vec3(1.0, 0.69, 0.01), vec3(0.90, 0.46, 0.0), vec3(0.61, 0.27, 0.0), billStage);
    if (allowsEffect(10)) col = over(col, c, reach(na.r, p.z));

    c = fxCol(uNC, uv, 2);                                                   // tralicci
    float blackout = near(s, 2.0) * off(0.4, 1.0, 0.17) * 0.40 + near(s, 3.0) * off(0.4, 2.8, 0.62);
    vec3 towerTint = tbl3(vec3(0.89, 0.83, 0.01), vec3(0.98, 0.70, 0.01), vec3(1.0, 0.66, 0.12), vec3(1.0, 0.42, 0.08), s);
    vec3 litTowers = mix(c.rgb, towerTint * c.a, 0.86);
    c.rgb = mix(litTowers, vec3(0.24, 0.23, 0.18) * c.a, blackout);
    if (allowsEffect(11)) col = over(col, c, reach(na.b, p.z));
  }

  if (uShow.y > 0.001 && allowsEffect(7)) {
    col = over(col, fxCol(uEC, uv, 3), reach(ea.a, p.y));                      // strade rovinate
  }
  return col;
}

vec4 emissions(vec2 uv) {
  if (uShow.x <= 0.001 || !allowsEffect(2)) return vec4(0.0);
  uv = clamp(uv, vec2(0.0006), vec2(0.9994));
  float p = uShow.x * (uStep.x + 1.0);
  float seed = texture(uSB, uv).b;
  float smoke = mix(1.0, 0.15 + 0.85 * puff(seed, 0.8), near(uStep.x, 1.0));
  float vis = reach(texture(uSA, uv).b, p) * smoke;
  return fxCol(uSC, uv, 2) * vis;
}
`;

// Avanza tacche e visibilità verso i valori scelti
export function advance(step, stepTarget, show, showTarget, dt) {
  for (let i = 0; i < 4; i++) {
    const c = step.getComponent(i), t = stepTarget.getComponent(i), d = STEP_SPEED * dt;
    step.setComponent(i, Math.abs(t - c) <= d ? t : c + Math.sign(t - c) * d);
    const sc = show.getComponent(i), st = showTarget.getComponent(i), sd = SHOW_SPEED * dt;
    show.setComponent(i, Math.abs(st - sc) <= sd ? st : sc + Math.sign(st - sc) * sd);
  }
}
