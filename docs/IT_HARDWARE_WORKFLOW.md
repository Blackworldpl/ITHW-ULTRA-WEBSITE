# Zakres IT Hardware — FV, sprzęt i magazyn

Wdrożone 08.10.2026: słowniki kategorii/jednostek, poprawa pól liczbowych, duży formularz faktury i dokładne dopasowanie pozycji do numerów seryjnych. Dalsza kontynuacja obejmuje ilości ułamkowe (migracja 015) i konfigurację terminali. Zakres: [PURCHASE_ENTRY_PLAN.md](PURCHASE_ENTRY_PLAN.md). Instrukcja zakupów: [PURCHASES_AND_EQUIPMENT.md](PURCHASES_AND_EQUIPMENT.md).

Aktualne ustalenia użytkownika z 06.10.2026 zastępują propozycję obiegu dokumentów ERP z `ERP_FIXED_ASSETS_PLAN.md`. Priorytetem jest codzienna ewidencja i szybkie znalezienie dokumentu zakupu.

## Sprzęt i dowód zakupu

Każda fizyczna drukarka, laptop lub inne urządzenie ma stały Asset ID i etykietę z QR. Identyfikator RFID na tej samej etykiecie jest przypisany do karty tego samego urządzenia. QR zawiera adres karty w IT Hardware.

Skan → karta urządzenia → w razie potrzeby logowanie → powrót do tej samej karty. Karta pokazuje aktualnego odbiorcę, lokalizację, numer seryjny, numer środka trwałego, dane zakupu i powiązaną FV. Dostawca i dokument PDF pozwalają sprawdzić, skąd pochodzi sprzęt.

FV można zarejestrować bez przyjmowania nowej dostawy. Numery seryjne pozwalają przypisać istniejące urządzenia do dokładnej pozycji FV z jawnym potwierdzeniem albo utworzyć nowe karty. Powiązanie na poziomie całej FV pozostaje dostępne przy edycji karty. Jedna FV może być powiązana z wieloma urządzeniami. Jeden PDF jest zapisany przy FV i udostępniony przy wszystkich jej urządzeniach; nie tworzymy kopii dla każdej sztuki.

PDF do 10 MB jest przechowywany w PostgreSQL wraz z autorem, datą i SHA256, a więc wchodzi do backupu tej bazy. Powtórne przesłanie tego samego pliku do tej samej FV nie tworzy duplikatu. Odczyt wymaga aktywnego konta. IT_ADVANCED i ADMIN rejestrują FV, zmieniają powiązania i przesyłają PDF. Dokumenty są pobierane przez aplikację po uwierzytelnieniu; nie ma publicznych adresów plików.

## Produkty ilościowe

Pojemnik z 200 kablami to jeden produkt z ilością 200, a nie 200 indywidualnych urządzeń. QR pojemnika prowadzi do stałej karty produktu.

Skan → w razie potrzeby logowanie → karta produktu → Pobierz −1 → stan 199. Ilość domyślna to jedna sztuka; można pobrać więcej. Zwrot zwiększa stan. Każdy ruch ma autora, czas, ilość i stan po operacji. Równoczesne pobrania nie mogą dać ujemnego stanu, a ponowienie tego samego żądania nie odejmuje kolejnej sztuki. IT_USER, IT_ADVANCED i ADMIN mogą pobierać i zwracać produkty.

Po fizycznym przeliczeniu operator IT_ADVANCED lub ADMIN może podać rzeczywisty stan i powód korekty. Import częściowego stanu początkowego nie zastępuje przeliczenia.

## Wydanie i przekazanie sprzętu

Wydanie laptopa Jarkowi ustawia Jarka jako odbiorcę i zapisuje zdarzenie. Przekazanie Bartkowi zmienia aktualnego odbiorcę na Bartka i zapisuje osobne zdarzenie „Jarek → Bartek” z datą i wykonawcą. Poprzednie zdarzenia oraz przypisana FV pozostają dostępne. Zwrot usuwa bieżące przypisanie i zapisuje osobę zwracającą w historii.

IT_USER, IT_ADVANCED i ADMIN mogą wydać, przekazać, przyjąć zwrot i dodać notatkę. VIEWER ma odczyt. Edycja danych zakupu, RFID, lokalizacji i pozostałych statusów należy do IT_ADVANCED i ADMIN. Odbiorcę można wybrać z bazy pracowników albo wpisać ręcznie. Stare przypisania tekstowe nie są automatycznie łączone z profilami o podobnej nazwie.

## Rozbudowa magazynu i administracji — 07.10.2026

