# Tymczasowy dostęp do IT Hardware w LAN

Laptop może obsługiwać aplikację i bazę dla kilku osób w sieci lokalnej. Jest to start w trybie deweloperskim przez HTTP do krótkich testów. Do regularnej pracy z danymi firmowymi użyj firmowego HTTPS.

1. W PowerShell wykonaj `ipconfig`. Wybierz adres IPv4 karty, przez którą łączysz się z innymi osobami (Wi-Fi lub Ethernet).
2. Zatrzymaj poprzednie uruchomienie przez Ctrl+C. W folderze `it-hardware` uruchom, podstawiając swój aktualny adres:

   ```powershell
   .\Start-Local.ps1 -LanAddress 10.186.114.26
   ```

   Jeżeli PowerShell blokuje uruchomienie skryptu, można wywołać jednorazowo:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-Local.ps1 -LanAddress 10.186.114.26
   ```

3. Zarówno na laptopie, jak i drugim komputerze otwórz `http://10.186.114.26:3000`. Używanie innego adresu (np. localhost) może zablokować logowanie lub zapis, ponieważ aplikacja sprawdza Origin. Skrypt ustawia APP_URL tylko dla tego startu; nie zapisuje adresu LAN do `.env.local`. W razie potrzeby utwórz pierwszego administratora na `/setup` przy użyciu tokenu z prywatnego `.env.local`, potem usuń SETUP_TOKEN. Każda osoba powinna mieć własne konto utworzone przez administratora.
4. Jeśli dostęp z drugiego komputera jest blokowany przez zaporę, w PowerShell uruchomionym jako administrator dodaj regułę dla portu aplikacji i lokalnej podsieci:

   ```powershell
   New-NetFirewallRule -Name 'IT-Hardware-LAN-3000' -DisplayName 'IT Hardware LAN' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -LocalAddress 10.186.114.26 -RemoteAddress LocalSubnet -Profile Domain,Private
   ```

   Reguła dotyczy profilu domenowego lub prywatnego. W zarządzanej sieci firmowej polityka IT może blokować własne reguły lub ruch między urządzeniami. W takim przypadku potrzebna jest pomoc administratora sieci. Polecenie kontrolne na drugim komputerze: `Test-NetConnection 10.186.114.26 -Port 3000`.

Laptop musi mieć zasilanie i aktywne połączenie z siecią; nie może zasypiać. Zostaw okno PowerShell otwarte. Ctrl+C kończy udostępnianie, a dane PostgreSQL pozostają na dysku. Przy zmianie adresu IP uruchom ponownie z nowym adresem i użyj go w przeglądarkach. Wydrukowane QR zawierające stary adres wymagają ponownego wygenerowania.

Kamera telefonu nie działa przez zwykły HTTP pod adresem LAN; potrzebny jest HTTPS. Odczyt kodu z pliku pozostaje dostępny. Produkcyjny `npm run start` wymaga HTTPS również dla logowania (cookie Secure).

Wyłączenie dodanej reguły po testach, w PowerShell administratora:

```powershell
Remove-NetFirewallRule -Name 'IT-Hardware-LAN-3000'
```

PostgreSQL pozostaje na 127.0.0.1:55432. Osobom korzystającym z aplikacji przekazuj adres strony; plik `.env.local` i folder bazy są prywatne. Skrypt nie zmienia zapory ani ustawień sieci.
