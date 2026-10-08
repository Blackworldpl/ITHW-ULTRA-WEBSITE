# Plan: produkty, słowniki i wygodne wprowadzanie faktur

Data: 08.10.2026. Status: wdrożono A–F oraz obsługę ilości ułamkowych. Końcowa weryfikacja jest opisana w VERIFICATION.md. Ilości ułamkowe wdrożono w migracji 015. Punktem odniesienia jest przesłany przykład formularza Comarch ERP: nagłówek dokumentu, duża tabela pozycji i praca w jednym oknie. Zachowujemy motyw i styl obecnej aplikacji.

## Wdrożone 08.10.2026

- Pola minimum, ilości faktury/dostawy, pobrania/zwrotu oraz korekty przechowują wpisywany tekst. Wyczyszczenie pola nie przywraca zera. Wspólna walidacja odrzuca pustą lub nieprawidłową ilość, a podgląd dostawy liczy kwoty dokładnie w groszach.
- Nowy produkt ma krótką kolejność: nazwa, kategoria z wyszukiwaniem, jednostka z listy, minimum i lokalizacja. SKU, kod producenta i uwagi są zwinięte. Adres/QR powstaje automatycznie; edycja zachowuje istniejący adres.
- Administracja zawiera „Kategorie magazynowe” i „Jednostki”: dodawanie, edycja, wyłączanie oraz usuwanie nieużywanych wpisów. Kategorie i jednostki nie powstają z dowolnego tekstu formularza ani importu. Formularz produktu ma odnośnik do zarządzania i odświeżenie list.
- Migracja 013 zachowuje dokładne istniejące nazwy. Wpisy słownika mają stałe UUID; dotychczasowy kontrakt tekstowych pól produktów pozostaje. Zmiana nazwy kategorii aktualizuje produkty bez zmiany ID/QR. Symbol używanej jednostki jest chroniony; jej pełną nazwę można zmienić. Jednostki produktu z zapasem, ruchem lub pozycją FV nie można zmienić bez osobnego procesu.
- Nowa kartoteka może mieć policzony stan początkowy z opisem źródła i jednym ruchem w historii. Produkt tworzony nad fakturą zaczyna od zera i wraca do konkretnego wiersza; ilość przyjmuje dopiero zatwierdzenie zakupu.
- Kontrola A/B: 68/68 integracyjnych, 15/15 jednostkowych i produkcyjny build z TypeScript. Końcowy wynik całego zakupu: VERIFICATION.md. UI sprawdzone wyłącznie na fikcyjnej bazie `_test`, w obu motywach i na telefonie 390 × 844. Szczegóły w [VERIFICATION.md](VERIFICATION.md), instrukcja w [WAREHOUSE.md](WAREHOUSE.md).

Kontynuacja zakończona: wspólny duży formularz Faktur/Dostaw, okna kontrahenta i produktu nad dokumentem, tabela z numeracją i jednostką pozycji, opcjonalne ceny oraz wyszukiwanie i dopasowanie urządzeń po SN lub Asset ID. Istniejące urządzenia wymagają jawnego potwierdzenia. Dokument można zapisać przed przyjęciem i uzupełnić później: urządzenia przez numery, produkty przez częściowe przyjęcia. Ceny przyjętego dokumentu można uzupełnić bez zmiany zapasu i wcześniejszych cen urządzeń.

Uzupełnienie wygody pracy z 08.10: zmiana kolejności pozycji, Alt+N z fokusem nowego wiersza, dodawanie kontrahenta/produktu z klawiatury, ochrona niezapisanych danych przed zamknięciem i ponowienie pobrania słowników bez wysyłania faktury. Sprawdzono zapis 15 pozycji wraz z PDF i zachowanie kolejności. Uaktualniono starsze opisy przepływu/architektury, które błędnie oznaczały zakup i częściowe przyjęcia jako niewdrożone. Migracja 015 obejmuje ilości ułamkowe w całym przepływie magazynu.

Migracja 014 zapisuje pozycję, jednostkę, planowane SN i dane nowych kart. Zachowuje dotychczasowe powiązania, historię i QR. Starsze dokumenty nie przechowywały kolejności; otrzymują deterministyczną numerację według nazwy/ID, a nowe zachowują kolejność wprowadzania. Oba starsze endpointy zakupowe pozostają obsługiwane. Migracja 015 rozszerza stany, minima, ruchy, dokumenty oraz import na ilości ułamkowe.

## Cel i zakres

