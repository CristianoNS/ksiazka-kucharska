/* Nazwy kategorii, podkategorii i formatowanie czasu pochodzą ze wspólnego
   pliku common.js, z którego korzysta też proces główny (eksport PDF/DOCX).
   Wcześniej te dane były zdublowane i groziło im rozjechanie się. */
const { CAT_LABELS, SUBCATS, subcatLabel, normalizeTime, makeId } = window.KKCommon;

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
let stanAplikacji = { tylkoOdczyt: false, folderDanych: '', problemy: [] };

/* --------------------------------------------------------------------------
   BEZPIECZNY ZAPIS
   Wcześniej wynik zapisu był ignorowany we wszystkich miejscach: gdy dysk był
   pełny albo folder tylko do odczytu, użytkownik widział normalny interfejs
   i był przekonany, że przepis się zapisał. Teraz każdy zapis przechodzi
   przez te funkcje, które pokazują wskaźnik stanu i głośno krzyczą przy
   niepowodzeniu.
   -------------------------------------------------------------------------- */

function pokazStanZapisu(stan, tekst) {
  const el = document.getElementById('saveStatus');
  if (!el) return;
  el.className = `save-status ${stan}`;
  el.textContent = tekst;
  el.hidden = false;
  if (stan === 'ok') {
    clearTimeout(pokazStanZapisu._timer);
    pokazStanZapisu._timer = setTimeout(() => { el.hidden = true; }, 2000);
  }
}

async function zapiszPrzepisy() {
  pokazStanZapisu('trwa', 'Zapisywanie…');
  let wynik;
  try {
    wynik = await window.api.saveRecipes(recipes);
  } catch (err) {
    console.error('Błąd zapisu przepisów:', err);
    wynik = { ok: false, error: String(err) };
  }
  if (wynik && wynik.ok) {
    pokazStanZapisu('ok', 'Zapisano ✓');
    return true;
  }
  pokazStanZapisu('blad', 'NIE ZAPISANO');
  await customConfirm({
    title: 'Nie udało się zapisać',
    message: wynik && wynik.tylkoOdczyt
      ? 'Aplikacja działa w trybie tylko do odczytu — zmiany nie zostaną zachowane.'
      : 'Zmiany nie zostały zapisane na dysk.',
    detail: (wynik && wynik.error ? `Szczegóły: ${wynik.error}` : '') +
      ' Sprawdź, czy dysk nie jest pełny i czy folder z danymi nie jest zabezpieczony przed zapisem.',
    confirmText: 'Rozumiem',
    cancelText: null,
    danger: true
  });
  return false;
}

