@echo off
title Servidor Shooter Multiplayer
echo ========================================
echo    INICIANDO SERVIDOR DEL JUEGO
echo ========================================
echo.

:: Verificar si Node.js está instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js no está instalado.
    echo Por favor instala Node.js desde: https://nodejs.org
    echo.
    pause
    exit /b
)

:: Verificar si npm está instalado
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: npm no está instalado.
    echo.
    pause
    exit /b
)

:: Verificar si node_modules existe, si no, instalar dependencias
if not exist "node_modules" (
    echo Instalando dependencias...
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: No se pudieron instalar las dependencias.
        pause
        exit /b
    )
)

echo.
echo Servidor iniciado correctamente!
echo.
echo Direccion local: http://localhost:3000
echo.
echo Para que otros jugadores se conecten desde tu red:
echo Usa tu IP local: http://[TU-IP]:3000
echo.
echo ========================================
echo    PRESIONA CTRL+C PARA DETENER
echo ========================================
echo.

:: Iniciar el servidor
node servidor.js

pause