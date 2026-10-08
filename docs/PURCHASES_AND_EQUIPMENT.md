# Faktury, stanowiska i dokumenty wyposażenia

## Faktury

W **Faktury → Dodaj fakturę** albo **Dostawy → Przyjmij dostawę** otwiera się ten sam duży formularz. Podaj numer, kontrahenta, datę i walutę. Jeśli firmy nie ma w wynikach, wybierz „Dodaj kontrahenta” na dole listy; administrator wypełni pełny formularz w dodatkowym oknie. Zapis lub anulowanie zachowują fakturę, pozycje i wybrany PDF. Escape zamyka najwyższe okno lub otwarte podpowiedzi.

Pozycje wprowadzaj w tabeli: nazwa z dokumentu, rodzaj, kartoteka/kategoria, ilość, jednostka i opcjonalna cena. „Produkt magazynowy”, „Urządzenie” i „Usługa / inna pozycja” dodają odpowiedni wiersz. Wybór kartoteki zachowuje osobną nazwę z faktury i jednostkę. Produktu brak w bazie? „Dodaj produkt” w podpowiedziach otwiera krótką kartotekę i wraca do tego wiersza, ze stanem zero.

Przy większej fakturze **Alt+N** dodaje kolejny wiersz tego samego rodzaju i ustawia kursor w jego nazwie. Strzałki przy wierszu zmieniają kolejność wraz ze wszystkimi danymi pozycji; numeracja zostaje zapisana w tej kolejności. Dotyczy nowych dokumentów i pozycji bez przyjęć/powiązań. W podpowiedziach kontrahenta lub produktu strzałkami można wybrać także „Dodaj”, a Enter otwiera dodatkowe okno. Wyszukiwanie musi się zakończyć, zanim zaoferuje utworzenie produktu.

Zamknięcie formularza z niezapisanymi zmianami przez Anuluj, Escape, krzyżyk albo tło pokazuje potwierdzenie. „Wróć do faktury” zachowuje nagłówek, wiersze oraz wybrany PDF. Niezmieniony formularz zamyka się od razu. Przeglądarka otrzymuje także ostrzeżenie przed opuszczeniem strony z niezapisanymi danymi. Gdy nie wczytają się listy, formularz pokazuje błąd i „Spróbuj ponownie”; ponowienie zachowuje wpisane dane i pobiera listy.

Dla urządzenia otwórz „SN / dane”. Wklej numery po jednym w wierszu albo wyszukaj istniejącą kartę po Asset ID, nazwie lub SN. „Sprawdź numery w bazie” rozróżnia nowe, istniejące, już powiązane i konflikty. Istniejące dopasowania potwierdź przyciskiem. Powiązanie zachowuje odbiorcę, lokalizację, stan, datę i wcześniejszą cenę urządzenia; inna waluta wcześniejszej ceny wymaga wyjaśnienia przed zapisem. Karta bez SN wymaga najpierw uzupełnienia numeru na urządzeniu.

„Przyjmij nowe urządzenia i ilości do magazynu” tworzy tylko brakujące karty oraz ruchy produktów. Podgląd pokazuje ilości i dopasowania. Przy częściowej liście SN przyjmowane są wpisane sztuki, a pozostałe można dokończyć później. Przyjęcie bez żadnego SN zachowuje obsługę kart bez numeru; uzupełnia się je na kartach urządzeń. Bez zaznaczonego przyjęcia zapisujesz dokument i potwierdzone połączenia, bez zwiększenia zapasu.

Na karcie faktury każda pozycja pokazuje swoje numery/Asset ID lub ilość już przyjętą. „Numery seryjne / powiązania” pozwala później dopasować albo utworzyć pozostałe urządzenia. „Przyjmij produkt” przyjmuje część lub pozostałą ilość produktu, z kontrolą wersji i ponowienia. Istniejące karty nie tworzą drugiego przyjęcia.

Ceny i kwota mogą pozostać puste. Brak jest oznaczony „—”; zero pozostaje rzeczywistą ceną zero. Polski przecinek jest obsługiwany, a suma używa dokładnych groszy. Pełną sumę pozycji pokazujemy tylko po uzupełnieniu wszystkich cen. Wpisana kwota dokumentu musi zgadzać się z kompletną sumą. „Edytuj fakturę” pozwala uzupełnić ceny także po przyjęciu, zachowując ilości, połączenia i wcześniejsze ceny na kartach urządzeń. Raporty wartości urządzeń wskazują niekompletne dane tych kart.

