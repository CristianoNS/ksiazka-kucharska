const { app, BrowserWindow, ipcMain, dialog, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx');
const { CAT_LABELS, subcatLabel, normalizeTime, makeId } = require('./common.js');

/* ==========================================================================
   1. GDZIE TRZYMAMY DANE
   ========================================================================== */

// Aplikacja jest budowana jako "portable" .exe, więc Electron ustawia zmienną
// PORTABLE_EXECUTABLE_DIR na folder, w którym leży plik .exe. Dane siedzą
// w podfolderze "dane-aplikacji" obok programu — wystarczy skopiować cały
// folder na pendrive, żeby przenieść wszystko na inny komputer.
//
// Jeśli nie da się tam pisać (płyta, folder tylko do odczytu), wracamy do
// standardowego folderu danych, żeby nie stracić możliwości zapisu.

// Uwaga: fs.accessSync(W_OK) na Windows potrafi skłamać (uprawnienia ACL,
// foldery pilnowane przez antywirusa). Dlatego robimy PRAWDZIWY zapis
// testowy — to jedyny wiarygodny sposób sprawdzenia.
function folderNadajeSieDoZapisu(folder) {
  try {
    fs.mkdirSync(folder, { recursive: true });
    const probny = path.join(folder, `.test-zapisu-${process.pid}`);
    fs.writeFileSync(probny, 'test', 'utf-8');
    fs.unlinkSync(probny);
    return true;
  } catch (err) {
    return false;
  }
}

function getDataDir() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) {
    const folder = path.join(portableDir, 'dane-aplikacji');
    if (folderNadajeSieDoZapisu(folder)) return folder;
    console.error('Folder obok programu nie nadaje się do zapisu — używam domyślnego folderu danych.');
  }
  const zapasowy = app.getPath('userData');
  try { fs.mkdirSync(zapasowy, { recursive: true }); } catch (_) { /* ignorujemy */ }
  return zapasowy;
}

const DATA_DIR = getDataDir();
const KOPIE_DIR = path.join(DATA_DIR, 'kopie');
const ZDJECIA_DIR = path.join(DATA_DIR, 'zdjecia');

const DATA_FILE = path.join(DATA_DIR, 'przepisy.json');
const MIARY_FILE = path.join(DATA_DIR, 'przelicznik-miar.json');
const MIGRATIONS_FILE = path.join(DATA_DIR, 'migracje.json');
const KOSZ_FILE = path.join(DATA_DIR, 'kosz.json');
const OKNO_FILE = path.join(DATA_DIR, 'okno.json');

// Wersja formatu danych, zapisywana w plikach. Pozwala w przyszłości
// bezpiecznie zmieniać strukturę bez psucia istniejących baz.
const WERSJA_DANYCH = 2;

const LICZBA_KOPII = 5;              // ile kopii zapasowych trzymamy
const DNI_W_KOSZU = 30;              // po ilu dniach kosz sam się czyści
const MAX_SZEROKOSC_ZDJECIA = 1600;  // px — większe zdjęcia są zmniejszane
const JAKOSC_JPEG = 82;

// Tryb tylko do odczytu — ustawiany, gdy nie możemy pisać na dysk. Interfejs
// blokuje wtedy edycję i mówi o tym wprost, zamiast udawać, że dane się
// zapisują.
let TRYB_TYLKO_ODCZYT = !folderNadajeSieDoZapisu(DATA_DIR);
let POWOD_TYLKO_ODCZYT = TRYB_TYLKO_ODCZYT
  ? 'Nie można zapisywać w folderze z danymi aplikacji.'
  : '';

// Problemy wykryte przy starcie — pokazywane po załadowaniu interfejsu.
const PROBLEMY_STARTOWE = [];

/* ==========================================================================
   2. BEZPIECZNY ZAPIS I ODCZYT PLIKÓW
   ========================================================================== */

// ZAPIS ATOMOWY.
// fs.writeFileSync najpierw obcina plik do zera, a dopiero potem zapisuje.
// Awaria zasilania między tymi krokami = uszkodzony plik i utrata przepisów.
// Tutaj zapisujemy do pliku tymczasowego, wymuszamy zrzut na dysk (fsync)
// i dopiero wtedy podmieniamy nazwę. Rename jest operacją atomową, więc plik
// docelowy jest ZAWSZE albo w starej, albo w nowej, kompletnej wersji.
function zapiszJsonAtomowo(sciezka, dane) {
  if (TRYB_TYLKO_ODCZYT) {
    return { ok: false, tylkoOdczyt: true, error: POWOD_TYLKO_ODCZYT };
  }
  const tmp = `${sciezka}.tmp`;
  let fd;
  try {
    fs.mkdirSync(path.dirname(sciezka), { recursive: true });
    const tresc = JSON.stringify(dane, null, 2);
    fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, tresc, 0, 'utf-8');
    fs.fsyncSync(fd);          // wymuszenie fizycznego zapisu na dysk
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, sciezka);
    return { ok: true };
  } catch (err) {
    console.error('Błąd zapisu pliku', sciezka, err);
    try { if (fd !== undefined) fs.closeSync(fd); } catch (_) { /* ignorujemy */ }
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* ignorujemy */ }
    // Jeśli zapis padł z powodu uprawnień, przechodzimy w tryb tylko do
    // odczytu, żeby użytkownik nie pracował w przekonaniu, że dane się zapisują.
    if (err && (err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'EROFS')) {
      TRYB_TYLKO_ODCZYT = true;
      POWOD_TYLKO_ODCZYT = 'Brak uprawnień do zapisu w folderze z danymi.';
    }
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// Odczyt JSON z rozpoznaniem uszkodzenia.
// Zwraca { status: 'ok' | 'brak' | 'uszkodzony', dane }.
// NIGDY nie zwraca po cichu pustej listy przy uszkodzonym pliku — to był
// najgroźniejszy błąd: aplikacja pokazywała pustą bazę, a pierwszy zapis
// bezpowrotnie nadpisywał dane, których nie udało się odczytać.
function czytajJson(sciezka) {
  if (!fs.existsSync(sciezka)) return { status: 'brak', dane: null };
  let raw;
  try {
    raw = fs.readFileSync(sciezka, 'utf-8');
  } catch (err) {
    console.error('Nie można odczytać pliku', sciezka, err);
    return { status: 'uszkodzony', dane: null, error: String(err && err.message) };
  }
  if (!raw.trim()) return { status: 'uszkodzony', dane: null, error: 'Plik jest pusty.' };
  try {
    return { status: 'ok', dane: JSON.parse(raw) };
  } catch (err) {
    console.error('Uszkodzony JSON w pliku', sciezka, err);
    return { status: 'uszkodzony', dane: null, error: String(err && err.message) };
  }
}