- Skaner odczytuje zdjęcie PNG/JPG/WEBP do 12 MB z komputera, lokalnie w przeglądarce. Korzysta z tego samego sprawdzania adresu i identyfikatorów co kamera/czytnik.
- SKU i kod produktu są opcjonalne dla urządzeń oraz produktów ilościowych. Stały Asset ID / slug i QR działają niezależnie od tych pól. Niejednoznaczny kod wymaga wyboru innego identyfikatora.
- Eksport historii na karcie obejmuje tylko wskazane urządzenie lub produkt. Administrator zachowuje osobny eksport całej historii magazynowej.
- Drzewo lokalizacji ma dowolną strukturę, w tym strefy w strefach i dzieci pojemników. Plus otwiera pole nazwy pod wskazanym folderem; Enter/zatwierdzenie tworzy dziecko bez okna wyboru rodzica i typu. Nowe węzły mają typ Folder, a opis typu można później zmienić bez ograniczeń struktury. Wyszukiwanie, zwijanie, edycja i przenoszenie całej gałęzi pozostają dostępne. Blokady chronią przed cyklami, nadpisaniem równoczesnej edycji i usuwaniem używanych lokalizacji.
- Kategorie urządzeń pozwalają włączyć/wyłączyć standardowe pola pojedynczo albo cały blok, np. sieć w laptopach. Ustawienia dotyczą formularza dodawania/edycji urządzenia; ukrycie pola nie usuwa zapisanych danych ani nie ogranicza uprawnień API. Odbiorca pozostaje wymagany przy statusie Wydany. Kategorie mają także opis i do 30 własnych pól: tekst, liczba, data, Tak/Nie, lista wyboru. Można wymagać wartości przy pełnym zapisie karty; nowe dostawy/import mogą pozostać w przygotowaniu do uzupełnienia danych. Zmiana definicji nie usuwa historycznych lub ręcznie dodanych wartości.
- Fakturę wyszukujemy po numerze lub kontrahencie z podpowiedzi serwera, również poza początkową listą FV. Należy wskazać istniejącą FV z wyników; sam tekst nie tworzy faktury. Pracownika/właściciela wyszukujemy po nazwisku, numerze, dziale lub e-mailu, z możliwością ręcznej nazwy bez profilu. Wybór lokalizacji pokazuje przeszukiwane, zwijane drzewo i pełną ścieżkę wybranego folderu. Te pola są wspólne dla urządzeń, filtrów, przekazań, produktów, dostaw, importu i profili pracowników.
- Kontrahenci mają NIP/VAT ID, REGON, adres, kontakt, telefon, e-mail, WWW, konto/IBAN i uwagi; te dane widać przy FV. PDF pozostaje właściwym dokumentem źródłowym.
- Profile pracowników: numer, kontakt, dział, stanowisko, lokalizacja, status, urządzenia, FV i historia. IT_ADVANCED/ADMIN edytują profile; ADMIN łączy istniejące konta i tworzy konta VIEWER/IT_USER. „Mój sprzęt” korzysta z profilu powiązanego z zalogowanym kontem. Przed dezaktywacją należy oddać/przekazać sprzęt; dezaktywacja połączonego profilu wyłącza konto i sesje. Ponowne włączenie profilu i konta to oddzielne czynności. Profil dezaktywuje się zamiast kasować jego historię.

## Etykiety Zebra

Druk z przeglądarki ma regulowane wymiary 30–120 mm, z ustawieniem roboczym 60 × 50 mm. Można pobrać QR jako PNG i etykietę ZPL dla 300 DPI. ZPL zawiera QR z adresem rekordu i identyfikator, bez kodowania RFID.

Użytkownik potwierdził 300 DPI; etykiety nie są jeszcze zamówione. Ostateczny rozmiar, ustawienia sterownika, kalibracja i próba fizycznego wydruku pozostają do wykonania po ich wyborze. System nie wysyła samodzielnie zleceń na USB. Bezpośredni druk z przeglądarki przez lokalny program Zebra można rozważyć później: [Zebra Browser Print](https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html).

## Priorytety i zakres

1. Działające skanowanie i powrót po logowaniu do właściwej karty.
2. FV, PDF oraz dwustronne powiązania faktura ↔ urządzenia.
3. Pobrania i zwroty produktów z pełną historią.
4. Wydania i przekazania urządzeń z historią odbiorców i zachowaniem dowodu zakupu.
5. Dostęp z telefonów przez docelowy firmowy adres HTTPS; ten adres należy ustawić przed wydrukiem etykiet.

WZ/PZ i rozbudowany obieg dokumentów ERP nie są wymagane. Formalne kampanie spisowe, konfiguracje i integracje pozostają opcjonalnymi przyszłymi modułami. Istniejący prosty zapis dostawy nadal może zwiększać stan i tworzyć karty nowo zakupionych sztuk.

## Weryfikacja

Przepływy i uprawnienia sprawdzamy na fikcyjnych danych w osobnej bazie `_test`. Nie otwieramy firmowych Exceli, faktur ani ewidencji w rozmowie. Kryteria: powrót do zeskanowanej karty, prawidłowe pobranie −1, zachowanie FV przy przekazaniu, autoryzowany odczyt PDF, brak duplikatów po ponowieniu i spójność list urządzeń na fakturze.
