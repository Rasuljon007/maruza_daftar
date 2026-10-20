@echo off
rem Ma'ruza Daftari serverini ishga tushiradi va to'xtab qolsa 10 soniyadan keyin qayta yoqadi.
rem Ikki marta bosing yoki Windows ishga tushganda avtomatik yoqilishi uchun: scripts\windows\autostart-yoqish.cmd
title Maruza Daftari server
cd /d "%~dp0"
:loop
echo.
echo [%date% %time%] Server ishga tushirilmoqda...
call npm start
echo.
echo [%date% %time%] Server to'xtadi. 10 soniyadan keyin qayta ishga tushadi (butunlay yopish uchun oynani yoping).
timeout /t 10 /nobreak >nul
goto loop
