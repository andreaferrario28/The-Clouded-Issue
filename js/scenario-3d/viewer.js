import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { CAT_KEYS, advance, effectUniforms, makeEffectTextures } from './effects.js';
import { buildGeometries, buildMap } from './modello3d.js';
import { createTrafficMesh, loadTraffic } from './traffic.js';

const PLANES = CAT_KEYS.map((category, component) => ({ category, component }));
const SPACING = 0.155;
const EXTRACTION_DISTANCE = 0.2;
const DURATION = 900;
const MAP_RADIUS = 1.1;
const STACK_VIEW = { phi: 1.19, theta: 0.57, zoom: 1.2 };
const DETAIL_VIEW = { phi: 0.59, theta: 0.25, zoom: 1.1 };

async function prepare(options, onProgress) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined') {
    try {
      const worker = new Worker(new URL('./lavoro.js', import.meta.url), { type: 'module' });
      try {
        return await new Promise((resolve, reject) => {
          worker.onmessage = ({ data }) => {
            if (data.error) reject(new Error(data.error));
            else if (data.result) resolve(data.result);
            else onProgress(data.progress);
          };
          worker.onerror = event => {
            event.preventDefault();
            reject(new Error(event.message));
          };
          worker.postMessage(options);
        });
      } finally {
        worker.terminate();
      }
    } catch (error) {
      console.warn('Preparazione 3D nel worker non riuscita:', error.message);
    }
  }

  const { prepareModel } = await import('./lavoro.js');
  return prepareModel(options, onProgress);
}

export async function createScenarioViewer({ viewport, canvas, labels, categoryNames, onProgress, onFocusChange }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  try {
    const trafficData = await loadTraffic();
    const size = viewport.parentElement.clientWidth < 600 ? 512 : 1024;
    const { effects, meshes } = await prepare({ size, traffic: trafficData }, onProgress);
    return initialize({ renderer, viewport, canvas, labels, categoryNames, effects, meshes, trafficData, onFocusChange });
  } catch (error) {
    renderer.dispose();
    throw error;
  }
}

