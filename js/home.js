const stage = document.querySelector('.home-stage');
const trail = stage.querySelector('.home-trail');
const canAnimate = window.matchMedia('(prefers-reduced-motion: no-preference)');

const effectFiles = [
  'brownfield.svg',
  'calore.svg',
  'campi.svg',
  'elettricità.svg',
  'emissioni.svg',
  'falde.svg',
  'fauna.svg',
  'posti di lavoro.svg',
  'rumore.svg',
  'valore immobiliare.svg',
];

const particles = new Map();
const maxParticles = 180;
const waveNeighbors = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1],
];
let effects = [];
let lastSample = null;
let activeTouch = null;
let lastPressType = null;
let cellSize = 20;
let waves = [];
let waveFrame = 0;

function resetTrail() {
  lastSample = null;
  trail.replaceChildren();
  particles.clear();
  waves = [];
  cancelAnimationFrame(waveFrame);
  waveFrame = 0;
  cellSize = 20 * Math.min(1.25, Math.max(0.65, stage.clientWidth / 974));

  if (canAnimate.matches && effects.length === 0) {
    effects = effectFiles.map((file) => {
      const image = new Image();
      image.alt = '';
      image.src = `Assets/Effetti/${encodeURIComponent(file)}`;
      return image;
    });
  }
}

function addParticle(column, row, distanceFromCenter, extraLifetime = 0) {
  const cell = `${column},${row}`;
  if (particles.has(cell)) return;

  const effect = effects[Math.floor(Math.random() * effects.length)];
  if (!effect?.naturalWidth) return;

  if (particles.size >= maxParticles) {
    const [oldestCell, oldestParticle] = particles.entries().next().value;
    oldestParticle.remove();
    particles.delete(oldestCell);
  }

  const particle = effect.cloneNode();
  const size = cellSize * (0.8 + Math.random() * 0.3 - distanceFromCenter * 0.16);
  const lifetime = 850 + Math.random() * 250 - distanceFromCenter * 100 + extraLifetime;

  particle.className = 'home-particle';
  particle.style.left = `${column * cellSize}px`;
  particle.style.top = `${row * cellSize}px`;
  particle.style.setProperty('--particle-size', `${size}px`);
  particle.style.setProperty('--particle-lifetime', `${lifetime}ms`);
  particle.addEventListener('animationend', () => {
    particle.remove();
    if (particles.get(cell) === particle) particles.delete(cell);
  }, { once: true });

  particles.set(cell, particle);
  trail.append(particle);
}

function emitStripe(x, y, horizontal) {
  const column = Math.round(x / cellSize);
  const row = Math.round(y / cellSize);

  for (let offset = -3; offset <= 3; offset++) {
    const distance = Math.abs(offset);
    if (Math.random() < distance * 0.2) continue;

    addParticle(
      column + (horizontal ? 0 : offset),
      row + (horizontal ? offset : 0),
      distance
    );
  }
}

function samplePointer(event) {
  const { left, top } = stage.getBoundingClientRect();
  const x = event.clientX - left;
  const y = event.clientY - top;
  if (!lastSample) {
    lastSample = { x, y };
    emitStripe(x, y, true);
    return;
  }

  const dx = x - lastSample.x;
  const dy = y - lastSample.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.floor(distance / cellSize);
  if (steps === 0) return;

  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const stepX = (dx / distance) * cellSize;
  const stepY = (dy / distance) * cellSize;

  // Campiona anche lo spazio fra due eventi del puntatore.
  for (let step = Math.max(1, steps - 19); step <= steps; step++) {
    emitStripe(lastSample.x + stepX * step, lastSample.y + stepY * step, horizontal);
  }

  lastSample = {
    x: lastSample.x + stepX * steps,
    y: lastSample.y + stepY * steps,
  };
}

function spreadWave(column, row, maxColumn, maxRow) {
  const pending = [{ column, row, time: 0 }];
  const visited = new Set([`${column},${row}`]);
  const cells = [];
  const direction = Math.random() * Math.PI * 2;
  const phase = Math.random() * Math.PI * 2;

  // La macchia cresce tra celle adiacenti, con zone veloci e zone più dense.
  while (pending.length && cells.length < 135) {
    pending.sort((a, b) => a.time - b.time);
    const cell = pending.shift();
    cells.push(cell);

    for (const [dx, dy] of waveNeighbors) {
      const x = cell.column + dx;
      const y = cell.row + dy;
      if (x < 0 || y < 0 || x > maxColumn || y > maxRow) continue;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const angle = Math.atan2(y - row, x - column);
      const lobes = Math.cos(angle - direction) * 0.26 + Math.cos(3 * (angle - direction)) * 0.3;
      const texture = Math.sin((x - column) * 0.8 + phase) * Math.cos((y - row) * 0.72);
      const delay = Math.hypot(dx, dy) * Math.max(30, 150 - lobes * 160 + texture * 62 + Math.random() * 120);
      pending.push({ column: x, row: y, time: cell.time + delay });
    }
  }
  return cells;
}

function drawWaves(now) {
  for (const wave of waves) {
    while (wave.next < wave.cells.length && wave.cells[wave.next].time * wave.scale <= now - wave.start) {
      const cell = wave.cells[wave.next++];
      const distance = Math.hypot(cell.column - wave.column, cell.row - wave.row);
      addParticle(cell.column, cell.row, Math.min(3, distance / 3), 450);
    }
  }
  waves = waves.filter(wave => wave.next < wave.cells.length);
  waveFrame = waves.length ? requestAnimationFrame(drawWaves) : 0;
}

stage.addEventListener('click', (event) => {
  if (!canAnimate.matches || !event.detail || (lastPressType || event.pointerType) !== 'mouse') return;
  const { left, top, width, height } = stage.getBoundingClientRect();
  const column = Math.round((event.clientX - left) / cellSize);
  const row = Math.round((event.clientY - top) / cellSize);
  const cells = spreadWave(column, row, Math.ceil(width / cellSize), Math.ceil(height / cellSize));
  const duration = 1400 + Math.random() * 350;
  const scale = duration / Math.max(1, cells.at(-1).time);
  if (waves.length === 2) waves.shift();
  waves.push({ cells, column, row, scale, start: performance.now(), next: 0 });
  if (!waveFrame) waveFrame = requestAnimationFrame(drawWaves);
});

stage.addEventListener('pointerdown', (event) => {
  if (event.isPrimary) lastPressType = event.pointerType;
  if (!canAnimate.matches || event.pointerType !== 'touch' || !event.isPrimary) return;
  activeTouch = event.pointerId;
  lastSample = null;
  stage.setPointerCapture(event.pointerId);
  samplePointer(event);
});

stage.addEventListener('pointermove', (event) => {
  if (!canAnimate.matches) return;
  const movingTouch = event.pointerId === activeTouch;
  const movingMouse = activeTouch === null && event.pointerType === 'mouse';
  if (movingTouch || movingMouse) samplePointer(event);
});

function endTouch(event) {
  if (event.pointerId !== activeTouch) return;
  activeTouch = null;
  lastSample = null;
}

stage.addEventListener('pointerup', endTouch);
stage.addEventListener('pointercancel', endTouch);
stage.addEventListener('lostpointercapture', endTouch);

stage.addEventListener('pointerleave', () => {
  if (activeTouch === null) lastSample = null;
});
window.addEventListener('resize', resetTrail);
canAnimate.addEventListener('change', resetTrail);
resetTrail();
