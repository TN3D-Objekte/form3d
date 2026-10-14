@echo off
rem Startet einen lokalen Webserver, damit das iPad die App im selben WLAN laden kann.
cd /d "%~dp0"
echo.
echo  Form3D laeuft. Auf dem iPad in Safari eine dieser Adressen oeffnen:
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo     http://%%a:8080
echo.
echo  Am PC selbst:  http://localhost:8080
echo  Beenden mit Strg+C.
echo.
python -m http.server 8080 --bind 0.0.0.0
pause
