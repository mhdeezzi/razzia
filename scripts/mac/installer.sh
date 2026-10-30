#!/bin/bash
# Installe la tâche automatique du Mac : stats-quotidiennes.sh chaque jour à 9 h 30 et 17 h 30 (heure du Mac).
# Si le Mac dort à l'heure prévue, la tâche part à son réveil. Désinstaller :
#   launchctl unload ~/Library/LaunchAgents/com.razzia.stats.plist && rm ~/Library/LaunchAgents/com.razzia.stats.plist
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$DIR/stats-quotidiennes.sh"
NODE_DIR="$(dirname "$(command -v node)")"
PLIST="$HOME/Library/LaunchAgents/com.razzia.stats.plist"
LOG="$HOME/Library/Logs/razzia-stats.log"
chmod +x "$SCRIPT"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.razzia.stats</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$SCRIPT</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>17</integer><key>Minute</key><integer>30</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Tâche installée : tous les jours à 9 h 30 et 17 h 30. Journal : $LOG"
echo "Premier passage maintenant (quelques minutes)…"
"$SCRIPT" 2>&1 | tee -a "$LOG"
