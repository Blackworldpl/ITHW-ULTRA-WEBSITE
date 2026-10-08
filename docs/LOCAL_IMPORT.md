# Lokalna analiza magazynu i identyfikatory

## Import do obecnej bazy w aplikacji

Otwórz `http://localhost:3000/import` jako IT Advanced lub administrator. Folder `imports` nie jest wymagany: wybierasz plik z dowolnego lokalnego folderu. Nie dołączaj go do rozmowy. Asystent nie otwiera firmowych plików ani podglądów.

1. Wybierz `.xlsx` lub `.csv` (maks. 10 MB). Dla CSV z polskiego Excela można wybrać Windows-1250. XLS zapisz wcześniej jako XLSX. Plik jest parsowany w przeglądarce; formuły nie są wykonywane. Numery zapisane jako liczby mogą utracić formatowanie, np. wiodące zera — sprawdź je w podglądzie.
2. Wybierz arkusz, wiersz nagłówków i zakres do 1000 wierszy. Większy arkusz importuj kolejnymi zakresami. Jedna partia urządzeń zawiera najwyżej 1000 sztuk. Puste wiersze są pomijane.
3. Wybierz „Urządzenia” dla osobnych sztuk i numerów seryjnych, albo „Magazyn” dla produktów z ilością. Ustaw wspólną kategorię i lokalizację; różne kategorie/lokalizacje importuj osobnymi zakresami. Dopasuj kolumny. Nieprzypisane kolumny nie są wysyłane.
4. Urządzenia otrzymają własne Asset ID i QR. Opcjonalna klasyfikacja jako środki trwałe generuje brakujące wewnętrzne numery ST; nie stanowią one uzgodnionej numeracji księgowej. Nie generujemy fikcyjnych fizycznych RFID.
5. Kliknij „Sprawdź wybrane dane”. Wybrane i zmapowane wiersze trafiają do serwera aplikacji, aby porównać je z obecną bazą. Kontrola nie zapisuje rekordów. Popraw błędy w pliku lub mapowaniu. Duplikaty istniejących numerów seryjnych / ST / SKU będą pominięte bez nadpisania.
6. Sprawdź podgląd, zaznacz potwierdzenie i kliknij zapis. Zapis całej partii jest atomowy. Ponowienie tej samej operacji nie mnoży zapisów. Ponowne wczytanie identycznego pliku/arkusza/wiersza jest rozpoznawane także bez numeru seryjnego.

**Zmieniony plik bez trwałych identyfikatorów może zawierać ten sam sprzęt.** Takich duplikatów nie da się pewnie wykryć po samej nazwie. Przed zapisem porównaj eksport z ewidencją. Generowane SKU `IMP-...` są wewnętrznym identyfikatorem pozycji, nie identyfikatorem dostawcy.

Import uzupełnia obecne dane, nie zeruje brakujących pozycji, nie nadpisuje stanów istniejących SKU i nie tworzy fikcyjnych faktur/dostaw. Nowe stany magazynowe zapisuje jako `OPENING_BALANCE` w historii. Pochodzenie i status `UNVERIFIED` są zapisane dla każdego nowego wiersza; urządzenia mają również adnotację w polach dodatkowych. Dane stanowią częściowy stan początkowy (według użytkownika około 40% rzeczywistego stanu), nie potwierdzony spis fizyczny. Obsługa fizycznego spisu i rozliczenia różnic jest kolejnym etapem.

Kod aplikacji i domyślne ustawienie lokalnej bazy pozostają bez zmian lokalizacyjnych: baza działa w `%LOCALAPPDATA%/IT-Hardware/postgres`; import nie zapisuje kopii pliku w projekcie ani nie przekazuje go do AI. Zapisy w bazie i jej kopie podlegają zasadom firmy.

Poniższa analiza PowerShell jest opcjonalnym narzędziem profilu i sama nie dodaje danych do bazy.

Użytkownik ma firmowy eksport stanu magazynowego w Excelu/CSV. Numeracja własna i fizyczne potwierdzenie będą dopiero nadawane. Nie ma zgody na przesyłanie rekordów firmowych do rozmowy z modelem.

