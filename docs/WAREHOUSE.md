# Magazyn z dużym katalogiem — 07.10.2026

Domyślny widok to zwarta tabela produktów ilościowych. Urządzenia z indywidualnymi numerami seryjnymi nadal znajdują się w module Sprzęt, dostępnym także przez odnośnik z magazynu. Przebudowa katalogu z 07.10 nie wymagała migracji. Dodane 08.10 słowniki używają migracji 013 i zachowują istniejące nazwy oraz stany.

## Dodawanie produktu i listy — 08.10.2026

„Dodaj produkt” otwiera krótszy formularz: nazwa → kategoria magazynowa → jednostka → minimalny stan → lokalizacja. Kategorie wybiera się z wyszukiwanej listy, jednostki z listy symboli i pełnych nazw. SKU, kod producenta oraz uwagi są w „Dodatkowe dane i identyfikatory”. Adres/QR tworzy się automatycznie, a edycja zachowuje stały adres produktu.

Administrator zarządza listami w Administracja → „Kategorie magazynowe” / „Jednostki”. Może dodawać, edytować, wyłączać i usuwać nieużywane wpisy. Odnośnik z formularza otwiera zarządzanie w nowej karcie, zachowując rozpoczęty produkt; „Odśwież listy” pobiera nowe opcje. Kategorie urządzeń pozostają osobną listą.

Używanego wpisu nie można usunąć. Wyłączenie ukrywa go dla nowych produktów, ale edycja starej karty może go zachować. Zmiana nazwy kategorii aktualizuje istniejące produkty bez zmiany QR. Używana jednostka zachowuje symbol; jej pełną nazwę można poprawić. Administrator może zwiększyć precyzję jednostki, a jej zmniejszenie po użyciu jest blokowane. Pozycja faktury zachowuje precyzję historyczną. Produktu z zapasem, historią ruchów lub pozycją faktury nie można przestawić na inną jednostkę bez osobnego procesu przeliczenia.

Karta domyślnie zaczyna ze stanem zero. W nowym produkcie można zaznaczyć „Wprowadź policzony stan początkowy” i podać ilość oraz źródło. Produkt i jeden ruch powstają razem; ponowienie zapisu nie powiela stanu. Zakup wprowadza się w dużym wspólnym formularzu faktury/dostawy. Nową kartotekę można utworzyć bez wychodzenia z pozycji. Dokument oczekujący ma na karcie akcję przyjęcia części lub pozostałości; przyjęta ilość jest widoczna przy pozycji. Minimum i ilości w magazynie, fakturze oraz dostawie można wyczyścić i wpisać ponownie; pusta ilość nie wykonuje ruchu. Migracja 015 dopuszcza ilości ułamkowe zgodnie z jednostką: 0–3 miejsca po przecinku, domyślnie 3 dla `m` i `kg`. Wpisy `2,5` i `0,125` są obsługiwane także w pobraniach, zwrotach, korektach, minimum, dostawach i imporcie. Ilości liczone są dokładnie w tysięcznych. Cena każdej pozycji jest zaokrąglana do groszy przed sumowaniem. Przyjęcia pokazują ilości osobno według jednostki.

Kontrola A/B: 68/68 integracyjnych, 15/15 jednostkowych i poprawny build. Formularz, zapis fikcyjnego produktu z jednostką `m` i minimum 15, edycja listy, puste ilości, oba motywy i telefon sprawdzone wyłącznie w `_test`. [Nowy formularz](screenshots/warehouse/product-form.jpg), [ciemny motyw](screenshots/warehouse/product-form-dark.jpg), [telefon](screenshots/warehouse/product-form-mobile.jpg). Kolejne etapy faktur i numerów seryjnych: [PURCHASE_ENTRY_PLAN.md](PURCHASE_ENTRY_PLAN.md).

## Praca z listą