// Uszkodzony plik odkładamy na bok (nie kasujemy!) — zawsze zostaje ślad,
// z którego da się ręcznie odzyskać dane.
function odlozUszkodzonyPlik(sciezka) {
  try {
    if (!fs.existsSync(sciezka)) return null;
    const znacznik = new Date().toISOString().replace(/[:.]/g, '-');
    const cel = `${sciezka}.uszkodzony-${znacznik}`;
    fs.renameSync(sciezka, cel);
    return cel;
  } catch (err) {
    console.error('Nie udało się odłożyć uszkodzonego pliku:', err);
    return null;
  }
}

/* ==========================================================================
   3. KOPIE ZAPASOWE
   ========================================================================== */

// Obsługujemy dwa formaty: stary (goła tablica) i nowy ({wersja, przepisy}),
// żeby aktualizacja aplikacji nie psuła istniejących baz.
function wyciagnijListe(dane, klucz) {
  if (Array.isArray(dane)) return dane;                        // format v1
  if (dane && Array.isArray(dane[klucz])) return dane[klucz];   // format v2
  return null;
}

function opakuj(klucz, lista) {
  return { wersja: WERSJA_DANYCH, zapisano: new Date().toISOString(), [klucz]: lista };
}

// Rotacyjne kopie robione RAZ przy starcie: kopia-1 jest najnowsza, kopia-5
// najstarsza. Nawet jeśli ktoś przez pomyłkę skasuje przepisy i zamknie
// program, poprzednie wersje wciąż leżą na dysku.
function zrobKopieZapasowe() {
  if (TRYB_TYLKO_ODCZYT) return;
  try {
    fs.mkdirSync(KOPIE_DIR, { recursive: true });
    [
      { zrodlo: DATA_FILE, nazwa: 'przepisy' },
      { zrodlo: MIARY_FILE, nazwa: 'przelicznik-miar' }
    ].forEach(({ zrodlo, nazwa }) => {
      if (!fs.existsSync(zrodlo)) return;
      for (let i = LICZBA_KOPII - 1; i >= 1; i--) {
        const stara = path.join(KOPIE_DIR, `${nazwa}-kopia-${i}.json`);
        const nowa = path.join(KOPIE_DIR, `${nazwa}-kopia-${i + 1}.json`);
        if (fs.existsSync(stara)) {
          try { fs.copyFileSync(stara, nowa); } catch (_) { /* ignorujemy */ }
        }
      }
      try {
        fs.copyFileSync(zrodlo, path.join(KOPIE_DIR, `${nazwa}-kopia-1.json`));
      } catch (err) {
        console.error('Nie udało się zrobić kopii pliku', zrodlo, err);
      }
    });
  } catch (err) {
    console.error('Nie udało się przygotować kopii zapasowych:', err);
  }
}

// Lista czytelnych kopii przepisów — do ekranu ratunkowego i do ustawień.
function listaKopii() {
  try {
    if (!fs.existsSync(KOPIE_DIR)) return [];
    return fs.readdirSync(KOPIE_DIR)
      .filter(f => f.startsWith('przepisy-kopia-') && f.endsWith('.json'))
      .map(f => {
        const pelna = path.join(KOPIE_DIR, f);
        let stat = null;
        try { stat = fs.statSync(pelna); } catch (_) { /* ignorujemy */ }
        let liczba = null;
        const odczyt = czytajJson(pelna);
        if (odczyt.status === 'ok') {
          const lista = wyciagnijListe(odczyt.dane, 'przepisy');
          if (Array.isArray(lista)) liczba = lista.length;
        }
        return {
          plik: f,
          data: stat ? stat.mtime.toISOString() : null,
          rozmiar: stat ? stat.size : 0,
          liczbaPrzepisow: liczba
        };
      })
      .filter(k => k.liczbaPrzepisow !== null)
      .sort((a, b) => String(b.data).localeCompare(String(a.data)));
  } catch (err) {
    console.error('Nie udało się odczytać listy kopii:', err);
    return [];
  }
}

/* ==========================================================================
   4. KONTROLA SPÓJNOŚCI DANYCH
   ========================================================================== */

// Wychwytuje m.in. zduplikowane identyfikatory (skutek dawnego generowania ID
// przez samo Date.now()), brakujące pola i złe typy — zamiast pozwolić
// aplikacji wywalić się później w losowym miejscu.
function sprawdzSpojnoscPrzepisow(lista) {
  const naprawy = [];
  const uzyteId = new Set();
  const wynik = [];

  lista.forEach((r, idx) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      naprawy.push(`Pominięto uszkodzony wpis nr ${idx + 1}.`);
      return;
    }
    const p = { ...r };

    if (p.id === undefined || p.id === null || p.id === '') {
      p.id = makeId([...uzyteId]);
      naprawy.push(`Przepis „${p.title || 'bez tytułu'}” nie miał identyfikatora — nadano nowy.`);
    }
    if (uzyteId.has(String(p.id))) {
      const stary = p.id;
      p.id = makeId([...uzyteId]);
      naprawy.push(`Przepis „${p.title || 'bez tytułu'}” miał powtórzony identyfikator (${stary}) — nadano nowy.`);
    }
    uzyteId.add(String(p.id));

    if (typeof p.title !== 'string' || !p.title.trim()) {
      p.title = 'Bez tytułu';
      naprawy.push('Znaleziono przepis bez tytułu — nadano nazwę „Bez tytułu”.');
    }
    if (!CAT_LABELS[p.cat]) {
      p.cat = 'dodatki';
      naprawy.push(`Przepis „${p.title}” miał nieznaną kategorię — przeniesiono do „Dodatki”.`);
    }
    if (!Array.isArray(p.ing)) p.ing = [];
    if (!Array.isArray(p.steps)) p.steps = [];
    if (!Array.isArray(p.photos)) p.photos = [];
    if (typeof p.notes !== 'string') p.notes = '';
    if (typeof p.desc !== 'string') p.desc = '';
    if (typeof p.subcat !== 'string') p.subcat = '';
    if (typeof p.time !== 'string') p.time = p.time == null ? '' : String(p.time);
    p.favorite = !!p.favorite;
    const porcje = parseInt(p.servings, 10);
    p.servings = Number.isFinite(porcje) && porcje > 0 ? Math.min(porcje, 50) : 4;

    wynik.push(p);
  });

  return { lista: wynik, naprawy };
}