async function zapiszMiary() {
  pokazStanZapisu('trwa', 'Zapisywanie…');
  let wynik;
  try {
    wynik = await window.api.saveMiary(miary);
  } catch (err) {
    console.error('Błąd zapisu przelicznika:', err);
    wynik = { ok: false, error: String(err) };
  }
  if (wynik && wynik.ok) {
    pokazStanZapisu('ok', 'Zapisano ✓');
    return true;
  }
  pokazStanZapisu('blad', 'NIE ZAPISANO');
  showToast('Nie udało się zapisać przelicznika miar', true);
  return false;
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
  // Cały start jest w try/catch — wcześniej jakikolwiek błąd wczytywania
  // zostawiał użytkownika z pustym białym ekranem bez wyjaśnienia.
  try {
    try {
      stanAplikacji = await window.api.stanAplikacji();
    } catch (err) {
      console.error('Nie udało się pobrać stanu aplikacji:', err);
    }

    const odczyt = await window.api.loadRecipes();

    // Plik z przepisami jest uszkodzony — pokazujemy ekran ratunkowy zamiast
    // udawać, że baza jest pusta (co wcześniej kończyło się nadpisaniem
    // danych przy pierwszej zmianie).
    if (odczyt && odczyt.uszkodzony) {
      pokazEkranRatunkowy(odczyt);
      return;
    }

    recipes = (odczyt && odczyt.przepisy) || [];

    const miaryOdczyt = await window.api.loadMiary();
    miary = (miaryOdczyt && miaryOdczyt.miary) || [];

    zastosujTrybTylkoOdczytu();
    renderCatTree();
    render();

    // Informacja o automatycznych naprawach i problemach wykrytych przy starcie
    const komunikaty = []
      .concat((odczyt && odczyt.naprawy) || [])
      .concat((stanAplikacji && stanAplikacji.problemy) || []);
    if (komunikaty.length) {
      await customConfirm({
        title: 'Sprawdzenie bazy przy uruchomieniu',
        message: 'Aplikacja wykryła i naprawiła drobne nieprawidłowości w danych:',
        detail: komunikaty.slice(0, 8).map(t => `• ${escapeHtml(t)}`).join('<br>') +
          (komunikaty.length > 8 ? `<br>…i jeszcze ${komunikaty.length - 8}.` : ''),
        confirmText: 'Rozumiem',
        cancelText: null,
        danger: false
      });
    }
  } catch (err) {
    console.error('Błąd uruchamiania aplikacji:', err);
    document.body.innerHTML = `
      <div class="fatal-screen">
        <h1>Nie udało się uruchomić aplikacji</h1>
        <p>Wystąpił nieoczekiwany błąd podczas wczytywania danych. Twoje przepisy
        najprawdopodobniej są bezpieczne — aplikacja trzyma kopie zapasowe.</p>
        <p class="fatal-detail">${escapeHtml(String(err && err.message ? err.message : err))}</p>
        <p>Spróbuj zamknąć i uruchomić program ponownie. Jeśli problem się powtarza,
        skopiuj folder <strong>dane-aplikacji</strong> w bezpieczne miejsce.</p>
      </div>`;
  }
}

// Tryb tylko do odczytu — gdy nie da się pisać na dysk, blokujemy dodawanie
// i edycję, zamiast pozwolić użytkownikowi pracować na próżno.
function zastosujTrybTylkoOdczytu() {
  if (!stanAplikacji || !stanAplikacji.tylkoOdczyt) return;
  document.body.classList.add('tryb-tylko-odczyt');
  const pasek = document.getElementById('readonlyBar');
  if (pasek) {
    pasek.hidden = false;
    pasek.textContent = '⚠ Tryb tylko do odczytu — wprowadzone zmiany NIE zostaną zapisane. '
      + (stanAplikacji.powodTylkoOdczyt || '');
  }
  ['addBtn', 'converterAddBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = true;
  });
}

// Ekran ratunkowy przy uszkodzonej bazie: pokazuje dostępne kopie zapasowe
// z datą i liczbą przepisów, żeby dało się wrócić do działającego stanu
// bez żadnej wiedzy technicznej.
function pokazEkranRatunkowy(odczyt) {
  const kopie = odczyt.kopie || [];
  const listaHtml = kopie.length
    ? kopie.map(k => `
        <li>
          <div class="rescue-copy">
            <div>
              <strong>${formatujDate(k.data)}</strong>
              <span class="rescue-count">${k.liczbaPrzepisow} ${plural(k.liczbaPrzepisow, ['przepis', 'przepisy', 'przepisów'])}</span>
            </div>
            <button class="btn-primary" data-plik="${escapeHtml(k.plik)}">Przywróć tę kopię</button>
          </div>
        </li>`).join('')
    : '<li class="rescue-none">Nie znaleziono żadnej kopii zapasowej.</li>';

  document.body.innerHTML = `
    <div class="rescue-screen">
      <div class="rescue-box">
        <div class="rescue-icon">⚠</div>
        <h1>Nie udało się odczytać przepisów</h1>
        <p>Plik z przepisami jest uszkodzony. <strong>Nic nie zostało skasowane</strong> —
        uszkodzony plik zachowaliśmy na dysku, a poniżej są kopie zapasowe,
        które aplikacja robi automatycznie.</p>
        <p class="rescue-error">${escapeHtml(odczyt.blad || '')}</p>
        <h2>Dostępne kopie zapasowe</h2>
        <ul class="rescue-list">${listaHtml}</ul>
        <p class="rescue-hint">Po przywróceniu kopii aplikacja uruchomi się ponownie z odzyskanymi przepisami.</p>
      </div>
    </div>`;

  document.querySelectorAll('.rescue-list button[data-plik]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Przywracanie…';
      try {
        const wynik = await window.api.przywrocKopie(btn.dataset.plik);
        if (wynik && wynik.ok) {
          location.reload();
        } else {
          btn.disabled = false;
          btn.textContent = 'Przywróć tę kopię';
          alert('Nie udało się przywrócić kopii: ' + ((wynik && wynik.error) || 'nieznany błąd'));
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Przywróć tę kopię';
        alert('Nie udało się przywrócić kopii: ' + err);
      }
    });
  });
}

