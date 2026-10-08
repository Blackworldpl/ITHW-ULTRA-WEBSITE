# Poprawki po audytach z 8 października 2026

Dotyczy audytu bezpieczeństwa i jakości (F01–F07, G01) oraz audytu wydajności (poprawki 1–11). Punkt wyjścia: commit `dc8d4f1`.

## Weryfikacja

CI (`.github/workflows/ci.yml`) na każdej gałęzi i pull requeście: `npm audit` zależności produkcyjnych, typecheck, testy jednostkowe, migracje i testy integracyjne na świeżym PostgreSQL 18, build oraz obraz Docker z kontrolą `/brand/ith-mark.svg`.

- `tests/audit-regressions.integration.ts` — role własne i atomowość przyjęć (F01), słowniki (F02), eksport braków (F03), zaproszenia (F04), wydanie sprzętu bez wymaganych pól (F05), kwota faktury (F06).
- `tests/query-equivalence.integration.ts` — wyszukiwanie urządzeń i magazynu, kursor i OFFSET, ścieżki i liczniki lokalizacji: wyniki porównywane rekord po rekordzie (identyfikatory i kolejność) z dotychczasowymi wyrażeniami, także dla przemianowanego pracownika, fraz obejmujących kilka pól, polskich znaków i równych znaczników czasu.

## Bezpieczeństwo i poprawność

| ID | Zmiana |
|---|---|
| F01 | Każda ścieżka przyjęcia tworzy sprzęt przez `createPurchasedAsset` (wymaga `asset.create`). `POST /api/deliveries` sprawdza `invoice.edit`, `inventory.move` i `asset.create` przed zapisem; funkcje faktur egzekwują `invoice.edit` w warstwie usług. Odmowa wycofuje całą transakcję. |
| F02 | Pełne dane dostawców w słownikach tylko z `invoice.view`; z samym `asset.view` — id i nazwa. Liczniki urządzeń pracowników wymagają `asset.view`. |
| F03 | Eksport braków wymaga `inventory.view` (trasa i funkcja serwera). |
| F04 | Najpierw tania kontrola tokenu; nieznany token nie uruchamia scrypt i nie tworzy wpisu limitu. Wspólny limit `invite:global`, najwyżej 2 równoległe obliczenia scrypt w procesie (kolejka 64, potem 503), usuwanie starych wpisów `auth_rate_limits`. |
| F05 | Decyzja: sprzęt z zakupu powstaje w stanie PREPARATION bez pól kategorii, ale wydanie osobie (akcja, operacja zbiorcza, edycja) wymaga wymaganych pól. |
| F06 | Przy edycji brak kwoty oznacza sumę bieżących pozycji, jak przy tworzeniu; pozycja bez ceny pozostawia kwotę nieznaną. |
| F07 | Obraz runtime zawiera `public/`. |
| G01 | Workflow CI jak wyżej. Ochronę gałęzi `main` (wymagane kontrole) włącza administrator repozytorium w ustawieniach GitHub. |

## Wydajność

Pomiar: PostgreSQL 16 lokalnie, dane z `scripts/perf/synthetic-data.sql` (50 000 urządzeń, 15 000 produktów, 785 lokalizacji, 2 000 pracowników), mediana 7 przebiegów `EXPLAIN ANALYZE` po rozgrzaniu. Wiersze i licznik listy wykonują się równolegle, więc czas żądania to dłuższy z nich. Wyniki przed i po porównano dla 94 zestawów (identyczne).

| Żądanie | Przed (ms) | Po (ms) |
|---|---:|---:|
| Lista urządzeń, strona 1 | 38 | 11 |
| Lista sortowana po lokalizacji | 226 | 39 |
| Strona 1600 (kursor) | 315 | 10 |
| Eksport 10 000 urządzeń | 1 052 | 59 |
| Wyszukiwanie urządzeń: „dell” / „latitude 5440” | 129 / 134 | 43 / 54 |
| Wyszukiwanie urządzeń: „ROB-0012” / brak trafień | 218 / 207 | 13 / 8 |
| Wyszukiwanie urządzeń: „a” (jeden znak) | 137 | 88 |
| Magazyn: „kabel hdmi” / „lodz pokoj” | 137 / 242 | 22 / 45 |
| `location_summary` (słowniki) | 108 | 16 |
| Słowniki po zalogowaniu (JSON, 2 000 pracowników) | ok. 1 100 KB | ok. 210 KB |

Zmiany: ścieżka lokalizacji zapisana w kolumnie i utrzymywana triggerami (`location_paths` zachowuje kolumny), liczniki gałęzi liczone raz na lokalizację, indeksowana kolumna `search_text` w magazynie, indeksowane warunki kandydatów przy wyszukiwaniu urządzeń (dotychczasowy predykat nadal decyduje o wyniku), stronicowanie na wąskich wierszach z pełną projekcją tylko dla strony, kursor dla domyślnego sortowania, licznik bez złączenia kategorii, osobna pula wyszukiwarki (4 połączenia, timeout 5 s, najwyżej 3 zapytania naraz na żądanie), wspólny wynik ekranów TV na interwał odświeżania i `last_seen_at` najwyżej raz na minutę, jedno zapytanie sesji, leniwe ładowanie ekranów, słowniki bez pracowników i faktur, odświeżanie tylko zmienionych słowników.

## Świadomie nie wprowadzono

- **GiST i `<->` dla dopasowań rozmytych.** Przy zachowaniu dotychczasowej kolejności remisów (Asset ID) grupy urządzeń o tej samej nazwie wymuszały pełny odczyt; pomiar był wolniejszy (118 wobec 102 ms).
- **Pula 20 połączeń.** Wyszukiwarka ma własną pulę, więc nie zajmuje połączeń zapisów. Rozmiar głównej puli ustawia `DATABASE_POOL_MAX` (domyślnie 10) — zwiększać po pomiarze, licząc wszystkie instancje.
- **Przeniesienie `devices.css`.** Jego klasy są używane w 49 komponentach; przeniesienie zmieniłoby wygląd innych ekranów.
- **Limit zaproszeń na klienta (IP).** Wymaga zaufanej konfiguracji reverse proxy.

## Otwarte decyzje i ograniczenia

- Dostęp do pól: odpowiedź urządzenia (i eksport) zawiera `invoiceNumber`, ceny i dostawcę dla `asset.view` niezależnie od `invoice.view`.
- Pomiary dotyczą danych syntetycznych; przed decyzjami o dalszej optymalizacji warto sprawdzić rzeczywistą liczbę rekordów.
- Rozmiar paczek klienta i czas startu w przeglądarce: CI zapisuje rozmiar fragmentów JS w adnotacji „bundle”; pomiar w przeglądarce (Lighthouse) nie był wykonany.
