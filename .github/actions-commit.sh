#!/usr/bin/env bash
# Commite et pousse la base SQLite si elle a changé (appelé par les workflows).
set -euo pipefail
MSG="$1"
sqlite3 data/radar.db "VACUUM;" 2>/dev/null || python -c "import sqlite3; c=sqlite3.connect('data/radar.db'); c.execute('VACUUM'); c.close()"
git config user.name "radar-bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add data/radar.db
if git diff --cached --quiet; then
  echo "Base inchangée, rien à commiter."
  exit 0
fi
git commit -q -m "$MSG"
for i in 1 2 3 4; do
  git push && exit 0
  echo "Push refusé, nouvel essai ($i)…"; sleep $((2 ** i))
  git pull --rebase -X theirs -q || true
done
exit 1
