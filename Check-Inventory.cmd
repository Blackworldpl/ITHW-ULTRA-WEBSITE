@echo off
powershell.exe -NoProfile -File "%~dp0Inspect-Inventory.ps1"
if errorlevel 1 goto failed
start "" "%LOCALAPPDATA%\IT-Hardware\import-reports\summary.html"
exit /b 0
:failed
echo Analiza nie powiodla sie. Sprawdz instrukcje docs\LOCAL_IMPORT.md.
pause
exit /b 1