function formatujDate(iso) {
  if (!iso) return 'nieznana data';
  try {
    return new Date(iso).toLocaleString('pl-PL', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch (_) {
    return String(iso);
  }
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
      <span class="tag ${escapeHtml(r.cat)}"><span class="dot"></span>${escapeHtml(CAT_LABELS[r.cat] || r.cat)}${subLabel ? ` · ${escapeHtml(subLabel)}` : ''}</span>
      <h3>${escapeHtml(r.title)}</h3>
      <p>${escapeHtml(r.desc || '')}</p>
      <div class="meta"><span>⏱ ${escapeHtml(normalizeTime(r.time))}</span><span>${(r.ing || []).length} ${plural((r.ing || []).length, ['składnik', 'składniki', 'składników'])}</span></div>
    `;
    card.querySelector('.fav-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      r.favorite = !r.favorite;
      await zapiszPrzepisy();
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
    // cancelText === null oznacza okno czysto informacyjne (tylko jeden przycisk)
    const zPrzyciskiemAnuluj = cancelText !== null;
    overlay.innerHTML = `
      <div class="modal confirm-modal">
        <div class="confirm-icon ${danger ? 'danger' : ''}">${danger ? '⚠' : 'ℹ'}</div>
        <h3>${title}</h3>
        <p>${message}</p>
        ${detail ? `<p class="confirm-detail">${detail}</p>` : ''}
        <div class="confirm-actions">
          ${zPrzyciskiemAnuluj ? `<button class="btn-secondary" id="confirmCancelBtn">${cancelText || 'Anuluj'}</button>` : ''}
          <button class="${danger ? 'btn-danger' : 'btn-primary'}" id="confirmOkBtn">${confirmText || 'OK'}</button>
        </div>
      </div>
    `;
    overlay.classList.add('show');

    const finish = (result) => {
      document.removeEventListener('keydown', obslugaKlawiszy, true);
      overlay.classList.remove('show');
      resolve(result);
    };
    // Esc = anuluj, Enter = potwierdź. Dialog musi obsłużyć klawisze sam,
    // zanim zrobi to globalna obsługa Esc dla pozostałych okien.
    function obslugaKlawiszy(e) {
      if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter') { e.stopPropagation(); finish(true); }
    }
    document.addEventListener('keydown', obslugaKlawiszy, true);

    document.getElementById('confirmOkBtn').addEventListener('click', () => finish(true));
    const anuluj = document.getElementById('confirmCancelBtn');
    if (anuluj) anuluj.addEventListener('click', () => finish(false));
    setTimeout(() => {
      const ok = document.getElementById('confirmOkBtn');
      if (ok) ok.focus();
    }, 30);
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
      await zapiszMiary();
      renderConverter();
      showToast('Produkt usunięty z przelicznika');
    });
  });
}

function converterSnapshot() {
  return JSON.stringify(['cf-name', 'cf-cup', 'cf-tbsp', 'cf-tsp']
    .map(id => document.getElementById(id).value));
}
let converterOpenSnapshot = null;

function openConverterForm(item) {
  document.getElementById('cf-id').value = item ? item.id : '';
  document.getElementById('cf-name').value = item ? item.name : '';
  document.getElementById('cf-cup').value = item ? item.cup : '';
  document.getElementById('cf-tbsp').value = item ? item.tbsp : '';
  document.getElementById('cf-tsp').value = item ? item.tsp : '';
  document.getElementById('converterFormTitle').textContent = item ? 'Edytuj produkt' : 'Nowy produkt';
  converterFormOverlay.classList.add('show');
  converterOpenSnapshot = converterSnapshot();
}

// To samo zabezpieczenie co przy przepisach — żeby przypadkowe zamknięcie
// okna nie skasowało wpisanych danych.
async function tryCloseConverterForm() {
  const zmienione = converterOpenSnapshot !== null && converterSnapshot() !== converterOpenSnapshot;
  if (zmienione) {
    const proceed = await customConfirm({
      title: 'Niezapisane zmiany',
      message: 'Wprowadzone dane produktu nie zostały zapisane.',
      detail: 'Zamknąć bez zapisywania?',
      confirmText: 'Zamknij bez zapisywania',
      cancelText: 'Wróć do edycji',
      danger: true
    });
    if (!proceed) return;
  }
  converterFormOverlay.classList.remove('show');
  converterOpenSnapshot = null;
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
      <div class="rv-meta">${escapeHtml(CAT_LABELS[r.cat] || r.cat)}${subcatLabel(r.cat, r.subcat) ? ` · ${escapeHtml(subcatLabel(r.cat, r.subcat))}` : ''} · ⏱ ${escapeHtml(normalizeTime(r.time))}</div>
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

  // Zdjęcia są wczytywane z dysku dopiero tutaj, przy otwarciu przepisu.
  // Dzięki temu plik przepisy.json pozostaje mały i szybki, niezależnie
  // od tego, ile zdjęć jest w bazie.
  async function renderGallery() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;
    const photos = r.photos || [];
    if (!photos.length) {
      grid.innerHTML = `<p class="gallery-empty">Brak zdjęć — dodaj pierwsze.</p>`;
      return;
    }
    grid.innerHTML = `<p class="gallery-empty">Wczytywanie zdjęć…</p>`;

    let zrodla = [];
    try {
      zrodla = await window.api.loadPhotos(photos);
    } catch (err) {
      console.error('Nie udało się wczytać zdjęć:', err);
    }

    const pary = photos.map((nazwa, i) => ({ nazwa, i, src: zrodla[i] })).filter(x => x.src);
    if (!pary.length) {
      grid.innerHTML = `<p class="gallery-empty">Nie udało się wczytać zdjęć z dysku.</p>`;
      return;
    }
    grid.innerHTML = pary.map(({ src, i }) => `
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
        if (!Array.isArray(r.photos) || !(idx in r.photos)) return;
        r.photos.splice(idx, 1);
        await zapiszPrzepisy();
        await renderGallery();
      });
    });
  }
  renderGallery();   // celowo bez await — galeria doczytuje się w tle

  document.getElementById('addPhotosBtn').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    try {
      const wynik = await window.api.pickImages();
      if (!wynik || wynik.canceled) return;
      if (!wynik.ok) {
        showToast(wynik.error || 'Nie udało się dodać zdjęć', true);
        return;
      }
      const nazwy = wynik.nazwy || [];
      r.photos = (r.photos || []).concat(nazwy);
      await zapiszPrzepisy();
      await renderGallery();
      let info = `Dodano ${nazwy.length} ${plural(nazwy.length, ['zdjęcie', 'zdjęcia', 'zdjęć'])}`;
      if (wynik.bledy && wynik.bledy.length) {
        info += ` (nie udało się dodać: ${wynik.bledy.length})`;
      }
      showToast(info);
    } catch (err) {
      console.error(err);
      showToast('Nie udało się dodać zdjęć', true);
    } finally {
      btn.disabled = false;
    }
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
    await zapiszPrzepisy();
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
      detail: 'Przepis trafi do kosza i przez 30 dni będzie można go przywrócić.',
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
      danger: true
    });
    if (!confirmed) return;

    // Najpierw kopia do kosza, dopiero potem usunięcie z listy — gdyby zapis
    // kosza się nie udał, przepis zostaje nietknięty.
    try {
      const doKosza = await window.api.doKosza(r);
      if (!doKosza || !doKosza.ok) {
        showToast('Nie udało się usunąć przepisu', true);
        return;
      }
    } catch (err) {
      console.error(err);
      showToast('Nie udało się usunąć przepisu', true);
      return;
    }

    const kopiaListy = recipes.slice();
    recipes = recipes.filter(x => String(x.id) !== String(r.id));
    const zapisano = await zapiszPrzepisy();
    if (!zapisano) {
      recipes = kopiaListy;   // cofamy zmianę w pamięci, żeby ekran zgadzał się z dyskiem
      return;
    }
    viewOverlay.classList.remove('show');
    renderCatTree();
    render();
    showToast('Przepis przeniesiony do kosza');
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

