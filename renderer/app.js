const CAT_LABELS = {
  sniadania: 'Śniadania', zupy: 'Zupy', 'dania-glowne': 'Dania główne',
  desery: 'Desery', napoje: 'Napoje', dodatki: 'Dodatki', przetwory: 'Przetwory'
};

const SUBCATS = {
  sniadania: [
    { key: 'na-slodko', label: 'Na słodko' },
    { key: 'na-slono', label: 'Na słono' },
    { key: 'szybkie', label: 'Szybkie (do 10 min)' }
  ],
  zupy: [
    { key: 'kremy', label: 'Kremy' },
    { key: 'klasyczne', label: 'Zupy klasyczne' },
    { key: 'chlodniki', label: 'Chłodniki' }
  ],
  'dania-glowne': [
    { key: 'miesne', label: 'Mięsne' },
    { key: 'rybne', label: 'Rybne' },
    { key: 'wege', label: 'Wegetariańskie i wegańskie' },
    { key: 'makarony', label: 'Makarony i pasty' },
    { key: 'zapiekanki', label: 'Zapiekanki' }
  ],
  desery: [
    { key: 'ciasta', label: 'Ciasta i torty' },
    { key: 'ciastka', label: 'Ciastka i drobne wypieki' },
    { key: 'na-zimno', label: 'Desery na zimno (musy, lody)' },
    { key: 'bez-pieczenia', label: 'Bez pieczenia' }
  ],
  napoje: [
    { key: 'gorace', label: 'Gorące (kawa, herbata)' },
    { key: 'zimne', label: 'Zimne i orzeźwiające' },
    { key: 'koktajle', label: 'Koktajle i drinki' },
    { key: 'smoothie', label: 'Smoothie i soki' }
  ],
  dodatki: [
    { key: 'sosy', label: 'Sosy' },
    { key: 'surowki', label: 'Surówki i sałatki' },
    { key: 'pieczywo', label: 'Pieczywo i podpłomyki' },
    { key: 'przekaski', label: 'Przekąski' }
  ],
  przetwory: [
    { key: 'dzemy', label: 'Dżemy i konfitury' },
    { key: 'kiszonki', label: 'Kiszonki' },
    { key: 'marynaty', label: 'Marynaty' },
    { key: 'soki', label: 'Soki i syropy' }
  ]
};

function subcatLabel(cat, subcat) {
  if (!subcat) return '';
  const item = (SUBCATS[cat] || []).find(s => s.key === subcat);
  return item ? item.label : '';
}

function renderCatTree() {
  const container = document.getElementById('catTree');
  container.innerHTML = Object.keys(CAT_LABELS).map(cat => {
    const subs = SUBCATS[cat] || [];
    const isExpanded = expandedCats.has(cat);
    const subHtml = subs.map(s => {
      const count = recipes.filter(r => r.cat === cat && r.subcat === s.key).length;
      return `
        <button type="button" class="subcat-item" data-cat="${cat}" data-subcat="${s.key}">
          <span class="subcat-dot"></span>
          <span class="subcat-label">${escapeHtml(s.label)}</span>
          ${count ? `<span class="subcat-count">${count}</span>` : ''}
        </button>
      `;
    }).join('');
    return `
      <div class="cat-tree-node">
        <div class="cat-item" data-cat="${cat}" tabindex="0" role="button">
          <span class="cat-icon" data-icon="${cat}"></span>
          <span class="cat-label">${CAT_LABELS[cat]}</span>
          ${subs.length ? `<button type="button" class="cat-chevron ${isExpanded ? 'expanded' : ''}" data-cat="${cat}" title="Rozwiń/zwiń podkategorie">▸</button>` : ''}
        </div>
        ${subs.length ? `<div class="subcat-list" ${isExpanded ? '' : 'hidden'}>${subHtml}</div>` : ''}
      </div>
    `;
  }).join('');
  syncActiveNav();
}