/* ==========================================================================
   5. ZDJĘCIA — osobny folder zamiast base64 w JSON
   ========================================================================== */

// Wcześniej zdjęcia siedziały jako base64 wprost w przepisy.json. Jedno
// zdjęcie 2 MB puchło do ~2,7 MB tekstu, a CAŁY plik był przepisywany przy
// każdej drobnej zmianie (np. kliknięciu gwiazdki). Teraz w JSON jest tylko
// nazwa pliku, a zdjęcia leżą w podfolderze "zdjecia".

function nowaNazwaZdjecia(rozszerzenie) {
  return `zdj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${rozszerzenie}`;
}

function zapiszZdjecieZPliku(sciezkaZrodlowa) {
  fs.mkdirSync(ZDJECIA_DIR, { recursive: true });
  let bufor;
  let rozszerzenie = '.jpg';
  try {
    let obraz = nativeImage.createFromPath(sciezkaZrodlowa);
    if (obraz.isEmpty()) throw new Error('Nie rozpoznano obrazu');
    const rozmiar = obraz.getSize();
    if (rozmiar.width > MAX_SZEROKOSC_ZDJECIA) {
      obraz = obraz.resize({ width: MAX_SZEROKOSC_ZDJECIA, quality: 'good' });
    }
    bufor = obraz.toJPEG(JAKOSC_JPEG);
    if (!bufor || !bufor.length) throw new Error('Pusty wynik konwersji');
  } catch (err) {
    // Awaryjnie zapisujemy oryginał — lepiej mieć duże zdjęcie niż stracić je.
    console.error('Nie udało się przetworzyć zdjęcia, zapisuję oryginał:', err);
    bufor = fs.readFileSync(sciezkaZrodlowa);
    rozszerzenie = path.extname(sciezkaZrodlowa) || '.jpg';
  }
  const nazwa = nowaNazwaZdjecia(rozszerzenie);
  fs.writeFileSync(path.join(ZDJECIA_DIR, nazwa), bufor);
  return nazwa;
}

function zapiszZdjecieZBase64(dataUrl) {
  fs.mkdirSync(ZDJECIA_DIR, { recursive: true });
  const dopasowanie = /^data:(image\/[a-z+]+);base64,(.*)$/i.exec(String(dataUrl));
  if (!dopasowanie) return null;
  const bufor = Buffer.from(dopasowanie[2], 'base64');
  const typ = dopasowanie[1].toLowerCase();
  const rozszerzenie = typ === 'image/png' ? '.png'
    : typ === 'image/gif' ? '.gif'
      : typ === 'image/webp' ? '.webp' : '.jpg';
  const nazwa = nowaNazwaZdjecia(rozszerzenie);
  fs.writeFileSync(path.join(ZDJECIA_DIR, nazwa), bufor);
  return nazwa;
}

function mimeZRozszerzenia(ext) {
  const e = String(ext).toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.gif') return 'image/gif';
  if (e === '.webp') return 'image/webp';
  return 'image/jpeg';
}

// Renderer prosi o zdjęcia dopiero przy otwarciu przepisu — dzięki temu lista
// przepisów jest lekka niezależnie od liczby zdjęć w bazie.
function wczytajZdjecia(nazwy) {
  return (nazwy || []).map(nazwa => {
    try {
      if (typeof nazwa === 'string' && nazwa.startsWith('data:')) return nazwa; // stary format
      const pelna = path.join(ZDJECIA_DIR, path.basename(String(nazwa)));
      if (!fs.existsSync(pelna)) return null;
      const bufor = fs.readFileSync(pelna);
      return `data:${mimeZRozszerzenia(path.extname(pelna))};base64,${bufor.toString('base64')}`;
    } catch (err) {
      console.error('Nie udało się wczytać zdjęcia', nazwa, err);
      return null;
    }
  });
}

// Jednorazowe przeniesienie starych zdjęć base64 do plików.
function migrujZdjeciaDoPlikow(lista) {
  let przeniesione = 0;
  lista.forEach(r => {
    if (!Array.isArray(r.photos) || !r.photos.length) return;
    r.photos = r.photos.map(p => {
      if (typeof p === 'string' && p.startsWith('data:')) {
        try {
          const nazwa = zapiszZdjecieZBase64(p);
          if (nazwa) { przeniesione++; return nazwa; }
        } catch (err) {
          console.error('Nie udało się przenieść zdjęcia do pliku:', err);
        }
        return null;
      }
      return p;
    }).filter(Boolean);
  });
  return przeniesione;
}

// Sprzątanie osieroconych zdjęć (plików, do których nie odwołuje się już
// żaden przepis ani nic w koszu). Uruchamiane raz przy starcie.
function usunOsieroconeZdjecia(przepisy, kosz) {
  if (TRYB_TYLKO_ODCZYT) return 0;
  try {
    if (!fs.existsSync(ZDJECIA_DIR)) return 0;
    const uzywane = new Set();
    [...(przepisy || []), ...(kosz || [])].forEach(r => {
      ((r && r.photos) || []).forEach(p => {
        if (typeof p === 'string' && !p.startsWith('data:')) uzywane.add(path.basename(p));
      });
    });
    let usuniete = 0;
    fs.readdirSync(ZDJECIA_DIR).forEach(plik => {
      if (!uzywane.has(plik)) {
        try { fs.unlinkSync(path.join(ZDJECIA_DIR, plik)); usuniete++; } catch (_) { /* ignorujemy */ }
      }
    });
    return usuniete;
  } catch (err) {
    console.error('Nie udało się posprzątać zdjęć:', err);
    return 0;
  }
}

/* ==========================================================================
   6. DANE DOMYŚLNE
   ========================================================================== */

