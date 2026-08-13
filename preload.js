const { contextBridge, ipcRenderer } = require('electron');

// Most między interfejsem a procesem głównym. Renderer nie ma dostępu do
// Node.js (contextIsolation: true, nodeIntegration: false) — może korzystać
// wyłącznie z funkcji wypisanych poniżej.
contextBridge.exposeInMainWorld('api', {
  // --- przepisy ---
  loadRecipes: () => ipcRenderer.invoke('load-recipes'),
  saveRecipes: (recipes) => ipcRenderer.invoke('save-recipes', recipes),

  // --- przelicznik miar ---
  loadMiary: () => ipcRenderer.invoke('load-miary'),
  saveMiary: (miary) => ipcRenderer.invoke('save-miary', miary),

  // --- zdjęcia ---
  loadPhotos: (nazwy) => ipcRenderer.invoke('load-photos', nazwy),
  pickImages: () => ipcRenderer.invoke('pick-images'),

  // --- eksport pojedynczego przepisu ---
  exportPdf: (recipe) => ipcRenderer.invoke('export-pdf', recipe),
  exportDocx: (recipe) => ipcRenderer.invoke('export-docx', recipe),
  printRecipe: (recipe) => ipcRenderer.invoke('print-recipe', recipe),

  // --- kopia całej bazy ---
  exportBaze: () => ipcRenderer.invoke('export-baze'),
  importBaze: () => ipcRenderer.invoke('import-baze'),

  // --- kopie zapasowe ---
  listaKopii: () => ipcRenderer.invoke('lista-kopii'),
  przywrocKopie: (plik) => ipcRenderer.invoke('przywroc-kopie', plik),

  // --- kosz ---
  loadKosz: () => ipcRenderer.invoke('load-kosz'),
  doKosza: (przepis) => ipcRenderer.invoke('do-kosza', przepis),
  przywrocZKosza: (id) => ipcRenderer.invoke('przywroc-z-kosza', id),
  usunTrwale: (id) => ipcRenderer.invoke('usun-trwale', id),
  oproznijKosz: () => ipcRenderer.invoke('oproznij-kosz'),

  // --- stan aplikacji ---
  stanAplikacji: () => ipcRenderer.invoke('stan-aplikacji'),
  pokazFolderDanych: () => ipcRenderer.invoke('pokaz-folder-danych')
});
