# Backup i odtworzenie

Właściciel infrastruktury odpowiada za harmonogram, przechowywanie kopii i test odtworzenia. Nazwany wolumin Docker i katalog lokalnego PostgreSQL zapewniają trwałość między restartami, ale nie zastępują backupu.

## Zakres i proponowane parametry

- PostgreSQL: urządzenia, stany, dokumenty zakupu wraz z binarnymi PDF w `attachments.content`, użytkownicy, historia, audyt i wersja schematu. Obecne PDF do FV wchodzą do zwykłego dumpu bazy; nie wymagają osobnej kopii katalogu.
- W tej samej bazie: ogólne dokumenty PDF/tekst, treść wersji konfiguracji, zapisane karty wyposażenia/obiegówki i końcowe raporty inwentaryzacji. Zawierają się w backupie PostgreSQL.
- Konfiguracja wdrożenia i sekrety: oddzielna zaszyfrowana kopia w firmowym magazynie sekretów; ograniczony dostęp i rotacja po incydencie.

Początkowo codzienny pełny dump, retencja 14 kopii dziennych i 12 miesięcznych, szyfrowana kopia w drugim miejscu oraz comiesięczny test odtworzenia. Proponowany RPO to 24 h; uzgodnij go z właścicielem procesu. Jeśli utrata jednego dnia jest niedopuszczalna, dodaj regularne kopie bazowe i archiwizację WAL/PITR. RTO wymaga pomiaru na docelowym serwerze i rzeczywistym wolumenie danych.

## Kopia PostgreSQL w Compose

Uruchom na serwerze, gdzie znajduje się wdrożenie. Poniższe polecenia nie przekazują hasła w argumentach i używają użytkownika administracyjnego wewnątrz kontenera:

```sh
docker compose --env-file .env.production exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl --file=/tmp/ithardware.dump'
docker compose --env-file .env.production cp postgres:/tmp/ithardware.dump ./backups/ithardware-YYYY-MM-DD.dump
```

Najpierw utwórz własny katalog `backups` z ograniczonymi prawami. Zastąp datę rzeczywistą, nie nadpisuj poprzedniej kopii. `pg_dump` wykonuje spójny snapshot bazy podczas normalnej pracy. Sprawdź kod zakończenia obu poleceń, rozmiar pliku i jego SHA256; kopię przenieś do szyfrowanego, zatwierdzonego magazynu poza serwerem. Zautomatyzuj powyższe jako systemowy job z alarmem po błędzie, dopiero po sprawdzeniu na docelowym serwerze.

Nie używaj przekierowania `>` dla binarnego dumpu w Windows PowerShell 5: może zmienić bajty. Kopiowanie przez `docker compose cp` zachowuje format. W przypadku PostgreSQL poza Docker użyj klienta `pg_dump` zgodnego z wersją serwera, pliku `.pgpass` z ograniczonymi prawami i parametru `--file`, bez umieszczania hasła w komendzie ([dokumentacja pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)).

Kopie nie zawierają haseł ról bazy przy `--no-owner --no-acl`; role, uprawnienia i ich sekrety odtwarzaj z oddzielnie chronionej konfiguracji infrastruktury. Konta aplikacji oraz hash haseł użytkowników są elementem dumpu bazy i wymagają ochrony.

## Bezpieczny test odtworzenia

1. Uruchom oddzielny PostgreSQL tej samej głównej wersji, poza produkcją. Utwórz pustą bazę o innej nazwie i przygotuj role infrastruktury.
2. Skopiuj dump do kontenera testowego. Wywołaj `pg_restore --exit-on-error --no-owner --no-acl --dbname=<osobna_baza> --username=<konto_odtwarzania> <plik>`. Używaj terminala i własnej konfiguracji poświadczeń; nie wklejaj sekretów do logów.
3. Sprawdź listę `schema_migrations` i sumy SHA256. Uruchom odpowiadającą kopii wersję aplikacji z oddzielnym `DATABASE_URL`. Nie kieruj środowiska testowego na produkcyjne integracje.
4. Porównaj liczby urządzeń, produktów, faktur i historii z raportem backupu. Sprawdź zgodność końcowych stanów z ostatnimi zapisanymi ruchami, szczegóły jednej faktury, historię urządzenia i logowanie uprawnionego konta testowego.
5. Nadaj ograniczone uprawnienia kontu aplikacji zgodnie z `ARCHITECTURE.md`. Unieważnij skopiowane sesje w środowisku odtwarzania (`DELETE FROM sessions`) i wyłącz `SETUP_TOKEN`, jeśli konta już istnieją.
6. Zapisz datę, wersję PostgreSQL, czas odtworzenia, wynik kontroli i osobę wykonującą test. Dopiero to potwierdza użyteczność kopii.

Nie odtwarzaj dumpu przez `--clean` do czynnej bazy firmy. Po rzeczywistej awarii zachowaj uszkodzone dane do analizy i najpierw odtwórz nową bazę, potwierdź jej poprawność, a następnie przełącz aplikację w zaplanowanym oknie.

## Ewentualny zewnętrzny magazyn plików

Przyszłe załączniki i konfiguracje przechowywane w zewnętrznym magazynie plików muszą być kopiowane wraz z odpowiadającym snapshotem metadanych. Klucze przechowywania powinny być niezmienne; stare wersje nie są nadpisywane. Kopia powinna zawierać manifest storage key → SHA256/rozmiar. Odtworzenie weryfikuje wszystkie powiązania i sumy. Obecne PDF do faktur są w PostgreSQL; po odtworzeniu sprawdź rozmiar i SHA256 dokumentu oraz jego powiązanie z FV i urządzeniami.

## Środowisko lokalne