const DOMYSLNE_PRZEPISY = [
  {
    id: 1,
    title: 'Żurek staropolski',
    cat: 'zupy',
    subcat: 'klasyczne',
    time: '1 godz 20 min',
    desc: 'Kwaśny, esencjonalny, z jajkiem i białą kiełbasą.',
    servings: 4,
    favorite: false,
    notes: '',
    photos: [],
    ing: ['1 l zakwasu na żurek', '30 dag białej kiełbasy', '3 ziemniaki', '3 ząbki czosnku', '1 cebula', 'liść laurowy, ziele angielskie', 'śmietana 18%', '4 jajka na twardo'],
    steps: ['Ugotuj wywar z włoszczyzny i kiełbasy.', 'Dodaj pokrojone ziemniaki i gotuj do miękkości.', 'Wlej zakwas, dopraw czosnkiem, solą i majerankiem.', 'Zabiel śmietaną, podawaj z połówką jajka.']
  },
  {
    id: 2,
    title: 'Placki ziemniaczane',
    cat: 'dania-glowne',
    subcat: 'wege',
    time: '35 min',
    desc: 'Chrupiące na brzegach, miękkie w środku.',
    servings: 4,
    favorite: false,
    notes: '',
    photos: [],
    ing: ['1 kg ziemniaków', '1 cebula', '2 jajka', '3 łyżki mąki', 'sól, pieprz', 'olej do smażenia'],
    steps: ['Zetrzyj ziemniaki i cebulę na tarce.', 'Odciśnij nadmiar wody, dodaj jajka i mąkę.', 'Dopraw solą i pieprzem.', 'Smaż na rozgrzanym oleju z obu stron na złoto.']
  },
  {
    id: 3,
    title: 'Domowy hummus',
    cat: 'dodatki',
    subcat: 'przekaski',
    time: '15 min',
    desc: 'Kremowy hummus z prażonym sezamem.',
    servings: 4,
    favorite: false,
    notes: '',
    photos: [],
    ing: ['400 g ciecierzycy z puszki', '2 łyżki tahini', '1 cytryna', '2 ząbki czosnku', 'oliwa'],
    steps: ['Zblenduj wszystkie składniki na gładki krem.', 'Dopraw solą i sokiem z cytryny.', 'Polej oliwą przed podaniem.']
  }
];

const MIGRACJE_PRZEPISOW = [
  { flag: 'dodano-demo-hummus', recipe: DOMYSLNE_PRZEPISY[2] }
];

const DOMYSLNE_MIARY = [
  { id: 1, name: 'Bułka tarta', cup: '150 g', tbsp: '9 g', tsp: '3 g' },
  { id: 2, name: 'Cukier', cup: '220 g', tbsp: '15 g', tsp: '5 g' },
  { id: 3, name: 'Cukier puder', cup: '170 g', tbsp: '12 g', tsp: '4 g' },
  { id: 4, name: 'Drożdże suszone', cup: '', tbsp: '', tsp: '4 g' },
  { id: 5, name: 'Kakao', cup: '130 g', tbsp: '8 g', tsp: '3 g' },
  { id: 6, name: 'Kasza manna', cup: '180 g', tbsp: '15 g', tsp: '' },
  { id: 7, name: 'Mąka graham', cup: '160 g', tbsp: '9 g', tsp: '3 g' },
  { id: 8, name: 'Mąka krupczatka (typ 500)', cup: '170 g', tbsp: '10 g', tsp: '3 g' },
  { id: 9, name: 'Mąka orkiszowa razowa (typ 2000)', cup: '120 g', tbsp: '9 g', tsp: '3 g' },
  { id: 10, name: 'Mąka pszenna (typ 550)', cup: '170 g', tbsp: '10 g', tsp: '3 g' },
  { id: 11, name: 'Mąka pszenna chlebowa (typ 750)', cup: '150 g', tbsp: '9 g', tsp: '3 g' },
  { id: 12, name: 'Mąka pszenna razowa (typ 2000)', cup: '145 g', tbsp: '10 g', tsp: '3 g' },
  { id: 13, name: 'Mąka włoska typ 00', cup: '165 g', tbsp: '10 g', tsp: '3 g' },
  { id: 14, name: 'Mąka ziemniaczana', cup: '200 g', tbsp: '10 g', tsp: '3 g' },
  { id: 15, name: 'Mąka żytnia razowa (typ 2000)', cup: '145 g', tbsp: '8 g', tsp: '~3 g' },
  { id: 16, name: 'Miód', cup: '360 g', tbsp: '22 g', tsp: '' },
  { id: 17, name: 'Mleko', cup: '250 g', tbsp: '15 g', tsp: '5 g' },
  { id: 18, name: 'Olej', cup: '230 g', tbsp: '14 g', tsp: '5 g' },
  { id: 19, name: 'Otręby pszenne', cup: '105 g', tbsp: '10 g', tsp: '3 g' },
  { id: 20, name: 'Płatki owsiane', cup: '90 g', tbsp: '5 g', tsp: '2 g' },
  { id: 21, name: 'Proszek do pieczenia', cup: '', tbsp: '12 g', tsp: '4 g' },
  { id: 22, name: 'Ryż (surowy)', cup: '225 g', tbsp: '14 g', tsp: '5 g' },
  { id: 23, name: 'Ser żółty tarty', cup: '125 g', tbsp: '8 g', tsp: '3 g' },
  { id: 24, name: 'Soda oczyszczona', cup: '', tbsp: '15 g', tsp: '5 g' },
  { id: 25, name: 'Sól', cup: '', tbsp: '19 g', tsp: '6 g' },
  { id: 26, name: 'Śmietana 18%', cup: '230 g', tbsp: '12 g', tsp: '4 g' },
  { id: 27, name: 'Śmietana kremówka 30%', cup: '270 g', tbsp: '16 g', tsp: '5 g' },
  { id: 28, name: 'Wiórki kokosowe', cup: '180 g', tbsp: '10 g', tsp: '3 g' },
  { id: 29, name: 'Woda/Wino', cup: '250 g', tbsp: '15 g', tsp: '5 g' },
  { id: 30, name: 'Żelatyna', cup: '170 g', tbsp: '10 g', tsp: '3 g' }
];

/* ==========================================================================
   7. WCZYTYWANIE I ZAPIS PRZEPISÓW
   ========================================================================== */

function readMigracje() {
  const odczyt = czytajJson(MIGRATIONS_FILE);
  return odczyt.status === 'ok' && odczyt.dane && typeof odczyt.dane === 'object' && !Array.isArray(odczyt.dane)
    ? odczyt.dane : {};
}

function writeMigracje(migracje) {
  zapiszJsonAtomowo(MIGRATIONS_FILE, migracje);
}