Użytkownik ma wprowadzić fakturę, wybrać lub utworzyć kontrahenta, dodać wszystkie pozycje i dokładnie połączyć je z produktami lub konkretnymi urządzeniami. Priorytetem jest poprawny dokument źródłowy i powiązanie **faktura → pozycja → urządzenie z numerem seryjnym**. Dane kwotowe mają być wygodnym uzupełnieniem tego procesu.

Zakres obejmuje zarówno formularz „Nowa faktura”, jak i „Przyjmij dostawę”, tworzenie/edycję produktów magazynowych, słowniki oraz pola ilościowe. Ustalenia o administracyjnym dostępie do lokalizacji i zarządzania ekranami pozostają w mocy.

## Ustalenia sprzed wdrożenia etapów A/B

- `InventoryForm` przyjmuje kategorię i jednostkę jako dowolny tekst. Jednostka domyślna to `szt.`, a nowy produkt zaczyna ze stanem zero.
- Pole minimum konwertuje każdą zmianę przez `Number(event.target.value)`. Pusty tekst staje się zerem. Podobny wzorzec występuje w innych polach ilościowych; poprawka musi objąć cały przepływ.
- `ReceiveDeliveryForm` ma zwykłą listę dostawców i osobne, duże bloki pozycji. `InvoiceComposer` ma wyszukiwanie i prosty formularz kontrahenta wewnątrz okna, ale nie oczekiwane dodatkowe okno z akcji na końcu wyników.
- `SearchSelect` wymaga rozszerzenia o akcję utworzenia wpisu. Wspólny `Modal` wymaga obsługi stosu okien, żeby Escape i pułapka fokusu działały tylko w najwyższym oknie.
- Baza ma już `invoice_items` oraz `invoice_item_assets`. Przyjęcie nowego urządzenia łączy je z dokładną pozycją. Zwykła zmiana faktury na karcie istniejącego urządzenia nie tworzy takiego dopasowania do pozycji.
- Ilości, stany, minima i ruchy są obecnie całkowite. Ceny pozycji i kwota faktury są wymagane. Rozszerzenie tych zachowań wymaga zmian w API i bazie, a nie tylko formularzu.

## 1. Pola liczbowe

Wspólny sposób wprowadzania ilości/minimum/stanu we wszystkich formularzach magazynu i zakupów:

- Podczas pisania wartość pozostaje tekstem; można usunąć wszystko, zaznaczyć i zastąpić liczbę oraz wkleić wartość.
- Puste pole nie jest automatycznie zastępowane zerem ani jedynką. Walidacja i konwersja odbywają się przy zatwierdzeniu.
- Wymagana ilość z pustym polem pokazuje błąd przy tym polu. Minimum może mieć wartość zero; czytelna wartość domyślna nie utrudnia jej usunięcia.
- Zakresy i dozwolona precyzja pozostają sprawdzane również przez API. Pobrania nie przekraczają stanu.
- Ta sama obsługa w nowym produkcie, edycji, korekcie, pobraniu/zwrocie, pozycji faktury, pozycji dostawy i ręcznych polach importu. Nie zmieniamy pól sterujących stroną tabeli na ilości magazynowe.
- Pola cenowe obsługują polski przecinek. Obliczenia kwot mają wspólny dokładny mechanizm; zastępujemy obecne obliczenia podglądu dostawy na liczbach zmiennoprzecinkowych.

**Wdrożone ilości ułamkowe:** administrator ustawia w jednostce 0–3 miejsca po przecinku; `m` i `kg` mają domyślnie 3. Stany, minima, ruchy, pozycje dostaw/faktur, import i eksport korzystają z `numeric(13,3)`. Obliczenia ilości używają całych tysięcznych, a wartość każdej pozycji zaokrągla się do groszy przed sumowaniem. Dokument zachowuje precyzję jednostki z chwili zapisu. Precyzję używanej jednostki można zwiększyć; zmniejszenie jest blokowane. Urządzenia z numerami seryjnymi oraz usługi zachowują całkowitą liczbę sztuk.

## 2. Kategorie i jednostki jako słowniki

Kategorie magazynowe i jednostki wybierane wyłącznie z listy z wyszukiwaniem. Wpisanie tekstu filtruje listę; sam tekst nie tworzy nowej wartości.

Administrator otrzymuje dwie listy zarządzania:

| Słownik | Dane wpisu | Operacje |
| --- | --- | --- |
| Kategorie magazynowe | Stałe ID, nazwa, opcjonalny opis, aktywność | Dodaj, edytuj, wyłącz, usuń nieużywany |
| Jednostki | Stałe ID, symbol i pełna nazwa; precyzja 0–3 | Dodaj, edytuj, wyłącz, usuń nieużywany |

