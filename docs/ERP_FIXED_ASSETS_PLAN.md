# Środki trwałe, inwentaryzacja i obieg dokumentów

> Poprzednia propozycja, zastąpiona ustaleniami użytkownika z 06.10.2026: [FV, sprzęt, pobrania QR i przekazania](IT_HARDWARE_WORKFLOW.md). WZ/PZ i rozbudowany obieg ERP nie są wymagane. Poniższe etapy nie są aktualną listą prac; podstawowy import i raporty już działają.

Status: projekt przebudowy, 06.10.2026. Ten dokument opisuje proponowane funkcje; nie oznacza, że są już dostępne w aplikacji.

## Ustalenia z użytkownikiem

- Najwyższy priorytet: inwentaryzacja środków trwałych.
- Istnieje wstępny eksport zawartości magazynu w Excelu lub CSV. Numery własne będą dopiero nadawane; dane wymagają dopasowania i potwierdzenia fizycznym spisem.
- Faktury i dostawy mają otrzymać sposób pracy zbliżony do Comarch ERP: rejestry dokumentów, pozycje, statusy i powiązania.
- Rekordy firmowe nie mogą być przesyłane do rozmowy z modelem. Mapowanie budujemy na udostępnionych, zatwierdzonych nagłówkach lub sztucznym przykładzie; użytkownik sam sprawdza plik w lokalnym podglądzie. Zasady i gotowe narzędzie profilowania: [LOCAL_IMPORT.md](LOCAL_IMPORT.md).

## Stan aplikacji

Istnieją konta i role, urządzenia, magazyn ilościowy, faktury, dostawy, QR oraz historia. Urządzenie ma już flagę `isFixedAsset`, numer środka trwałego, lokalizację, użytkownika, numer seryjny i powiązanie zakupu. Nie ma osobnego modułu arkuszy spisowych ani importu Excel/CSV.

Tabele `inventory_scans` i `inventory_scan_items` są jedynie punktem rozszerzenia. Nie utrwalają jeszcze pełnej migawki ewidencji, klasyfikacji różnic, decyzji rozliczenia i ich zatwierdzenia.

Obecny proces dostawy zapisuje fakturę i przyjęcie razem; model zakłada jedną dostawę na fakturę. Docelowy obieg dokumentów wymaga rozdzielenia tych operacji i obsługi częściowych przyjęć.

Do naprawy przed rozbudową: zmiana `assets.invoice_id` nie aktualizuje relacji `invoice_item_assets`. Zakup urządzenia z dostawy musi mieć kontrolowany, audytowany sposób korekty powiązania.

## Jednostki ewidencji

| Pojęcie | Znaczenie |
|---|---|
| Urządzenie | Konkretna fizyczna sztuka, własny Asset ID i opcjonalny numer seryjny/QR/RFID |
| Środek trwały | Pozycja ewidencji firmowej z numerem środka trwałego |
| Produkt magazynowy | Towar liczony ilościowo, np. kable, bez przypisania indywidualnej tożsamości każdej sztuce |
| Arkusz spisowy | Zakres i migawka stanu oczekiwanego na określony dzień |
| Obserwacja | Potwierdzenie fizycznego znalezienia sprzętu: kto, kiedy, gdzie i jak go zidentyfikował |
| Różnica | Rozbieżność między migawką a wynikiem spisu, wymagająca decyzji |
| FZ | Dokument zakupu i jego pozycje |
| PZ | Dokument potwierdzający fizyczne przyjęcie sprzętu lub produktów |

Numer ewidencyjny środka, Asset ID i RFID to odrębne identyfikatory. Import zachowuje identyfikatory źródłowe, jeśli istnieją. Proponujemy stały Asset ID `ITHW-00000001` i osobną wewnętrzną sekwencję `ST-00000001` dla świadomie zakwalifikowanych pozycji. Numer księgowy pozostaje osobnym polem, jeśli firma go prowadzi. Należy sprawdzić, czy jeden środek może obejmować kilka fizycznych urządzeń; w takim przypadku potrzebna jest relacja środka nadrzędnego i jego elementów. Obecna unikalność numeru na pojedynczym urządzeniu nie obsłuży takiego zestawu. Wiersz magazynowy z ilością większą od 1 wymaga decyzji o rozdzieleniu na sztuki albo zachowaniu produktu ilościowego.

## Docelowe menu

1. **Środki trwałe** — rejestr, karta, powiązane urządzenia, lokalizacja, osoba odpowiedzialna, źródło danych, ostatnia weryfikacja.
2. **Inwentaryzacja** — kampanie/arkusze, spis, różnice, decyzje i protokoły.
3. **Urządzenia** — pełna ewidencja fizycznego sprzętu, również wyposażenia.
4. **Magazyn** — produkty ilościowe i ruchy.
5. **Dokumenty zakupu** — faktury FZ i przyjęcia PZ z odrębnymi rejestrami i wzajemnymi powiązaniami.