function syncActiveNav() {
  document.querySelectorAll('.cat-item, .subcat-item').forEach(el => {
    el.classList.remove('active', 'active-parent');
  });
  if (activeSubcat) {
    const sub = catList.querySelector(`.subcat-item[data-cat="${activeCat}"][data-subcat="${activeSubcat}"]`);
    if (sub) sub.classList.add('active');
    const parent = catList.querySelector(`.cat-item[data-cat="${activeCat}"]`);
    if (parent) parent.classList.add('active-parent');
  } else {
    const el = catList.querySelector(`.cat-item[data-cat="${activeCat}"]`);
    if (el) el.classList.add('active');
  }
}

let recipes = [];
let miary = [];
let activeCat = 'wszystkie';
let activeSubcat = null;
let expandedCats = new Set();
let searchTerm = '';
let sortMode = 'new';

function normalizeTime(value) {
  if (!value) return '—';
  return /^\d+$/.test(value) ? `${value} min` : value;
}

function plural(n, forms) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n === 1) return forms[0];
  if (n10 >= 2 && n10 <= 4 && !(n100 >= 12 && n100 <= 14)) return forms[1];
  return forms[2];
}

function scaleIngredientText(text, factor) {
  const match = String(text).match(/^(\d+(?:[.,]\d+)?)(.*)$/);
  if (!match) return text;
  const num = parseFloat(match[1].replace(',', '.'));
  const scaled = Math.round(num * factor * 100) / 100;
  let formatted = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return formatted.replace('.', ',') + match[2];
}

const grid = document.getElementById('grid');
const emptyState = document.getElementById('emptyState');
const catList = document.getElementById('catList');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const addBtn = document.getElementById('addBtn');
const converterView = document.getElementById('converterView');
const converterBody = document.getElementById('converterBody');
const converterEmpty = document.getElementById('converterEmpty');
const converterFormOverlay = document.getElementById('converterFormOverlay');
const converterForm = document.getElementById('converterForm');

async function init() {
  recipes = await window.api.loadRecipes();
  miary = await window.api.loadMiary();
  renderCatTree();
  render();
}

// Normalizacja tekstu do wyszukiwania: małe litery + usunięcie polskich
// (i innych) znaków diakrytycznych, żeby "zurek" znajdowało "Żurek",
// a "smietana" znajdowało "Śmietana".
function normalizeSearch(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // usuwa akcenty (ż→z, ć→c, ł→l zostaje niżej)
}
// "ł" nie jest zapisywane jako litera + akcent w Unicode, trzeba osobno
function normalizeSearchPl(str) {
  return normalizeSearch(str).replace(/ł/g, 'l');
}

// Odległość Levenshteina — do tolerowania drobnych literówek
// (jedna pomyłka, przestawiona/brakująca litera itp.)
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

// Sprawdza, czy termin wyszukiwania pasuje do tekstu — dokładnie (substring)
// albo w przybliżeniu (tolerancja literówek), słowo po słowie.
function fuzzyMatch(text, term) {
  if (!term) return true;
  const normText = normalizeSearchPl(text);
  const normTerm = normalizeSearchPl(term);
  if (normText.includes(normTerm)) return true;

  // tolerancja literówek: porówaj każde słowo z tekstu z każdym słowem
  // zapytania, dopuszczając 1 różnicę (2 przy dłuższych słowach)
  const textWords = normText.split(/[^a-z0-9]+/).filter(Boolean);
  const termWords = normTerm.split(/[^a-z0-9]+/).filter(Boolean);
  return termWords.every(tw => {
    if (tw.length < 3) return textWords.some(w => w.includes(tw));
    const maxDist = tw.length >= 6 ? 2 : 1;
    return textWords.some(w => {
      if (w.includes(tw)) return true;
      if (Math.abs(w.length - tw.length) > maxDist) return false;
      return levenshtein(w, tw) <= maxDist;
    });
  });
}