// Zwraca { ok, przepisy, uszkodzony, blad, kopie, naprawy }.
// Przy uszkodzonym pliku NIE nadpisujemy niczego — interfejs pokazuje ekran
// ratunkowy z listą kopii do przywrócenia.
function readRecipes() {
  const odczyt = czytajJson(DATA_FILE);

  if (odczyt.status === 'brak') {
    const przepisy = JSON.parse(JSON.stringify(DOMYSLNE_PRZEPISY));
    zapiszJsonAtomowo(DATA_FILE, opakuj('przepisy', przepisy));
    const migracjeStart = {};
    MIGRACJE_PRZEPISOW.forEach(m => { migracjeStart[m.flag] = true; });
    writeMigracje(migracjeStart);
    return { ok: true, przepisy, naprawy: [] };
  }

  if (odczyt.status === 'uszkodzony') {
    return {
      ok: false,
      uszkodzony: true,
      blad: odczyt.error || 'Nie udało się odczytać pliku z przepisami.',
      kopie: listaKopii(),
      przepisy: []
    };
  }

  let lista = wyciagnijListe(odczyt.dane, 'przepisy');
  if (!Array.isArray(lista)) {
    // Poprawny JSON, ale zły kształt (np. obiekt zamiast listy). Traktujemy
    // to jak uszkodzenie — nie kasujemy danych użytkownika.
    return {
      ok: false,
      uszkodzony: true,
      blad: 'Plik z przepisami ma nieprawidłową strukturę.',
      kopie: listaKopii(),
      przepisy: []
    };
  }

  const kontrola = sprawdzSpojnoscPrzepisow(lista);
  lista = kontrola.lista;
  const naprawy = kontrola.naprawy.slice();

  // jednorazowe dopisanie przepisów z migracji
  const migracje = readMigracje();
  let zmieniono = false;
  MIGRACJE_PRZEPISOW.forEach(m => {
    if (!migracje[m.flag]) {
      const kopia = JSON.parse(JSON.stringify(m.recipe));
      kopia.id = makeId(lista.map(r => r.id));
      lista.push(kopia);
      migracje[m.flag] = true;
      zmieniono = true;
    }
  });

  const przeniesioneZdjecia = migrujZdjeciaDoPlikow(lista);
  if (przeniesioneZdjecia > 0) {
    naprawy.push(`Przeniesiono ${przeniesioneZdjecia} zdjęć do osobnego folderu — aplikacja działa teraz szybciej.`);
  }

  const trzebaZapisac = zmieniono || naprawy.length > 0 || przeniesioneZdjecia > 0 || Array.isArray(odczyt.dane);
  if (trzebaZapisac) {
    zapiszJsonAtomowo(DATA_FILE, opakuj('przepisy', lista));
    if (zmieniono) writeMigracje(migracje);
  }

  return { ok: true, przepisy: lista, naprawy };
}

function writeRecipes(przepisy) {
  if (!Array.isArray(przepisy)) return { ok: false, error: 'Nieprawidłowe dane do zapisu.' };
  return zapiszJsonAtomowo(DATA_FILE, opakuj('przepisy', przepisy));
}

function readMiary() {
  const odczyt = czytajJson(MIARY_FILE);

  if (odczyt.status === 'brak') {
    zapiszJsonAtomowo(MIARY_FILE, opakuj('miary', DOMYSLNE_MIARY));
    return { ok: true, miary: JSON.parse(JSON.stringify(DOMYSLNE_MIARY)) };
  }

  if (odczyt.status === 'uszkodzony') {
    const odlozony = odlozUszkodzonyPlik(MIARY_FILE);
    zapiszJsonAtomowo(MIARY_FILE, opakuj('miary', DOMYSLNE_MIARY));
    PROBLEMY_STARTOWE.push(
      'Tabela przelicznika miar była uszkodzona — przywrócono wartości domyślne.' +
      (odlozony ? ' Uszkodzony plik zachowano obok, na wypadek ręcznego odzyskania.' : '')
    );
    return { ok: true, miary: JSON.parse(JSON.stringify(DOMYSLNE_MIARY)) };
  }

  const lista = wyciagnijListe(odczyt.dane, 'miary');
  if (!Array.isArray(lista)) {
    odlozUszkodzonyPlik(MIARY_FILE);
    zapiszJsonAtomowo(MIARY_FILE, opakuj('miary', DOMYSLNE_MIARY));
    PROBLEMY_STARTOWE.push('Tabela przelicznika miar miała nieprawidłową strukturę — przywrócono wartości domyślne.');
    return { ok: true, miary: JSON.parse(JSON.stringify(DOMYSLNE_MIARY)) };
  }

  const uzyte = new Set();
  const czyste = lista.filter(m => m && typeof m === 'object' && !Array.isArray(m)).map(m => {
    const kopia = { ...m };
    if (kopia.id === undefined || kopia.id === null || uzyte.has(String(kopia.id))) {
      kopia.id = makeId([...uzyte]);
    }
    uzyte.add(String(kopia.id));
    if (typeof kopia.name !== 'string' || !kopia.name.trim()) kopia.name = 'Bez nazwy';
    ['cup', 'tbsp', 'tsp'].forEach(k => { if (typeof kopia[k] !== 'string') kopia[k] = ''; });
    return kopia;
  });

  if (Array.isArray(odczyt.dane) || czyste.length !== lista.length) {
    zapiszJsonAtomowo(MIARY_FILE, opakuj('miary', czyste));
  }
  return { ok: true, miary: czyste };
}

function writeMiary(miary) {
  if (!Array.isArray(miary)) return { ok: false, error: 'Nieprawidłowe dane do zapisu.' };
  return zapiszJsonAtomowo(MIARY_FILE, opakuj('miary', miary));
}

/* ==========================================================================
   8. KOSZ — usunięte przepisy da się odzyskać przez 30 dni
   ========================================================================== */

function readKosz() {
  const odczyt = czytajJson(KOSZ_FILE);
  if (odczyt.status !== 'ok') return [];
  const lista = wyciagnijListe(odczyt.dane, 'kosz');
  if (!Array.isArray(lista)) return [];
  const granica = Date.now() - DNI_W_KOSZU * 24 * 60 * 60 * 1000;
  return lista.filter(w => {
    if (!w || typeof w !== 'object') return false;
    const czas = Date.parse(w.usunietoDnia);
    return Number.isFinite(czas) ? czas >= granica : true;
  });
}

function writeKosz(kosz) {
  return zapiszJsonAtomowo(KOSZ_FILE, opakuj('kosz', kosz));
}