## Etap 1: bezpieczny import istniejącej ewidencji

### Przepływ

Plik → podgląd → mapowanie kolumn → walidacja → propozycja dopasowania → zatwierdzenie → raport importu.

Import ma dwie fazy. Podgląd nie modyfikuje ewidencji. Zatwierdzenie dotyczy jawnie wybranych, poprawnych wierszy. Wiersze problematyczne pozostają w raporcie; nie są pomijane bez informacji.

### Dane do mapowania

- Numer środka trwałego / numer inwentarzowy.
- Dotychczasowy Asset ID i identyfikator rekordu w systemie źródłowym, jeśli występują.
- Nazwa, kategoria, producent, model, numer seryjny.
- Lokalizacja i osoba odpowiedzialna.
- Status użytkowania.
- Data zakupu, wartość i waluta, numer faktury i dostawca — jeśli dostępne.
- Data i wynik poprzedniej fizycznej weryfikacji, jeśli są wiarygodnie udokumentowane.

### Reguły

- Numery seryjne, numery inwentarzowe i kody są tekstem; zachowujemy zera wiodące.
- Nie dopasowujemy automatycznie rekordów po samej nazwie, modelu lub osobie.
- Konflikt identyfikatorów, duplikat i dopasowanie niejednoznaczne wymagają decyzji.
- Puste pole importu domyślnie nie usuwa istniejącej wartości.
- Nazwy lokalizacji i kategorii wymagają jawnego mapowania do słowników.
- Nie zastępujemy nieznanej lokalizacji, daty lub ceny wymyśloną wartością.
- Każdy wiersz ma partię importu, nazwę źródła, numer wiersza i wynik: nowy / dopasowany / konflikt / pominięty przez operatora.
- Powtórzenie zatwierdzenia tej samej partii nie tworzy kolejnych urządzeń.
- Dane z pliku otrzymują stan weryfikacji „Niezweryfikowany”, chyba że import obejmuje wiarygodne dowody wcześniejszego spisu.
- Wartości w różnych walutach nie są sumowane bez określonego przeliczenia.
- Typ wartości z pliku (np. wartość nabycia, netto, brutto, wartość księgowa) jest opisany jawnie. Obecnej ceny zakupu nie utożsamiamy automatycznie z wartością księgową.

### Kryterium ukończenia

Wybrany rzeczywisty plik przechodzi podgląd i zatwierdzenie, raport pokazuje wszystkie wiersze, powtórzenie importu nie zwiększa liczby urządzeń, a brakujące dane pozostają widoczne.

## Etap 2: inwentaryzacja fizyczna — najwyższy priorytet funkcjonalny

### Zakres

Kampania ma numer, nazwę, dzień odniesienia, lokalizacje, odpowiedzialnych operatorów i zakres: środki trwałe lub wyposażenie. Pierwszy wariant organizujemy według lokalizacji, z filtrem osoby odpowiedzialnej. Ostateczny podział wynika z danych źródłowych.

Przy rozpoczęciu powstaje niezmienna migawka oczekiwanych rekordów: identyfikatory, nazwa, lokalizacja, osoba, status oraz wersja karty. Późniejsze zmiany bieżącej ewidencji nie zmieniają tej migawki.

### Cykl arkusza

Roboczy → W trakcie spisu → Do rozliczenia → Zatwierdzony.

„Anulowany” kończy arkusz z zapisaną przyczyną. Zatwierdzonego arkusza nie edytujemy; korekta jest kolejnym dokumentem powiązanym z poprzednim.

### Spis

- Wybór lokalizacji i arkusza.
- Skanowanie QR lub wpisanie Asset ID, numeru seryjnego albo numeru środka trwałego.
- Pokazanie jednoznacznego dopasowania przed zapisem obserwacji.
- Potwierdzenie miejsca znalezienia i ewentualnej uwagi.
- Zachowanie autora, czasu i metody identyfikacji.
- Ponowny skan tej samej sztuki nie zwiększa ilości.
- Nieznany kod trafia do kolejki wyjaśnień; nie tworzy automatycznie nowego środka trwałego.

### Wyniki

| Wynik | Znaczenie |
|---|---|
| Do sprawdzenia | Pozycja oczekiwana, jeszcze bez obserwacji; otwarty spis |
| Potwierdzony | Tożsamość i lokalizacja zgodne z migawką |
| Inna lokalizacja | Sztuka rozpoznana, znaleziona gdzie indziej |
| Znaleziony poza zakresem | Znane urządzenie nie znajdowało się na tym arkuszu |
| Kod do wyjaśnienia | Brak jednoznacznego dopasowania |
| Niepotwierdzony po spisie | Oczekiwany rekord bez obserwacji po zakończeniu spisu |