function formSnapshot() {
  return JSON.stringify([
    document.getElementById('f-title').value,
    document.getElementById('f-cat').value,
    document.getElementById('f-subcat').value,
    document.getElementById('f-time').value,
    document.getElementById('f-desc').value,
    document.getElementById('f-servings').value,
    document.getElementById('f-ing').value,
    document.getElementById('f-steps').value,
    document.getElementById('f-notes').value
  ]);
}
let formOpenSnapshot = null;

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
  formOpenSnapshot = formSnapshot();
}

document.getElementById('addBtn').addEventListener('click', () => openForm(null));

async function tryCloseForm() {
  const isDirty = formOpenSnapshot !== null && formSnapshot() !== formOpenSnapshot;
  if (isDirty) {
    const proceed = await customConfirm({
      title: 'Niezapisane zmiany',
      message: 'Wprowadzone dane w przepisie nie zostały zapisane.',
      detail: 'Zamknąć bez zapisywania?',
      confirmText: 'Zamknij bez zapisywania',
      cancelText: 'Wróć do edycji',
      danger: true
    });
    if (!proceed) return;
  }
  addOverlay.classList.remove('show');
  formOpenSnapshot = null;
}

document.getElementById('closeAdd').addEventListener('click', tryCloseForm);
addOverlay.addEventListener('click', (e) => { if (e.target === addOverlay) tryCloseForm(); });

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
    // Wykrywanie duplikatów: wcześniej używane `includes` w obie strony było
    // zbyt agresywne — przepis „Zupa” w bazie powodował ostrzeżenie przy
    // KAŻDEJ „Zupie pomidorowej”, „Zupie ogórkowej” itd. Teraz ostrzegamy
    // tylko przy tytule praktycznie identycznym (po pominięciu wielkości
    // liter, polskich znaków i znaków interpunkcyjnych).
    const uprosc = (t) => normalizeSearchPl(t).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const normTitle = uprosc(data.title);
    const dup = normTitle ? recipes.find(r => uprosc(r.title) === normTitle) : null;
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

  await zapiszPrzepisy();
  addOverlay.classList.remove('show');
  formOpenSnapshot = null;
  activeCat = 'wszystkie';
  activeSubcat = null;
  renderCatTree();
  render();
  showToast(idValue ? 'Przepis zaktualizowany' : 'Przepis dodany');
});

