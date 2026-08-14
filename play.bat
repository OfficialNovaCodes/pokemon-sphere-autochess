@echo off
REM Pokemon Sphere AutoChess — local launcher
cd /d "%~dp0"
start "" http://localhost:8787/
python -m http.server 8787
