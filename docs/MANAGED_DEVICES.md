# Dashboardy TV, terminale i administracja

Wdrożenie lokalne: 07.10.2026. „Administracja → Ekrany i terminale” oraz „Mój dashboard” są dostępne wyłącznie dla ADMIN, również przez API. Kontynuacja z 08.10.2026 obejmuje także wybór danych i układu terminali.

## TV: kod pojawia się na telewizorze

1. Administrator dodaje TV, nadaje nazwę i wybiera dane. Dostaje indywidualny link `/device/<uuid>`.
2. Otwórz link na TV. Ekran wyświetli własny sześciocyfrowy kod ważny 15 minut.
3. W panelu administratora wybierz przy tym TV „Połącz TV” i wpisz kod widoczny na telewizorze.
4. Po zatwierdzeniu TV uruchomi dashboard automatycznie, bez logowania konta administratora na TV.

Kod zatwierdza konkretną przeglądarkę. Inna przeglądarka otwierająca ten sam link dostaje inny kod. Sam link ani kod bez potwierdzenia przez administratora nie dają dostępu do danych. Kod jest jednorazowy i przypisany do wybranego TV; w bazie pozostają tylko skróty kodu i losowego poświadczenia przeglądarki. Przed zatwierdzeniem przeglądarka może wyłącznie sprawdzić własny stan oczekiwania.

Udane zatwierdzenie zastępuje wcześniejszą przeglądarkę tego TV. „Wyłącz dostęp” unieważnia dostęp i oczekujące kody. Ponowne włączenie wymaga nowego parowania. Cookie urządzenia jest osobne od kont użytkowników, HttpOnly, SameSite=Strict, Secure w produkcji, ograniczone do API tego urządzenia i ważne 180 dni. Nie autoryzuje zwykłego API ani panelu administratora.

Potwierdzenie przypisuje odpowiedzialność za konfigurację zatwierdzającemu administratorowi. Dezaktywacja administratora, utrata roli ADMIN lub device.manage blokuje ekran. Zapis konfiguracji i zatwierdzenie chroni wersja; równoczesna zmiana wymaga ponownego otwarcia formularza. Sekrety i kody nie trafiają do audytu ani listy urządzeń. Nieudane próby są ograniczane.

## Usuwanie dashboardu lub terminala

W „Administracja → Ekrany i terminale” administrator wybiera „Usuń dashboard” przy TV lub „Usuń terminal”, a następnie potwierdza nazwę w oknie. „Anuluj” pozostawia ekran bez zmian. Usunięcie jest trwałe: kasuje konfigurację i oczekujące parowania, unieważnia link i poświadczenia urządzenia. Sprzęt w ewidencji oraz istniejąca historia operacji są zachowane; usunięcie ma osobny wpis audytowy. Przy równoczesnej zmianie ekranu trzeba ponownie otworzyć potwierdzenie z aktualnej listy.

Usunięty ekran znika z listy. Jego przeglądarka przy najbliższym odświeżeniu pokazuje „Ekran niedostępny”; przywrócenie widoku wymaga dodania nowego dashboardu i nowego parowania. „Wyłącz dostęp” nadal służy do czasowego odłączenia z zachowaniem konfiguracji.

Sprawdzono 10/10 testów ekranów/API, produkcyjny build i UI na odizolowanej bazie `_test`: odmowę dla innych ról, CSRF/Origin, konflikt wersji, usunięcie aktywnego TV i wyłączonego terminala, czyszczenie kodów, zachowanie sprzętu/audytu, anulowanie potwierdzenia oraz zniknięcie z listy i odmowę starego linku. [Okno potwierdzenia na fikcyjnym ekranie](screenshots/tv-custom/delete-dashboard.jpg).

## Dokładny wybór danych TV

Każdy TV ma niezależne ustawienia. „Ustaw widok” zawiera gotowe punkty startowe: liczniki ze zgłoszeniami, same zgłoszenia, same liczniki lub komunikat.

