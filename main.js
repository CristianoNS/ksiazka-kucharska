const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx');

const CAT_LABELS = {
  sniadania: 'Śniadania', zupy: 'Zupy', 'dania-glowne': 'Dania główne',
  desery: 'Desery', napoje: 'Napoje', dodatki: 'Dodatki', przetwory: 'Przetwory'
};

function sanitizeFilename(name) {
  return (name || 'przepis').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'przepis';
}

function buildRecipeHtml(recipe) {
  const esc = (s) => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const ingHtml = (recipe.ing || []).map(i => `<li>${esc(i)}</li>`).join('');
  const stepsHtml = (recipe.steps || []).map(s => `<li>${esc(s)}</li>`).join('');
  const notesHtml = recipe.notes
    ? `<h2>Notatki</h2><p class="notes">${esc(recipe.notes).replace(/\n/g, '<br>')}</p>` : '';
  return `
  <!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><style>
    body{font-family: Georgia, 'Times New Roman', serif; color:#1E2321; padding:36px 44px;}
    h1{font-size:26px; margin:0 0 4px;}
    .meta{color:#6B7280; font-size:13px; margin-bottom:10px;}
    .desc{font-style:italic; color:#444; margin-bottom:22px;}
    h2{font-size:15px; text-transform:uppercase; letter-spacing:.04em; color:#2F6F4E; border-bottom:1px solid #ddd; padding-bottom:4px; margin-top:26px;}
    ul,ol{padding-left:20px; font-size:14px; line-height:1.6;}
    li{margin-bottom:4px;}
    .notes{font-size:14px; line-height:1.6; white-space:pre-wrap;}
  </style></head><body>
    <h1>${esc(recipe.title)}</h1>
    <div class="meta">${esc(CAT_LABELS[recipe.cat] || recipe.cat)} · ${esc(normalizeTime(recipe.time))} · ${esc(recipe.servings || 4)} porcje (bazowo)</div>
    ${recipe.desc ? `<div class="desc">${esc(recipe.desc)}</div>` : ''}
    <h2>Składniki</h2>
    <ul>${ingHtml}</ul>
    <h2>Przygotowanie</h2>
    <ol>${stepsHtml}</ol>
    ${notesHtml}
  </body></html>`;
}

function normalizeTime(value) {
  if (!value) return '—';
  return /^\d+$/.test(String(value).trim()) ? `${value} min` : value;
}

function mimeFromExt(ext) {
  const e = ext.toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.png') return 'image/png';
  if (e === '.gif') return 'image/gif';
  if (e === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

async function pickImages(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Wybierz zdjęcia',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Obrazy', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
  });
  if (canceled || !filePaths.length) return [];
  return filePaths.map(fp => {
    const buffer = fs.readFileSync(fp);
    const mime = mimeFromExt(path.extname(fp));
    return `data:${mime};base64,${buffer.toString('base64')}`;
  });
}