## Gdzie umieścić pliki

Folder wejściowy na tym komputerze:

```text
%LOCALAPPDATA%\IT-Hardware\imports
```

Folder raportów:

```text
%LOCALAPPDATA%\IT-Hardware\import-reports
```

Są poza projektem synchronizowanym przez OneDrive. Kod narzędzia jest w projekcie; firmowe pliki i raporty pozostają w katalogach lokalnych. Podlegają zasadom dostępu i ochrony obowiązującym na tym komputerze.

## Uruchomienie przez użytkownika

1. Uruchom dwuklikiem `Open-Inventory-Folder.cmd` w katalogu projektu. Tworzy folder `imports` w profilu użytkownika uruchamiającego skrypt i otwiera go w Eksploratorze. Lokalny skrót „Otworz folder Inventory” wskazuje na ten skrypt, zamiast na wcześniej zapisany bezwzględny adres. Umieść tam kopie `.xlsx` lub `.csv`. Stary `.xls` zapisz w Excelu jako `.xlsx`.
2. Uruchom dwuklikiem `Check-Inventory.cmd` w katalogu projektu `it-hardware`. Wykona analizę i otworzy lokalny raport w domyślnej przeglądarce. Alternatywnie w PowerShell, w katalogu projektu, uruchom:

   ```powershell
   .\Inspect-Inventory.ps1
   ```

3. Otwórz `%LOCALAPPDATA%\IT-Hardware\import-reports\summary.html` w przeglądarce.

Skrypt wymaga Windows PowerShell 5.1 albo PowerShell z bibliotekami .NET. Nie instaluje zależności. Czyta pliki, nie zmienia ich, nie korzysta z sieci, AI ani bazy IT Hardware. Raport HTML ma politykę CSP blokującą zasoby sieciowe i skrypty.

Wynik zawiera nazwy plików, arkuszy i kolumn, liczbę wierszy, puste komórki, liczbę różnych wartości i powtórzeń w kolumnie. Nie zawiera wartości z wierszy danych. Zgłoszenia błędów parsera nie wypisują treści wejściowej. Każdy arkusz Excela jest analizowany oddzielnie.

Raport nie jest automatycznie bezpieczny do udostępnienia: same nagłówki, nazwy plików, arkuszy i statystyki także mogą być informacją firmową. Użytkownik sam wybiera, co może przekazać, np. zanonimizowane nazwy kolumn lub sztuczny przykład.

### Ograniczenia i ustawienia

- `.xlsx` oraz CSV z separatorem `;`, `,` lub tabulatorem; CSV z polami cytowanymi i wieloma liniami.
- CSV: wykrycie UTF-8, UTF-16 z BOM; przy niepoprawnym UTF-8 domyślnie Windows-1250. Można wskazać `-CsvEncoding Windows1250`, `Windows1252` lub `UTF8`.
- Domyślny nagłówek: pierwszy wiersz. Dla raportu z tytułem nad tabelą można użyć `-HeaderRow 3`. W XLSX jest to numer wiersza; w CSV numer rekordu, z pominięciem pustych linii przez parser.
- Limit pliku 50 MB, rozpakowanego XLSX 100 MB, arkusza 100 000 wierszy danych i 256 kolumn. Większe eksporty można podzielić.
- Szyfrowane XLSX, XLS, zewnętrzne relacje arkuszy i XML z DTD nie są obsługiwane.
- Formuły nie są wykonywane. Zapamiętane wyniki mogą być nieaktualne; do importu najlepiej przygotować kopię z wartościami.
- Formatowanie komórek Excel nie jest odtwarzane. Zera wiodące zapisane jako tekst są zachowane w analizie. Jeśli identyfikator jest liczbą z formatem `000000`, wymaga sprawdzenia przed importem. Data zapisana jako liczba Excela również wymaga jawnej konwersji.
- Powtórzenia nazw, modeli i lokalizacji mogą być prawidłowe. Powtórzenia numerów seryjnych wymagają decyzji; samo profilowanie nie rozstrzyga, czy rekordy są duplikatami.
- Narzędzie nie importuje danych do aplikacji, nie oznacza ich jako zweryfikowane i nie nadaje numerów.