PDF jest opcjonalny, do 10 MB, i dostępny z faktury oraz powiązanego urządzenia. Przy błędzie przesłania formularz zachowuje zapisaną fakturę i pozwala ponowić sam załącznik. Pozycje z przyjęciem lub powiązaniem są chronione przed zastępowaniem. Produkty magazynowe mogą mieć ilości ułamkowe zgodnie z jednostką (0–3 miejsca); urządzenia z numerami seryjnymi i usługi mają ilości całkowite. Przecinek jest obsługiwany. Każda pozycja zaokrągla swoją wartość do groszy przed sumowaniem.

## Stanowiska i stoły

W menu **Stanowiska i stoły → Dodaj stanowisko** wpisz np. 308A i wybierz jego folder nadrzędny. Stanowisko jest lokalizacją typu DESK. Na karcie dodasz urządzenie lub przeniesiesz istniejące. Lista pokazuje Asset ID, model i numer seryjny urządzeń znajdujących się na stole i w jego folderach podrzędnych.

Wyposażenie stołu nie jest automatycznie wydawane pracownikowi. Pracownik magazynowy może mieć pustą listę osobistego wyposażenia, a stół własną listę monitorów, klawiatur i myszy. Akcesoria wymagające indywidualnego numeru seryjnego dodawaj jako urządzenia; ilościowe produkty magazynowe pozostają w magazynie.

W **Administracja → Lokalizacje** chwyć uchwyt przy folderze, przesuń go na dozwolonego rodzica i puść. Podświetlenie wskazuje cel, etykieta podąża za wskaźnikiem, a przeniesienie zapisuje się od razu. Stałe pole **Poziom główny** pozwala wynieść folder do korzenia. Escape anuluje przeciąganie. Przeniesienie obejmuje całą gałąź; nie można utworzyć cyklu. Alternatywnie wybierz folder nadrzędny w panelu szczegółów.

## Pracownicy i papierowe rozliczenie

Profil pracownika rozdziela osobiste wyposażenie, dokumenty, dane kontaktowe / konto oraz historię. Dodawanie pracownika jest dostępne z listy pracowników. Wyposażenie wydaje się lub przekazuje przez wyszukiwarkę urządzeń. Zwrot zapisuje się na karcie urządzenia.

**Zapisz kartę wyposażenia** utrwala osobiste urządzenia pracownika. **Przygotuj obiegówkę** tworzy dokument z polami zwrotu / braków, stanu, daty i podpisów. **Zapisz stan stanowiska** tworzy osobny dokument stołu. Dokumenty mają numer, datę, autora i trwałą kopię stanu; późniejsze zmiany ewidencji nie zmieniają zapisanej listy.

W podglądzie wybierz **Drukuj / zapisz PDF** albo pobierz dokument HTML. **Pobierz szkic e-maila** tworzy plik .eml z dokumentem HTML jako załącznikiem. Otwórz go w swoim programie pocztowym, sprawdź / uzupełnij odbiorcę i wyślij. Aplikacja nie korzysta z serwera SMTP. Fizyczna drukarka i obsługa szkicu zależą od lokalnego programu użytkownika.

Obiegówka jest dokumentem papierowym. Jej utworzenie nie potwierdza zwrotu, nie zwraca urządzeń i nie wyłącza konta. Po fizycznym rozliczeniu operator zapisuje zwroty w ewidencji.

## Weryfikacja

Końcowa kontrola: 16/16 jednostkowych, 77/77 integracyjnych i build Next.js z TypeScript, wyłącznie na fikcyjnych rekordach. Obejmuje nowe dopasowania SN, częściowe przyjęcia produktów, ceny opcjonalne i ich późniejsze uzupełnienie, a także regresje stanowisk, dokumentów wyposażenia, uprawnień, rollback i ponowień. CUA potwierdziło okna potomne, zachowany PDF, dwie pozycje z przyjęciem, późniejsze ceny, częściowe przyjęcia i telefon 390 px. Szczegóły oraz zrzuty: [VERIFICATION.md](VERIFICATION.md).