function filteredRecipes() {
  let list = recipes.filter(r => {
    const matchCat = activeCat === 'wszystkie'
      ? true
      : activeCat === 'ulubione'
        ? !!r.favorite
        : r.cat === activeCat && (!activeSubcat || r.subcat === activeSubcat);
    const term = searchTerm.trim();
    const matchSearch = !term
      || fuzzyMatch(r.title, term)
      || fuzzyMatch(subcatLabel(r.cat, r.subcat), term);
    return matchCat && matchSearch;
  });

  if (sortMode === 'az') {
    list = list.slice().sort((a, b) => a.title.localeCompare(b.title, 'pl'));
  } else if (sortMode === 'fav') {
    list = list.slice().sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  }
  return list;
}

function render() {
  const list = filteredRecipes();
  grid.innerHTML = '';
  emptyState.hidden = list.length !== 0;

  list.forEach(r => {
    const card = document.createElement('div');
    card.className = 'card';
    const subLabel = subcatLabel(r.cat, r.subcat);
    card.innerHTML = `
      <button class="fav-btn ${r.favorite ? 'is-fav' : ''}" title="${r.favorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}">★</button>
      <span class="tag ${r.cat}"><span class="dot"></span>${CAT_LABELS[r.cat] || r.cat}${subLabel ? ` · ${escapeHtml(subLabel)}` : ''}</span>
      <h3>${escapeHtml(r.title)}</h3>
      <p>${escapeHtml(r.desc || '')}</p>
      <div class="meta"><span>⏱ ${escapeHtml(normalizeTime(r.time))}</span><span>${(r.ing || []).length} ${plural((r.ing || []).length, ['składnik', 'składniki', 'składników'])}</span></div>
    `;
    card.querySelector('.fav-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      r.favorite = !r.favorite;
      await window.api.saveRecipes(recipes);
      render();
    });
    card.addEventListener('click', () => openView(r));
    grid.appendChild(card);
  });
}

