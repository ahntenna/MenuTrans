@echo off
setlocal
rem Local dev launcher (Windows cmd).
rem Opens two windows: backend (uvicorn --reload, :8000) and frontend (vite, :5173).
rem iPhone test: same Wi-Fi, open http://<PC IP>:5173 (file-input camera works over HTTP).

set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

if not exist "%ROOT%\backend\.venv\Scripts\python.exe" (
    echo [setup] creating venv and installing Python deps...
    py -3 -m venv "%ROOT%\backend\.venv" || goto :fail
    "%ROOT%\backend\.venv\Scripts\python.exe" -m pip install -r "%ROOT%\backend\requirements.txt" || goto :fail
)

if not exist "%ROOT%\frontend\node_modules" (
    echo [setup] npm install...
    pushd "%ROOT%\frontend"
    call npm install || (popd & goto :fail)
    popd
)

if not exist "%ROOT%\backend\.env" (
    echo [warn] backend\.env not found. Copy backend\.env.example to backend\.env and set ANTHROPIC_API_KEY.
)

set PYTHONUTF8=1
start "MenuTrans backend :8000" /D "%ROOT%\backend" cmd /k .venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
start "MenuTrans frontend :5173" /D "%ROOT%\frontend" cmd /k npm run dev

echo.
echo PC:      http://localhost:5173
echo iPhone:  http://^<PC IP^>:5173  (same Wi-Fi). Your IPv4 addresses:
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /i "IPv4"') do for /f "tokens=1" %%B in ("%%A") do echo          http://%%B:5173
echo.
endlocal
exit /b 0

:fail
echo [error] setup failed.
endlocal
exit /b 1
