@echo off
rem Windows'ga kirganingizda Ma'ruza Daftari serveri o'zi ishga tushadigan qiladi.
set "TARGET=%~dp0..\..\start-server.cmd"
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Maruza Daftari server.cmd"
> "%LINK%" echo @start "Maruza Daftari server" /min cmd /c "%TARGET%"
echo Tayyor: Windows'ga kirganingizda server avtomatik ishga tushadi.
echo O'chirish uchun: scripts\windows\autostart-ochirish.cmd
pause