/* ---------- PRZELICZNIK: DODAWANIE / EDYCJA PRODUKTU ---------- */
document.getElementById('converterAddBtn').addEventListener('click', () => openConverterForm(null));
document.getElementById('closeConverterForm').addEventListener('click', tryCloseConverterForm);
converterFormOverlay.addEventListener('click', (e) => { if (e.target === converterFormOverlay) tryCloseConverterForm(); });

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

  await zapiszMiary();
  converterFormOverlay.classList.remove('show');
  converterOpenSnapshot = null;
  renderConverter();
  showToast(idValue ? 'Produkt zaktualizowany' : 'Produkt dodany do przelicznika');
});


/* ==========================================================================
   KOSZ — usunięte przepisy można odzyskać przez 30 dni
   ========================================================================== */

const koszOverlay = document.getElementById('koszOverlay');

async function otworzKosz() {
  let kosz = [];
  try {
    kosz = await window.api.loadKosz();
  } catch (err) {
    console.error('Nie udało się wczytać kosza:', err);
    showToast('Nie udało się otworzyć kosza', true);
    return;
  }

  const modal = document.getElementById('koszModal');
  const listaHtml = kosz.length
    ? kosz.map(w => `
        <li class="kosz-item" data-id="${escapeHtml(String(w.id))}">
          <div class="kosz-info">
            <strong>${escapeHtml(w.title || 'Bez tytułu')}</strong>
            <span class="kosz-meta">usunięto ${formatujDate(w.usunietoDnia)} · zostało ${dniDoUsuniecia(w.usunietoDnia)}</span>
          </div>
          <div class="kosz-akcje">
            <button class="btn-secondary kosz-przywroc">Przywróć</button>
            <button class="btn-danger kosz-usun">Usuń trwale</button>
          </div>
        </li>`).join('')
    : '<li class="kosz-pusty">Kosz jest pusty.</li>';

  modal.innerHTML = `
    <div class="modal-head">
      <h2>Kosz</h2>
      <button class="icon-btn" id="closeKosz">✕</button>
    </div>
    <p class="kosz-opis">Usunięte przepisy są tu przechowywane przez 30 dni, a potem znikają automatycznie.</p>
    <ul class="kosz-lista">${listaHtml}</ul>
    ${kosz.length ? '<button class="btn-danger btn-block" id="oproznijKoszBtn">Opróżnij cały kosz</button>' : ''}
  `;
  koszOverlay.classList.add('show');

  document.getElementById('closeKosz').addEventListener('click', () => koszOverlay.classList.remove('show'));

  modal.querySelectorAll('.kosz-przywroc').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.kosz-item').dataset.id;
      btn.disabled = true;
      try {
        const wynik = await window.api.przywrocZKosza(id);
        if (wynik && wynik.ok) {
          const odczyt = await window.api.loadRecipes();
          recipes = (odczyt && odczyt.przepisy) || recipes;
          renderCatTree();
          render();
          showToast('Przepis przywrócony');
          otworzKosz();
        } else {
          btn.disabled = false;
          showToast((wynik && wynik.error) || 'Nie udało się przywrócić przepisu', true);
        }
      } catch (err) {
        btn.disabled = false;
        console.error(err);
        showToast('Nie udało się przywrócić przepisu', true);
      }
    });
  });

  modal.querySelectorAll('.kosz-usun').forEach(btn => {
    btn.addEventListener('click', async () => {
      const el = btn.closest('.kosz-item');
      const id = el.dataset.id;
      const nazwa = el.querySelector('strong').textContent;
      const potwierdzone = await customConfirm({
        title: 'Usunąć bezpowrotnie?',
        message: `Przepis „${escapeHtml(nazwa)}” zostanie usunięty na zawsze.`,
        detail: 'Tej operacji nie da się już cofnąć.',
        confirmText: 'Usuń na zawsze',
        cancelText: 'Anuluj',
        danger: true
      });
      if (!potwierdzone) return;
      await window.api.usunTrwale(id);
      otworzKosz();
    });
  });

  const oproznij = document.getElementById('oproznijKoszBtn');
  if (oproznij) {
    oproznij.addEventListener('click', async () => {
      const potwierdzone = await customConfirm({
        title: 'Opróżnić kosz?',
        message: `Wszystkie przepisy w koszu (${kosz.length}) zostaną usunięte na zawsze.`,
        detail: 'Tej operacji nie da się cofnąć.',
        confirmText: 'Opróżnij kosz',
        cancelText: 'Anuluj',
        danger: true
      });
      if (!potwierdzone) return;
      await window.api.oproznijKosz();
      otworzKosz();
      showToast('Kosz opróżniony');
    });
  }
}