Przykładowe jednostki do ustalenia: `szt.`, `kpl.`, `opak.`, `m`, `kg`. Kategorie magazynowe są odrębne od istniejących kategorii urządzeń, które mają własne pola techniczne. W administracji ich nazwy muszą być jednoznaczne.

Wpis używany w produktach lub historii pozostaje chroniony przed fizycznym usunięciem; wyłączenie usuwa go z wyboru dla nowych produktów i zachowuje stare powiązania. Zmiana nazwy zachowuje ID. Zmiana jednostki produktu nie przelicza automatycznie jego zapasu ani historii; znacząca zmiana jednostki wymaga osobnego, jawnego procesu. Pozycja dokumentu zachowuje jednostkę z momentu zapisu.

Migracja zachowuje istniejące kategorie/jednostki i ich powiązania. Nie łączy automatycznie różnych nazw na podstawie podobieństwa. Dane starych produktów nadal można otworzyć i poprawić. Zarządzanie słownikami należy do administracji; zwykły formularz udostępnia wybór.

## 3. Nowy produkt magazynowy

Krótki formularz z czytelną kolejnością: **nazwa → kategoria → jednostka → minimum → lokalizacja**. SKU, kod producenta i uwagi w części dodatkowej. Techniczny identyfikator adresu powstaje automatycznie, z obsługą kolizji, i pozostaje stały po utworzeniu.

Dwa konteksty pracy:

- **Z magazynu:** utworzenie samej kartoteki albo kartoteki z policzonym stanem początkowym i opisem źródła. Stan początkowy jest osobnym ruchem w historii, zapisanym razem z produktem. Zakup z faktury prowadzi do formularza przyjęcia z wybranym produktem.
- **Z faktury/dostawy:** dodatkowe okno tworzy kartotekę, wraca do konkretnego wiersza i wybiera nowy produkt. Ilość z faktury zwiększa stan dopiero po zatwierdzeniu przyjęcia. Samo utworzenie kartoteki nie przyjmuje towaru.

Jeśli użytkownik anuluje fakturę po utworzeniu produktu, kartoteka może pozostać ze stanem zero; formularz powinien jasno potwierdzić jej utworzenie. Ponowienie zapisu nie tworzy drugiej kartoteki ani drugiego stanu początkowego.

## 4. Kontrahent bez opuszczania dokumentu

Przebieg wymagany przez użytkownika:

1. W polu kontrahenta wpisuje `SPECKABLE` lub NIP.
2. Lista pokazuje dopasowania oraz na dole akcję **„Dodaj kontrahenta «SPECKABLE»”**, jeśli nie ma dokładnego wpisu.
3. Akcja otwiera dodatkowe okno z przeniesioną nazwą. Faktura pod spodem zachowuje numer, datę, walutę, wszystkie pozycje i wybrany PDF.
4. Po zapisie kontrahent trafia do słownika i zostaje wybrany na fakturze. Po anulowaniu użytkownik wraca do faktury z zachowanymi danymi.

Nowe okno korzysta z pełnego formularza kontrahenta: nazwa, NIP i opcjonalne dane adresowe/kontaktowe. Błędy oraz duplikaty nazwy/NIP są widoczne w tym oknie. Przy istniejącym kontrahencie można wrócić i wybrać go zamiast tworzyć duplikat.

Zachowujemy dotychczasowy dostęp ADMIN do tworzenia kontrahentów. Dla innych ról akcja jest dostępna tylko po nadaniu odpowiedniego uprawnienia; nie poszerzamy dostępu automatycznie. Podstawowy wybór istniejącego kontrahenta pozostaje dostępny dla operatorów z prawem wprowadzania dokumentów.

Obsługa okien: fokus tylko w najwyższym, Escape zamyka najpierw podpowiedzi lub najwyższe okno, zamknięcie potomnego nie zamyka faktury, zapis kontrahenta nie wysyła formularza faktury. Anulowanie nie kasuje danych rodzica.

## 5. Jeden duży formularz faktury i przyjęcia

Wspólny ekran edycji dla wejścia z Faktur i Dostaw, z wyraźnie wskazanym celem: zapis dokumentu, przyjęcie nowego zakupu albo powiązanie już zarejestrowanego sprzętu. Nagłówek i akcje zapisu są łatwo dostępne, a pozycje zajmują większą część okna.