async function exportRecipeToPdf(recipe) {
  const { canceled, filePath } = await dialog.showSaveDialog({
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
    return { ok: false, error: String(err) };
  } finally {
    printWin.close();
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
  } finally {
    printWin.close();
  }
}

async function exportRecipeToDocx(recipe) {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Zapisz przepis jako Word',
    defaultPath: `${sanitizeFilename(recipe.title)}.docx`,
    filters: [{ name: 'Dokument Word', extensions: ['docx'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  try {
    const children = [
      new Paragraph({ text: recipe.title || 'Bez tytułu', heading: HeadingLevel.TITLE }),
      new Paragraph({
        children: [new TextRun({
          text: `${CAT_LABELS[recipe.cat] || recipe.cat} · ${normalizeTime(recipe.time)} · ${recipe.servings || 4} porcje (bazowo)`,
          color: '6B7280', size: 20
        })],
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
    (recipe.ing || []).forEach(i => {
      children.push(new Paragraph({ text: i, bullet: { level: 0 } }));
    });
    children.push(new Paragraph({ text: 'Przygotowanie', heading: HeadingLevel.HEADING_2, spacing: { before: 300 } }));
    (recipe.steps || []).forEach((s, idx) => {
      children.push(new Paragraph({ text: `${idx + 1}. ${s}` }));
    });

    if (recipe.notes) {
      children.push(new Paragraph({ text: 'Notatki', heading: HeadingLevel.HEADING_2, spacing: { before: 300 } }));
      recipe.notes.split('\n').forEach(line => {
        children.push(new Paragraph({ text: line }));
      });
    }

    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
    return { ok: true, filePath };
  } catch (err) {
    console.error('Błąd eksportu DOCX:', err);
    return { ok: false, error: String(err) };
  }
}

// Plik z przepisami trzymamy w standardowym folderze danych aplikacji
// (np. na Windows: C:\Users\Ty\AppData\Roaming\Ksiazka Kucharska\przepisy.json)
const DATA_FILE = path.join(app.getPath('userData'), 'przepisy.json');

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
    ing: ['400 g ciecierzycy z puszki', '2 łyżki tahini', '1 cytryna', '2 ząbki czosnku', 'oliwa'],
    steps: ['Zblenduj wszystkie składniki na gładki krem.', 'Dopraw solą i sokiem z cytryny.', 'Polej oliwą przed podaniem.']
  }
];

// Przepisy dopisywane jednorazowo do JUŻ ISTNIEJĄCYCH baz (nie dotyczy
// świeżych instalacji — te dostają je od razu w DOMYSLNE_PRZEPISY powyżej).
// Klucz w MIGRATIONS_FILE pilnuje, żeby dopisać je tylko raz, nawet jeśli
// użytkownik później sam usunie taki przepis.
const MIGRACJE_PRZEPISOW = [
  { flag: 'dodano-demo-hummus', recipe: DOMYSLNE_PRZEPISY[2] }
];

function readRecipes() {
  try {
    let recipes;
    let pierwszeUruchomienie = false;

    if (!fs.existsSync(DATA_FILE)) {
      pierwszeUruchomienie = true;
      recipes = JSON.parse(JSON.stringify(DOMYSLNE_PRZEPISY));
      fs.writeFileSync(DATA_FILE, JSON.stringify(recipes, null, 2), 'utf-8');
      // świeża instalacja ma migrowane przepisy już w komplecie — oznacz
      // migracje jako wykonane, żeby nie dopisać ich drugi raz później
      const migracjeStart = {};
      MIGRACJE_PRZEPISOW.forEach(m => { migracjeStart[m.flag] = true; });
      writeMigracje(migracjeStart);
    } else {
      recipes = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }

    if (!pierwszeUruchomienie) {
      const migracje = readMigracje();
      let zmieniono = false;
      MIGRACJE_PRZEPISOW.forEach(m => {
        if (!migracje[m.flag]) {
          recipes.push(JSON.parse(JSON.stringify(m.recipe)));
          migracje[m.flag] = true;
          zmieniono = true;
        }
      });
      if (zmieniono) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(recipes, null, 2), 'utf-8');
        writeMigracje(migracje);
      }
    }

    return recipes;
  } catch (err) {
    console.error('Błąd odczytu pliku przepisów:', err);
    return [];
  }
}

function writeRecipes(recipes) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(recipes, null, 2), 'utf-8');
    return { ok: true };
  } catch (err) {
    console.error('Błąd zapisu pliku przepisów:', err);
    return { ok: false, error: String(err) };
  }
}

// Plik śledzący jednorazowe migracje danych (żeby nic nie dublować/wracało
// po usunięciu przez użytkownika)
const MIGRATIONS_FILE = path.join(app.getPath('userData'), 'migracje.json');

function readMigracje() {
  try {
    if (!fs.existsSync(MIGRATIONS_FILE)) return {};
    return JSON.parse(fs.readFileSync(MIGRATIONS_FILE, 'utf-8'));
  } catch (err) {
    console.error('Błąd odczytu pliku migracji:', err);
    return {};
  }
}

function writeMigracje(migracje) {
  try {
    fs.writeFileSync(MIGRATIONS_FILE, JSON.stringify(migracje, null, 2), 'utf-8');
  } catch (err) {
    console.error('Błąd zapisu pliku migracji:', err);
  }
}

// Plik z tabelą przelicznika miar i wag (edytowalny przez użytkownika)
const MIARY_FILE = path.join(app.getPath('userData'), 'przelicznik-miar.json');

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

function readMiary() {
  try {
    if (!fs.existsSync(MIARY_FILE)) {
      fs.writeFileSync(MIARY_FILE, JSON.stringify(DOMYSLNE_MIARY, null, 2), 'utf-8');
      return DOMYSLNE_MIARY;
    }
    const raw = fs.readFileSync(MIARY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Błąd odczytu pliku przelicznika miar:', err);
    return DOMYSLNE_MIARY;
  }
}

function writeMiary(miary) {
  try {
    fs.writeFileSync(MIARY_FILE, JSON.stringify(miary, null, 2), 'utf-8');
    return { ok: true };
  } catch (err) {
    console.error('Błąd zapisu pliku przelicznika miar:', err);
    return { ok: false, error: String(err) };
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#F6F7F5',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('load-recipes', () => readRecipes());
ipcMain.handle('save-recipes', (event, recipes) => writeRecipes(recipes));
ipcMain.handle('load-miary', () => readMiary());
ipcMain.handle('save-miary', (event, miary) => writeMiary(miary));
ipcMain.handle('export-pdf', (event, recipe) => exportRecipeToPdf(recipe));
ipcMain.handle('export-docx', (event, recipe) => exportRecipeToDocx(recipe));
ipcMain.handle('pick-images', (event) => pickImages(BrowserWindow.fromWebContents(event.sender)));
ipcMain.handle('print-recipe', (event, recipe) => printRecipe(BrowserWindow.fromWebContents(event.sender), recipe));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
