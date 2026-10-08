# Weryfikacja MVP — 06.10.2026

## Wykonane kontrole

| Kontrola | Wynik |
|---|---|
| Node.js 24.21.0 Windows x64 z nodejs.org | ZIP zweryfikowany SHA256 według oficjalnego SHASUMS256.txt |
| Instalacja npm i jawnie zatwierdzone skrypty esbuild/embedded-postgres | Zakończona poprawnie; wersje przypięte w package.json i package-lock.json |
| `npm run typecheck` | Poprawny pełny TypeScript bez błędów |
| `npm test` | 4/4: scrypt, porównywanie sekretów i bezpieczne rozwiązywanie QR |
| `npm run test:integration` | 11/11 na rzeczywistym PostgreSQL, bez pominiętych testów |
| `npm run build` | Poprawna kompilacja produkcyjna Next.js, TypeScript i generowanie wszystkich stron |
| Audyt zależności npm | Brak podatności wysokich i krytycznych w sprawdzonym drzewie |
| Pierwszy lokalny start i migracje `001_initial.sql`, `002_history_truncate_protection.sql` | Poprawne uruchomienie PostgreSQL wyłącznie na loopback; dane poza OneDrive; aktualny schemat |
| Ponowne wykonanie migracji | Idempotentne, bez ponownego stosowania schematu |
| Nieinteraktywny `admin:create` | Bezpiecznie odmawia pobrania hasła; nie tworzy konta |

Testy integracyjne sprawdzają autoryzację, CSRF/Origin, role, sesje, atomową dostawę z urządzeniami i fakturą, rollback błędnej dostawy, jednoczesne pobrania bez ujemnego stanu, idempotencję retry, konflikt wersji urządzenia, zachowanie niewymienionych pól edycji, niemodyfikowalną historię, wyszukiwanie faktur, QR, CSV i unieważnienie sesji po zmianie roli.

Oddzielny test inicjalizacji tworzy własną losowo nazwaną bazę: nieprawidłowy token zwraca 403, dwie równoległe poprawne próby tworzą dokładnie jednego administratora, kolejne inicjalizacje zwracają 409, a cookie pozwala pobrać własną sesję. Drugi test tworzy własną bazę migracji i weryfikuje blokadę dwóch procesów, kontrolę SHA256, wycofanie DDL po błędzie i zastosowanie naprawionej jeszcze niezatwierdzonej migracji. Te dwa testy usuwają wyłącznie utworzone przez siebie losowe bazy testowe.

Fixture podstawowego przepływu znajdują się wyłącznie w `ithardware_test`. Baza lokalnej aplikacji nie otrzymała demonstracyjnych kont, urządzeń ani faktur. Prywatne URL/hasła i token setup są w ignorowanych plikach, bez wartości w raporcie.

## Kontrola w przeglądarce

Interfejs zweryfikowano na oddzielnym serwerze `localhost:3001`, korzystającym wyłącznie z bazy testowej i oznaczonych danych syntetycznych:

- Logowanie rzeczywistym kontem testowym i wyświetlenie Dashboardu z PostgreSQL.
- Pobranie produktu przyciskiem −1: stan 1 → 0 oraz nowy ruch z użytkownikiem i końcowym stanem; zwrot +1: stan 0 → 1.
- Widok mobilny 390 × 844: czytelne ekrany, brak poziomego przepełnienia; zmierzona szerokość dokumentu 375 px przy oknie 390 px.
- Dodanie dostawcy przez ekran administratora.
- Globalne wyszukanie faktury i przejście do jej karty z dwoma powiązanymi urządzeniami.
- Przyjęcie dostawy z wieloma pozycjami: 2 jednostki produktu i 1 fizyczne urządzenie, faktura w EUR o wartości 125,62; karta urządzenia pokazała cenę 125,32 EUR, numer seryjny, lokalizację, fakturę, historię i QR.
- Wpisanie Asset ID na ekranie skanowania otworzyło prawidłową kartę urządzenia.

Widok przeglądarki po kontroli przywrócono. Nie utworzono danych testowych ani kont w lokalnej bazie aplikacji. Test przeglądarkowy był wykonywany na środowisku deweloperskim; nie potwierdza działania produkcyjnego reverse proxy i cookie Secure.

## Granice tych wyników

Docker nie jest zainstalowany na tym komputerze: `Dockerfile` i `compose.yaml` przygotowano, ale obrazu ani wdrożenia kontenerowego tutaj nie uruchomiono. Nie wykonywano odtworzenia backupu ani testu obciążenia na docelowym serwerze. Nie ma danych dostępowych do ServiceNow API, Entra ID lub czytnika RFID. Obsługa konkretnych urządzeń, drukarek oraz kamera rzeczywistego telefonu wymagają walidacji w środowisku firmy.

Powyższe testy API używają rzeczywistych handlerów HTTP NextRequest i PostgreSQL, lecz nie zastępują testu wdrożenia z HTTPS. Automatyczne odczytanie QR fizyczną kamerą i komunikacja RFID nie zostały sprawdzone na urządzeniu.

## Rozbudowa magazynu — 07.10.2026

