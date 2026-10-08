@echo off
setlocal
if not defined LOCALAPPDATA goto failed
set "inventoryFolder=%LOCALAPPDATA%\IT-Hardware\imports"
if not exist "%inventoryFolder%\" mkdir "%inventoryFolder%"
if not exist "%inventoryFolder%\" goto failed
echo Folder Inventory: "%inventoryFolder%"
if /I "%~1"=="--check-only" exit /b 0
start "" "%SystemRoot%\explorer.exe" "%inventoryFolder%"
exit /b 0
:failed
echo Nie udalo sie utworzyc folderu Inventory w Twoim profilu Windows.
echo Sprawdz dostep do LOCALAPPDATA lub skontaktuj sie z administratorem komputera.
pause
exit /b 1
