document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('repoGrid');
  const tabs = document.querySelectorAll('.folder-tab');
  const searchInput = document.getElementById('repoSearch');
  const repoCount = document.getElementById('repoCount');
  if (!grid) return;

  const REPO_DATA = [
    // 01 Documenti Ufficiali
    {
      folder: 'documenti',
      type: 'PORTALE VIA',
      title: 'Portale S.I.L.V.I.A. — Regione Lombardia',
      desc: 'Sistema informativo lombardo per la Valutazione di Impatto Ambientale. Contiene i PAUR e le delibere per Lacchiarella e l\'hinterland.',
      source: 'Regione Lombardia',
      url: 'https://www.silvia.servizirl.it'
    },
    {
      folder: 'documenti',
      type: 'DOCUMENTO PDF',
      title: 'Studio Dispersione Inquinanti (CALPUFF)',
      desc: 'Valutazione delle emissioni in atmosfera dei 160 gruppi elettrogeni di emergenza (>150 MWt) a servizio del Data Center di Lacchiarella.',
      source: 'Istanza VIA / MASE',
      url: '#'
    },
    {
      folder: 'documenti',
      type: 'DOCUMENTO PDF',
      title: 'Relazione Idrogeologica — Comparto H2a',
      desc: 'Analisi della falda superficiale, direzione del flusso sotterraneo NNO–SSE e posizionamento dei piezometri e serbatoi di gasolio.',
      source: 'Studio Geologica (2026)',
      url: '#'
    },
    {
      folder: 'documenti',
      type: 'PARERE TECNICO',
      title: 'Rilievi Istituto Superiore di Sanità (ISS)',
      desc: 'Osservazioni del Dipartimento Ambiente e Salute su aspetti sanitari, reti idriche, applicabilità Seveso III e qualità dell\'aria.',
      source: 'ISS Roma',
      url: '#'
    },

    // 02 Comitati e Proteste
    {
      folder: 'comitati',
      type: 'COMITATO',
      title: 'Rete Stop Data Center',
      desc: 'Coordinamento di cittadini e comitati dell\'area metropolitana milanese che chiede moratoria e chiarezza sugli effetti cumulativi.',
      source: 'Milano e Hinterland',
      url: '#'
    },
    {
      folder: 'comitati',
      type: 'COMITATO',
      title: 'Comitato Stop Data Center Cornaredo',
      desc: 'Mobilitazioni locali, presidi pubblici e raccolta firme per la trasparenza sui progetti hyperscale nell\'ovest milanese.',
      source: 'Cornaredo (MI)',
      url: '#'
    },
    {
      folder: 'comitati',
      type: 'COMITATO',
      title: 'Comitato per la tutela del territorio di Cesate',
      desc: 'Campagna "Cesate non tace" a difesa delle aree verdi periurbane e della fascia adiacente alla Pineta di Cesate.',
      source: 'Cesate (MI)',
      url: '#'
    },
    {
      folder: 'comitati',
      type: 'OSSERVAZIONI',
      title: 'Controdeduzioni cittadine su isole di calore',
      desc: 'Osservazioni tecniche depositate da cittadini di Lacchiarella sulla dispersione termica ad aria e sull\'inversione termica padana.',
      source: 'Archivio MASE',
      url: '#'
    },

    // 03 Ricerca e Report
    {
      folder: 'ricerca',
      type: 'RICERCA',
      title: 'Data Scapes — CRAFT Politecnico di Milano',
      desc: 'Indagine territoriale sull\'espansione dei data center nell\'hinterland milanese e sulle criticità di reperimento dei dati pubblici.',
      source: 'Politecnico di Milano',
      url: '#'
    },
    {
      folder: 'ricerca',
      type: 'REPORT',
      title: 'Osservatorio Data Center — Politecnico di Milano',
      desc: 'Analisi economica e previsioni di crescita della domanda energetica e degli investimenti infrastrutturali in Italia fino al 2030.',
      source: 'School of Management',
      url: '#'
    },
    {
      folder: 'ricerca',
      type: 'SAGGIO',
      title: 'Atlas of AI — Kate Crawford',
      desc: 'Mappatura critica della materialità del cloud: estrazione di suolo, acqua, energia e lavoro nascosti dietro l\'intelligenza artificiale.',
      source: 'Yale University Press',
      url: '#'
    },

    // 04 Media e Inchieste
    {
      folder: 'media',
      type: 'PROGETTO WEB',
      title: 'Anatomy of an AI System',
      desc: 'Saggio visivo e mappa di data activism di Kate Crawford e Vladan Joler sul ciclo di vita materiale delle infrastrutture digitali.',
      source: 'anatomyof.ai',
      url: 'https://anatomyof.ai/'
    },
    {
      folder: 'media',
      type: 'NORMATIVA',
      title: 'Legge Regionale Lombardia n. 11/2026',
      desc: 'Disposizioni regionali in materia di consumo di suolo agricolo e compensazioni ecosistemiche per i nuovi poli data center.',
      source: 'Regione Lombardia',
      url: '#'
    }
  ];

  let activeFolder = 'documenti';

  function render() {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = REPO_DATA.filter(item => {
      const matchFolder = query ? true : item.folder === activeFolder;
      const matchQuery = !query ||
        item.title.toLowerCase().includes(query) ||
        item.desc.toLowerCase().includes(query) ||
        item.source.toLowerCase().includes(query);
      return matchFolder && matchQuery;
    });

    repoCount.textContent = `${filtered.length} elementi visualizzati`;

    if (filtered.length === 0) {
      grid.innerHTML = `<p style="color:var(--muted);">Nessun documento trovato per "${searchInput.value}".</p>`;
      return;
    }

    grid.innerHTML = filtered.map(item => `
      <article class="repo-card">
        <div>
          <span class="tag tag-accent">${item.type}</span>
          <h3>${item.title}</h3>
          <p>${item.desc}</p>
        </div>
        <div class="repo-card-footer">
          <span>${item.source}</span>
          <a href="${item.url}" class="repo-link" target="_blank" rel="noopener">Apri →</a>
        </div>
      </article>
    `).join('');
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFolder = tab.dataset.folder;
      searchInput.value = '';
      render();
    });
  });

  searchInput.addEventListener('input', render);

  render();
});