# Porównanie z projektem GitHub

Analiza z 06.10.2026. Źródło: [Blackworldpl/IT-Hardware-Managment-Website](https://github.com/Blackworldpl/IT-Hardware-Managment-Website), commit `58bf23f2160b0878b801871b925971d4a37edaf4`.
Repozytorium jest prywatne; odczytano je przez autoryzowane połączenie GitHub. Metadane nie wskazują licencji. Funkcje poniżej zaimplementowano samodzielnie dla obecnego schematu PostgreSQL i API; nie importowano kodu, zależności, kont ani danych z repozytorium.

Oba projekty mają Next.js, PostgreSQL, te same cztery role, indywidualne urządzenia, magazyn ilościowy, dostawy, faktury, QR i trwały audyt. Projekt referencyjny używa Prisma i Server Actions, a lokalna aplikacja używa pg i REST z tokenem CSRF.

| Funkcja ze źródła | Stan lokalny po wdrożeniu |
|---|---|
| Raporty kategorii, statusów, lokalizacji, gwarancji, zakupów i dostawców | Nowy dział Raporty, odnośniki do filtrów i odświeżanie. Wartości dzielone według waluty; ceny pozostają decimal w bazie. |
| Najczęściej pobierane produkty | Ranking pobrań z 90 dni; korekty i import nie są liczone jako pobrania. |
| Eksport ewidencji CSV | Eksport wszystkich wyników aktualnych filtrów, niezależnie od strony, dla IT_ADVANCED i ADMIN. Limit 10 000 z jawnym błędem zamiast ucinania. |
| Sortowanie, środki trwałe i lokalizacje z podlokalizacjami | Nowe filtry i sortowanie; hierarchia działa po identyfikatorach, także gdy nazwa zawiera znak `/`. |
| Szybkie akcje urządzenia | Wydanie/przekazanie, zwrot, przeniesienie, status, RFID i notatki w historii. Kontrola wersji i uprawnień na serwerze. |
| Edycja produktu magazynowego | Nazwa, SKU, kategoria, jednostka, minimum, lokalizacja, uwagi. Stały adres i QR; ochrona przed nadpisaniem równoczesnej zmiany. |
| Korekta inwentaryzacyjna | Nowy faktycznie policzony stan, włącznie z zerem, z powodem, autorem i historią. Blokada rekordu, kontrola poprzedniego stanu i idempotencja. |
| Lista do zamówienia | Lista do uzupełnienia w Raportach, niedobór do minimum i pełny eksport CSV. Osiągnięcie minimum wyświetla ostrzeżenie, brak do minimum wynosi wtedy 0. |
| Skanowanie RFID, SKU i numerów seryjnych | Skaner rozpoznaje też numer środka trwałego. Dopasowanie niejednoznaczne wymaga wyboru przez wyszukiwarkę. URL z QR pozostaje ograniczony do własnej aplikacji. |
| Wyszukiwarka ze skrótem `/` | Skrót `/` i istniejący Ctrl+K; wyszukiwanie numerów środków trwałych i lokalizacji. |
| Zarządzanie słownikami i użytkownikami | Istniało po wcześniejszej poprawce: edycja, usuwanie nieużywanych wpisów, dezaktywacja kont i audyt. |

## Funkcje odrębnego etapu

Aktualizacja zakresu po doprecyzowaniu użytkownika: [FV, sprzęt, pobrania QR i przekazania](IT_HARDWARE_WORKFLOW.md). Lokalnie wdrożono już PDF do FV, samodzielną rejestrację FV, zachowanie celu QR po logowaniu i zdarzenie przekazania z poprzednim oraz nowym odbiorcą. Poniższa informacja o załącznikach opisuje stan projektu referencyjnego w analizowanym commicie; nie oznacza braku obsługi PDF faktur w lokalnej aplikacji.

Konfiguracje i załączniki w repozytorium są nadal oznaczone jako etap 2. Nie przeniesiono ich jako pozornie działających ekranów. Integracje ServiceNow API, Entra ID, Power BI i fizycznych urządzeń RFID wymagają docelowych systemów i uprawnień. Skaner RFID obsługuje obecnie kod z czytnika klawiaturowego.

Korekta produktu ilościowego nie stanowi pełnego modułu spisu środków trwałych. Kampanie, niezmienne migawki, rozliczenie różnic i zatwierdzenie protokołu pozostają opisane w ERP_FIXED_ASSETS_PLAN.md.

## Weryfikacja

Testy integracyjne na oddzielnej bazie `_test`: filtry i eksport CSV, rozdzielenie walut, ochrona przed formułami CSV, uprawnienia, edycja produktu, korekta do zera, równoczesne korekty, ponowienie żądania, akcje urządzenia, kontrola wersji, skanowanie kodów i niejednoznaczność. Interfejs sprawdzono na danych syntetycznych na porcie 3001. Dane firmowe i źródłowe pliki Excel/CSV nie były odczytywane.

Źródła funkcji: [README](https://github.com/Blackworldpl/IT-Hardware-Managment-Website/blob/58bf23f2160b0878b801871b925971d4a37edaf4/README.md), [raporty](https://github.com/Blackworldpl/IT-Hardware-Managment-Website/blob/58bf23f2160b0878b801871b925971d4a37edaf4/src/server/services/reports.ts), [akcje urządzenia](https://github.com/Blackworldpl/IT-Hardware-Managment-Website/blob/58bf23f2160b0878b801871b925971d4a37edaf4/src/components/AssetActions.tsx), [magazyn](https://github.com/Blackworldpl/IT-Hardware-Managment-Website/blob/58bf23f2160b0878b801871b925971d4a37edaf4/src/server/services/inventory.ts), [wyszukiwanie i skanowanie](https://github.com/Blackworldpl/IT-Hardware-Managment-Website/blob/58bf23f2160b0878b801871b925971d4a37edaf4/src/server/services/search.ts).
