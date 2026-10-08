# Konta i hasła

## Dodawanie konta

Administrator otwiera **Administracja → Użytkownicy → Dodaj użytkownika**, wpisuje imię i nazwisko, adres e-mail oraz wybiera rolę. Hasło tymczasowe można wpisać albo wygenerować i skopiować. Opcja **Wymagaj zmiany hasła przy pierwszym logowaniu** jest domyślnie zaznaczona. Te same zasady obowiązują przy tworzeniu konta z profilu pracownika.

Po zapisaniu konta okno pokazuje adres logowania, e-mail, rolę oraz hasło tymczasowe. Administrator przekazuje dostęp użytkownikowi przed zamknięciem tego okna. Hasło jest domyślnie zasłonięte i nie jest ponownie pobierane z bazy. System nie wysyła tych danych automatycznie e-mailem. Na liście kont pojawia się status **Oczekuje na własne hasło**; przy braku wcześniejszego logowania widnieje **Nie logował się**.

## Pierwsze logowanie

1. Użytkownik loguje się swoim e-mailem i hasłem tymczasowym.
2. System otwiera formularz ustawienia własnego hasła. Do tego czasu nie udostępnia pozostałych ekranów ani chronionych operacji API.
3. Użytkownik wpisuje hasło tymczasowe, własne nowe hasło oraz jego powtórzenie. Hasło musi mieć 12–128 znaków i różnić się od poprzedniego. Można wkleić je z menedżera haseł.
4. Zapis kończy wszystkie dotychczasowe sesje tego konta. Użytkownik loguje się ponownie nowym hasłem i wraca do strony, którą próbował otworzyć.

Stare hasło tymczasowe przestaje działać. Status oczekiwania znika po ustawieniu własnego hasła. Samo wejście bezpośrednio na inny adres nie omija obowiązkowej zmiany.

## Reset i późniejsza zmiana

Administrator może w edycji konta ustawić nowe hasło tymczasowe. Przy resecie domyślnie włączony jest obowiązek ustawienia własnego hasła. Może również wymusić zmianę przy kolejnym logowaniu bez zmieniania dotychczasowego hasła. Zmiana tych ustawień unieważnia dotychczasowe sesje. Wyłączenie już obowiązującego wymogu w edycji wymaga ustawienia nowego hasła.

Każdy zalogowany użytkownik ma opcję **Menu profilu → Zmień hasło**. Podaje swoje dotychczasowe hasło, nowe hasło i powtórzenie. Także ta zmiana kończy wszystkie sesje konta i wymaga ponownego logowania. Administrator zmienia własne hasło tym formularzem.

Migracja 016 nie wymusza zmiany haseł istniejących kont. Administrator może ją włączyć indywidualnie. Dotychczasowy proces zaproszenia pozostaje dostępny; osoba przyjmująca zaproszenie sama wybiera swoje hasło, więc nie musi zmieniać go drugi raz.

## Weryfikacja

Testy używają wyłącznie fikcyjnych kont w bazie `_test`. Objęły obowiązek zmiany dla wszystkich ról, blokadę chronionych operacji, reset administratora, zmianę dobrowolną, wygaśnięcie sesji, konkurencyjne zapisy, zaproszenia i walidację formularza. Szczegóły i zrzuty znajdują się w [VERIFICATION.md](VERIFICATION.md).
