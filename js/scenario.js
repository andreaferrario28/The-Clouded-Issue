document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('codeForm');
  const input = document.getElementById('scenarioCodeInput');
  const activeCodeLabel = document.getElementById('activeCodeLabel');
  if (!form) return;

  const NS = 'http://www.w3.org/2000/svg';
  let currentScenario;
  let focusedCategory = null;
  let separated = false;
  let viewer;

  // Dizionario scenari per ciascuno dei 4 ambiti (livelli 1–4)
  const EFFECTS_DB = {
    salute: {
      name: 'Salute e vivibilità',
      levels: {
        1: { title: 'Impatto contenuto attorno al cantiere', bullets: ['Emissioni generatori limitate a test annuali', 'Dispersione termica localizzata', 'Nessuna variazione percepibile in centro paese'] },
        2: { title: 'Di notte, un ronzio che non si spegne mai', bullets: ['Ronzio continuo a bassa frequenza (45-55 dB)', '+2°C nelle sere d\'estate', 'Più ossidi di azoto nell\'aria'] },
        3: { title: 'Disagio cronico e isola di calore', bullets: ['Bolla di calore intrappolata dall\'inversione termica', 'Incremento NOx nei picchi manutentivi', 'Diffusione acustica verso Cascina Mentirate e Badile'] },
        4: { title: 'Emergenza cumulativa di area vasta', bullets: ['Picchi termici estivi fino a +4°C / +9°C localizzati', 'Accensione simultanea dei 160 generatori diesel', 'Impatto sanitario esteso ai comuni confinanti'] }
      }
    },
    economia: {
      name: 'Economia',
      levels: {
        1: { title: 'Polo di sviluppo e compensazioni', bullets: ['Oneri e compensazioni comunali (L.R. 11/2026)', 'Indotto temporaneo nei 52 mesi di cantiere', 'Nuove piste ciclabili e opere accessorie'] },
        2: { title: 'Indotto limitato a fine cantiere', bullets: ['Forte automazione dei server da remoto', 'Circa 20-50 addetti stabili in sede', 'Ricadute marginali sul commercio locale'] },
        3: { title: 'Cattedrale nel deserto', bullets: ['Scomparsa della rendita agricola su 23 ettari', 'Usura della viabilità provinciale (SP105)', 'Bassa integrazione con il tessuto economico locale'] },
        4: { title: 'Costi scaricati e svalutazione', bullets: ['Perimetro militarizzato e inaccessibile', 'Svalutazione immobiliare delle cascine limitrofe', 'Costi infrastrutturali indiretti a carico della collettività'] }
      }
    },
    energia: {
      name: 'Energia e servizi',
      levels: {
        1: { title: 'Rete blindata ad alta tensione', bullets: ['Doppio allacciamento dedicato a 380 kV', 'Stabilità garantita per le utenze domestiche', 'Nessuna interferenza con il centro abitato'] },
        2: { title: 'Espansione infrastrutturale', bullets: ['Nuove sottostazioni elettriche sui campi', 'Scavi estesi per elettrodotti interrati', 'Pressione crescente sulla rete regionale'] },
        3: { title: 'Assedio infrastrutturale e rincari', bullets: ['Assorbimento equivalente a centinaia di comuni', 'Aree dedicate a maxi-batterie e cabine', 'Possibili ricadute dei costi di rete in bolletta'] },
        4: { title: 'Saturazione di area vasta', bullets: ['Sovraccarico della rete nei picchi estivi', 'Rischio micro-interruzioni locali', 'Attivazione frequente dei 160 generatori a gasolio'] }
      }
    },
    ambiente: {
      name: 'Ambiente',
      levels: {
        1: { title: 'Compensazioni e raffreddamento a secco', bullets: ['Sistema a secco senza prelievo idrico diretto', 'Nuove fasce alberate compensative', 'Canali irrigui principali mantenuti'] },
        2: { title: 'Trasformazione del paesaggio agricolo', bullets: ['Impermeabilizzazione di 229.000 mq', 'Riduzione della continuità delle risaie', 'Alterazione dei corridoi ecologici locali'] },
        3: { title: 'Stress su fauna, flora e suolo', bullets: ['23 ettari di suolo agricolo cementificati', 'Pressione sui fontanili e sul deflusso superficiale', 'Frammentazione dell\'habitat verso l\'Oasi'] },
        4: { title: 'Un danno difficile da riparare', bullets: ['Rischio sversamento gasolio nella falda', 'Pozzi e acque sotterranee esposti', 'Cancellazione irreversibile dell\'identità agricola'] }
      }
    }
  };

  // Codici noti dalla mostra
  const PRESET_CODES = {
    'TCI-033': { salute: 2, economia: 1, energia: 2, ambiente: 1 },
    'TCI-067': { salute: 2, economia: 3, energia: 3, ambiente: 3 },
    'TCI-004': { salute: 4, economia: 4, energia: 4, ambiente: 4 },
  };

  const levelNames = ['Rassicurante', 'Moderato', 'Critico', 'Estremo'];
  const parameterRows = document.getElementById('scenarioParameters');
  const details = document.getElementById('scenarioDetails');
  const detailName = document.getElementById('scenarioDetailName');
  const detailLevel = document.getElementById('scenarioDetailLevel');
  const detailTitle = document.getElementById('scenarioDetailTitle');
  const detailEffects = document.getElementById('scenarioDetailEffects');
  const stackHelp = document.getElementById('scenarioStackHelp');
  const combinedHelp = document.getElementById('scenarioCombinedHelp');
  const detailHelp = document.getElementById('scenarioDetailHelp');
  const codeList = document.getElementById('scenarioCodes');

  for (const code of Object.keys(PRESET_CODES)) {
    codeList.append(new Option(code));
  }

  const parameterCells = Object.entries(EFFECTS_DB).map(([key, { name }]) => {
    const row = parameterRows.insertRow();
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = name;
    row.append(heading);
    return [key, row.insertCell()];
  });

  function el(tag, attrs = {}) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  function decodeCode(raw) {
    const code = raw.trim().toUpperCase();
    if (PRESET_CODES[code]) return { code, ...PRESET_CODES[code] };

    // Se l'utente inserisce 4 cifre (es. 2314), le usa come livelli dei 4 ambiti
    const digits = code.replace(/\D/g, '');
    if (digits.length >= 4) {
      const clamp = n => Math.min(4, Math.max(1, Number(n) || 2));
      return {
        code,
        salute: clamp(digits[0]),
        economia: clamp(digits[1]),
        energia: clamp(digits[2]),
        ambiente: clamp(digits[3]),
      };
    }

    // Fallback deterministico su qualsiasi stringa
    let hash = 0;
    for (let i = 0; i < code.length; i++) hash += code.charCodeAt(i);
    return {
      code: code || 'TCI-067',
      salute: (hash % 4) + 1,
      economia: ((hash + 1) % 4) + 1,
      energia: ((hash + 2) % 4) + 1,
      ambiente: ((hash + 3) % 4) + 1,
    };
  }

  function renderMapLayers(sc) {
    // 1. Layer Salute (alone a pallini rossi + pixel rosa proporzionali al livello)
    const gSalute = document.getElementById('layer-salute');
    gSalute.innerHTML = '';
    const rSalute = 80 + sc.salute * 58;
    gSalute.appendChild(el('circle', { cx: 365, cy: 170, r: rSalute, fill: 'url(#patSalute)' }));
    for (let i = 0; i < sc.salute * 14; i++) {
      const px = 250 + ((i * 53) % 260);
      const py = 90 + ((i * 37) % (120 + sc.salute * 50));
      gSalute.appendChild(el('rect', { x: px, y: py, width: 14, height: 14, fill: '#F582D3', 'fill-opacity': 0.8 }));
    }

    // 2. Layer Ambiente (griglia verde suolo + cerchietti fauna + linea falda)
    const gAmbiente = document.getElementById('layer-ambiente');
    gAmbiente.innerHTML = '';
    const ambWidth = 100 + sc.ambiente * 65;
    gAmbiente.appendChild(el('rect', { x: 450, y: 20, width: ambWidth, height: 240 + sc.ambiente * 40, fill: 'url(#patAmbiente)', 'fill-opacity': 0.85 }));
    gAmbiente.appendChild(el('path', {
      d: 'M 0 340 Q 220 300 390 420 T 800 470',
      fill: 'none',
      stroke: '#7A7448',
      'stroke-width': 4 + sc.ambiente * 2,
      'stroke-dasharray': '6 4'
    }));
    for (let i = 0; i < 24 - sc.ambiente * 3; i++) {
      gAmbiente.appendChild(el('circle', {
        cx: 40 + ((i * 97) % 720),
        cy: 40 + ((i * 61) % 540),
        r: 6,
        fill: 'none',
        stroke: '#1D7A4C',
        'stroke-width': 2
      }));
    }

    // 3. Layer Energia (area blu tratteggiata + triangoli sottostazioni)
    const gEnergia = document.getElementById('layer-energia');
    gEnergia.innerHTML = '';
    const enH = 70 + sc.energia * 42;
    gEnergia.appendChild(el('polygon', {
      points: `360,340 530,320 560,${340 + enH} 380,${360 + enH}`,
      fill: 'url(#patEnergia)',
      'fill-opacity': 0.85
    }));
    for (let i = 0; i < sc.energia * 5; i++) {
      const tx = 140 + i * 32;
      const ty = 260 + (i % 3) * 28;
      gEnergia.appendChild(el('polygon', {
        points: `${tx},${ty - 8} ${tx - 7},${ty + 6} ${tx + 7},${ty + 6}`,
        fill: '#0A4D5C'
      }));
    }

    // 4. Layer Economia (edifici e perimetri gialli)
    const gEconomia = document.getElementById('layer-economia');
    gEconomia.innerHTML = '';
    gEconomia.appendChild(el('rect', {
      x: 190, y: 130, width: 100, height: 120,
      fill: '#E5C617', 'fill-opacity': 0.25 + sc.economia * 0.15,
      stroke: '#E5C617', 'stroke-width': 3
    }));
    gEconomia.appendChild(el('path', {
      d: 'M 365 355 L 510 355 L 510 535 L 365 535 Z',
      fill: '#E5C617', 'fill-opacity': 0.2 + sc.economia * 0.14,
      stroke: '#E5C617', 'stroke-width': 2.5, 'stroke-dasharray': '8 4'
    }));
  }

  function showDetails(category) {
    const opening = category && focusedCategory !== category;
    focusedCategory = category;
    details.hidden = detailHelp.hidden = !category;
    stackHelp.hidden = !separated || Boolean(category);
    combinedHelp.hidden = separated;
    if (!category) return;

    const { name, levels } = EFFECTS_DB[category];
    const level = currentScenario[category];
    const { title, bullets } = levels[level];
    detailName.textContent = name;
    detailLevel.textContent = `Livello ${level}/4 · ${levelNames[level - 1]}`;
    detailTitle.textContent = title;
    detailEffects.replaceChildren(...bullets.map(effect => {
      const item = document.createElement('li');
      item.textContent = effect;
      return item;
    }));
    if (opening && window.matchMedia('(max-width: 720px)').matches) {
      details.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }

  function loadScenario(code) {
    const sc = decodeCode(code);
    currentScenario = sc;
    input.value = activeCodeLabel.textContent = sc.code;
    for (const [key, cell] of parameterCells) {
      cell.textContent = `${sc[key]}/4`;
      cell.title = levelNames[sc[key] - 1];
    }
    renderMapLayers(sc);
    showDetails(focusedCategory);
    viewer?.setScenario(sc);
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (input.value.trim()) loadScenario(input.value);
  });

  const params = new URLSearchParams(window.location.search);
  loadScenario(params.get('code') || 'TCI-067');

  const status = document.getElementById('scenarioViewStatus');
  const loadState = document.getElementById('scenarioLoadState');
  const progress = document.getElementById('scenarioLoadProgress');
  const fallbackButton = document.getElementById('showScenarioFallback');
  const viewport = document.getElementById('scenarioViewport');
  const canvas = document.getElementById('scenarioCanvas');
  const labels = document.getElementById('scenarioPlaneLabels');
  const stackButton = document.getElementById('showScenarioStack');
  const viewToggle = document.getElementById('toggleScenarioView');
  const viewHelp = document.getElementById('scenarioViewHelp');
  const fallbackMap = document.getElementById('scenarioMap');
  const categoryNames = Object.fromEntries(
    Object.entries(EFFECTS_DB).map(([key, info]) => [key, info.name])
  );

  function showLoadError(message) {
    viewer = null;
    viewport.hidden = viewHelp.hidden = viewToggle.hidden = true;
    showDetails(null);
    progress.hidden = true;
    fallbackButton.hidden = false;
    loadState.hidden = false;
    status.textContent = message;
  }

  fallbackButton.addEventListener('click', () => {
    fallbackMap.removeAttribute('hidden');
    loadState.hidden = true;
  });

  stackButton.addEventListener('click', () => {
    viewer.showStack();
    canvas.focus({ preventScroll: true });
  });
  viewToggle.addEventListener('click', () => {
    separated = !separated;
    viewToggle.textContent = separated ? 'Riunisci ambiti' : 'Dividi ambiti';
    viewToggle.setAttribute('aria-expanded', String(separated));
    viewer.setSeparated(separated);
  });
  canvas.addEventListener('webglcontextlost', () => {
    showLoadError('La vista 3D si è interrotta. Ricarica la pagina per riaprirla.');
  });

  import('./scenario-3d/viewer.js').then(({ createScenarioViewer }) =>
    createScenarioViewer({
      viewport, canvas, labels, categoryNames,
      onProgress(fraction) {
        progress.value = Math.max(progress.value, Math.floor(fraction * 100));
        if (fraction >= 0.6 && status.textContent !== 'Preparazione degli effetti…') {
          status.textContent = 'Preparazione degli effetti…';
        }
      },
      onFocusChange: showDetails,
    })
  ).then(async instance => {
    viewer = instance;
    viewer.setScenario(currentScenario);
    progress.value = 96;
    status.textContent = 'Preparazione della vista 3D…';
    viewport.hidden = false;
    await instance.renderFirstFrame();
    if (viewer !== instance) return;
    loadState.hidden = true;
    viewHelp.hidden = viewToggle.hidden = false;
  }).catch(error => {
    console.error('Vista 3D di Lacchiarella:', error);
    showLoadError('Vista 3D non disponibile.');
  });
});