**Nagłówek:** numer faktury, kontrahent, data, waluta, opcjonalny numer zamówienia i PDF. Wybór waluty pokazuje kod oraz nazwę, np. `PLN — złoty polski`, `EUR — euro`, z PLN jako domyślną dla nowego dokumentu. Ta sama waluta jest widoczna przy cenach i sumach. Waluta jest cechą dokumentu; jej zmiana nie przelicza samoczynnie już zapisanych cen zakupu.

**Tabela pozycji:** kolejność jak na dokumencie, numer pozycji, nazwa z faktury, powiązany produkt/urządzenie, ilość, jednostka, numery seryjne/status powiązania, lokalizacja oraz dodatkowe dane kwotowe. Nazwa z dokumentu i nazwa kartoteki są odrębnymi danymi — dopasowanie nie nadpisuje oryginalnej nazwy pozycji.

- Wyszukiwanie produktu po nazwie, SKU i kodzie; wyszukiwanie konkretnego urządzenia również po Asset ID i numerze seryjnym.
- Akcja „Dodaj produkt” na końcu podpowiedzi otwiera dodatkowe okno i uzupełnia tylko wskazany wiersz po zapisie.
- Szybkie dodawanie następnej pozycji, usuwanie niezapisanej pozycji, przechodzenie klawiaturą i zachowanie kolejności wierszy po zapisie.
- Szczegóły modelu, numerów seryjnych i lokalizacji otwierane przy danej pozycji, bez ogromnego osobnego formularza dla każdego wiersza.
- Produkt ilościowy, urządzenia z numerami seryjnymi oraz pozostała pozycja/usługa mają właściwy dla siebie formularz.
- Podgląd przed zapisem pokazuje, ile kart zostanie utworzonych, ile istniejących urządzeń powiązanych i o ile wzrosną poszczególne zapasy.

**Wdrożone ceny opcjonalne:** cena pozycji i kwota dokumentu mogą pozostać nieuzupełnione, z czytelnym oznaczeniem braku danych. Brak ceny nie oznacza zera i nie blokuje zapisania poprawnego powiązania sprzętu z dokumentem. Podana kwota faktury zachowuje wartość przepisaną z dokumentu; pełną sumę pozycji prezentujemy tylko, gdy dane są kompletne. Rozbieżność wymaga czytelnego komunikatu i wyjaśnienia, np. dodatkowej pozycji/usługi lub innej podstawy kwoty. Kontrakt kwot i raporty obsługują null; grupy raportu wskazują niepełną wartość i liczbę urządzeń bez ceny. Ceny na istniejących kartach nie są automatycznie nadpisywane przez uzupełnienie dokumentu.

## 6. Numer seryjny łączy dokładną sztukę z pozycją

Przykład: pozycja „HP ProBook”, ilość 3, numery `HP-DEMO-001`, `HP-DEMO-002`, `HP-DEMO-003`.

1. Użytkownik wkleja numery, po jednym w wierszu. Opcjonalnie może wpisać je pojedynczo przez czytnik.
2. Aplikacja pokazuje podgląd dopasowania każdego numeru do bazy. Porównanie pomija otaczające spacje i wielkość liter, zachowuje zera i znaki wewnątrz numeru.
3. Numer znaleziony w bazie wskazuje konkretną istniejącą kartę; użytkownik widzi Asset ID i potwierdza powiązanie. Nie tworzymy drugiego laptopa.
4. Numer nieznany pozwala utworzyć nową kartę na podstawie danych pozycji i związać ją z tą pozycją.
5. Numer powtórzony w dokumencie, niezgodna liczba sztuk albo urządzenie już powiązane z inną pozycją/fakturą otrzymuje komunikat przy tej sztuce. Istniejącego powiązania nie nadpisujemy po cichu; jego korekta jest jawną operacją z historią.
6. Po zatwierdzeniu karta laptopa wskazuje **numer FV, konkretną pozycję i PDF**, a pozycja FV pokazuje listę swoich laptopów z numerami seryjnymi i linkami.

Można zarejestrować dokument przed uzupełnieniem wszystkich numerów, z widocznym statusem „do powiązania”. Późniejsze dopasowanie uzupełnia połączenie i historię; nie przyjmuje drugi raz już zarejestrowanego sprzętu. Powiązanie istniejącego urządzenia nie zmienia jego lokalizacji, odbiorcy, stanu ani dat zakupu bez osobnego świadomego działania.

Zapis dokumentu, pozycji, nowych kart, połączeń i ruchów przyjęcia jest atomowy i chroniony przed powtórzeniem. Walidacja konfliktów działa również na serwerze i przy równoczesnej pracy.

