#!/bin/bash
# Mise à jour quotidienne des tableaux stats.nba.com (bloqués sur GitHub) depuis le Mac, puis envoi sur la branche
# donnees-stats que lisent les simulations. Lancé chaque jour par launchd (voir installer.sh) ; journal dans
# ~/Library/Logs/razzia-stats.log.
set -u
cd "$(dirname "$0")/../.." || exit 1
echo "=== $(date '+%Y-%m-%d %H:%M') ==="
# Code du moteur à jour (sans toucher à d'éventuelles modifications locales).
git pull --ff-only -q origin main || echo "git pull impossible : on continue avec le code actuel"
[ -d node_modules ] && [ package-lock.json -ot node_modules ] || npm ci --no-audit --no-fund -q
npm run -s ingest -- --stats || { echo "ÉCHEC : lecture de stats.nba.com"; exit 1; }
npm run -s snapshot -- --push || { echo "ÉCHEC : envoi sur GitHub"; exit 1; }
echo "OK"