Końcowa weryfikacja: 11/11 testów jednostkowych, 29/29 testów integracyjnych (łącznie 40, bez pominiętych), poprawna kompilacja produkcyjna i TypeScript. Migrację `006_warehouse_directory.sql` zastosowano w osobnej bazie testowej oraz lokalnej bazie aplikacji. Nie odczytywano prywatnych rekordów ani plików; wszystkie scenariusze funkcjonalne używały fikcyjnych danych `_test`.

Nowe testy obejmują opcjonalne SKU/kody produktu, skanowanie identyfikatorów, eksport pojedynczego przedmiotu, autoryzowane PNG/ZPL, wymiary 300 DPI i ochronę przed poleceniami drukarki w nazwie. Sprawdzono zapis danych kontrahenta na FV, typy i wymagalność pól kategorii, konflikty wersji oraz zachowanie ręcznych pól. Przekazania między profilami zachowują FV, poprzednie nazwy w historii i dokładne zestawienie aktualnego sprzętu. Konta pracowników powstają atomowo, bez haseł w audycie; dezaktywacja po oddaniu sprzętu wyłącza konto i sesje. Nieaktywny profil pozwala nadal edytować kontakt bez ponownego aktywowania konta.

Testy przeglądarkowe na `localhost:3001` i `_test` potwierdziły:

- Pobranie QR PNG, wybór tego pliku w skanerze i przejście do dokładnie tego urządzenia.
- Przeciągnięcie pomieszczenia na inny obiekt, zatwierdzenie i przeniesienie razem z pojemnikiem.
- Zapis stanowiska pracownika, wydanie urządzenia pracownikowi wybranemu z bazy oraz profil z przypisanym sprzętem, FV i historią.
- Edycję opcji listy w kategorii i ich wyświetlenie w formularzu urządzenia, z zachowanymi własnymi polami.
- Edycję rozbudowanych danych kontrahenta i ich wyświetlenie na FV.
- Brak błędów konsoli w sprawdzonym przebiegu.

Zrzuty przedstawiają wyłącznie dane testowe: [drzewo lokalizacji](screenshots/location-tree-test.jpg), [pracownik i sprzęt](screenshots/employee-equipment-test.jpg). Podgląd testowy i jego kartę zamknięto; localhost aplikacji pozostaje na porcie 3000.

Użytkownik potwierdził Zebra 300 DPI. Dokładne etykiety nie są jeszcze zamówione, więc rozmiar 60 × 50 mm jest roboczy i regulowany. Finalne dopasowanie, kalibrację, fizyczny druk i komunikację ze sprzętem odłożono do wyboru etykiet. Testy PNG/ZPL nie potwierdzają fizycznego wydruku ani kodowania RFID.

## Swobodne foldery i wyszukiwane formularze — 07.10.2026

Po zmianach: 12/12 testów jednostkowych oraz 31/31 integracyjnych, łącznie 43 bez pominiętych. Końcowa kompilacja produkcyjna i osobny TypeScript przechodzą. Migrację `007_flexible_forms.sql` zastosowano najpierw w `_test`, następnie w lokalnej bazie aplikacji; zmienia schemat bez odczytywania firmowej ewidencji.

API/PostgreSQL potwierdzają strefy w strefach, dzieci pojemników, domyślny typ FOLDER bez wyboru typu w body, dowolny typ w korzeniu i przenoszenie całej gałęzi. Zachowano blokady cykli, równoczesnych konfliktów i usuwania używanych folderów. Ustawienia standardowych pól są zapisywane i odczytywane w kategoriach; nieznane flagi są odrzucane, a brak uprawnień i stare wersje blokują zmianę. Edycja z ukrytymi polami zachowuje IP, MAC, hostname, FV, flagę i numer środka trwałego.

Kontrola przeglądarkowa używała wyłącznie produkcyjnego podglądu `localhost:3001` z syntetyczną bazą `_test`:

- Plus dodaje pole nazwy pod wskazanym folderem bez modalu; Enter zapisuje dziecko. Oznaczono INBOUND DEMO i jego dziecko jako strefy.
- Wyłączenie całego bloku Sieć dla testowej kategorii laptopa ukrywa formularz sieci. Przełączenie na Drukarkę pokazuje IP/MAC/hostname. Zapis laptopa zachował wcześniejszy adres IP.
- Wybrano podstrefę z przeszukiwanego drzewa, pracownika po nazwisku i istniejącą FV po numerze. Zmiana FV pokazuje właściwy numer; zapis powiązał urządzenie z profilem pracownika.
- Przekazanie używa tego samego wyszukiwania pracownika; karta i profil pokazują nowego odbiorcę, a historia obu. FV pozostaje przypisana.
- Enter po nazwie podstrefy wybiera podstrefę, zamiast jej widocznego przodka. Escape zamyka podpowiedzi, kolejny Escape zamyka modal. Nieistniejący numer FV bez wyboru dopasowania blokuje zapis formularza.
- Profil pracownika zapisuje lokalizację wybraną z drzewa. Nie stwierdzono błędów ani ostrzeżeń konsoli w tym przebiegu.

Podglądy zawierają wyłącznie dane testowe: [dodawanie folderu](screenshots/flexible-locations-test.jpg), [przełączniki pól kategorii](screenshots/category-field-switches-test.jpg), [wybór lokalizacji](screenshots/location-picker-test.jpg). Testowy serwer i kartę zamknięto po kontroli; aplikacja pozostaje pod `localhost:3000`.