- Strony po 25, 50 lub 100 produktów; przejście do konkretnej strony, pierwszej i ostatniej. API przesyła tylko wybraną stronę. Tabela ma własny obszar przewijania i stałe nagłówki; na telefonie każdy wiersz otrzymuje podpisy pól.
- Wyszukiwanie wielu słów, w dowolnej kolejności, po nazwie, SKU, kodzie, identyfikatorze, kategorii i ścieżce lokalizacji. Polskie znaki można pominąć, np. „przewod” odnajduje „przewód”. Znaki % i _ są traktowane dosłownie.
- Wyszukiwane kategorie, lokalizacja wraz z potomkami lub tylko wskazanym folderem, produkty bez lokalizacji i filtr stanu. Podpowiedzi kategorii pokazują liczbę pozycji w całym katalogu.
- Sortowanie po nazwie, SKU, kategorii, stanie, minimum, niedoborze, lokalizacji lub aktualizacji. Niedobór to max(minimum − stan, 0). Remisy są rozstrzygane stabilnie.
- Liczniki „Wszystkie”, „Do uzupełnienia”, „Brak na stanie” i „Stan prawidłowy” są jednocześnie filtrami. Dotyczą liczby produktów w aktualnym zakresie wyszukiwania/kategorii/lokalizacji, przed wyborem filtra stanu. Do uzupełnienia: stan ≤ minimum, w tym zero; prawidłowy: stan > minimum. Nie sumujemy różnych jednostek miary.
- Wybór kolumn, widok tabeli/kafelków, odstępy i rozmiar strony zapamiętywane są lokalnie w przeglądarce osobno dla każdego użytkownika. Filtry, sortowanie i strona znajdują się też w URL. Powrót z karty produktu odtwarza listę.

## Pobrania i zwroty

„Pobierz” w wierszu otwiera formularz ilości; menu wiersza udostępnia też zwrot, kartę, historię, edycję, korektę i QR zgodnie z uprawnieniami. Kafelki mają osobne przyciski pobrania i zwrotu. Formularz pobiera aktualny stan, pokazuje wynik operacji i blokuje ilość przekraczającą dostępny zapas lub limit.

Ruchy korzystają z istniejącej transakcji, historii i requestId chroniącego ponowienie. Przy równoczesnej zmianie stanu formularz odświeża produkt i pokazuje komunikat. Powód można dopisać w notatce. Nowe zakupy przyjmuje się przez dostawy/faktury, a policzony stan przez korektę.

Nie dodano nowych uprawnień: odczyt wymaga inventory.view, ruchy inventory.move, edycja/korekta inventory.edit, etykiety label.print. Dostawy i import respektują dotychczasowe uprawnienia. Moduł zarządzania lokalizacjami nadal pozostaje wyłącznie dla administracji; filtr pozwala wybierać istniejącą lokalizację.

## Weryfikacja

62/62 testy integracyjne i końcowy build Next.js/TypeScript przeszły. Nowe testy sprawdzają paginację i stabilne remisy, liczniki i kombinacje filtrów, podpowiedzi, wyszukiwanie bez polskich znaków, walidację, dostęp i bezpieczne pobrania/zwroty. Używają wyłącznie fikcyjnych danych w `_test`.

Przeglądarka: tabela/kafelki, oba motywy, zapis ustawień po odświeżeniu, filtry i powrót z karty, pobranie/zwrot, blokada nadmiernej ilości oraz układ 390 × 844 bez poziomego przepełnienia.

Benchmark na 12 000 fikcyjnych produktów, 12 próbek na scenariusz:

| Zapytanie | p50 | p95 |
| --- | ---: | ---: |
| Strona 50 + podsumowanie w lokalizacji | 9 ms | 11 ms |
| Wyszukiwanie wieloma słowami | 222 ms | 429 ms |
| Sortowanie stanu, 100 produktów | 8 ms | 10 ms |
| Niedobory | 6 ms | 7 ms |
| Strona 200 | 12 ms | 14 ms |
| Podpowiedzi kategorii | 27 ms | 31 ms |

To pomiar funkcji serwera i lokalnego PostgreSQL, bez uwierzytelnienia, sieci, renderowania i równoczesnego obciążenia. Nie jest gwarancją czasu odpowiedzi docelowego wdrożenia. Fixture benchmarku usunięto wyłącznie z `_test`; firmowa ewidencja nie była odczytywana ani zmieniana. Pełny wynik: [WAREHOUSE_PERFORMANCE.json](WAREHOUSE_PERFORMANCE.json).

Zrzuty z fikcyjnymi produktami: [jasny motyw](screenshots/warehouse/catalogue-light.jpg), [ciemny motyw](screenshots/warehouse/catalogue-dark.jpg), [telefon](screenshots/warehouse/catalogue-mobile.jpg), [pobranie na telefonie](screenshots/warehouse/movement-mobile.jpg).
