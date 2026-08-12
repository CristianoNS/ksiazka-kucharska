# Książka Kucharska — aplikacja desktopowa

Prosta, płaska (flat design) aplikacja do przechowywania przepisów. Dane zapisują się
naprawdę, trwale, w plikach na Twoim dysku — nie w przeglądarce.

## Jak wgrać aktualizację (ręcznie, krok po kroku)

1. Rozpakuj archiwum, które dostałeś.
2. W swoim folderze projektu (tym, w którym masz `main.js`, `package.json` itd.)
   podmień pliki na te z rozpakowanego archiwum: `main.js`, `preload.js`,
   `package.json`, `README.md` i cały folder `renderer` (nadpisz go w całości).
3. Otwórz terminal (PowerShell) **w folderze projektu** i wpisz:
   ```
   npm install
   npm run dist
   ```
4. Poczekaj, aż terminal skończy (może potrwać minutę-dwie).
5. Nowy plik `.exe` znajdziesz w podfolderze **`dist\`** — nazywa się
   `KsiazkaKucharska.exe`. To ten plik musisz teraz uruchomić.

## Najczęstszy błąd: "podmieniłem pliki i nic się nie zmieniło"

Prawie zawsze chodzi o jedno z dwóch:

- **Nie uruchomiłeś `npm run dist` po podmianie plików.** Samo podmienienie
  plików źródłowych niczego nie buduje — dopiero ta komenda tworzy nowy `.exe`.
- **Otwierasz starą kopię pliku `.exe`**, np. tę, którą wcześniej przeniosłeś
  na Pulpit. Nowy build zawsze ląduje w `dist\KsiazkaKucharska.exe` — jeśli
  masz kopię gdzie indziej (Pulpit, inny folder), musisz ją **ręcznie zastąpić**
  nową z `dist\` po każdym budowaniu.

## Szybszy podgląd zmian, bez budowania .exe za każdym razem

Budowanie (`npm run dist`) jest potrzebne tylko wtedy, gdy chcesz mieć gotowy,
przenośny plik do rozdania/wgrania. Na co dzień, żeby tylko zobaczyć efekt
zmiany, wystarczy w folderze projektu wpisać:

```
npm start
```

Otworzy się okno aplikacji od razu, bez pakowania do `.exe`. Zmiany w plikach
`renderer/` (interfejs) możesz odświeżyć w otwartym oknie klawiszem **Ctrl+R**,
bez zamykania aplikacji. Zmiany w `main.js` wymagają zamknięcia okna i
ponownego `npm start`.

## Funkcje aplikacji

**Przepisy** — dodawanie, edycja, usuwanie, skalowanie porcji z żywym
przeliczaniem składników, oznaczanie ulubionych (gwiazdka), galeria zdjęć
w widoku przepisu, notatki własne, sortowanie (najnowsze / alfabetycznie /
ulubione najpierw). Tytuł, kategoria i podkategoria są wymagane przy
dodawaniu i edycji przepisu.

**Kategorie i podkategorie** — Śniadania, Zupy, Dania główne, Desery,
Napoje, Dodatki, Przetwory, każda z własnym zestawem podkategorii widocznym
w rozwijanym drzewku w pasku bocznym. Wyszukiwanie działa po tytule
przepisu i nazwie podkategorii.

**Eksport i druk** — w widoku przepisu: **Edytuj**, **Drukuj**,
**Pobierz .pdf**, **Pobierz .docx** i **Usuń** (czerwony, z potwierdzeniem).
Eksport otwiera systemowe okno "Zapisz jako". Zdjęcia z galerii przepisu
**nie** trafiają do PDF/DOCX ani na wydruk — te formaty zawierają tylko
tekst przepisu.

**Przelicznik miar i wag** — osobna pozycja na liście kategorii (ikona
w postaci kropki, tak jak inne kategorie). Pokazuje, ile gramów mieści
szklanka (250 ml), łyżka (15 ml) i łyżeczka (5 ml) dla popularnych
produktów. Tabela jest w pełni edytowalna: możesz dopisywać własne
produkty, poprawiać wbudowane wartości (✎) i usuwać pozycje (✕).
Lista sortuje się zawsze alfabetycznie, także po dodaniu nowego produktu.
Działa też wyszukiwanie po nazwie produktu.

## 1. Czego potrzebujesz

- Zainstalowany **Node.js** (wersja 18 lub nowsza) — pobierz z https://nodejs.org
  (podczas instalacji zaznacz domyślne opcje, to wystarczy)

## 2. Uruchomienie w trybie podglądu (bez budowania .exe)

Otwórz terminal (np. PowerShell) w folderze projektu i wpisz kolejno:

```
npm install
npm start
```

Otworzy się okno aplikacji — tak będzie wyglądał finalny program.

## 3. Zbudowanie pliku .exe (jednorazowo)

W folderze projektu, w terminalu:

```
npm run dist
```

Po zakończeniu (kilka minut przy pierwszym razie) w folderze `dist\` pojawi się
gotowy, pojedynczy plik **`KsiazkaKucharska.exe`**. To wersja przenośna —
nic nie instalujesz, nie ma kreatora. Możesz go:

- przenieść w dowolne miejsce (Pulpit, główny folder projektu, pendrive),
- uruchamiać dwukrotnym kliknięciem od teraz zawsze tak,
- **nigdy więcej nie potrzebujesz terminala ani `npm start`** — to robisz tylko raz, teraz.

Jeśli potem zmienisz coś w kodzie (poprosisz mnie o kolejną funkcję), za każdym
razem trzeba będzie tylko ponownie odpalić `npm run dist`, żeby powstał
zaktualizowany plik `.exe`.

> Uwaga: to niepodpisany plik (bez płatnego certyfikatu Microsoftu),
> więc Windows/SmartScreen przy pierwszym uruchomieniu może pokazać ostrzeżenie
> "Nieznany wydawca" — wybierz "Więcej informacji" → "Uruchom mimo to".
> To nic niepokojącego, po prostu Windows nie zna tego nowo powstałego pliku.

## 4. Gdzie trzymane są dane

Aplikacja zapisuje dane w dwóch plikach w standardowym folderze danych
aplikacji, np.:

```
C:\Users\TwojaNazwaUżytkownika\AppData\Roaming\ksiazka-kucharska\przepisy.json
C:\Users\TwojaNazwaUżytkownika\AppData\Roaming\ksiazka-kucharska\przelicznik-miar.json
```

- `przepisy.json` — Twoje przepisy.
- `przelicznik-miar.json` — tabela przelicznika miar i wag (łącznie z Twoimi
  własnymi produktami i poprawkami wbudowanych wartości).

To zwykłe pliki tekstowe — możesz je skopiować jako kopię zapasową albo
przenieść na inny komputer.

## 5. Struktura projektu

```
main.js         – proces główny Electron (okno, zapis/odczyt plików, eksport)
preload.js      – bezpieczny "most" między aplikacją a systemem plików
renderer/       – interfejs (HTML/CSS/JS), to co widzisz na ekranie
package.json    – konfiguracja projektu i budowania .exe
```

Dowolną zmianę wyglądu robisz w `renderer/style.css`, a logikę interfejsu
(przepisy, przelicznik) w `renderer/app.js`.