„Niepotwierdzony” nie oznacza automatycznie utraty, likwidacji ani usunięcia z ewidencji. Operator prowadzący wyjaśnienia zapisuje decyzję, powód i ewentualny dowód. Zmiana bieżącej lokalizacji lub statusu odbywa się dopiero przez osobną, zatwierdzoną operację.

### Rozliczenie

- Lista różnic i komentarze.
- Kontrola zmian karty od chwili utworzenia migawki; konflikt wymaga ponownej oceny.
- Decyzja osoby uprawnionej dla każdej różnicy.
- Zatwierdzenie dokumentu i utrwalenie autora, daty, zakresu oraz decyzji.
- Eksport arkusza i protokołu, z oddzieleniem wyników spisu od późniejszych korekt ewidencji.

Operator IT_USER może rejestrować obserwacje w przydzielonym spisie. IT_ADVANCED prowadzi i rozlicza arkusz. ADMIN zatwierdza korekty. Ostateczne uprawnienia i ewentualna komisja wymagają dopasowania do praktyki firmy.

### Kryteria ukończenia

Testy obejmują zgodny spis, brak obserwacji, sprzęt w innej lokalizacji, nieznany kod, powtórny skan, równoczesny zapis dwóch operatorów, zmianę ewidencji podczas spisu oraz odmowę edycji zatwierdzonego arkusza. Pilot kończy się porównaniem protokołu z rzeczywistym spisem jednej lokalizacji.

## Etap 3: faktury i dostawy w układzie ERP

### Rejestry

Faktury i przyjęcia otrzymują własne numery, filtry, statusy oraz pasek działań. Numer wewnętrzny dokumentu jest odrębny od numeru faktury dostawcy.

Karta dokumentu ma zakładki: Ogólne, Pozycje, Powiązania, Załączniki, Historia. Funkcje niezaimplementowane nie otrzymują pozornych aktywnych przycisków.

### Zasady obiegu

- Rejestracja faktury FZ nie potwierdza fizycznego przyjęcia sztuk.
- Zatwierdzenie PZ tworzy fizyczne urządzenia lub zwiększa stan produktów dokładnie raz.
- Jedna FZ może być rozliczona przez kilka częściowych przyjęć.
- Sprzęt może nadejść przed fakturą; PZ pozostaje wtedy do powiązania z dokumentem zakupu.
- Pozycja przyjęcia ma ilość, wskazanie pozycji zakupu i identyfikatory fizycznych sztuk.
- Zatwierdzonych dokumentów nie nadpisujemy zwykłą edycją; korekta zachowuje dokument źródłowy i audyt.
- Przyjęcie nowego urządzenia nie przesądza o jego kwalifikacji jako środka trwałego. Numer i klasyfikacja pochodzą z uzgodnionej ewidencji firmy.
- Powiązanie urządzenie → pozycja przyjęcia → pozycja zakupu → faktura musi pozostawać spójne.

PDF faktury, termin płatności i dane dostawcy można dodać później. Pola netto/VAT/brutto wymagają ustalenia źródła i reguł zaokrągleń; nie zastępujemy istniejącej kwoty zakupu nieuzgodnionym wyliczeniem.

## Kolejność realizacji

1. Lokalna analiza pliku źródłowego przez użytkownika, uzgodnienie zatwierdzonych nagłówków lub sztucznego przykładu, definicja jednostki ewidencji, numeracji i lokalizacji.
2. Poprawa spójności zakupu, import z podglądem, osobny rejestr środków trwałych i raport jakości danych.
3. Arkusze spisowe, obserwacje, rozliczenie różnic, protokoły i pilot jednej lokalizacji.
4. Rozdzielenie FZ/PZ, częściowe dostawy oraz układ dokumentów inspirowany ERP.
5. Załączniki, integracje i automatyzacja po ustabilizowaniu pilota.

Przy rozpoczęciu importu i pilota zachowujemy dotychczasowy Excel jako źródło odniesienia. Plan nie przewiduje usuwania ani zastępowania istniejących danych bez zatwierdzonego podglądu.

## Inspiracja i źródła

Dokumentacja Comarch ERP Optima stanowi odniesienie do organizacji procesów i ekranów. Plan nie oznacza integracji z Comarch ani zgodności księgowej.

- [Inwentaryzacja — arkusze, stan bieżący, ilość według spisu i różnice](https://pomoc.comarch.pl/optima/pl/2026/dokumentacja/inwentaryzacja-2/).
- [Faktury zakupu — odrębność FZ i powiązanego przyjęcia PZ](https://pomoc.comarch.pl/optima/pl/2026/dokumentacja/faktury-zakupu/).
- [Ewidencja środków trwałych — numer inwentarzowy, lokalizacja i osoba odpowiedzialna](https://pomoc.comarch.pl/optima/pl/2026/dokumentacja/ewidencja-srodkow-trwalych/).