function dniDoUsuniecia(iso) {
  const czas = Date.parse(iso);
  if (!Number.isFinite(czas)) return '30 dni';
  const dni = Math.max(0, 30 - Math.floor((Date.now() - czas) / (24 * 3600 * 1000)));
  return `${dni} ${plural(dni, ['dzień', 'dni', 'dni'])}`;
}

koszOverlay.addEventListener('click', (e) => { if (e.target === koszOverlay) koszOverlay.classList.remove('show'); });

/* ==========================================================================
   USTAWIENIA — kopia bazy, import, przywracanie kopii zapasowych
   ========================================================================== */

const ustawieniaOverlay = document.getElementById('ustawieniaOverlay');

async function otworzUstawienia() {
  const modal = document.getElementById('ustawieniaModal');
  modal.innerHTML = `
    <div class="modal-head">
      <h2>Kopie i dane</h2>
      <button class="icon-btn" id="closeUstawienia">✕</button>
    </div>

    <div class="ust-sekcja">
      <h4>Kopia całej bazy</h4>
      <p class="ust-opis">Zapisz wszystkie przepisy, zdjęcia i tabelę przelicznika do jednego pliku —
      możesz go trzymać na pendrivie albo przenieść na inny komputer.</p>
      <div class="ust-przyciski">
        <button class="btn-primary" id="eksportBazyBtn">Zapisz kopię bazy…</button>
        <button class="btn-secondary" id="importBazyBtn">Wczytaj kopię z pliku…</button>
      </div>
    </div>

    <div class="ust-sekcja">
      <h4>Automatyczne kopie zapasowe</h4>
      <p class="ust-opis">Aplikacja sama robi kopię przy każdym uruchomieniu i pamięta 5 ostatnich.
      Jeśli coś pójdzie nie tak, możesz wrócić do wcześniejszej wersji.</p>
      <ul class="ust-kopie" id="listaKopii"><li class="ust-ladowanie">Wczytywanie…</li></ul>
    </div>

    <div class="ust-sekcja">
      <h4>Gdzie leżą Twoje dane</h4>
      <p class="ust-sciezka">${escapeHtml(stanAplikacji.folderDanych || 'nieznana lokalizacja')}</p>
      <button class="btn-secondary" id="otworzFolderBtn">Otwórz ten folder</button>
    </div>
  `;
  ustawieniaOverlay.classList.add('show');

  document.getElementById('closeUstawienia').addEventListener('click', () => ustawieniaOverlay.classList.remove('show'));

  document.getElementById('otworzFolderBtn').addEventListener('click', () => window.api.pokazFolderDanych());

  document.getElementById('eksportBazyBtn').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Zapisywanie…';
    try {
      const wynik = await window.api.exportBaze();
      if (wynik && wynik.ok) {
        showToast(`Zapisano kopię (${wynik.liczbaPrzepisow} ${plural(wynik.liczbaPrzepisow, ['przepis', 'przepisy', 'przepisów'])})`);
      } else if (!wynik || !wynik.canceled) {
        showToast((wynik && wynik.error) || 'Nie udało się zapisać kopii', true);
      }
    } catch (err) {
      console.error(err);
      showToast('Nie udało się zapisać kopii', true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Zapisz kopię bazy…';
    }
  });

  document.getElementById('importBazyBtn').addEventListener('click', async () => {
    const potwierdzone = await customConfirm({
      title: 'Wczytać kopię z pliku?',
      message: 'Obecne przepisy zostaną zastąpione zawartością wybranego pliku.',
      detail: 'Zanim to nastąpi, aplikacja automatycznie zrobi kopię zapasową obecnego stanu.',
      confirmText: 'Wybierz plik…',
      cancelText: 'Anuluj',
      danger: true
    });
    if (!potwierdzone) return;
    try {
      const wynik = await window.api.importBaze();
      if (wynik && wynik.ok) {
        showToast(`Wczytano ${wynik.liczbaPrzepisow} ${plural(wynik.liczbaPrzepisow, ['przepis', 'przepisy', 'przepisów'])}`);
        setTimeout(() => location.reload(), 900);
      } else if (!wynik || !wynik.canceled) {
        showToast((wynik && wynik.error) || 'Nie udało się wczytać kopii', true);
      }
    } catch (err) {
      console.error(err);
      showToast('Nie udało się wczytać kopii', true);
    }
  });

  // lista automatycznych kopii
  try {
    const kopie = await window.api.listaKopii();
    const ul = document.getElementById('listaKopii');
    if (!ul) return;
    ul.innerHTML = kopie.length
      ? kopie.map(k => `
          <li>
            <div class="ust-kopia">
              <div>
                <strong>${formatujDate(k.data)}</strong>
                <span class="ust-kopia-meta">${k.liczbaPrzepisow} ${plural(k.liczbaPrzepisow, ['przepis', 'przepisy', 'przepisów'])}</span>
              </div>
              <button class="btn-secondary" data-plik="${escapeHtml(k.plik)}">Przywróć</button>
            </div>
          </li>`).join('')
      : '<li class="ust-ladowanie">Brak kopii — pierwsza powstanie przy kolejnym uruchomieniu.</li>';

    ul.querySelectorAll('button[data-plik]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const potwierdzone = await customConfirm({
          title: 'Przywrócić tę kopię?',
          message: 'Obecne przepisy zostaną zastąpione zawartością wybranej kopii.',
          detail: 'Obecny plik zostanie zachowany obok, więc nic nie przepadnie bezpowrotnie.',
          confirmText: 'Przywróć',
          cancelText: 'Anuluj',
          danger: true
        });
        if (!potwierdzone) return;
        const wynik = await window.api.przywrocKopie(btn.dataset.plik);
        if (wynik && wynik.ok) {
          showToast(`Przywrócono ${wynik.liczba} ${plural(wynik.liczba, ['przepis', 'przepisy', 'przepisów'])}`);
          setTimeout(() => location.reload(), 900);
        } else {
          showToast((wynik && wynik.error) || 'Nie udało się przywrócić kopii', true);
        }
      });
    });
  } catch (err) {
    console.error('Nie udało się pobrać listy kopii:', err);
  }
}

ustawieniaOverlay.addEventListener('click', (e) => { if (e.target === ustawieniaOverlay) ustawieniaOverlay.classList.remove('show'); });

document.getElementById('koszBtn').addEventListener('click', otworzKosz);
document.getElementById('ustawieniaBtn').addEventListener('click', otworzUstawienia);

/* ==========================================================================
   KLAWISZ ESC — zamyka wierzchnie okno
   ========================================================================== */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const confirmOverlay = document.getElementById('confirmOverlay');
  if (confirmOverlay && confirmOverlay.classList.contains('show')) return; // dialog ma własną obsługę
  if (addOverlay.classList.contains('show')) { tryCloseForm(); return; }
  if (converterFormOverlay.classList.contains('show')) { tryCloseConverterForm(); return; }
  if (ustawieniaOverlay.classList.contains('show')) { ustawieniaOverlay.classList.remove('show'); return; }
  if (koszOverlay.classList.contains('show')) { koszOverlay.classList.remove('show'); return; }
  if (viewOverlay.classList.contains('show')) { viewOverlay.classList.remove('show'); }
});

init();