function customConfirm({ title, message, detail, confirmText, cancelText, danger }) {
  return new Promise((resolve) => {
    let overlay = document.getElementById('confirmOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'confirmOverlay';
      overlay.className = 'modal-overlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="modal confirm-modal">
        <div class="confirm-icon ${danger ? 'danger' : ''}">${danger ? '⚠' : 'ℹ'}</div>
        <h3>${title}</h3>
        <p>${message}</p>
        ${detail ? `<p class="confirm-detail">${detail}</p>` : ''}
        <div class="confirm-actions">
          <button class="btn-secondary" id="confirmCancelBtn">${cancelText || 'Anuluj'}</button>
          <button class="${danger ? 'btn-danger' : 'btn-primary'}" id="confirmOkBtn">${confirmText || 'OK'}</button>
        </div>
      </div>
    `;
    overlay.classList.add('show');
    const finish = (result) => {
      overlay.classList.remove('show');
      resolve(result);
    };
    document.getElementById('confirmOkBtn').addEventListener('click', () => finish(true));
    document.getElementById('confirmCancelBtn').addEventListener('click', () => finish(false));
  });
}

function openLightbox(src) {
  let box = document.getElementById('lightboxOverlay');
  if (!box) {
    box = document.createElement('div');
    box.id = 'lightboxOverlay';
    box.className = 'modal-overlay';
    box.innerHTML = `<img class="lightbox-img" id="lightboxImg">`;
    box.addEventListener('click', () => box.classList.remove('show'));
    document.body.appendChild(box);
  }
  document.getElementById('lightboxImg').src = src;
  box.classList.add('show');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderConverter() {
  const term = searchTerm.trim();
  const rows = miary
    .filter(m => fuzzyMatch(m.name, term))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  converterBody.innerHTML = rows.map(m => `
    <tr data-id="${m.id}">
      <td>${escapeHtml(m.name)}</td>
      <td>${escapeHtml(m.cup) || '—'}</td>
      <td>${escapeHtml(m.tbsp) || '—'}</td>
      <td>${escapeHtml(m.tsp) || '—'}</td>
      <td class="conv-row-actions">
        <button class="icon-btn conv-edit" title="Edytuj">✎</button>
        <button class="icon-btn conv-delete" title="Usuń">✕</button>
      </td>
    </tr>
  `).join('');
  converterEmpty.hidden = rows.length !== 0;

  converterBody.querySelectorAll('.conv-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      const item = miary.find(m => String(m.id) === String(id));
      if (item) openConverterForm(item);
    });
  });
  converterBody.querySelectorAll('.conv-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      const item = miary.find(m => String(m.id) === String(id));
      if (!item) return;
      const confirmed = await customConfirm({
        title: 'Potwierdź usunięcie',
        message: `Usunąć „${escapeHtml(item.name)}” z przelicznika?`,
        confirmText: 'Usuń',
        cancelText: 'Anuluj',
        danger: true
      });
      if (!confirmed) return;
      miary = miary.filter(m => String(m.id) !== String(id));
      await window.api.saveMiary(miary);
      renderConverter();
      showToast('Produkt usunięty z przelicznika');
    });
  });
}

function openConverterForm(item) {
  document.getElementById('cf-id').value = item ? item.id : '';
  document.getElementById('cf-name').value = item ? item.name : '';
  document.getElementById('cf-cup').value = item ? item.cup : '';
  document.getElementById('cf-tbsp').value = item ? item.tbsp : '';
  document.getElementById('cf-tsp').value = item ? item.tsp : '';
  document.getElementById('converterFormTitle').textContent = item ? 'Edytuj produkt' : 'Nowy produkt';
  converterFormOverlay.classList.add('show');
}

function updateView() {
  const isConverter = activeCat === 'przelicznik';
  grid.hidden = isConverter;
  emptyState.hidden = isConverter || filteredRecipes().length !== 0;
  converterView.hidden = !isConverter;
  sortSelect.hidden = isConverter;
  addBtn.hidden = isConverter;
  searchInput.placeholder = isConverter ? 'Szukaj produktu…' : 'Szukaj przepisu…';
  if (isConverter) {
    renderConverter();
  } else {
    render();
  }
}

catList.addEventListener('click', (e) => {
  const chevron = e.target.closest('.cat-chevron');
  if (chevron) {
    e.stopPropagation();
    const cat = chevron.dataset.cat;
    if (expandedCats.has(cat)) expandedCats.delete(cat);
    else expandedCats.add(cat);
    renderCatTree();
    return;
  }

  const subBtn = e.target.closest('.subcat-item');
  if (subBtn) {
    activeCat = subBtn.dataset.cat;
    activeSubcat = subBtn.dataset.subcat;
    expandedCats.add(activeCat);
    searchTerm = '';
    searchInput.value = '';
    renderCatTree();
    updateView();
    return;
  }

  const btn = e.target.closest('.cat-item');
  if (!btn) return;
  activeCat = btn.dataset.cat;
  activeSubcat = null;
  searchTerm = '';
  searchInput.value = '';
  renderCatTree();
  updateView();
});

searchInput.addEventListener('input', (e) => {
  searchTerm = e.target.value;
  if (activeCat === 'przelicznik') {
    renderConverter();
  } else {
    render();
  }
});

document.getElementById('sortSelect').addEventListener('change', (e) => {
  sortMode = e.target.value;
  render();
});

/* ---------- VIEW MODAL ---------- */
const viewOverlay = document.getElementById('viewOverlay');
const viewModal = document.getElementById('viewModal');

function openView(r) {
  let currentServings = r.servings || 4;
  const baseServings = r.servings || 4;

  viewModal.innerHTML = `
    <div class="modal-head">
      <div></div>
      <button class="icon-btn" id="closeView">✕</button>
    </div>
    <div class="rv-actions">
      <div class="rv-actions-group">
        <button class="btn-secondary" id="editBtn">Edytuj</button>
        <button class="btn-secondary" id="printBtn">Drukuj</button>
        <button class="btn-secondary" id="pdfBtn">Pobierz .pdf</button>
        <button class="btn-secondary" id="docxBtn">Pobierz .docx</button>
      </div>
      <button class="btn-danger" id="deleteBtn">Usuń</button>
    </div>
    <div class="rv-head">
      <div class="rv-title-row">
        <h2>${escapeHtml(r.title)}</h2>
        <button class="fav-btn ${r.favorite ? 'is-fav' : ''}" id="viewFavBtn" title="${r.favorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}">★</button>
      </div>
      <div class="rv-meta">${CAT_LABELS[r.cat] || r.cat}${subcatLabel(r.cat, r.subcat) ? ` · ${escapeHtml(subcatLabel(r.cat, r.subcat))}` : ''} · ⏱ ${escapeHtml(normalizeTime(r.time))}</div>
    </div>
    <div class="rv-section">
      <div class="rv-servings-row">
        <h4 class="no-margin">Składniki</h4>
        <div class="servings-control">
          <span>Porcje:</span>
          <button type="button" id="servMinus">–</button>
          <span id="servValue">${currentServings}</span>
          <button type="button" id="servPlus">+</button>
        </div>
      </div>
      <ul class="rv-ing" id="rvIngList"></ul>
      <button class="copy-link" id="copyIngBtn">📋 Skopiuj do swojej listy zakupów</button>
    </div>
    <div class="rv-section">
      <h4>Przygotowanie</h4>
      <ol class="rv-steps">${(r.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
    </div>
    ${r.notes ? `
    <div class="rv-section">
      <h4>Notatki</h4>
      <p class="rv-notes">${escapeHtml(r.notes).replace(/\n/g, '<br>')}</p>
    </div>` : ''}
    <div class="rv-section">
      <div class="rv-servings-row">
        <h4 class="no-margin">Zdjęcia</h4>
        <button class="btn-secondary" id="addPhotosBtn">+ Dodaj zdjęcia</button>
      </div>
      <div class="gallery" id="galleryGrid"></div>
    </div>
  `;
  viewOverlay.classList.add('show');

  function renderGallery() {
    const grid = document.getElementById('galleryGrid');
    const photos = r.photos || [];
    if (!photos.length) {
      grid.innerHTML = `<p class="gallery-empty">Brak zdjęć — dodaj pierwsze.</p>`;
      return;
    }
    grid.innerHTML = photos.map((src, i) => `
      <div class="gallery-item">
        <img src="${src}" data-idx="${i}">
        <button class="remove-photo" data-idx="${i}" title="Usuń zdjęcie">✕</button>
      </div>
    `).join('');
    grid.querySelectorAll('img').forEach(img => {
      img.addEventListener('click', () => openLightbox(img.src));
    });
    grid.querySelectorAll('.remove-photo').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        r.photos.splice(idx, 1);
        await window.api.saveRecipes(recipes);
        renderGallery();
      });
    });
  }
  renderGallery();

  document.getElementById('addPhotosBtn').addEventListener('click', async () => {
    const newPhotos = await window.api.pickImages();
    if (!newPhotos.length) return;
    r.photos = (r.photos || []).concat(newPhotos);
    await window.api.saveRecipes(recipes);
    renderGallery();
    showToast(`Dodano ${newPhotos.length} ${plural(newPhotos.length, ['zdjęcie', 'zdjęcia', 'zdjęć'])}`);
  });

  function renderIng() {
    const factor = currentServings / baseServings;
    document.getElementById('rvIngList').innerHTML = (r.ing || [])
      .map(i => `<li>${escapeHtml(scaleIngredientText(i, factor))}</li>`).join('');
    document.getElementById('servValue').textContent = currentServings;
  }
  renderIng();

  document.getElementById('servMinus').addEventListener('click', () => {
    if (currentServings > 1) { currentServings--; renderIng(); }
  });
  document.getElementById('servPlus').addEventListener('click', () => {
    if (currentServings < 50) { currentServings++; renderIng(); }
  });

  document.getElementById('copyIngBtn').addEventListener('click', async () => {
    const factor = currentServings / baseServings;
    const text = (r.ing || []).map(i => scaleIngredientText(i, factor)).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast('Skopiowano — wklej (Ctrl+V) w swojej liście zakupów');
    } catch (err) {
      console.error(err);
      showToast('Nie udało się skopiować do schowka', true);
    }
  });

  document.getElementById('viewFavBtn').addEventListener('click', async (e) => {
    r.favorite = !r.favorite;
    e.target.classList.toggle('is-fav', r.favorite);
    e.target.title = r.favorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych';
    await window.api.saveRecipes(recipes);
    render();
  });

  document.getElementById('closeView').addEventListener('click', () => viewOverlay.classList.remove('show'));

  document.getElementById('editBtn').addEventListener('click', () => {
    viewOverlay.classList.remove('show');
    openForm(r);
  });

  document.getElementById('pdfBtn').addEventListener('click', async (e) => {
    await handleExport(e.target, () => window.api.exportPdf(r), 'PDF');
  });
  document.getElementById('docxBtn').addEventListener('click', async (e) => {
    await handleExport(e.target, () => window.api.exportDocx(r), 'DOCX');
  });
  document.getElementById('printBtn').addEventListener('click', async (e) => {
    const btn = e.target;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Przygotowywanie…';
    try {
      const result = await window.api.printRecipe(r);
      if (result && result.ok) showToast('Wysłano do druku');
    } catch (err) {
      console.error(err);
      showToast('Nie udało się wydrukować', true);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  document.getElementById('deleteBtn').addEventListener('click', async () => {
    const confirmed = await customConfirm({
      title: 'Potwierdź usunięcie',
      message: `Usunąć przepis „${escapeHtml(r.title)}”?`,
      detail: 'Tej operacji nie można cofnąć.',
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
      danger: true
    });
    if (!confirmed) return;
    recipes = recipes.filter(x => String(x.id) !== String(r.id));
    await window.api.saveRecipes(recipes);
    viewOverlay.classList.remove('show');
    renderCatTree();
    render();
    showToast('Przepis usunięty');
  });
}
viewOverlay.addEventListener('click', (e) => { if (e.target === viewOverlay) viewOverlay.classList.remove('show'); });

async function handleExport(btn, exportFn, label) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Zapisywanie…';
  try {
    const result = await exportFn();
    if (result && result.ok) {
      showToast(`Zapisano jako ${label}`);
    } else if (result && result.canceled) {
      // użytkownik anulował okno zapisu — nic nie pokazujemy
    } else {
      showToast(`Nie udało się zapisać ${label}`, true);
    }
  } catch (err) {
    console.error(err);
    showToast(`Nie udało się zapisać ${label}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

let toastTimer;
function showToast(msg, isError) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.toggle('toast-error', !!isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

/* ---------- ADD / EDIT MODAL ---------- */
const addOverlay = document.getElementById('addOverlay');
const recipeForm = document.getElementById('recipeForm');
const formTitle = document.getElementById('formTitle');

function populateSubcatOptions(cat, selectedValue) {
  const select = document.getElementById('f-subcat');
  const options = SUBCATS[cat] || [];
  if (!cat || !options.length) {
    select.innerHTML = '<option value="" disabled selected>Najpierw wybierz kategorię</option>';
    return;
  }
  const isValid = selectedValue && options.some(s => s.key === selectedValue);
  select.innerHTML = `<option value="" disabled ${isValid ? '' : 'selected'}>Wybierz podkategorię</option>` +
    options.map(s => `<option value="${s.key}" ${s.key === selectedValue ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
}

document.getElementById('f-cat').addEventListener('change', (e) => {
  populateSubcatOptions(e.target.value, '');
});

function openForm(recipe) {
  recipeForm.reset();
  if (recipe) {
    formTitle.textContent = 'Edytuj przepis';
    document.getElementById('f-id').value = recipe.id;
    document.getElementById('f-title').value = recipe.title || '';
    document.getElementById('f-cat').value = recipe.cat || '';
    populateSubcatOptions(recipe.cat || '', recipe.subcat || '');
    document.getElementById('f-time').value = recipe.time || '';
    document.getElementById('f-desc').value = recipe.desc || '';
    document.getElementById('f-servings').value = recipe.servings || 4;
    document.getElementById('f-ing').value = (recipe.ing || []).join('\n');
    document.getElementById('f-steps').value = (recipe.steps || []).join('\n');
    document.getElementById('f-notes').value = recipe.notes || '';
  } else {
    formTitle.textContent = 'Nowy przepis';
    document.getElementById('f-id').value = '';
    document.getElementById('f-servings').value = 4;
    populateSubcatOptions('', '');
  }
  addOverlay.classList.add('show');
}

document.getElementById('addBtn').addEventListener('click', () => openForm(null));
document.getElementById('closeAdd').addEventListener('click', () => addOverlay.classList.remove('show'));
addOverlay.addEventListener('click', (e) => { if (e.target === addOverlay) addOverlay.classList.remove('show'); });

recipeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const idValue = document.getElementById('f-id').value;
  const data = {
    title: document.getElementById('f-title').value.trim() || 'Bez tytułu',
    cat: document.getElementById('f-cat').value,
    subcat: document.getElementById('f-subcat').value,
    time: normalizeTime(document.getElementById('f-time').value.trim()),
    desc: document.getElementById('f-desc').value.trim(),
    servings: parseInt(document.getElementById('f-servings').value, 10) || 4,
    notes: document.getElementById('f-notes').value.trim(),
    ing: document.getElementById('f-ing').value.split('\n').map(s => s.trim()).filter(Boolean),
    steps: document.getElementById('f-steps').value.split('\n').map(s => s.trim()).filter(Boolean)
  };

  if (!idValue) {
    const normTitle = data.title.trim().toLowerCase().replace(/\s+/g, ' ');
    const dup = recipes.find(r => {
      const rn = r.title.trim().toLowerCase().replace(/\s+/g, ' ');
      return rn === normTitle || rn.includes(normTitle) || normTitle.includes(rn);
    });
    if (dup) {
      const proceed = await customConfirm({
        title: 'Podobny przepis już istnieje',
        message: `Przepis o podobnym tytule już masz: „${escapeHtml(dup.title)}”.`,
        detail: 'Dodać ten jako kolejny, osobny przepis?',
        confirmText: 'Dodaj mimo to',
        cancelText: 'Anuluj',
        danger: false
      });
      if (!proceed) return;
    }
  }

  if (idValue) {
    const idx = recipes.findIndex(r => String(r.id) === String(idValue));
    if (idx !== -1) recipes[idx] = { ...recipes[idx], ...data };
  } else {
    recipes.unshift({ id: Date.now(), favorite: false, ...data });
  }

  await window.api.saveRecipes(recipes);
  addOverlay.classList.remove('show');
  activeCat = 'wszystkie';
  activeSubcat = null;
  renderCatTree();
  render();
  showToast(idValue ? 'Przepis zaktualizowany' : 'Przepis dodany');
});

/* ---------- PRZELICZNIK: DODAWANIE / EDYCJA PRODUKTU ---------- */
document.getElementById('converterAddBtn').addEventListener('click', () => openConverterForm(null));
document.getElementById('closeConverterForm').addEventListener('click', () => converterFormOverlay.classList.remove('show'));
converterFormOverlay.addEventListener('click', (e) => { if (e.target === converterFormOverlay) converterFormOverlay.classList.remove('show'); });

converterForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const idValue = document.getElementById('cf-id').value;
  const data = {
    name: document.getElementById('cf-name').value.trim() || 'Bez nazwy',
    cup: document.getElementById('cf-cup').value.trim(),
    tbsp: document.getElementById('cf-tbsp').value.trim(),
    tsp: document.getElementById('cf-tsp').value.trim()
  };

  if (idValue) {
    const idx = miary.findIndex(m => String(m.id) === String(idValue));
    if (idx !== -1) miary[idx] = { ...miary[idx], ...data };
  } else {
    miary.push({ id: Date.now(), ...data });
  }

  await window.api.saveMiary(miary);
  converterFormOverlay.classList.remove('show');
  renderConverter();
  showToast(idValue ? 'Produkt zaktualizowany' : 'Produkt dodany do przelicznika');
});

init();
