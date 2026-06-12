@echo off
set "SCRIPT_DIR=%~dp0"

:: Navigate to the project root
pushd "%SCRIPT_DIR%.."

set "PROJECT_ROOT=%CD%"
set "VENV_DIR=%PROJECT_ROOT%\api-metachatbot-adk\.venv"
set "TARGET_DIR=%PROJECT_ROOT%\vectorstores-api"

echo Project root: %PROJECT_ROOT%
echo Using venv from: %VENV_DIR%
echo Target directory: %TARGET_DIR%

:: --- START SERVICES ---

echo Starting Main API...
start "API Main" powershell -NoProfile -NoExit -ExecutionPolicy Bypass -Command "& { cd '%TARGET_DIR%'; . '%VENV_DIR%\Scripts\Activate.ps1'; python main.py }"

:: --- START WORKERS ---

echo Starting Celery Worker (Cleanup ^& Low Priority)...
start "Celery Low Priority" powershell -NoProfile -NoExit -ExecutionPolicy Bypass -Command "& { cd '%TARGET_DIR%'; . '%VENV_DIR%\Scripts\Activate.ps1'; celery -A worker.celery_app worker --loglevel=info -P solo -Q azure-search.low-priority,default,smart-chunking,conversion,data-processing.batch -c 5 -n azure-search.low-priority@%%h }"

echo Starting Celery Worker (Image Indexation)...
start "Celery Image Indexation" powershell -NoProfile -NoExit -ExecutionPolicy Bypass -Command "& { cd '%TARGET_DIR%'; . '%VENV_DIR%\Scripts\Activate.ps1'; celery -A worker.celery_app worker --loglevel=info -P solo -Q image-indexation -c 5 -n image-indexation@%%h }"

echo Starting Celery Worker (Text Indexation)...
start "Celery Text Indexation" powershell -NoProfile -NoExit -ExecutionPolicy Bypass -Command "& { cd '%TARGET_DIR%'; . '%VENV_DIR%\Scripts\Activate.ps1'; celery -A worker.celery_app worker --loglevel=info -P solo -Q text-indexation -c 5 -n text-indexation@%%h }"

echo Starting Celery Worker (Logical Indexing)...
start "Celery Logical Indexing" powershell -NoProfile -NoExit -ExecutionPolicy Bypass -Command "& { cd '%TARGET_DIR%'; . '%VENV_DIR%\Scripts\Activate.ps1'; celery -A worker.celery_app worker --loglevel=info -P eventlet -Q logical-indexing -c 5 -n logical-indexing@%%h }"

:: echo Starting Celery Worker (Classification)...
:: start "Celery Classification" powershell -NoProfile -NoExit -ExecutionPolicy Bypass -Command "& { cd '%TARGET_DIR%'; . '%VENV_DIR%\Scripts\Activate.ps1'; celery -A worker.celery_app worker --loglevel=info -P solo -Q classification -c 5 -n classification@%%h }"

echo Starting Flower...
start "Flower" powershell -NoProfile -NoExit -ExecutionPolicy Bypass -Command "& { cd '%TARGET_DIR%'; . '%VENV_DIR%\Scripts\Activate.ps1'; celery -A worker.celery_app flower --loglevel=info --broker=redis://127.0.0.1:6379/0 --port=5555 }"

echo All services launched (Main API, Workers, and Flower).
popd