## Kolejność realizacji i punkty kontynuacji

| Etap | Rezultat do sprawdzenia | Stan |
| --- | --- | --- |
| A | Swobodne pola liczbowe w całym przepływie; zestaw regresji dla pustej wartości | Gotowe, również dla ilości ułamkowych |
| B | Słowniki kategorii/jednostek, migracja istniejących wartości, nowy formularz produktu | Gotowe, również policzony stan początkowy |
| C | Wspólne bezpieczne okna potomne i akcje utworzenia kontrahenta/produktu w podpowiedziach | Gotowe |
| D | Duży wspólny formularz i tabela pozycji, waluta, dane kwotowe oraz PDF | Gotowe |
| E | Dopasowanie numerów seryjnych, tworzenie nowych i powiązanie istniejących kart, odnośniki dwustronne | Gotowe |
| F | Testy całego zakupu, regresje magazynu/dostaw/faktur, mobilny widok i końcowy build | API, jednostkowe, build i UI: VERIFICATION.md |

A–E są wdrożone. Okna potomne zachowują formularz i PDF, a D/E korzystają ze wspólnego modelu pozycji. Częściowe przyjęcie zapisanej pozycji oraz uzupełnienie cen domykają późniejszą pracę z dokumentem. F potwierdzają testy i scenariusze w VERIFICATION.md.

Potrzebne nowe migracje dodajemy po obecnych, bez edycji zastosowanych plików. Najpierw izolowana baza `_test`, następnie kontrolowane zastosowanie w lokalnej bazie po kopii. Zachować stare faktury, ruchy, QR i zgodność dotychczasowych wywołań API lub zapewnić jawny adapter.

## Kryteria odbioru

- [x] Minimum `0` można wyczyścić i wpisać `15`; można zaznaczyć/wkleić inną wartość. To samo działa w ilości, stanie i korekcie.
- [x] Sam tekst nowej kategorii/jednostki nie przechodzi jako wybrana wartość. Administrator może dodać i edytować wpis; usunięcie używanego wpisu jest blokowane i zachowuje powiązania.
- [x] Nowy produkt z zadeklarowanym stanem początkowym ma jeden ruch z autorem; ponowienie nie powiela ilości.
- [x] Nowy kontrahent z wyszukiwania jest automatycznie wybrany; wcześniej wpisane dane faktury, wiersze i PDF przetrwały zapis oraz anulowanie okna potomnego.
- [x] Produkt dodany z pozycji wraca do tej pozycji. Ilość rośnie jeden raz dopiero po zatwierdzeniu przyjęcia.
- [x] Faktura z kilkunastoma pozycjami daje się wygodnie wprowadzić w tabeli i zapamiętuje kolejność.
- [x] Jedna pozycja z trzema HP ma trzy dokładne połączenia numer seryjny → Asset ID → pozycja → FV/PDF.
- [x] Dokument z jednym istniejącym i jednym nowym numerem tworzy tylko jedną nową kartę. Połączenie istniejącego sprzętu nie generuje drugiego przyjęcia.
- [x] Konflikt numeru seryjnego, ponowienie zapisu i przerwane żądanie nie zostawiają częściowo przyjętej dostawy.
- [x] Brak ceny jest widoczny jako brak; raporty nie przedstawiają niepełnej wartości jako kompletnej lub zerowej.
- [x] Regresje dokumentów, historii i QR oraz powrót do przefiltrowanej listy przechodzą po migracji na danych syntetycznych.
- [x] Odpowiednie role/API, jasny i ciemny motyw, klawiatura, stos okien i telefon sprawdzone na fikcyjnych danych.

Testowanie wyłącznie na danych syntetycznych. Firmowe faktury, ewidencja i pliki nie są otwierane ani przesyłane do modelu.

## Miejsca implementacji

- Formularze: `src/components/inventory.tsx`, `inventory-movement.tsx`, `invoice-composer.tsx`, `operations.tsx` oraz ilościowe pola importu.
- Wspólne komponenty: `src/components/pickers.tsx`, `ui.tsx`, formularz kontrahenta wydzielony z `dictionary-editor.tsx`; nowy edytor słowników magazynowych.
- Model i API: `src/shared/types.ts`, `src/server/validation.ts`, `services.ts`, moduł słowników i dopasowań pozycji, `src/app/api/[...path]/route.ts`.
- Nowe migracje, spójna historia/snapshot jednostki i nazwy pozycji, testy integracyjne oraz scenariusze UI. Przy ułamkach także import/eksport i wszystkie operacje arytmetyczne magazynu.