Testy narzędzia korzystają wyłącznie z syntetycznych plików w ignorowanym `.local/profile-tests`. Polecenie: `powershell.exe -NoProfile -File tests/local-inventory.ps1`.

## Prywatność pracy z asystentem

Brak załącznika w rozmowie nie oznacza, że odczyt przez narzędzia asystenta pozostaje poza modelem. Wynik narzędzia może trafić do kontekstu modelu. Nie należy prosić asystenta o otwarcie źródłowego Excela, wypisanie wierszy ani zrobienie zrzutu ekranu prywatnego podglądu.

Asystent przygotowuje kod i testuje go na danych syntetycznych. Lokalną analizę prawdziwych danych uruchamia użytkownik. Do dalszego projektowania wystarczą ręcznie udostępnione, zatwierdzone nagłówki lub sztuczny przykład. [Oficjalna dokumentacja OpenAI opisuje przekazywanie wyników narzędzi do modelu](https://developers.openai.com/api/docs/guides/function-calling).

## Proponowana numeracja

| Identyfikator | Propozycja | Kiedy powstaje |
|---|---|---|
| Asset ID fizycznej sztuki | `ITHW-00000001` — obecny format aplikacji | Po utworzeniu konkretnej sztuki |
| Wewnętrzny numer ewidencji środka | `ST-00000001` — proponowana osobna sekwencja | Po świadomym oznaczeniu pozycji jako środek trwały |
| Numer z ewidencji księgowej | Osobne pole, jeśli firma go prowadzi | Przy uzgodnieniu danych z księgowością |
| QR | Link do karty stabilnego Asset ID | Przy generowaniu etykiety |
| RFID EPC | Kod zgodny z wybranym tagiem i czytnikiem | Przy programowaniu i potwierdzeniu odczytu tagu |
| Fabryczny identyfikator tagu | Odczytany TID/UID, jeśli urządzenie go udostępnia | Przy parowaniu fizycznego tagu |

Lokalizacja, rok zakupu, model i użytkownik są polami karty; nie są częścią stałego numeru sprzętu. Przeniesienie, naprawa lub ponowne wydanie nie zmieniają Asset ID. Numerów nie wykorzystujemy ponownie po wycofaniu urządzenia.

Numery nadaje aplikacja transakcyjnie z sekwencji bazy, z unikalnymi ograniczeniami. Numer wiersza Excela nie jest trwałym identyfikatorem. Nowa partia importu zachowuje powiązanie z rekordami i raport dopasowania, aby ponowny import nie tworzył kolejnych sztuk.

Własny numer ewidencyjny pomaga w pracy IT. Nie jest automatycznym potwierdzeniem kwalifikacji do firmowej ewidencji środków trwałych. Początkowy eksport magazynowy może zawierać zarówno fizyczne urządzenia, zestawy, jak i produkty ilościowe. Przed nadaniem numerów trzeba ustalić, czy wiersz opisuje jedną sztukę, czy kilka sztuk tego samego modelu.

RFID wymaga fizycznego tagu i urządzenia potrafiącego go odczytać lub zapisać. Sam tekst w bazie nie programuje tagu. Wymiana tagu powinna utrwalać stare i nowe powiązanie w historii. Format EPC i długość dobieramy po poznaniu modelu sprzętu; nie generujemy z góry numerów rzekomo zgodnych z nieznanym czytnikiem.

## Następny etap aplikacji

Lokalny podgląd mapowania kolumn → rozdzielenie sztuk i produktów ilościowych → zatwierdzenie importu → nadanie Asset ID → etykiety QR → fizyczny spis → rozliczenie różnic. RFID rozszerza identyfikację po doborze sprzętu.

Budowa mapowania i importu nie wymaga przekazania prawdziwych wierszy asystentowi. Wystarczy uzgodniony schemat i testy na sztucznych rekordach, a użytkownik sprawdza rzeczywiste dane w lokalnej aplikacji.