function doKosza(przepis) {
  if (!przepis || typeof przepis !== 'object') return { ok: false, error: 'Brak przepisu do usunięcia.' };
  const kosz = readKosz();
  kosz.unshift({ ...przepis, usunietoDnia: new Date().toISOString() });
  return writeKosz(kosz);
}

function przywrocZKosza(id) {
  const kosz = readKosz();
  const idx = kosz.findIndex(w => String(w.id) === String(id));
  if (idx === -1) return { ok: false, error: 'Nie znaleziono przepisu w koszu.' };

  const wpis = { ...kosz[idx] };
  delete wpis.usunietoDnia;
  kosz.splice(idx, 1);

  const odczyt = readRecipes();
  if (!odczyt.ok) return { ok: false, error: 'Nie można teraz odczytać bazy przepisów.' };

  const przepisy = odczyt.przepisy;
  wpis.id = makeId(przepisy.map(r => r.id));   // na wypadek zajętego identyfikatora
  przepisy.unshift(wpis);

  const zapis = writeRecipes(przepisy);
  if (!zapis.ok) return zapis;
  writeKosz(kosz);
  return { ok: true, przepis: wpis };
}

function usunTrwaleZKosza(id) {
  return writeKosz(readKosz().filter(w => String(w.id) !== String(id)));
}

function oproznijKosz() {
  return writeKosz([]);
}

/* ==========================================================================
   9. PRZYWRACANIE KOPII ZAPASOWEJ
   ========================================================================== */