## Industrialny redesign i przebudowa produktu — 07.10.2026

Końcowy wynik: **14/14 jednostkowych i 45/45 integracyjnych**, bez pominięć. Produkcyjny build Next.js 16.3.8 z TypeScript zakończony poprawnie po ostatnich zmianach; następnie uruchomiono ponownie localhost:3000. Migracje 009/010 zastosowane w testowej i lokalnej bazie, po wykonaniu spójnej kopii zatrzymanego klastra z manifestem SHA256. Bez odczytu firmowych rekordów.

Nowe testy API/PostgreSQL potwierdzają niezmienne wersje i bajty konfiguracji, scoped download, idempotentny upload PDF/tekst, archiwum dokumentów wyposażenia i wyszukanie numeru dokumentu, snapshot i zamrożony raport inwentaryzacji, skany równoczesne/retry/duplikat/nieznany, atomic bulk/rollback/stale version/no-op, historię gałęzi lokalizacji, lokalne zgłoszenia i liczniki, wyszukiwanie IP/MAC/fuzzy/QR/kont, ograniczenia custom profiles także w polach zapisu i powiązanych ekranach, unieważnianie sesji, jednorazowe/wygaśnięte zaproszenia oraz wersjonowane ustawienia HTTPS.

UI w odizolowanej bazie _test (proxy rzeczywistych handlerów API, frontend istniejącego projektu):
- Wyszukiwanie IP przez Ctrl+K, strzałki i Enter otworzyło właściwy paszport.
- Zapisano dwie wersje konfiguracji, wybrano starszą, skopiowano i pobrano jej treść.
- Sesja inwentaryzacji: 4 oczekiwane urządzenia, 6 skanów, 4 odczytane, 0 brakujących, 1 duplikat i 1 nieznany; zamknięto i wyświetlono zamrożony raport.
- Natywny pointer drag przeniósł folder z Warehouse A do B przy DPR 1,5; po końcowej optymalizacji sprawdzono też blokadę cyklu i przeniesienie podfolderu na poziom główny.
- Sortowanie numeru seryjnego w obu kierunkach, zapis widoku oraz masowe przeniesienie dwóch monitorów na stanowisko 308A bez osobistego przypisania.
- Zapisana rozpiska stanowiska zawiera dwa numery seryjne i podpisy; podgląd w archiwum dokumentów działa.
- FV z pozycjami 3 × 12,34 oraz 2 × 5,50 została zapisana z sumą 48,02 PLN.
- Utworzono lokalne krytyczne zgłoszenie i potwierdzono licznik dashboardu.
- Skaner ciągły zachował 3 odczyty i 2 unikalne rekordy. QR z pobranego fikcyjnego PNG otworzył bezpośrednio właściwy paszport.
- Końcowe menu urządzenia kopiuje Asset ID do schowka i otwiera sekcję historii. Komunikat skanera ciągłego potwierdza zapis i gotowość kolejnego odczytu.
- Dashboard w szerokościach 2560/1920/1366/768/390 bez przepełnienia dokumentu. Na mobile sprawdzono również faktury, konfiguracje, lokalizacje, macierz permissions i inwentaryzację. Menu mobilne jest osobnym dialogiem.

Podczas testu starszy bundle dev powodował błąd widoku po skanie. Po świeżym buildzie/restartcie i reloadzie seria sześciu skanów oraz raport działały poprawnie. Oddzielny błąd PostgreSQL UUID/text w szczegółach lokalizacji naprawiono i objęto testem.

Benchmark 10 000 fikcyjnych rekordów, 12 próbek: p95 exact Asset ID 78 ms, częściowy serial 126 ms, wspólny model 120 ms, literówka 149 ms, tabela 25 rekordów 29 ms. Test mierzy funkcje serwera i DB, bez sieci/uwierzytelnienia/przeglądarki i współbieżnego obciążenia. Fixture benchmarku usunięto wyłącznie z testowej bazy. Wyniki: [PERFORMANCE_RESULTS.json](PERFORMANCE_RESULTS.json).

Fizyczna kamera/czytnik/druk, klient poczty .eml, ServiceNow SSO, backup restore i produkcyjne HTTPS wymagają sprawdzenia na docelowym sprzęcie. Lokalny ServiceNow to link, incydenty są lokalne, nie ma SMTP ani adaptera konkretnego czytnika. Szczegółowy raport i zrzuty na fikcyjnych danych: [REDESIGN_UI.md](REDESIGN_UI.md).

## TV, terminale, jasny motyw i dashboard administratora — 07.10.2026

51/51 testów integracyjnych i 14/14 jednostkowych, bez pominięć. Nowe testy obejmują ograniczenie zarządzania urządzeniami i ustawień dashboardu do ADMIN, jednorazowe/wygaśnięte kody, zastąpienie i odwołanie poświadczeń, izolację cookie od sesji użytkownika, filtr lokalizacji i ograniczony payload, tryby terminala, CSRF/Origin, wersję konfiguracji przy odczycie, retry inwentaryzacji oraz osobne preferencje administratorów i konflikty wersji.

Przeglądarkowa kontrola na danych wyłącznie `_test` potwierdziła:

- Parowanie indywidualnego linku TV, statystyki i otwarte zgłoszenia w jasnym motywie.
- Zdalną zmianę komunikatu, trybu i motywu TV przy automatycznym odpytywaniu, bez ręcznego reloadu ekranu.
- Dodanie i parowanie terminala, odczyt fikcyjnego RFID oraz zdalne przełączenie na odczyty ciągłe.
- Mobilny układ terminala bez przepełnienia dokumentu; pole odczytu mieści się w ekranie.
- Zapis wybranych sekcji osobnego dashboardu i zachowanie wyboru po przeładowaniu.

Naprawiono klienta HTTP, aby brak parowania urządzenia (401) pokazywał formularz kodu zamiast przekierowania do logowania użytkownika. Wysoki komunikat TV i szerokość pola terminala dopracowane po kontroli UI. Końcowy produkcyjny build z TypeScript zakończony poprawnie. Migracja 011 zastosowana w bazie lokalnej i testowej po kopii nieruchomego klastra. Lokalna aplikacja nadal na 127.0.0.1:3000; środowisko testowe jest zamykane po kontroli.

Fizyczny TV/terminal, jego czytnik/aparat i kiosk oraz firmowy adres HTTPS wymagają próby na docelowym sprzęcie. Szczegółowy zakres i zrzuty z fikcyjnych danych: [MANAGED_DEVICES.md](MANAGED_DEVICES.md).

## Rozbudowa TV i administracja lokalizacji — 07.10.2026

53/53 integracyjnych, 14/14 jednostkowych i końcowy build Next.js/TypeScript poprawne. Nowe przypadki potwierdzają kierunek TV → kod → zatwierdzenie przez ADMIN, odrębne poświadczenie przeglądarki oczekującej, wygaśnięcie i jednorazowość, brak autoryzacji API użytkownika, zakres kategorii/gałęzi i filtrów zgłoszeń, wybrane liczniki, pominięcie niewybranych pól oraz odmowę modułu lokalizacji dla VIEWER/IT_ADVANCED. Dotychczasowe terminale przechodzą te same testy odczytu/inwentaryzacji/odwołania.

W UI wyłącznie _test potwierdzono samoczynny start po zatwierdzeniu kodu z TV, filtrowany dashboard i automatyczne strony, zdalną zmianę kolejności sekcji/liczników, tekstu i zegara. IT_ADVANCED nie ma Lokalizacji w menu i otrzymuje odmowę przy bezpośrednim wejściu na /locations. W konsoli testowego TV brak błędów i ostrzeżeń. Przejściowy timeout automatycznej kontroli dostępu przeglądarki ustąpił przy dozwolonym ponowieniu. Błąd tabeli filtra kategorii naprawiono przed końcowym przebiegiem testów. Pomocnicze proxy testowe poprawiono tak, by przekazywało oddzielne Set-Cookie, jak serwer Next.js.

Migracja 012 zastosowana po spójnej kopii i porównaniu SHA256 nieruchomego klastra. Dane firmowe nie były odczytywane. Szczegóły nowego przepływu i zrzuty: [MANAGED_DEVICES.md](MANAGED_DEVICES.md).

## Usuwanie dashboardów — 07.10.2026

10/10 testów z `tests/devices.integration.ts`, TypeScript i produkcyjny build poprawne. Dodane przypadki obejmują usuwanie sparowanego TV i wyłączonego terminala, ADMIN + device.manage, odrzucenie nieprawidłowego CSRF/Origin i wersji, unieważnienie cookie/linku/kodów, zachowanie sprzętu i wcześniejszego audytu oraz przypisanie operacji administratorowi.

UI sprawdzono wyłącznie przez proxy do `_test`: przycisk i nazwa w potwierdzeniu, domyślny fokus na Anuluj, skuteczne anulowanie, automatyczne zniknięcie z listy oraz „Ekran niedostępny” pod starym linkiem. Usunięto tylko dokładnie wskazaną fikcyjną próbkę przez lokalny helper testowy; żadnych dashboardów ani danych firmowych nie usuwano. Konsola testowego panelu bez błędów i ostrzeżeń. Zmiana nie wymaga nowej migracji. [Podgląd potwierdzenia](screenshots/tv-custom/delete-dashboard.jpg).

## Duży katalog magazynu — 07.10.2026

62/62 integracyjnych i końcowy build Next.js/TypeScript poprawne. Nowa suita magazynu potwierdza ograniczone strony i stabilne sortowanie, podsumowania poza filtrem stanu, dokładne kombinacje kategorii/lokalizacji/gałęzi/braku lokalizacji, podpowiedzi, słowa w różnej kolejności i wyszukiwanie bez polskich znaków. Waliduje parametry i dosłowne znaki %/_, odmawia dostępu bez inventory.view, sprawdza audyt i idempotencję pobrania/zwrotu oraz brak zmiany stanu po próbie nadmiernego pobrania.