Lokalny katalog `%LOCALAPPDATA%\IT-Hardware\postgres` służy do rozwoju i nie jest automatycznie archiwizowany. Nie kopiuj katalogu czynnego PostgreSQL do OneDrive: zwykła synchronizacja plików nie tworzy spójnej kopii bazy. Aby zachować lokalne dane, użyj zewnętrznego klienta PostgreSQL 18 i `pg_dump --file`, zachowując prywatną konfigurację poza repozytorium. Produkcyjne dane wymagają przygotowanej strategii serwera opisanej wyżej.

## Kopia przed przebudową — 07.10.2026

Przed migracją 009 wykonano kopię lokalnego klastra w:
`%LOCALAPPDATA%\IT-Hardware\backups\pre-industrial-20261007-151709`.
Obok znajduje się `pre-industrial-20261007-151709-manifest.json` z listą plików, rozmiarami i SHA256.

Lokalny pakiet PostgreSQL nie zawierał pg_dump, dlatego PostgreSQL zatrzymano w trybie fast, sprawdzono zakończenie i brak aktywnego postmaster.pid, skopiowano nieruchomy katalog danych, porównano manifest oraz ponownie uruchomiono serwer w finally. Nie kopiowano działającego klastra ani nie odczytywano rekordów firmowych. Kopia znajduje się poza OneDrive.

To kopia fizyczna całego lokalnego klastra, w tym baz testowych i ról; wymaga ochrony jak oryginalna baza. Odtworzenie wymaga zgodnego PostgreSQL 18/platformy oraz osobnego katalogu i portu. Nie należy podmieniać czynnego katalogu danych. Hash potwierdził zgodność skopiowanych plików, ale **nie wykonano osobnego testu odtworzenia**. Pełny test należy przeprowadzić zgodnie z firmowym upoważnieniem w odizolowanym środowisku.

## Kopia przed modułem urządzeń — 07.10.2026

Przed migracją 011 wykonano kolejną spójną kopię zatrzymanego lokalnego klastra:
`%LOCALAPPDATA%\IT-Hardware\backups\pre-devices-20261007-174439`.
Manifest obok: `pre-devices-20261007-174439-manifest.json`.

Wykorzystano tę samą procedurę fast-stop, weryfikacji zakończenia, kopiowania nieruchomego katalogu, porównania SHA256 i restartu. Nie odczytywano firmowych rekordów. Nie wykonano osobnego odtworzenia tej kopii; obowiązują wymagania ochrony i odizolowanego testu opisane wyżej. Migracja 011 jest addytywna. Preferencje osobnego dashboardu korzystają z istniejącej tabeli system_settings.

## Kopia przed rozbudową TV — 07.10.2026

Przed addytywną migracją 012 wykonano kopię:
`%LOCALAPPDATA%\IT-Hardware\backups\pre-tv-dashboard-20261007-223359`.
Manifest obok: `pre-tv-dashboard-20261007-223359-manifest.json`.

PostgreSQL zatrzymano w trybie fast i potwierdzono brak aktywnego postmaster.pid. Skopiowano nieruchomy katalog poza OneDrive; rozmiar oraz SHA256 każdego pliku kopii porównano z oryginałem. W finally ponownie uruchomiono klaster. Nie odczytywano rekordów firmowych. Kopia zawiera cały lokalny klaster i wymaga takiej samej ochrony jak baza. Nie wykonano testu odtworzenia.


## Kopia przed ilościami ułamkowymi — 08.10.2026

Przed migracją 015 zatrzymano lokalny PostgreSQL (fast), wykonano kopię nieruchomego klastra poza OneDrive i porównano SHA256 wszystkich plików:
`%LOCALAPPDATA%\IT-Hardware\backups\pre-fractional-quantities-20261008-105722`.
Manifest obok: `pre-fractional-quantities-20261008-105722-manifest.json`. Klaster ponownie uruchomiono. Firmowych rekordów nie odczytywano. Migrację zastosowano w bazie lokalnej oraz `_test`. Nie wykonano osobnego testu odtworzenia; zgodność hashy nie zastępuje takiego testu.

## Kopia przed zmianą pierwszego logowania — 08.10.2026

Przed migracją 016 zatrzymano lokalny PostgreSQL w trybie fast, wykonano kopię nieruchomego klastra poza OneDrive i porównano rozmiar oraz SHA256 wszystkich plików:
`%LOCALAPPDATA%\IT-Hardware\backups\pre-first-login-password-20261008-161103`.
Manifest obok: `pre-first-login-password-20261008-161103-manifest.json`. Klaster ponownie uruchomiono. Firmowych rekordów nie odczytywano. Migrację zastosowano w bazie lokalnej oraz `_test`. Nie wykonano osobnego odtworzenia tej kopii.

## Kopia kodu w GitHub — 08.10.2026

Repozytorium: [Blackworldpl/ITHW-ULTRA-WEBSITE](https://github.com/Blackworldpl/ITHW-ULTRA-WEBSITE), gałąź `main`. Zapis obejmuje kod aplikacji, wszystkie migracje do 016, pliki uruchomienia, package-lock.json, testy, dokumentację, grafikę marki i zrzuty fikcyjnych testów.

Po pobraniu repozytorium zainstaluj Node.js, odtwórz prywatną konfigurację i uruchom projekt według [README.md](../README.md). Repozytorium nie zawiera `.env.local`, `.local/`, bazy PostgreSQL, rzeczywistego importu Excel/CSV ani kopii danych. `node_modules/` odtwarza `npm ci`; `.next/` odtwarza build. Stan ewidencji wymaga osobnej kopii bazy opisanej powyżej. Ten zapis jest jednorazową kopią kodu; kolejne zmiany wymagają kolejnego commita.
