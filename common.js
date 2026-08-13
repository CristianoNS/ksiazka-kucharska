/* ==========================================================================
   WSPÓLNE DANE I FUNKCJE
   --------------------------------------------------------------------------
   Ten plik jest używany JEDNOCZEŚNIE przez:
     - main.js (proces główny Electrona, przez require)
     - renderer/app.js (interfejs, przez <script src="../common.js">)

   Dzięki temu nazwy kategorii, podkategorii i sposób formatowania czasu są
   zdefiniowane w JEDNYM miejscu. Wcześniej były zdublowane i groziło to tym,
   że np. eksport do PDF pokazywał inne nazwy niż aplikacja.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();           // Node / proces główny
  } else {
    root.KKCommon = factory();            // przeglądarka / renderer
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const CAT_LABELS = {
    sniadania: 'Śniadania',
    zupy: 'Zupy',
    'dania-glowne': 'Dania główne',
    desery: 'Desery',
    napoje: 'Napoje',
    dodatki: 'Dodatki',
    przetwory: 'Przetwory'
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

  function normalizeTime(value) {
    if (!value) return '—';
    return /^\d+$/.test(String(value).trim()) ? `${value} min` : String(value);
  }

  // Generuje identyfikator, który NA PEWNO nie koliduje z już istniejącymi.
  // Wcześniej używane samo Date.now() potrafiło zwrócić tę samą wartość
  // kilka razy pod rząd (np. przy imporcie), przez co edycja/usuwanie
  // działały na niewłaściwym przepisie.
  function makeId(existingIds) {
    const used = new Set((existingIds || []).map(String));
    let id = Date.now();
    while (used.has(String(id))) id++;
    return id;
  }

  return { CAT_LABELS, SUBCATS, subcatLabel, normalizeTime, makeId };
});