UI wyłącznie na fikcyjnych danych przez proxy do `_test`: strony 50/100 i przejście dalej, tabela/kafelki, oba motywy, zapis układu po reloadzie, filtry kategorii/zerowego stanu/niedoborów, wyszukiwanie oraz powrót z karty z zachowanymi filtrami. Pobranie 2 szt. zmieniło stan 3 → 1; zwrot 2 szt. przywrócił 3. Próba pobrania 4 szt. przy stanie 3 blokuje przycisk. Telefon 390 × 844: tabela z podpisami pól i formularz ilości bez poziomego przepełnienia.

Benchmark 12 000 fikcyjnych produktów (12 próbek): p95 strona 50 + liczniki 11 ms, wielosłowne wyszukiwanie 429 ms, sortowanie stanu 100 produktów 10 ms, niedobory 7 ms, strona 200 14 ms, podpowiedzi 31 ms. Pomiar tylko funkcji serwera/DB, bez sieci, uwierzytelnienia, renderowania i równoczesnego obciążenia. Fixture benchmarku usunięto wyłącznie z `_test`. Brak nowej migracji; nie odczytywano ani nie zmieniano firmowej ewidencji.

Instrukcja, ograniczenia pomiaru i zrzuty: [WAREHOUSE.md](WAREHOUSE.md). Wyniki: [WAREHOUSE_PERFORMANCE.json](WAREHOUSE_PERFORMANCE.json).

## Formularz produktu, listy i ilości — 08.10.2026

Końcowy wynik po wszystkich zmianach źródłowych: **68/68 testów integracyjnych, 15/15 jednostkowych oraz poprawny produkcyjny build Next.js z TypeScript**, bez pominiętych testów. Nowa suita sprawdza ADMIN/settings.manage, CSRF/Origin, odczyt dla inventory.view, konflikty wersji i nazw, aktywność, ochronę używanych wpisów, zachowanie ID/slug/QR po zmianie nazwy kategorii, audyt oraz wyścig tworzenia produktu z usunięciem wpisu. API odrzuca nieznane wybory także przy imporcie. Zmiana jednostki jest blokowana przy historii ruchów i powiązaniu pozycji FV, również gdy zapas wynosi zero. Regresje dostaw, faktur, importu, urządzeń, stanowisk i zarządzanych ekranów przechodzą.

Testy jednostkowe ilości obejmują pusty tekst, białe znaki, zero przy dozwolonym minimum, cyfry z wiodącym zerem, ułamki, ujemne wartości, zapis naukowy i granice zakresu. Formularze przechowują tekst podczas wpisywania, a konwersja następuje przy walidacji. Podgląd dostawy używa wspólnego mechanizmu dokładnych kwot.

UI sprawdzone przez CUA i proxy `127.0.0.1:3002`, kierujące całe `/api` wyłącznie do `_test`:

- Wyczyszczono minimum `0`, wpisano `15` i zapisano fikcyjny przewód z kategorii „Kable i przewody” z jednostką `m`; karta potwierdziła minimum 15 i stan 0.
- Pusta ilość na karcie blokowała zwrot. W formularzach faktury i dostawy pole ilości pozostało puste po wyczyszczeniu; wpisanie `25` i ceny `1,99` pokazało `49,75 zł`. Oba dokumenty anulowano bez zapisu.
- Administrator dodał testową jednostkę, zmienił jej pełną nazwę i zobaczył ją na liście oraz w formularzu produktu. Usunięcia nie wykonywano w UI; API przetestowano na fikcyjnych rekordach.
- Formularz sprawdzono w jasnym i ciemnym motywie. Telefon 390 × 844 miał szerokość dokumentu 390 px, czytelne pola i dostępne akcje zapisu. Zrzuty: [formularz](screenshots/warehouse/product-form.jpg), [ciemny](screenshots/warehouse/product-form-dark.jpg), [telefon](screenshots/warehouse/product-form-mobile.jpg).

Migrację `013_inventory_dictionaries.sql` zastosowano najpierw w `_test`, następnie lokalnie po spójnej kopii zatrzymanego klastra. Manifest rozmiarów/SHA256 sprawdzono przed ponownym uruchomieniem PostgreSQL. Kopia: `%LOCALAPPDATA%/IT-Hardware/backups/pre-inventory-dictionaries-20261008-001530`. Migracja zachowuje dokładne istniejące nazwy; firmowych rekordów ani plików nie odczytywano i nie przedstawiano modelowi. Karta testowa została zamknięta, a tymczasowy rozmiar przeglądarki zresetowany.

To weryfikacja etapów A i podstawowego B. Duża tabela faktury, okna kontrahenta/produktu nad dokumentem, dopasowanie numerów seryjnych, stan początkowy w oknie tworzenia i ceny opcjonalne pozostają do wdrożenia. Ilości są nadal całkowite; ułamki wymagają osobnego ustalenia i migracji. Stan kontynuacji: [PURCHASE_ENTRY_PLAN.md](PURCHASE_ENTRY_PLAN.md).

## Domknięcie wprowadzania zakupów — 08.10.2026

**77/77 integracyjnych, 16/16 jednostkowych oraz produkcyjny build Next.js z TypeScript poprawne**, bez pominięć. Wszystkie dane w testach są fikcyjne w osobnej bazie `_test`. Suity wykonują się kolejno, bo część starszych regresji sprawdza globalne sumy raportów; scenariusze równoczesnych operacji w każdej suicie nadal działają równolegle.