- Dziewięć osobnych liczników: urządzenia, dostępne, wydane, w naprawie, do przygotowania, uszkodzone, do utylizacji, otwarte zgłoszenia i krytyczne zgłoszenia. Wybrane liczniki można ustawić w dowolnej kolejności.
- Filtr lokalizacji, przełącznik uwzględniania podfolderów i filtr kategorii sprzętu.
- Filtry statusów i priorytetów zgłoszeń, również gdy zgłoszenia są używane tylko przez liczniki.
- Przełączniki numeru zgłoszenia, nazwy urządzenia, priorytetu, statusu i daty aktualizacji. Tytuł jest zawsze widoczny. Wyłączone pola są pomijane w odpowiedzi API do TV.
- Limit 1–50 zgłoszeń i sortowanie: priorytet/ostatnia zmiana, ostatnia zmiana lub najdłużej bez aktualizacji.
- Kolejność sekcji komunikatu, liczników i zgłoszeń, 1–3 kolumny, trzy wielkości tekstu i opcjonalny zegar.
- Strony po 1–12 zgłoszeń, automatyczna zmiana co 10–120 sekund oraz przyciski poprzednia/następna.
- Własny nagłówek, jasny/ciemny motyw, komunikat informacyjny/ważny/pilny i aktualizacja danych co 5–60 sekund.

Formularz pokazuje podgląd kolejności sekcji, liczników i wybranych pól; wartości podglądu są kreskami, aby nie udawały danych. Po zapisie TV automatycznie pobiera zmianę. To odpytywanie HTTP, nie WebSocket. Lista zmienia stronę niezależnie od odświeżania danych.

Liczniki sprzętu obejmują aktywne urządzenia (bez RETIRED). Filtry kategorii/lokalizacji są wspólne dla sprzętu i zgłoszeń. Przy takich filtrach zgłoszenia bez urządzenia należącego do wybranego zakresu są pomijane. Filtry statusów i priorytetów ograniczają listę i liczniki zgłoszeń; „Otwarte” i „Krytyczne” nie liczą RESOLVED. Dane pochodzą z lokalnego rejestru IT Hardware, bez synchronizacji ServiceNow.

TV nie dostaje opisów zgłoszeń, przypisanych operatorów, profili pracowników ani danych finansowych. Tytuły zgłoszeń i treść komunikatów są ustalane przez osoby zarządzające rejestrem.

## Lokalizacje tylko w administracji

Moduł drzewa lokalizacji przeniesiono do „Administracja”. Menu, strona szczegółów, wyniki wyszukiwania prowadzące do modułu oraz dostęp do jego API wymagają ADMIN i location.manage. Konta VIEWER/IT_USER/IT_ADVANCED nie mogą otworzyć modułu przez wpisanie adresu ani wywołać jego endpointów.

Dotychczasowe location.view służy do operacyjnego wyboru istniejącej lokalizacji w formularzach sprzętu i pracy ze stanowiskami. Dzięki temu ograniczenie modułu administracyjnego nie blokuje przyjęć, przenoszenia ani inwentaryzacji uprawnionym operatorom. Nie oznacza zakazu wyświetlania nazwy lokalizacji na karcie sprzętu.

## Terminale i osobisty dashboard

Terminal nadal korzysta z wcześniejszego parowania: administrator generuje kod i wpisuje się go na terminalu. Tryby: sprawdzenie urządzenia, kolejne odczyty i zapis do wybranej otwartej inwentaryzacji. Czytnik powinien wysyłać kod jako klawiatura i Enter. Kolejka, UUID odczytu, wersja konfiguracji oraz CSRF/Origin chronią zapis i ponowienia. Administrator wybiera osobno pola karty sprzętu (Asset ID, SN, model, status, lokalizacja), produktu (SKU, stan, minimum, lokalizacja) oraz liczniki spisu. Wyłączone pola wyników są pomijane w API. Nazwa rozpoznanego rekordu pozostaje widoczna.

