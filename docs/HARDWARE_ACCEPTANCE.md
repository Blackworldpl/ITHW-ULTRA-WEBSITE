# Odbiór drukarki, TV i terminala

Stan oprogramowania: 08.10.2026. Testy kodu i przeglądarki są opisane w [VERIFICATION.md](VERIFICATION.md). Próby na fizycznych urządzeniach nie zostały wykonane.

## Etykieta Zebra

W oknie QR wybierz wymiary rzeczywiście założonej etykiety oraz rozdzielczość drukarki: 203, 300 lub 600 DPI. Profile drukarek zainstalowane na komputerze obejmują 203 i 600 DPI; sam profil nie potwierdza obecnego połączenia ani rozmiaru materiału.

W [fixtures/labels](fixtures/labels) są pliki kalibracyjne dla fikcyjnego rekordu, przy założeniu materiału 60 × 50 mm. Użyj wyłącznie pliku z DPI konkretnej drukarki i pasującymi wymiarami. Plik przygotowuje jedną etykietę; jego pobranie nie wysyła zadania do drukarki. ZPL wymaga drukarki lub trybu obsługującego ZPL; profil CPCL wymaga osobnego sprawdzenia zgodności.

Po wskazaniu docelowej drukarki i materiału:
1. Wydrukuj pojedynczą etykietę z aplikacji producenta, bez skalowania lub dodatkowej konwersji obrazu.
2. Sprawdź położenie QR, marginesy, czytelność nazwy i identyfikatora.
3. Odczytaj QR czytnikiem. Adres z plików kalibracyjnych jest demonstracyjny i nie otworzy rekordu. Do próby otwarcia użyj etykiety prawdziwego rekordu z zatwierdzonym APP_URL.
4. Potwierdź wynik na docelowej drukarce przed drukowaniem serii.

## TV

TV wymaga adresu HTTPS dostępnego z jego sieci; localhost na TV wskazuje telewizor. Skonfiguruj zatwierdzony adres aplikacji, certyfikat oraz APP_URL. W tej pracy nie zmieniano zapory ani dostępu do sieci.

Dodaj TV jako administrator, otwórz jego link na TV i wpisz w panelu kod wygenerowany na telewizorze. Sprawdź samoczynny start, wybrane statystyki i zgłoszenia, rotację stron, zmianę motywu oraz powrót po zamknięciu przeglądarki. Wyłączenie dostępu musi zatrzymać wyświetlanie przy następnym odświeżeniu.

## Terminal z przeglądarką

Terminal nadal paruje się kodem wygenerowanym w panelu administratora. Po połączeniu:
1. Sprawdź wbudowany czytnik: QR lub identyfikator jako klawiatura i Enter; pole ma zachowywać fokus po odczycie.
2. Odczytaj urządzenie z SN oraz produkt magazynowy. Sprawdź wybrane pola i jednostki.
3. Zmień ustawienia w panelu i sprawdź odświeżenie bez ponownego parowania.
4. W inwentaryzacji sprawdź odczyt oczekiwany, nadmiarowy, powtórzony oraz nieznany.
5. Przerwij połączenie podczas odczytu i ponów po powrocie; zapis nie może się podwoić.
6. Zmień spis lub tryb z oczekującym odczytem; terminal musi wymagać jawnego pominięcia i ponownego skanu.
7. Jeśli potrzebny jest aparat, sprawdź go na zatwierdzonym HTTPS i z udzieloną zgodą przeglądarki.

Wynik fizycznej próby należy zapisać z modelem urządzenia, przeglądarką, DPI/materiałem i datą. Brak fizycznego testu nie jest oznaczony jako zaliczony.
