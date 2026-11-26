import * as THREE from 'three';
import { FX_GLSL } from './effects.js';

const COLORS = {
  BASE: '#f1f1ed',
  CENTRO_ABITATO: '#ecece8',
  CAMPI: '#e4e5de',
  RETI_ELETTRICHE: '#c2c2bd',
  TRALICCI_ELETTRICITA: '#a8a8a3',
  PARCHI: '#d6e2cd',
  TERRENI_INDUSTRIALI: '#deded8',
  INDUSTRIE: '#e2e2dd',
  CASCINE: '#dcd9d2',
  ABITAZIONI: '#f7f7f4',
  SCUOLE: '#f0eee9',
  STRADE: '#c9c9c4',
  DATACENTER: '#2b2b2b',
};

export function buildGeometries(meshes) {
  return meshes.map(mesh => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.nor, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    if (!mesh.hasNormals) geometry.computeVertexNormals();
    return { name: mesh.name, geometry };
  });
}

export function buildMap(geometries, uniforms, sheetOpacity) {
  const group = new THREE.Group();
  const order = Object.keys(COLORS);

  for (const { name, geometry } of geometries) {
    const base = name === 'BASE' && sheetOpacity;
    const layer = Math.max(0, order.indexOf(name));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms,
        uColor: { value: new THREE.Color(COLORS[name] || '#dddddd') },
        uOpacity: base || { value: 1 },
      },
      vertexShader: `
        varying vec3 vPos;
        varying vec3 vNormal;
        void main() {
          vPos = position;
          vNormal = normal;
          vec3 relief = position;
          relief.y += 3.0 * max(0.0, relief.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(relief, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec3 vPos;
        varying vec3 vNormal;
        ${FX_GLSL}
        void main() {
          vec2 uv = (vPos.xz + 0.25) / 0.5;
          vec3 n = normalize(vNormal);
          if (n.y < -0.5) n = -n;
          float light = 0.80 + 0.22 * max(dot(n, normalize(vec3(-0.35, 1.0, 0.45))), 0.0);
          light -= 0.14 * (1.0 - abs(n.y));
          vec3 col = applyEffects(uColor, uv) * light;
          col = over(col, emissions(uv), 1.0);
          gl_FragColor = vec4(col, uOpacity);
        }
      `,
      side: base ? THREE.FrontSide : THREE.DoubleSide,
      transparent: Boolean(base),
      depthWrite: !base,
      polygonOffset: layer > 0,
      polygonOffsetFactor: -layer,
      polygonOffsetUnits: -layer,
    });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
  }

  return group;
}
