@echo off
REM Pokemon Sphere AutoChess — multiplayer launcher
REM Starts the Colyseus game server + static file server, opens the PVP lobby.
cd /d "%~dp0"
start "autochess-server" cmd /c "cd server && node index.js"
start "" http://localhost:8787/mp.html
python -m http.server 8787