Nowa suita zakupów potwierdza jeden ruch policzonego stanu przy równoczesnym ponowieniu, wymagany dostęp/CSRF, jawne świeże dopasowanie istniejącego SN, rollback bez potwierdzenia, zachowanie kolejności/nazwy/jednostki, brak nadpisania odbiorcy/lokalizacji/stanu/daty/ceny starego urządzenia, tylko jedną nową kartę i właściwe przyjęcie mieszanego zakupu. Raporty rozróżniają brak ceny i znaną wartość. Dokument oczekujący można uzupełniać partiami po numerach; liczba połączeń nie przekracza pozycji. Konflikt dwóch faktur z tym samym SN pozostawia jedną kartę i jeden dokument. Waluta wcześniejszej ceny jest chroniona.

Uzupełnienie cen przyjętego dokumentu zachowuje ID pozycji, urządzenia, ruchy i wcześniejsze ceny kart. Stale version, pozycja obcej faktury i rozbieżna kompletna suma są odrzucane. Częściowe przyjęcia produktów ogranicza pozostała ilość dokumentu; retry nie nalicza zapasu ponownie. Starszy endpoint dostaw zachowuje kolejność wprowadzania i jednostkę produktu. Regresje PDF, QR, inwentaryzacji, ekranów, uprawnień i raportów przechodzą.

CUA przez `127.0.0.1:3002` kierujące całe API do `_test`:

- Dodanie kontrahenta z końca podpowiedzi przeniosło nazwę i dane adresowe do pełnego okna, po zapisie wybrało go w dokumencie. Escape zamyka tylko najwyższe okno, zachowując numer i wiersze.
- Nowy produkt z jednostką `m` i kategorią „Kable i przewody” wrócił do tego samego wiersza. Zachowano osobną nazwę z faktury. Ilość 25 i cena `1,99` dały dokładnie `49,75 zł`.
- Dwa nieznane SN pokazano jako nowe. Zapis z przyjęciem utworzył dokładnie dwa urządzenia, połączył je z pozycją 2 i przyjął 25 m produktu. Załączony fikcyjny PDF przetrwał dodatkowe okno kontrahenta i znalazł się na karcie faktury.
- Cena urządzeń mogła być pusta; suma była „—”. Późniejsze wpisanie `10,00` w edycji dało `69,75 zł`, z zachowanymi dwoma połączeniami i liczbą przyjęcia 27. Częściowo wpisany przecinek nie powodował błędu renderowania.
- Wyszukiwanie po Asset ID zwróciło właściwą kartę i SN; podgląd rozpoznał już powiązane numery. Sprawdzono jasny/ciemny motyw i układ 390 × 844; dokument nie przekracza 390 px. Ilość można wyczyścić do pustego pola, a następnie wpisać 25.
- Drugi dokument produktu zapisano bez przyjęcia. Później przyjęto 2 z 5 m, a następnie pozostałe 3 m. Karta FV pokazała 5 z 5 i usunęła akcję przyjęcia; przejście odnośnikiem do produktu potwierdziło stan 30 m i trzy ruchy: +25, +2, +3.

Zrzuty: [jasny formularz](screenshots/purchases/invoice-light.jpg), [ciemny formularz](screenshots/purchases/invoice-dark.jpg), [telefon](screenshots/purchases/invoice-mobile.jpg), [okno kontrahenta](screenshots/purchases/supplier-popup.jpg), [przyjęta faktura](screenshots/purchases/invoice-received.jpg), [uzupełnienie cen](screenshots/purchases/price-completion.jpg), [dopasowanie numerów](screenshots/purchases/serial-match.jpg), [częściowe przyjęcie](screenshots/purchases/partial-receipt.jpg).

Migracja `014_purchase_entry.sql` najpierw przeszła w `_test`, następnie w lokalnej aplikacji po kopii zatrzymanego klastra z weryfikacją rozmiarów/SHA256: `%LOCALAPPDATA%/IT-Hardware/backups/pre-purchase-entry-20261008-085513`. Nowe pola są dodane bez zmiany wcześniejszych migracji. Starsze faktury nie miały zapisanej kolejności pozycji; migracja nadaje deterministyczne numery według nazwy/ID. Firmowych rekordów i plików nie odczytywano do modelu. Publiczne logowanie `127.0.0.1:3000/login` zwraca HTTP 200.

Etapy A–F są opisane w [PURCHASE_ENTRY_PLAN.md](PURCHASE_ENTRY_PLAN.md). Ilości pozostają całkowite; ewentualne ułamki wymagają osobnego ustalenia i migracji wszystkich stanów/ruchów. Ceny dokumentu nie nadpisują automatycznie cen zakupowych urządzeń. PDF zapisuje się osobno po atomowej operacji zakupu, z bezpiecznym ponowieniem samego załącznika.

Końcowa konsola CUA bez błędów i ostrzeżeń. Szkic do ilustracji anulowano, kartę testową zamknięto i zresetowano tymczasowy rozmiar przeglądarki. Proxy `_test` zatrzymano; lokalna aplikacja i PostgreSQL pozostały uruchomione.

## Dalsze poprawki formularzy — 08.10.2026

