@echo off
cd /d "%~dp0"
start "Scene Composer Dev Server" cmd /k npm run dev
timeout /t 5 /nobreak >nul
start http://localhost:3000/composer
