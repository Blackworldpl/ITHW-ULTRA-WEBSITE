# IT Hardware

Wewnętrzny system IT HARDWARE ROBAKOWO do ewidencji urządzeń, gospodarki magazynowej, inwentaryzacji, zakupów, konfiguracji i serwisu. Korzysta z rzeczywistego PostgreSQL. Nowa baza startuje bez urządzeń, faktur i kont; migracje dodają wyłącznie schemat i słowniki.

Przebudowa industrialnego interfejsu i produktu: [raport wdrożenia i weryfikacji](docs/REDESIGN_UI.md).

## Uruchomienie lokalne w Windows

Wymagany Node.js 24 LTS. W tym środowisku zweryfikowany SHA256 pakiet przenośny Node.js 24.21.0 znajduje się poza projektem w `%USERPROFILE%\.codex\tmp\it-hardware-tools\node-v24.21.0-win-x64`. Skrypt rozpoznaje go automatycznie, jeśli Node.js nie jest na PATH.

```powershell
# Uruchom w katalogu it-hardware.
.\Start-Local.ps1
```

Opcjonalnie wskaż własną instalację: `.\Start-Local.ps1 -NodeDirectory 'C:\narzedzia\node'`. Skrypt instaluje brakujące zależności, uruchamia PostgreSQL, wykonuje migracje i uruchamia aplikację pod [http://localhost:3000](http://localhost:3000). Zakończ przez Ctrl+C. Dane bazy pozostają na dysku.

PostgreSQL nasłuchuje wyłącznie na `127.0.0.1:55432`. Dane domyślnie trafiają do `%LOCALAPPDATA%\IT-Hardware\postgres`, poza OneDrive. Możesz ustawić `LOCAL_PG_DATA` i `LOCAL_PG_PORT` przed uruchomieniem. Wbudowana baza służy do lokalnego rozwoju. Produkcja korzysta z odrębnego serwera PostgreSQL.

Przy pierwszym lokalnym starcie skrypt generuje losowe hasło bazy i losowy `SETUP_TOKEN` oraz zapisuje je do ignorowanego pliku `.env.local`. Otwórz [stronę inicjalizacji](http://localhost:3000/setup), podaj token z tego pliku i utwórz własne konto administratora. Hasło ma co najmniej 12 znaków. Usuń `SETUP_TOKEN` po inicjalizacji. Kolejne konta i role nadaje administrator w aplikacji. Alternatywnie uruchom `npm run admin:create` w interaktywnym terminalu; hasło nie pojawia się na ekranie.

Nie przesyłaj `.env.local` ani katalogu PostgreSQL do repozytorium lub współpracowników. Na Windows zabezpiecz pliki poświadczeń uprawnieniami swojego konta. Projekt znajduje się w OneDrive, więc rzeczywiste dane firmowe i sekrety trzymaj w zatwierdzonym środowisku poza synchronizowanym katalogiem; przy wdrożeniu podawaj sekrety przez środowisko procesu.

## Tymczasowy dostęp w LAN

W folderze projektu uruchom `.\Start-Local.ps1 -LanAddress <IPv4 laptopa>`. Skrypt ustawi adres aplikacji potrzebny do logowania i QR. Szczegóły oraz reguła zapory: [instrukcja LAN](docs/START_LAN.md).

## Własny PostgreSQL

Przygotuj pustą bazę PostgreSQL 18 i własnego użytkownika; wymagane rozszerzenia `pgcrypto` oraz `pg_trgm`. Skopiuj `.env.example` do `.env.local` i uzupełnij `DATABASE_URL`, kanoniczny `APP_URL` oraz losowy `SETUP_TOKEN` o długości minimum 32 znaków. URL musi poprawnie kodować znaki specjalne w haśle. Konto migracji może mieć osobny `MIGRATION_DATABASE_URL`.

```powershell
npm ci
npm run db:migrate
npm run dev
```

Polecenia używają bezpośrednio Node.js, dzięki czemu działają także w katalogach zawierających znak `&`. Nie uruchamiaj `db:local` przy konfiguracji zewnętrznego serwera: ten skrypt celowo odmawia nadpisania obcego `DATABASE_URL`.

## Funkcje systemu

- Logowanie, indywidualne konta i role VIEWER, IT_USER, IT_ADVANCED, ADMIN.
- Nowe konta z hasłem tymczasowym i domyślnym obowiązkiem ustawienia własnego hasła po pierwszym logowaniu; generator, reset administratora i zmiana z menu profilu. [Instrukcja kont i haseł](docs/USERS_AND_PASSWORDS.md).
- Dashboard ze stanami i ostatnią aktywnością z bazy.
- Własny wybór sekcji dashboardu dla każdego administratora, zapisywany na jego koncie.
- TV: kod pojawia się na ekranie i jest zatwierdzany przez administratora; osobne liczniki, filtry i pola zgłoszeń, układ, zegar i rotacja stron. Terminale zachowują wcześniejszą obsługę. Zarządzanie wyłącznie dla ADMIN: [instrukcja](docs/MANAGED_DEVICES.md).
- Moduł drzewa lokalizacji dostępny wyłącznie w administracji; operacyjny wybór istniejącej lokalizacji pozostaje w formularzach uprawnionych operatorów.
- Motyw jasny, ciemny lub zgodny z systemem; osobny motyw dla każdego zarządzanego ekranu.
- Assets: tworzenie, edycja, filtrowanie, wyszukiwanie i historia; dane zakupowe, sieciowe, lokalizacja, użytkownik oraz tag RFID.
- Magazyn: tabela lub kafelki, strony 25/50/100 produktów, wyszukiwanie wieloma słowami, filtry kategorii/lokalizacji/niedoborów, sortowanie i zapamiętane kolumny. Pobranie/zwrot bezpośrednio z listy, z podglądem stanu i historią; blokady transakcyjne chronią przed ujemnym stanem. [Instrukcja i weryfikacja dużego katalogu](docs/WAREHOUSE.md).
- Dostawy z pozycjami magazynowymi i urządzeniami, faktury oraz powiązanie sprzętu z dokumentem. Jedno zatwierdzenie zapisuje całość w transakcji.
- QR wskazujące konkretne urządzenie lub produkt i skanowanie kamerą. Etykiety można wydrukować z przeglądarki.
- Podstawowe zestawienia i eksport CSV; historia i audyt dostępne według uprawnień.
- Konfigurowalny bezpieczny link ServiceNow przez `SERVICENOW_URL`.
- Raporty kategorii, statusów, lokalizacji, gwarancji, zakupów i dostawców; podsumowanie wartości osobno według waluty, ranking pobrań z 90 dni i lista do uzupełnienia z eksportem CSV.
- Eksport przefiltrowanej ewidencji CSV, sortowanie, filtr środków trwałych i lokalizacja wraz z poziomami podrzędnymi.
- Szybkie akcje urządzenia: wydanie, zwrot, przeniesienie, status, RFID i notatka do historii.
- QR zachowuje kartę sprzętu lub produktu po logowaniu i po wygaśnięciu sesji.
- Samodzielna rejestracja FV, PDF dostępny na FV i kartach przypisanego sprzętu oraz przekazania między osobami z historią. IT_USER może wydać, przekazać i przyjąć zwrot; dane zakupu i RFID edytuje IT_ADVANCED lub ADMIN.
- Edycja produktów magazynowych bez zmiany QR i korekta faktycznie policzonego stanu z powodem, historią i kontrolą równoczesnych operacji.
- Skaner kodów rozpoznaje Asset ID, numery seryjne i środka trwałego, RFID oraz SKU. Globalna wyszukiwarka ma skróty `/` i Ctrl+K, obejmuje także lokalizacje.
- Odczyt QR z pliku na komputerze, pobieranie PNG, regulowany wydruk etykiet i eksport Zebra ZPL 300 DPI; finalny rozmiar etykiet i test drukarki po zamówieniu materiałów.
- Opcjonalne SKU/kod produktu dla sprzętu i magazynu oraz eksport historii tylko z wybranej karty.
- Wizualne, edytowalne drzewo lokalizacji z przenoszeniem gałęzi i ochroną powiązań.
- Opisy i własne pola kategorii (typy, wartości wymagane, listy wyboru) oraz rozbudowane dane kontrahentów widoczne przy FV.
- Baza pracowników, profile z urządzeniami i historią, przypisania według identyfikatora pracownika, konta powiązane z profilem oraz „Mój sprzęt”.
- Stanowiska/stoły jako lokalizacje DESK z własnym wyposażeniem. Zapisane karty osobiste, rozpiski stanowiska i obiegówki z numerami seryjnymi oraz miejscami na podpisy; wydruk i szkic wiadomości .eml. Sprzęt stanowiska nie jest automatycznie przypisywany pracownikowi.
- Sesje inwentaryzacji lokalizacji ze snapshotem oczekiwanego sprzętu, kolejką odczytów, brakami/nadmiarami/duplikatami i niezmiennym raportem końcowym z CSV.
- Biblioteka wersjonowanych konfiguracji: wyszukiwanie, historia, kopia, pobieranie i rejestracja zastosowania wersji na urządzeniu.
- Biblioteka dokumentów PDF/tekst i archiwum dokumentów wyposażenia, z kontrolowanym pobieraniem oraz backupem zawartości w PostgreSQL.
- Lokalne zgłoszenia IT ze statusami, priorytetem, operatorem, urządzeniem i historią. Link do ServiceNow pozostaje oddzielny od rejestru lokalnego.
- Profile granularnych uprawnień, macierz ról, ostatnie logowanie, jednorazowe zaproszenia i unieważnianie sesji przy zmianie dostępu.
- Operacje masowe do 100 urządzeń, zapisywane atomowo; wybór kolumn i widoki tabeli zapamiętywane dla użytkownika.
- Globalne wyszukiwanie z rankingiem, dopasowaniem częściowym/trigramowym i poleceniami; obejmuje też MAC/IP, konfiguracje, dokumenty, zgłoszenia i konta.

Administracja udostępnia swobodne drzewo lokalizacji z dodawaniem podfolderów bezpośrednio przyciskiem plus oraz ustawienia widoczności standardowych pól dla każdej kategorii sprzętu. Można wyłączyć cały blok sieci lub wybrane pola; zapis zachowuje ukryte wartości urządzenia. Formularze korzystają z wyszukiwanych podpowiedzi pracowników i faktur oraz drzewa wyboru lokalizacji. Szczegóły: [przepływ magazynu](docs/IT_HARDWARE_WORKFLOW.md).

Porównanie z drugim projektem i zakres przeniesionych pomysłów: [docs/REFERENCE_PROJECT_ANALYSIS.md](docs/REFERENCE_PROJECT_ANALYSIS.md).

Kamera telefonu wymaga HTTPS albo localhost oraz zgody użytkownika. Lokalny serwer jest domyślnie dostępny tylko na tym komputerze; do pracy z telefonu potrzebny jest zatwierdzony adres HTTPS w sieci firmowej. Ustaw `APP_URL` na ten adres przed generowaniem etykiet, aby QR wskazywały prawidłowy serwer.

## Weryfikacja

```powershell
npm run typecheck
npm test
npm run build
```

Testy integracyjne wymagają oddzielnej bazy zakończonej `_test`, z jawnie ustawionym `TEST_DATABASE_URL`. Konto testowe musi mieć CREATEDB i możliwość tworzenia rozszerzeń: testy inicjalizacji/migracji zakładają własne losowo nazwane bazy i usuwają wyłącznie je. Uruchamiaj je na odrębnym serwerze testowym lub lokalnym PostgreSQL, nigdy produkcyjnym. Testowe konta i urządzenia nie są tworzone w bazie aplikacji. Przy działającym lokalnym PostgreSQL przygotuj odrębną bazę:

```powershell
npm run db:test:prepare
# Runner automatycznie odczyta prywatny TEST_DATABASE_URL z .local/test.env.
npm run test:integration
```

Testy zapisują rozpoznawalne, unikalne fixture wyłącznie do bazy testowej; można je powtarzać. Nigdy nie kieruj testów do danych firmowych. Migracje są numerowane, transakcyjne, serializowane blokadą PostgreSQL i sprawdzane SHA256. Zastosowanych plików nie edytuj: dodaj kolejny plik w `migrations/`.

## Wdrożenie na własnym serwerze

Dołączono `Dockerfile` i `compose.yaml`. Kontenery aplikacji działają jako użytkownik bez uprawnień root. PostgreSQL ma trwały nazwany wolumin i nie udostępnia portu hostowi. Ruch aplikacji kieruj przez firmowy reverse proxy z HTTPS do `127.0.0.1:3000`. Produkcyjne sesje mają cookie Secure; zwykły HTTP nie zapewni działającego logowania produkcyjnego.

W prywatnym `.env.production` lub bezpośrednio w środowisku ustaw: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `MIGRATION_DATABASE_URL`, `DATABASE_URL`, `APP_URL` i początkowo `SETUP_TOKEN`. Nazwa hosta bazy wewnątrz Compose to `postgres`. `DATABASE_URL` powinien wskazywać odrębne konto aplikacji bez uprawnień superuser; `MIGRATION_DATABASE_URL` konto właściciela schematu. Nie dodawaj tego pliku do repozytorium ani obrazu.

```sh
docker compose --env-file .env.production up -d postgres
docker compose --env-file .env.production run --rm migrate
# Utwórz ograniczone konto aplikacji i przyznaj mu prawa opisane w docs/ARCHITECTURE.md.
docker compose --env-file .env.production up -d --build app
```

Przed pracą produkcyjną skonfiguruj backup, test odtworzenia, monitoring, kontrolę dostępu sieciowego i zatwierdzony adres HTTPS. Instalacja Docker i faktyczne wdrożenie wymagają docelowego serwera; konfiguracja kontenerów nie została tutaj uruchomiona, bo Docker nie jest zainstalowany.

## Dokumentacja i kolejne etapy

Model i decyzje: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). API: [docs/API.md](docs/API.md). Backup i odtworzenie: [docs/BACKUP.md](docs/BACKUP.md).

Kopia kodu projektu: [Blackworldpl/ITHW-ULTRA-WEBSITE](https://github.com/Blackworldpl/ITHW-ULTRA-WEBSITE). Repozytorium obejmuje źródła, zależności opisane w package-lock.json, migracje, testy, instrukcje i zrzuty z fikcyjnych testów. Lokalna konfiguracja, sekrety, baza oraz dane firmowe wymagają osobnej chronionej kopii.

Aktualny zakres i uprawnienia: [FV, sprzęt, pobrania przez QR i historia przekazań](docs/IT_HARDWARE_WORKFLOW.md). Ustalenia użytkownika zastępują wcześniejszą propozycję obiegu ERP; WZ/PZ nie są wymagane. Dalszy priorytet wdrożeniowy to dostęp zespołu z telefonów przez firmowy adres HTTPS.

[Lokalna analiza Excel/CSV i proponowana numeracja](docs/LOCAL_IMPORT.md): gotowy `Inspect-Inventory.ps1` profiluje pliki na komputerze użytkownika, poza OneDrive, bez API i bez wypisywania wartości wierszy. Narzędzie nie importuje jeszcze danych do aplikacji.

Gotowe moduły i dowody testów opisuje [raport przebudowy](docs/REDESIGN_UI.md). Dalsze rozszerzenia zależne od środowiska obejmują adapter konkretnego czytnika RFID, fizyczną drukarkę etykiet, ServiceNow API, Microsoft Entra ID i Power BI. Wbudowane sesje inwentaryzacji, wersjonowane konfiguracje, operacje masowe i biblioteka dokumentów są już dostępne. Poczta działa jako pobierany szkic .eml; aplikacja nie ma skonfigurowanego SMTP. Upload obsługuje PDF do 10 MB oraz tekst UTF-8 do 256 KiB; zdjęcia i XLSX jako eksport pozostają poza obecnym zakresem.

Do uzgodnienia przed wdrożeniem pozostają format dotychczasowych Asset ID, dane lokalizacji i dostawców, polityka przypisania do pracowników, retencja dokumentów, wymagania SSO oraz środowisko serwera. Każdy z tych elementów można podłączyć bez zastępowania rdzenia gospodarki sprzętowej.
