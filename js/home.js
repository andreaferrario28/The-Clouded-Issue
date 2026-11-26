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
let effects = [];
let lastSample = null;
let activeTouch = null;
let cellSize = 20;

function resetTrail() {
  lastSample = null;
  trail.replaceChildren();
  particles.clear();
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

function addParticle(column, row, distanceFromCenter) {
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
  const lifetime = 850 + Math.random() * 250 - distanceFromCenter * 100;

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

stage.addEventListener('pointerdown', (event) => {
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
