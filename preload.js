const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadRecipes: () => ipcRenderer.invoke('load-recipes'),
  saveRecipes: (recipes) => ipcRenderer.invoke('save-recipes', recipes),
  exportPdf: (recipe) => ipcRenderer.invoke('export-pdf', recipe),
  exportDocx: (recipe) => ipcRenderer.invoke('export-docx', recipe),
  pickImages: () => ipcRenderer.invoke('pick-images'),
  printRecipe: (recipe) => ipcRenderer.invoke('print-recipe', recipe),
  loadMiary: () => ipcRenderer.invoke('load-miary'),
  saveMiary: (miary) => ipcRenderer.invoke('save-miary', miary)
});
