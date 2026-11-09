@echo off
setlocal
rem Build the frontend, then serve everything from FastAPI on :8000 (same layout as Docker).

set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

pushd "%ROOT%\frontend"
call npm run build
if errorlevel 1 (
    popd
    echo [error] frontend build failed.
    endlocal
    exit /b 1
)
popd

cd /d "%ROOT%\backend"
set PYTHONUTF8=1
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
endlocal
