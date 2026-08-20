@echo off
setlocal
cd /d "%~dp0"
title Bom Ruido - Servidor
if not exist ".env" (
  echo [ERRO] .env nao encontrado nesta pasta.
  echo Copie o .env da instalacao que ja funciona para ca.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Instalando dependencias...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)
echo.
echo Iniciando Bom Ruido...
echo Abra http://localhost:3000 se o navegador nao abrir sozinho.
echo.
start "" http://localhost:3000
node server.js
pause