function initialize({ renderer, viewport, canvas, labels, categoryNames, effects, meshes, trafficData, onFocusChange }) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 4);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.minZoom = 0.65;
  controls.maxZoom = 4;
  controls.maxPolarAngle = Math.PI * 0.48;
  renderer.setClearColor('#ecece8');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  const geometries = buildGeometries(meshes);
  const textures = makeEffectTextures(effects, renderer);
  const uniforms = effectUniforms(textures, effects.origin);
  const stepTarget = new THREE.Vector4();
  const showTarget = new THREE.Vector4(1, 1, 1, 1);
  const combined = buildMap(geometries, uniforms);
  const combinedTraffic = createTrafficMesh(trafficData, { scale: 0.5, lift: 0.003 });
  combined.add(combinedTraffic);
  scene.add(combined);
  const sheets = [];
  const sheetOpacity = { value: 0.8 };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let transition = null;
  let width = 1;
  let height = 1;
  let dirty = true;
  let inView = true;
  let lastFrame = 0;
  let animationTime = 0;
  let focusedPlane = null;
  let stackView = STACK_VIEW;
  let combinedView = DETAIL_VIEW;
  let separated = false;
  let spread = 0;
  let detail = 0;

  const point = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const angle = new THREE.Spherical();
  const right = new THREE.Vector3();
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const board = new THREE.Plane(new THREE.Vector3(0, 1, 0));
  let press = null;

  function createSheets() {
    for (const plane of PLANES) {
      const show = new THREE.Vector4(0, 0, 0, 0);
      const sheet = buildMap(geometries, {
        ...uniforms,
        uShow: { value: show },
      }, sheetOpacity);
      const traffic = plane.category === 'economia'
        ? createTrafficMesh(trafficData, { scale: 0.5, lift: 0.003 })
        : null;
      if (traffic) sheet.add(traffic);
      sheet.visible = false;
      scene.add(sheet);

      const label = document.createElement('span');
      label.className = 'scenario-plane-label';
      label.dataset.category = plane.category;
      label.textContent = categoryNames[plane.category];
      label.hidden = true;
      labels.append(label);

      const level = ((PLANES.length - 1) / 2 - plane.component) * SPACING;
      sheets.push({ ...plane, sheet, label, show, traffic, level });
    }
  }

  function updateProjection() {
    const aspect = width / height;
    const stacked = spread * (1 - detail);
    const stackHeight = 0.36 + stacked * (PLANES.length - 1) * SPACING * 0.49;
    const halfHeight = Math.max(
      stackHeight,
      (THREE.MathUtils.lerp(0.41, 0.45, stacked) + Math.sin(Math.PI * detail) * 0.13) / aspect
    );
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }

  function resize() {
    const rect = viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width;
    height = rect.height;
    renderer.setSize(width, height, false);
    updateProjection();
    dirty = true;
  }

  function captureView() {
    angle.setFromVector3(offset.copy(camera.position).sub(controls.target));
    return { phi: angle.phi, theta: angle.theta, zoom: camera.zoom };
  }

  function setView({ phi, theta, zoom }) {
    angle.set(MAP_RADIUS, phi, theta);
    camera.position.copy(controls.target).add(offset.setFromSpherical(angle));
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function animateTo(view, targetDetail, targetSpread = 1) {
    const from = captureView();
    const radians = Math.PI * 2;
    const rotation = THREE.MathUtils.euclideanModulo(view.theta - from.theta + Math.PI, radians) - Math.PI;
    transition = {
      start: performance.now(),
      from,
      to: { ...view, theta: from.theta + rotation },
      fromDetail: detail,
      targetDetail,
      fromSpread: spread,
      targetSpread,
    };
    controls.enabled = false;
    dirty = true;
  }

  function setSeparated(next) {
    if (separated === next) return;
    if (!transition) {
      if (!separated) combinedView = captureView();
      else if (!focusedPlane) stackView = captureView();
    }
    separated = next;
    onFocusChange(null);
    animateTo(next ? stackView : combinedView, 0, next ? 1 : 0);
  }

  function setScenario(scenario) {
    CAT_KEYS.forEach((key, index) => stepTarget.setComponent(index, scenario[key] - 1));
    dirty = true;
  }

  function updateTransition(now) {
    if (!transition) return;
    const { start, from, to, fromDetail, targetDetail, fromSpread, targetSpread } = transition;
    const progress = reducedMotion.matches ? 1 : Math.min(1, (now - start) / DURATION);
    const eased = THREE.MathUtils.smootherstep(progress, 0, 1);
    const mix = THREE.MathUtils.lerp;
    detail = mix(fromDetail, targetDetail, eased);
    spread = mix(fromSpread, targetSpread, eased);
    setView({
      phi: mix(from.phi, to.phi, eased),
      theta: mix(from.theta, to.theta, eased),
      zoom: mix(from.zoom, to.zoom, eased),
    });
    if (progress === 1) {
      if (targetDetail === 0) focusedPlane = null;
      transition = null;
      controls.enabled = true;
    }
  }

  function positionLabel(plane) {
    const visible = plane.sheet.visible;
    plane.label.hidden = !visible;
    plane.label.classList.toggle('is-extracted', visible && plane === focusedPlane);
    if (!visible) return;
    const { x: boardX, y: boardY, z: boardZ } = plane.sheet.position;
    point.set(0.25 + boardX, boardY, -0.25 + boardZ).project(camera);
    const x = Math.min(width - 5, (point.x + 1) * width / 2);
    const y = (1 - point.y) * height / 2;
    plane.label.style.transform = `translate(${x}px, ${y}px)`;
  }

  function openPlane(plane) {
    if (!separated || transition || focusedPlane || !plane) return;
    stackView = captureView();
    focusedPlane = plane;
    onFocusChange(plane.category);
    animateTo(DETAIL_VIEW, 1);
  }

  function showStack() {
    if (!separated || !focusedPlane || transition?.targetDetail === 0) return;
    onFocusChange(null);
    animateTo(stackView, 0);
  }

  function pickPlane(event) {
    if (!separated || transition || focusedPlane) return null;
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2
    );
    raycaster.setFromCamera(pointer, camera);
    const ray = raycaster.ray;
    let nearest = Infinity;
    let hit = null;
    for (const plane of sheets) {
      if (!plane.sheet.visible) continue;
      const { x, y, z } = plane.sheet.position;
      board.constant = -y;
      if (!ray.intersectPlane(board, point)) continue;
      if (Math.abs(point.x - x) > 0.25 || Math.abs(point.z - z) > 0.25) continue;
      const distance = ray.origin.distanceToSquared(point);
      if (distance >= nearest) continue;
      nearest = distance;
      hit = plane;
    }
    return hit;
  }

  function moveSheets() {
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    for (const plane of sheets) {
      const isSelected = plane === focusedPlane;
      const shift = isSelected ? spread * Math.sin(Math.PI * detail) * EXTRACTION_DISTANCE : 0;
      const level = spread * plane.level * (isSelected ? 1 - detail : 1);
      plane.sheet.position.set(right.x * shift, level, right.z * shift);
    }
  }

  function draw(now, dt) {
    updateTransition(now);
    camera.updateMatrixWorld();
    moveSheets();
    updateProjection();

    if (reducedMotion.matches) {
      uniforms.uStep.value.copy(stepTarget);
      uniforms.uShow.value.copy(showTarget);
    } else {
      advance(uniforms.uStep.value, stepTarget, uniforms.uShow.value, showTarget, dt);
      animationTime += dt;
    }
    uniforms.uTime.value = animationTime;
    const trafficDt = reducedMotion.matches ? 0 : dt;
    combined.visible = spread <= 0.08;
    if (combined.visible) {
      combinedTraffic.userData.update(trafficDt, uniforms.uStep.value.y, uniforms.uShow.value.y);
    }
    sheetOpacity.value = 1 - spread * (1 - detail) * 0.2;
    for (const plane of sheets) {
      plane.sheet.visible = !combined.visible && (detail < 0.42 || plane === focusedPlane);
      plane.show.setComponent(plane.component, uniforms.uShow.value.getComponent(plane.component));
      if (plane.sheet.visible && plane.traffic) {
        plane.traffic.userData.update(trafficDt, uniforms.uStep.value.y, plane.show.y);
      }
    }
    renderer.render(scene, camera);
    sheets.forEach(positionLabel);
    dirty = false;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!inView || document.hidden || (reducedMotion.matches && !dirty && !transition)) return;
    if (lastFrame && now - lastFrame < 30) return;
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 1 / 30;
    lastFrame = now;
    draw(now, dt);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(viewport);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) dirty = true;
  });
  intersectionObserver.observe(viewport);
  controls.addEventListener('change', () => { dirty = true; });
  reducedMotion.addEventListener('change', () => { dirty = true; });
  canvas.addEventListener('pointermove', event => {
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) press = null;
    const canSelect = event.pointerType === 'mouse' && !event.buttons && Boolean(pickPlane(event));
    canvas.classList.toggle('is-over-plane', canSelect);
  });
  canvas.addEventListener('pointerleave', () => {
    canvas.classList.remove('is-over-plane');
  });
  canvas.addEventListener('pointerdown', event => {
    const plane = event.isPrimary && event.button === 0 ? pickPlane(event) : null;
    press = plane
      ? { plane, id: event.pointerId, x: event.clientX, y: event.clientY }
      : null;
  });
  canvas.addEventListener('pointerup', event => {
    if (!press || press.id !== event.pointerId) return;
    const { plane, x, y } = press;
    press = null;
    if (Math.hypot(event.clientX - x, event.clientY - y) <= 8 && pickPlane(event) === plane) {
      canvas.classList.remove('is-over-plane');
      openPlane(plane);
    }
  });
  canvas.addEventListener('pointercancel', () => { press = null; });
  canvas.addEventListener('keydown', event => {
    if (event.key === 'Escape') showStack();
    if (!controls.enabled) return;
    if (/^[1-4]$/.test(event.key)) {
      openPlane(sheets[Number(event.key) - 1]);
      return;
    }
    const view = captureView();
    switch (event.key) {
      case 'ArrowLeft': view.theta -= 0.12; break;
      case 'ArrowRight': view.theta += 0.12; break;
      case 'ArrowUp': view.phi = Math.max(0.02, view.phi - 0.12); break;
      case 'ArrowDown': view.phi = Math.min(controls.maxPolarAngle, view.phi + 0.12); break;
      case '+':
      case '=': view.zoom = Math.min(controls.maxZoom, view.zoom * 1.15); break;
      case '-': view.zoom = Math.max(controls.minZoom, view.zoom / 1.15); break;
      default: return;
    }
    event.preventDefault();
    setView(view);
  });

  createSheets();
  setView(combinedView);

  async function renderFirstFrame() {
    resize();
    await renderer.compileAsync(scene, camera);
    if (renderer.getContext().isContextLost()) throw new Error('Contesto WebGL interrotto');
    draw(performance.now(), 1 / 30);
    requestAnimationFrame(frame);
  }

  return { setScenario, setSeparated, showStack, renderFirstFrame };
}
