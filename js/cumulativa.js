document.addEventListener('DOMContentLoaded', () => {
  const svg = document.getElementById('plotterSvg');
  const tooltip = document.getElementById('plotterTooltip');
  const countLabel = document.getElementById('scenarioCount');
  if (!svg) return;

  const NS = 'http://www.w3.org/2000/svg';
  const CX = 400;
  const CY = 400;
  // 4 anelli concentrici = 4 livelli di urgenza (1 rassicurante -> 4 estremo)
  const RINGS = [75, 165, 255, 345];

  const PARAM_COLORS = {
    salute: '#EB4225',
    economia: '#D4B30F',
    energia: '#2058D6',
    ambiente: '#68C68E'
  };

  const PARAM_LABELS = {
    salute: 'Salute e vivibilità',
    economia: 'Economia',
    energia: 'Energia e servizi',
    ambiente: 'Ambiente'
  };

  // Dataset di esempio degli scenari raccolti in mostra
  const scenarios = [
    { id: 'TCI-004', salute: 4, economia: 4, energia: 4, ambiente: 4 },
    { id: 'TCI-011', salute: 3, economia: 2, energia: 3, ambiente: 4 },
    { id: 'TCI-018', salute: 2, economia: 1, energia: 2, ambiente: 3 },
    { id: 'TCI-024', salute: 4, economia: 3, energia: 3, ambiente: 4 },
    { id: 'TCI-033', salute: 2, economia: 2, energia: 1, ambiente: 2 },
    { id: 'TCI-039', salute: 3, economia: 4, energia: 2, ambiente: 3 },
    { id: 'TCI-042', salute: 1, economia: 2, energia: 1, ambiente: 2 },
    { id: 'TCI-051', salute: 4, economia: 3, energia: 4, ambiente: 3 },
    { id: 'TCI-058', salute: 3, economia: 3, energia: 2, ambiente: 4 },
    { id: 'TCI-067', salute: 3, economia: 3, energia: 2, ambiente: 4 },
    { id: 'TCI-074', salute: 2, economia: 4, energia: 3, ambiente: 3 },
    { id: 'TCI-081', salute: 1, economia: 1, energia: 2, ambiente: 1 },
    { id: 'TCI-089', salute: 4, economia: 2, energia: 4, ambiente: 4 },
    { id: 'TCI-095', salute: 3, economia: 2, energia: 3, ambiente: 2 },
    { id: 'TCI-102', salute: 2, economia: 3, energia: 2, ambiente: 3 },
    { id: 'TCI-114', salute: 4, economia: 4, energia: 3, ambiente: 4 },
    { id: 'TCI-120', salute: 2, economia: 1, energia: 3, ambiente: 2 },
    { id: 'TCI-128', salute: 3, economia: 3, energia: 4, ambiente: 3 }
  ];

  countLabel.textContent = `Scenari raccolti: ${scenarios.length}`;

  let state = { mode: 'all', urgency: null, param: null };

  function el(tag, attrs = {}) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  function polarToXY(angleDeg, radius) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: CX + radius * Math.cos(rad),
      y: CY + radius * Math.sin(rad)
    };
  }

  // Disegna il simbolo a croce graduata stile pen plotter
  function drawCrosshair(group, x, y, color = '#161616') {
    const g = el('g', { stroke: color, 'stroke-width': 1 });
    g.appendChild(el('line', { x1: x - 10, y1: y, x2: x + 10, y2: y }));
    g.appendChild(el('line', { x1: x, y1: y - 10, x2: x, y2: y + 10 }));
    g.appendChild(el('rect', { x: x - 3, y: y - 3, width: 6, height: 6, fill: '#FFFFFF' }));
    group.appendChild(g);
    return g;
  }

  function render() {
    svg.innerHTML = '';

    // 1. Cerchi concentrici
    const ringLabels = ['RASSICURANTE', 'MODERATO', 'CRITICO', 'ESTREMO'];
    RINGS.forEach((r, idx) => {
      svg.appendChild(el('circle', {
        cx: CX, cy: CY, r,
        fill: 'none',
        stroke: '#161616',
        'stroke-width': idx === 3 ? 1.2 : 0.8,
        'stroke-opacity': 0.55
      }));

      const lbl = el('text', {
        x: CX + 6,
        y: CY - r + 12,
        'font-size': 9,
        fill: '#5C5C5A'
      });
      lbl.textContent = ringLabels[idx];
      svg.appendChild(lbl);
    });

    const paramsOrder = ['salute', 'economia', 'energia', 'ambiente'];
    const sliceDeg = 360 / scenarios.length;

    // Raccolta punti per filtri speciali
    const filteredPoints = [];

    // 2. Tracciati individuali (modalità cumulativa)
    scenarios.forEach((sc, sIdx) => {
      const baseAngle = sIdx * sliceDeg;
      const pts = paramsOrder.map((p, pIdx) => {
        const angle = baseAngle + (pIdx * (sliceDeg * 0.72)) / 3;
        const level = sc[p];
        const pos = polarToXY(angle, RINGS[level - 1]);
        return { ...pos, param: p, level, scenario: sc };
      });

      // Disegna linea nera del visitatore
      const showBaseLine = state.mode === 'all';
      const poly = el('polyline', {
        points: pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
        fill: 'none',
        stroke: '#161616',
        'stroke-width': showBaseLine ? 1.1 : 0.4,
        'stroke-opacity': showBaseLine ? 0.8 : 0.15
      });
      svg.appendChild(poly);

      // Disegna nodi crosshair
      pts.forEach(pt => {
        const isMatchUrgency = state.urgency && pt.level === state.urgency;
        const isMatchParam = state.param && pt.param === state.param;

        if (isMatchUrgency || isMatchParam) {
          filteredPoints.push(pt);
        }

        const opacity = (state.mode === 'all' || isMatchUrgency || isMatchParam) ? 1 : 0.25;
        const nodeGroup = el('g', { opacity, style: 'cursor:pointer;' });
        drawCrosshair(nodeGroup, pt.x, pt.y, isMatchUrgency ? '#EB4225' : '#161616');

        nodeGroup.addEventListener('mouseenter', () => {
          tooltip.innerHTML = `
            <strong>${pt.scenario.id}</strong><br>
            Ambito: ${PARAM_LABELS[pt.param]}<br>
            Livello: ${pt.level}/4 (${ringLabels[pt.level - 1]})<br>
            <a href="mio-scenario.html?code=${pt.scenario.id}" style="color:#EB4225;text-decoration:underline;">Apri questo scenario →</a>
          `;
        });
        svg.appendChild(nodeGroup);
      });
    });

    // 3. Linea evidenziata quando è attivo un filtro (stile Slide 49)
    if (filteredPoints.length > 1) {
      const strokeColor = state.urgency ? '#EB4225' : PARAM_COLORS[state.param];
      const highlightLine = el('polyline', {
        points: filteredPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
        fill: 'none',
        stroke: strokeColor,
        'stroke-width': 2.6
      });
      svg.appendChild(highlightLine);
    }
  }

  // Gestione pulsanti filtro
  const buttons = document.querySelectorAll('.filter-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active', 'active-accent'));

      if (btn.dataset.mode === 'all') {
        state = { mode: 'all', urgency: null, param: null };
        btn.classList.add('active');
      } else if (btn.dataset.urgency) {
        state = { mode: 'urgency', urgency: Number(btn.dataset.urgency), param: null };
        btn.classList.add('active-accent');
      } else if (btn.dataset.param) {
        state = { mode: 'param', urgency: null, param: btn.dataset.param };
        btn.classList.add('active');
      }
      render();
    });
  });

  render();
});