Zmiany dotyczą interfejsu i instrukcji; schemat bazy oraz API zakupów pozostają te same. W tej kontynuacji przeszło 16/16 istniejących testów jednostkowych. Końcowy build Next.js wraz z TypeScript zakończył się powodzeniem. Poprzedni zestaw 77 testów integracyjnych jest opisany powyżej; nie uruchamiano go ponownie dla tych zmian interfejsu.

CUA, wyłącznie fikcyjne rekordy przez proxy `_test`:

- Alt+N z wiersza usługi dodało następny wiersz tego samego rodzaju i ustawiło fokus w jego nazwie. Dodanie przyciskiem ma ten sam fokus. Przeniesienie wiersza zachowało nazwę, ilość i cenę; przy pierwszym/ostatnim wierszu właściwa strzałka jest wyłączona.
- Zapisano 15 pozycji dokumentu `PRZYKLAD-UX-0810`, w kolejności B, A, 3…15, z sumą 28,97 PLN i fikcyjnym PDF. Karta po zapisie pokazała tę samą kolejność, ilości oraz załącznik.
- Anulowanie zmienionego formularza pokazało potwierdzenie; powrót zachował nagłówek, wiersze i wybrany PDF, który następnie poprawnie zapisano. Niezmieniony edytor zamknął się bez potwierdzenia. Zmianę kolejności w mobilnej edycji odrzucono, zachowując zapisany dokument.
- Kontrahenta można utworzyć przez strzałkę/Enter z końca listy. Przy produkcie Enter podczas oczekiwania zachował otwarte podpowiedzi „Szukanie…”, bez akcji tworzenia przed odpowiedzią. Po zakończeniu wyszukiwania strzałka/Enter otworzyły nowe okno z przeniesioną nazwą; po pobraniu słowników fokus trafił do nazwy produktu. Anulowano tę kartotekę, bez utworzenia produktu.
- Escape zamknął kolejno okno produktu, podpowiedzi rodzica i dopiero potem pokazał potwierdzenie opuszczenia faktury. Fokus w potwierdzeniu był na „Wróć do faktury”. Kontrole wyłączone przez fieldset nie trafiają do pułapki Tab.
- Symulowano jeden HTTP 503 list `/api/lookups`, używając `REVIEW_LOOKUP_FAILURES=1` w lokalnym proxy. Formularz pokazał błąd, wyłączył wybór kontrahenta oraz zapis i pozwolił ponowić pobranie. „Spróbuj ponownie” przywróciło listy, zachowało wpisany numer/nazwę i nie wysłało POST faktury (log kontrolny `REVIEW_LOG_PURCHASES=1`). Szkicu awarii nie zapisano. Test 503 jest celowy; wcześniejsza kontrola konsoli obu motywów nie wykazała błędów/ostrzeżeń aplikacji.
- Widok 390 × 844: szerokość dokumentu 390 px, okna 375 px, bez poziomego przepełnienia; przenoszenie wiersza i potwierdzenie działają. Jasny i ciemny motyw sprawdzone.

Zrzuty: [kolejność pozycji — jasny](screenshots/purchases/entry-order.png), [ciemny](screenshots/purchases/entry-order-dark.png), [telefon](screenshots/purchases/entry-order-mobile.png), [ochrona niezapisanych danych](screenshots/purchases/draft-protection.png). Karta CUA została zamknięta, rozmiar przeglądarki przywrócony i proxy testowe zatrzymane. Lokalna aplikacja pozostaje uruchomiona; publiczne `/login` na porcie 3000 ponownie zwróciło HTTP 200. Firmowa ewidencja i pliki nie były odczytywane. Ilości ułamkowe były otwarte na tym etapie; wdrożenie migracji 015 opisano w kolejnym wpisie poniżej.


## Ilości ułamkowe, terminale i DPI — 08.10.2026

Wdrożono migrację 015 po kopii i porównaniu SHA256 zatrzymanego klastra ([BACKUP.md](BACKUP.md)). Migracja działa w bazie lokalnej i `_test`; nie odczytywano ewidencji firmowej. Starsze uwagi powyżej o całkowitych ilościach opisują stan wcześniejszych etapów.

- Pełny zestaw po zmianach ilości i terminali: **85/85 integracyjnych**, bez pominiętych testów. Obejmuje dokładne obliczenia, precyzję jednostek, stan początkowy, minimum, równoczesne pobrania, korektę i retry, częściowe przyjęcia, historyczną precyzję FV, import, raporty oraz pomijanie pól/liczników terminala i uprawnienia.
- Po dodaniu wyboru DPI: **19/19 jednostkowych** i ponownie **29/29** testów w `workflows.integration.ts`, w tym API 203/300/600 DPI, odrzucenie 1200 DPI, QR/PNG, uwierzytelnienie i regresje magazynu.
- Końcowy build Next.js z TypeScript przeszedł. Pierwsze ponowienie końcowego builda napotkało EPERM na chwilowo blokowanym pliku OneDrive; kolejna próba zakończyła się powodzeniem bez usuwania danych lub zmiany konfiguracji aplikacji.

Kontrola przeglądarki odbywała się wyłącznie przez proxy do `_test`, na fikcyjnych rekordach:

