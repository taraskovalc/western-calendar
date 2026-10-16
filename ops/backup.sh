#!/bin/sh
# Nightly database backups, run by the "backup" container in docker-compose.yml.
#
# Every 24 hours: dump the whole database into /backups (which is
# /srv/backups/western-calendar on the server), then delete dumps older than
# KEEP_DAYS days. The first backup happens as soon as the container starts.
#
# Restore one with (see README.md):
#   docker compose exec -T db pg_restore -U calendar -d calendar --clean --if-exists < FILE.dump
set -eu

KEEP_DAYS="${KEEP_DAYS:-14}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-86400}"

while true; do
  stamp="$(date +%Y-%m-%d_%H%M)"
  file="/backups/calendar_${stamp}.dump"
  # Write to a temporary name first, so a half-finished dump is never mistaken
  # for a good one.
  if pg_dump --format=custom --file="${file}.partial"; then
    mv "${file}.partial" "${file}"
    echo "$(date '+%F %T') Backup saved: $(basename "$file") ($(du -h "$file" | cut -f1))"
  else
    rm -f "${file}.partial"
    echo "$(date '+%F %T') Backup FAILED" >&2
  fi
  find /backups -name 'calendar_*.dump' -mtime +"$KEEP_DAYS" -delete
  sleep "$INTERVAL_SECONDS"
done