Można ustawić duży tekst, opis i podpowiedź pola odczytu, wyłączyć aparat, kod oraz historię, a także ograniczyć ją do 1–100 ostatnich odczytów. Gotowe układy: zwięzły dla wbudowanego czytnika oraz pełny wynik i historia. Produkty ilościowe pokazują stan w swojej jednostce, również ułamkowy. Czyszczenie lokalnej historii nie usuwa dziennika inwentaryzacji.

Po zmianie konfiguracji terminal usuwa stare wyniki ze swojego widoku. Kolejka zachowuje tryb i spis z chwili odczytu: zmiana trybu lub spisu zatrzymuje ponowienie i wymaga jawnego odrzucenia oraz ponownego skanowania. Zmiana samego wyglądu pozwala ponowić z aktualną wersją. Wyłączenie aparatu zatrzymuje aktywny odczyt. Zarządzanie pozostaje dostępne wyłącznie dla administratorów.

„Mój dashboard” pozwala administratorowi wybrać sekcje strony głównej; układ zapisuje się osobno dla jego konta. Motyw panelu wybiera się w nagłówku lub Ustawieniach i zapisuje lokalnie w przeglądarce. Motyw TV jest niezależny.

## Dostęp z fizycznego TV lub terminala

Localhost działa tylko na komputerze uruchamiającym aplikację; na TV wskazuje sam telewizor. Fizyczny TV wymaga zatwierdzonego adresu HTTPS dostępnego w sieci firmowej, poprawnego APP_URL i certyfikatu. Nie zmieniono zapory ani nie wystawiono serwera do sieci. Lokalna aplikacja pozostaje na 127.0.0.1:3000.

## Weryfikacja

53/53 testów integracyjnych PostgreSQL/API, 14/14 jednostkowych i poprawny produkcyjny build z TypeScript. Testy obejmują nowy przepływ zatwierdzania, jednorazowość/wygaśnięcie kodu, posiadanie cookie oczekującej przeglądarki, zastąpienie i odwołanie dostępu, role, dokładne liczniki, kategorię i gałąź, statusy/priorytety, pomijanie pól, walidację i wersje oraz dalsze działanie terminali i osobnych dashboardów.

Przeglądarka pracowała wyłącznie przez proxy do bazy _test. Potwierdzono kod na TV → wpisanie w panelu → samoczynny start, filtrowany widok, automatyczną rotację stron, zmianę kolejności liczników/sekcji, wielkości tekstu i zegara oraz brak modułu lokalizacji i odmowę bezpośredniego wejścia dla IT_ADVANCED. Konsola TV bez błędów i ostrzeżeń. Naprawiono zapytanie filtra kategorii i przekazywanie wielu nagłówków Set-Cookie w pomocniczym proxy testowym.

Zrzuty z fikcyjnych danych: [kod na TV](screenshots/tv-custom/tv-generated-code.jpg), [ustawiony dashboard](screenshots/tv-custom/configured-tv.jpg), [edycja układu](screenshots/tv-custom/admin-tv-layout.jpg), [odmowa dostępu do lokalizacji](screenshots/tv-custom/locations-denied.jpg).

Migracja 012 dodaje tabelę oczekujących zgłoszeń parowania. Zastosowano ją w bazie lokalnej i testowej po zatrzymaniu klastra, kopii i porównaniu SHA256. Backup: [BACKUP.md](BACKUP.md). Dane firmowe nie były odczytywane. Fizyczny TV, jego kiosk i firmowe HTTPS nadal wymagają próby na docelowym sprzęcie.

## Kontynuacja terminali — 08.10.2026

Testy na `_test` potwierdzają wybór i pomijanie pól, produkt z ilościami ułamkowymi, ograniczone liczniki spisu, walidację konfiguracji i dostęp administracyjny. Bieżące wyniki testów oraz UI: [VERIFICATION.md](VERIFICATION.md). Próby na fizycznym terminalu, TV i drukarce są osobnym odbiorem: [HARDWARE_ACCEPTANCE.md](HARDWARE_ACCEPTANCE.md).