1. Produkt w `m`: stan początkowy `2,5`, minimum `0,125`; wyczyszczenie pola i wpis z przecinkiem działały.
2. Pobranie `0,1` pokazało dokładnie `2,4 m`.
3. FV `0,3 m × 1,99 zł` pokazała `0,60 zł`. Dokument zapisano bez przyjęcia. Przyjęcie `0,1 m` pozostawiło `0,2 m`; drugie przyjęcie zakończyło pozycję `0,3 z 0,3 m`, bez kolejnej akcji przyjęcia. Produkt osiągnął `2,7 m`; historia zachowuje oddzielne ruchy.
4. Administrator utworzył terminal, wybrał pola, duży tekst, brak aparatu i kodu oraz historię pięciu odczytów. Po parowaniu odczyt produktu pokazał `2,7 m` i minimum `0,125 m`.
5. Zdalna zmiana motywu, podpowiedzi i ukrycie minimum dotarły automatycznie bez ponownego parowania. Poprzednie wyniki zniknęły; kolejny wynik zawierał tylko wybrane pola.
6. Sześć odczytów ograniczyło podgląd do pięciu. „Wyczyść podgląd” usunęło wynik i listę z ekranu. W widoku 390 × 844 brak poziomego przepełnienia. Konsola terminala bez błędów i ostrzeżeń; panel miał wyłącznie powiadomienia Fast Refresh związane z edycją kodu.
7. Wybór 600 DPI w karcie produktu utworzył link ZPL z `dpi=600` i wybranymi wymiarami. Nie wysłano zadania drukowania.

Dowody: [FV ułamkowa](screenshots/fractions-terminal/invoice-fractions.png), [terminal jasny](screenshots/fractions-terminal/terminal-light.png), [terminal mobilny ciemny](screenshots/fractions-terminal/terminal-mobile-dark.png), [produkt i DPI](screenshots/fractions-terminal/product-label-600dpi.png).

Pliki kalibracyjne zawierają wyłącznie fikcyjne dane i nie są etykietami produkcyjnych rekordów. Fizyczny wydruk, czytnik, TV i firmowy HTTPS wymagają próby na docelowym sprzęcie: [HARDWARE_ACCEPTANCE.md](HARDWARE_ACCEPTANCE.md).

Po kontroli zamknięto karty CUA, przywrócono rozmiar przeglądarki i zatrzymano proxy 3002. Normalne `/login` na 3000 zwróciło HTTP 200; PostgreSQL na 55432 pozostał uruchomiony.

## Konta i pierwsze logowanie — 08.10.2026

Migrację 016 zastosowano w bazie lokalnej i `_test` po kopii zatrzymanego klastra z weryfikacją SHA256 ([BACKUP.md](BACKUP.md)). Istniejące konta zachowują dotychczasowe zachowanie; nowe konta domyślnie wymagają ustawienia własnego hasła. Instrukcja: [USERS_AND_PASSWORDS.md](USERS_AND_PASSWORDS.md).

- **22/22 testów jednostkowych**; **91/91 testów integracyjnych**, bez pominiętych. Build Next.js z TypeScript przeszedł.
- Nowy zestaw pierwszego logowania obejmuje wszystkie role, ograniczenie uprawnień przed zmianą, blokadę chronionych odczytów/zapisów, CSRF/Origin, walidację hasła i potwierdzenia, reset administratora, zmianę dobrowolną oraz zaproszenia.
- Zmiana hasła atomowo unieważnia wszystkie sesje. Sprawdzono konkurencyjne zapisy i odrzucenie sesji wystawianej dla nieaktualnej wersji hasła. Hasła ani ich hashe nie trafiają do dziennika audytu.

Kontrola CUA korzystała wyłącznie z fikcyjnych rekordów przez proxy `_test` na porcie 3002 i tymczasowy serwer interfejsu 3100. Sprawdzono dodanie konta, generator, zasłonięte dane do przekazania, status oczekiwania i przekierowanie po logowaniu tymczasowym. Bezpośrednie wejście na `/inventory` wróciło do obowiązkowej zmiany. Oba motywy i widok 390 × 844 bez poziomego przepełnienia; konsola aplikacji bez błędów i ostrzeżeń.

Właściwy zapis nowego hasła fikcyjnego konta wykonano przez izolowany test API. Przeglądarka potwierdziła następnie wygaśnięcie poprzedniej sesji, logowanie nowym hasłem, powrót do magazynu oraz opcję **Zmień hasło** w menu profilu. W formularzu dobrowolnej zmiany widoczne były dotychczasowe hasło i powrót do systemu. Nie wpisywano ani nie wysyłano nowego hasła przez formularz CUA.

Dowody: [pierwsze logowanie](screenshots/first-login/required-change-full.png), [telefon — jasny](screenshots/first-login/required-change-mobile.png), [telefon — ciemny](screenshots/first-login/required-change-mobile-dark.png), [przekazanie konta](screenshots/first-login/account-handoff.png), [status oczekiwania](screenshots/first-login/pending-account.png), [zmiana z profilu](screenshots/first-login/voluntary-change.png).

Kontrola korzystała z tymczasowego serwera, ponieważ podczas tego etapu główny proces aplikacji zmienił adres nasłuchiwania niezależnie od implementacji haseł. Nie zmieniano jego konfiguracji. Nie potwierdzono działania głównego `/login` na localhost:3000 w tej kontroli.