function przywrocKopie(nazwaPliku) {
  try {
    const zrodlo = path.join(KOPIE_DIR, path.basename(String(nazwaPliku)));
    if (!fs.existsSync(zrodlo)) return { ok: false, error: 'Nie znaleziono wskazanej kopii.' };

    const odczyt = czytajJson(zrodlo);
    if (odczyt.status !== 'ok') return { ok: false, error: 'Wybrana kopia jest uszkodzona.' };

    const lista = wyciagnijListe(odczyt.dane, 'przepisy');
    if (!Array.isArray(lista)) return { ok: false, error: 'Wybrana kopia ma nieprawidłową strukturę.' };

    // Zanim cokolwiek nadpiszemy, odkładamy obecny (być może uszkodzony) plik.
    odlozUszkodzonyPlik(DATA_FILE);

    const kontrola = sprawdzSpojnoscPrzepisow(lista);
    const zapis = zapiszJsonAtomowo(DATA_FILE, opakuj('przepisy', kontrola.lista));
    if (!zapis.ok) return zapis;
    return { ok: true, liczba: kontrola.lista.length };
  } catch (err) {
    console.error('Błąd przywracania kopii:', err);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/* ==========================================================================
   10. EKSPORT / IMPORT CAŁEJ BAZY
   ========================================================================== */

async function eksportujBaze(win) {
  const znacznik = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Zapisz kopię całej bazy',
    defaultPath: `ksiazka-kucharska-kopia-${znacznik}.json`,
    filters: [{ name: 'Kopia bazy', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  try {
    const przepisyOdczyt = readRecipes();
    if (!przepisyOdczyt.ok) return { ok: false, error: 'Nie można odczytać przepisów.' };
    const miaryOdczyt = readMiary();

    // Zdjęcia pakujemy razem, żeby kopia była kompletna i samowystarczalna.
    const zdjecia = {};
    przepisyOdczyt.przepisy.forEach(r => {
      (r.photos || []).forEach(nazwa => {
        if (typeof nazwa !== 'string' || nazwa.startsWith('data:') || zdjecia[nazwa]) return;
        try {
          const pelna = path.join(ZDJECIA_DIR, path.basename(nazwa));
          if (fs.existsSync(pelna)) zdjecia[nazwa] = fs.readFileSync(pelna).toString('base64');
        } catch (_) { /* pomijamy brakujące zdjęcie */ }
      });
    });

    const paczka = {
      typ: 'ksiazka-kucharska-kopia',
      wersja: WERSJA_DANYCH,
      utworzono: new Date().toISOString(),
      przepisy: przepisyOdczyt.przepisy,
      miary: miaryOdczyt.miary,
      zdjecia
    };
    fs.writeFileSync(filePath, JSON.stringify(paczka, null, 2), 'utf-8');
    return { ok: true, filePath, liczbaPrzepisow: paczka.przepisy.length };
  } catch (err) {
    console.error('Błąd eksportu bazy:', err);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

async function importujBaze(win) {
  if (TRYB_TYLKO_ODCZYT) return { ok: false, error: POWOD_TYLKO_ODCZYT };

  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Wybierz plik z kopią bazy',
    properties: ['openFile'],
    filters: [{ name: 'Kopia bazy', extensions: ['json'] }]
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };

  try {
    const odczyt = czytajJson(filePaths[0]);
    if (odczyt.status !== 'ok') return { ok: false, error: 'Nie udało się odczytać wskazanego pliku.' };

    const paczka = odczyt.dane;
    const przepisy = wyciagnijListe(paczka, 'przepisy');
    if (!Array.isArray(przepisy)) {
      return { ok: false, error: 'To nie wygląda na kopię bazy Książki Kucharskiej.' };
    }

    // Zawsze robimy kopię obecnego stanu PRZED nadpisaniem.
    zrobKopieZapasowe();

    if (paczka.zdjecia && typeof paczka.zdjecia === 'object') {
      fs.mkdirSync(ZDJECIA_DIR, { recursive: true });
      Object.entries(paczka.zdjecia).forEach(([nazwa, base64]) => {
        try {
          const cel = path.join(ZDJECIA_DIR, path.basename(String(nazwa)));
          if (!fs.existsSync(cel)) fs.writeFileSync(cel, Buffer.from(String(base64), 'base64'));
        } catch (_) { /* pomijamy pojedyncze zdjęcie */ }
      });
    }

    const kontrola = sprawdzSpojnoscPrzepisow(przepisy);
    migrujZdjeciaDoPlikow(kontrola.lista);
    const zapis = zapiszJsonAtomowo(DATA_FILE, opakuj('przepisy', kontrola.lista));
    if (!zapis.ok) return zapis;

    const miary = wyciagnijListe(paczka, 'miary');
    if (Array.isArray(miary)) zapiszJsonAtomowo(MIARY_FILE, opakuj('miary', miary));

    return { ok: true, liczbaPrzepisow: kontrola.lista.length };
  } catch (err) {
    console.error('Błąd importu bazy:', err);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/* ==========================================================================
   11. EKSPORT POJEDYNCZEGO PRZEPISU (PDF / DOCX / DRUK)
   ========================================================================== */

function sanitizeFilename(name) {
  return (name || 'przepis').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'przepis';
}

// Nagłówek z kategorią, podkategorią i czasem — identyczny jak w aplikacji.
// Wcześniej eksport pomijał podkategorię, przez co plik różnił się od tego,
// co użytkownik widział na ekranie.
function opisPrzepisu(recipe) {
  return [
    CAT_LABELS[recipe.cat] || recipe.cat || '',
    subcatLabel(recipe.cat, recipe.subcat),
    normalizeTime(recipe.time),
    `${recipe.servings || 4} porcje (bazowo)`
  ].filter(Boolean).join(' · ');
}

function buildRecipeHtml(recipe) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const ingHtml = (recipe.ing || []).map(i => `<li>${esc(i)}</li>`).join('');
  const stepsHtml = (recipe.steps || []).map(s => `<li>${esc(s)}</li>`).join('');
  const notesHtml = recipe.notes
    ? `<h2>Notatki</h2><p class="notes">${esc(recipe.notes).replace(/\n/g, '<br>')}</p>` : '';
  return `
  <!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><style>
    body{font-family: Georgia, 'Times New Roman', serif; color:#1E2321; padding:36px 44px;}
    h1{font-size:26px; margin:0 0 4px;}
    .meta{color:#4B5563; font-size:13px; margin-bottom:10px;}
    .desc{font-style:italic; color:#444; margin-bottom:22px;}
    h2{font-size:15px; text-transform:uppercase; letter-spacing:.04em; color:#2F6F4E; border-bottom:1px solid #ddd; padding-bottom:4px; margin-top:26px;}
    ul,ol{padding-left:20px; font-size:14px; line-height:1.6;}
    li{margin-bottom:4px;}
    .notes{font-size:14px; line-height:1.6; white-space:pre-wrap;}
  </style></head><body>
    <h1>${esc(recipe.title)}</h1>
    <div class="meta">${esc(opisPrzepisu(recipe))}</div>
    ${recipe.desc ? `<div class="desc">${esc(recipe.desc)}</div>` : ''}
    <h2>Składniki</h2>
    <ul>${ingHtml}</ul>
    <h2>Przygotowanie</h2>
    <ol>${stepsHtml}</ol>
    ${notesHtml}
  </body></html>`;
}

async function pickImages(win) {
  if (TRYB_TYLKO_ODCZYT) return { ok: false, error: POWOD_TYLKO_ODCZYT, nazwy: [] };

  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Wybierz zdjęcia',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Obrazy', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true, nazwy: [] };

  const nazwy = [];
  const bledy = [];
  filePaths.forEach(fp => {
    try {
      nazwy.push(zapiszZdjecieZPliku(fp));
    } catch (err) {
      console.error('Nie udało się dodać zdjęcia', fp, err);
      bledy.push(path.basename(fp));
    }
  });
  return { ok: nazwy.length > 0, nazwy, bledy };
}

async function exportRecipeToPdf(win, recipe) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Zapisz przepis jako PDF',
    defaultPath: `${sanitizeFilename(recipe.title)}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildRecipeHtml(recipe)));
    const pdfBuffer = await printWin.webContents.printToPDF({ printBackground: true });
    fs.writeFileSync(filePath, pdfBuffer);
    return { ok: true, filePath };
  } catch (err) {
    console.error('Błąd eksportu PDF:', err);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    if (!printWin.isDestroyed()) printWin.close();
  }
}

async function printRecipe(win, recipe) {
  const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildRecipeHtml(recipe)));
    return await new Promise((resolve) => {
      printWin.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        resolve({ ok: success, reason });
      });
    });
  } catch (err) {
    console.error('Błąd drukowania:', err);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    if (!printWin.isDestroyed()) printWin.close();
  }
}

async function exportRecipeToDocx(win, recipe) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Zapisz przepis jako Word',
    defaultPath: `${sanitizeFilename(recipe.title)}.docx`,
    filters: [{ name: 'Dokument Word', extensions: ['docx'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  try {
    const children = [
      new Paragraph({ text: recipe.title || 'Bez tytułu', heading: HeadingLevel.TITLE }),
      new Paragraph({
        children: [new TextRun({ text: opisPrzepisu(recipe), color: '4B5563', size: 20 })],
        spacing: { after: 100 }
      })
    ];
    if (recipe.desc) {
      children.push(new Paragraph({
        children: [new TextRun({ text: recipe.desc, italics: true })],
        spacing: { after: 300 }
      }));
    }
    children.push(new Paragraph({ text: 'Składniki', heading: HeadingLevel.HEADING_2 }));
    (recipe.ing || []).forEach(i => children.push(new Paragraph({ text: i, bullet: { level: 0 } })));
    children.push(new Paragraph({ text: 'Przygotowanie', heading: HeadingLevel.HEADING_2, spacing: { before: 300 } }));
    (recipe.steps || []).forEach((s, idx) => children.push(new Paragraph({ text: `${idx + 1}. ${s}` })));
    if (recipe.notes) {
      children.push(new Paragraph({ text: 'Notatki', heading: HeadingLevel.HEADING_2, spacing: { before: 300 } }));
      recipe.notes.split('\n').forEach(line => children.push(new Paragraph({ text: line })));
    }

    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
    return { ok: true, filePath };
  } catch (err) {
    console.error('Błąd eksportu DOCX:', err);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/* ==========================================================================
   12. PAMIĘTANIE ROZMIARU I POŁOŻENIA OKNA
   ========================================================================== */

function odczytajStanOkna() {
  const odczyt = czytajJson(OKNO_FILE);
  if (odczyt.status !== 'ok' || !odczyt.dane || typeof odczyt.dane !== 'object') return null;
  const { width, height, x, y, maximized } = odczyt.dane;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < 400 || height < 300) return null;   // ochrona przed bzdurnymi wartościami
  return { width, height, x, y, maximized: !!maximized };
}

function zapiszStanOkna(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const bounds = maximized ? win.getNormalBounds() : win.getBounds();
    zapiszJsonAtomowo(OKNO_FILE, {
      width: bounds.width, height: bounds.height,
      x: bounds.x, y: bounds.y, maximized
    });
  } catch (err) {
    console.error('Nie udało się zapisać rozmiaru okna:', err);
  }
}

/* ==========================================================================
   13. OKNO APLIKACJI
   ========================================================================== */

function createWindow() {
  const zapisany = odczytajStanOkna();
  const opcje = {
    width: zapisany ? zapisany.width : 1180,
    height: zapisany ? zapisany.height : 780,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#F6F7F5',
    show: false,
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  };
  if (zapisany && Number.isFinite(zapisany.x) && Number.isFinite(zapisany.y)) {
    opcje.x = zapisany.x;
    opcje.y = zapisany.y;
  }

  const win = new BrowserWindow(opcje);
  win.setMenuBarVisibility(false);

  // Zabezpieczenie przed przypadkowym otwarciem narzędzi deweloperskich lub
  // przeładowaniem okna (Ctrl+R, F5, F12). Dla mniej technicznej osoby taki
  // ekran jest tylko źródłem niepokoju.
  if (app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      const k = String(input.key || '').toLowerCase();
      const blokuj =
        k === 'f12' || k === 'f5' ||
        (input.control && k === 'r') ||
        (input.control && input.shift && (k === 'i' || k === 'j' || k === 'c'));
      if (blokuj) event.preventDefault();
    });
  }

  if (zapisany && zapisany.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  let timerZapisu;
  const zaplanujZapisOkna = () => {
    clearTimeout(timerZapisu);
    timerZapisu = setTimeout(() => zapiszStanOkna(win), 400);
  };
  win.on('resize', zaplanujZapisOkna);
  win.on('move', zaplanujZapisOkna);
  win.on('close', () => { clearTimeout(timerZapisu); zapiszStanOkna(win); });

  return win;
}

/* ==========================================================================
   14. KANAŁY IPC
   ========================================================================== */

ipcMain.handle('load-recipes', () => readRecipes());
ipcMain.handle('save-recipes', (event, recipes) => writeRecipes(recipes));
ipcMain.handle('load-miary', () => readMiary());
ipcMain.handle('save-miary', (event, miary) => writeMiary(miary));

ipcMain.handle('load-photos', (event, nazwy) => wczytajZdjecia(nazwy));
ipcMain.handle('pick-images', (event) => pickImages(BrowserWindow.fromWebContents(event.sender)));

ipcMain.handle('export-pdf', (event, recipe) => exportRecipeToPdf(BrowserWindow.fromWebContents(event.sender), recipe));
ipcMain.handle('export-docx', (event, recipe) => exportRecipeToDocx(BrowserWindow.fromWebContents(event.sender), recipe));
ipcMain.handle('print-recipe', (event, recipe) => printRecipe(BrowserWindow.fromWebContents(event.sender), recipe));

ipcMain.handle('export-baze', (event) => eksportujBaze(BrowserWindow.fromWebContents(event.sender)));
ipcMain.handle('import-baze', (event) => importujBaze(BrowserWindow.fromWebContents(event.sender)));

ipcMain.handle('lista-kopii', () => listaKopii());
ipcMain.handle('przywroc-kopie', (event, plik) => przywrocKopie(plik));

ipcMain.handle('load-kosz', () => readKosz());
ipcMain.handle('do-kosza', (event, przepis) => doKosza(przepis));
ipcMain.handle('przywroc-z-kosza', (event, id) => przywrocZKosza(id));
ipcMain.handle('usun-trwale', (event, id) => usunTrwaleZKosza(id));
ipcMain.handle('oproznij-kosz', () => oproznijKosz());

// Stan aplikacji dla interfejsu: tryb tylko do odczytu, gdzie leżą dane,
// jakie problemy wykryto przy starcie.
ipcMain.handle('stan-aplikacji', () => ({
  tylkoOdczyt: TRYB_TYLKO_ODCZYT,
  powodTylkoOdczyt: POWOD_TYLKO_ODCZYT,
  folderDanych: DATA_DIR,
  problemy: PROBLEMY_STARTOWE.slice(),
  wersjaDanych: WERSJA_DANYCH
}));

ipcMain.handle('pokaz-folder-danych', async () => {
  try {
    await shell.openPath(DATA_DIR);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

/* ==========================================================================
   15. START
   ========================================================================== */

app.whenReady().then(() => {
  if (TRYB_TYLKO_ODCZYT) {
    PROBLEMY_STARTOWE.push(
      'Aplikacja nie może zapisywać danych w swoim folderze. Działa w trybie tylko do odczytu — wprowadzone zmiany nie zostaną zachowane.'
    );
  } else {
    // Jednorazowe przeniesienie danych ze starego, ukrytego folderu AppData
    // do folderu obok programu (dla osób aktualizujących starszą wersję).
    const staryFolder = app.getPath('userData');
    if (path.normalize(DATA_DIR) !== path.normalize(staryFolder)) {
      ['przepisy.json', 'migracje.json', 'przelicznik-miar.json', 'kosz.json'].forEach(nazwa => {
        const stary = path.join(staryFolder, nazwa);
        const nowy = path.join(DATA_DIR, nazwa);
        try {
          if (fs.existsSync(stary) && !fs.existsSync(nowy)) fs.copyFileSync(stary, nowy);
        } catch (err) {
          console.error(`Nie udało się przenieść pliku ${nazwa}:`, err);
        }
      });
    }

    zrobKopieZapasowe();

    // sprzątanie zdjęć, do których nie odwołuje się już żaden przepis
    const odczyt = czytajJson(DATA_FILE);
    if (odczyt.status === 'ok') {
      const lista = wyciagnijListe(odczyt.dane, 'przepisy');
      if (Array.isArray(lista)) usunOsieroconeZdjecia(lista, readKosz());
    }
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Awaria w procesie głównym nie może po cichu zabić aplikacji — pokazujemy
// czytelny komunikat zamiast nagłego zniknięcia okna.
process.on('uncaughtException', (err) => {
  console.error('Nieobsłużony błąd w procesie głównym:', err);
  try {
    dialog.showErrorBox(
      'Wystąpił nieoczekiwany błąd',
      'Aplikacja napotkała problem, ale Twoje przepisy są bezpieczne — zapisywane są w sposób odporny na takie sytuacje.\n\n' +
      'Szczegóły techniczne:\n' + String(err && err.message ? err.message : err)
    );
  } catch (_) { /* nic więcej nie da się zrobić */ }
});
