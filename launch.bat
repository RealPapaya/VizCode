@echo off
if defined _VIZCODE_LAUNCHED goto :START
set _VIZCODE_LAUNCHED=1
%SystemRoot%\System32\cmd.exe /c "%~f0" %*
exit /b

:START
chcp 65001 >nul
title VIZCODE V4

cd /d "%~dp0"

set MIN_PYTHON=3.6

python --version >nul 2>&1
if errorlevel 1 goto python_missing

python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 6) else 1)"
if errorlevel 1 goto python_too_old
goto check_passed

:python_missing
echo [ERROR] Python is not installed.
goto offer_install

:python_too_old
echo [ERROR] Python %MIN_PYTHON% or newer is required.
for /f "delims=" %%V in ('python --version 2^>^&1') do echo Detected: %%V
goto offer_install

:offer_install
where winget >nul 2>&1
if errorlevel 1 goto no_winget

set /p INSTALL_PYTHON="Do you want to install a supported Python version via winget now? (Y/N): "
if /i "%INSTALL_PYTHON%"=="Y" goto opt_yes
goto opt_no

:no_winget
echo winget is not available on this system.
goto opt_no

:opt_yes
echo Installing Python 3.11...
winget install --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo Installation did not complete successfully.
    pause
    exit /b 1
)
echo =========================================
echo Installation complete! Please close and reopen this window, then run the script again.
echo =========================================
pause
exit /b 0

:opt_no
echo Python %MIN_PYTHON%+ is required to run this program. Please install it manually.
pause
exit /b 1

:check_passed
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

cls

python src\vizcode.py %*
