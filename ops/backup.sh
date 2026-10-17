#!/bin/sh
# Nightly database backups, run by the "backup" container in docker-compose.yml.
#
# Every 24 hours: dump the whole database into /backups (which is
# /srv/backups/western-calendar on the server), then delete dumps older than
# KEEP_DAYS days. The first backup happens as soon as the container starts.
# If a backup fails (for example the database is still starting after a
# reboot), it tries again after RETRY_SECONDS instead of waiting a whole day.
#
# Restore one with (see README.md):
#   docker compose exec -T db pg_restore -U calendar -d calendar --clean --if-exists < FILE.dump
set -eu

KEEP_DAYS="${KEEP_DAYS:-14}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-86400}"
RETRY_SECONDS="${RETRY_SECONDS:-600}"

while true; do
  # Wait up to 2 minutes for the database to accept connections.
  tries=0
  until pg_isready --quiet || [ "$tries" -ge 24 ]; do
    tries=$((tries + 1))
    sleep 5
  done

  stamp="$(date +%Y-%m-%d_%H%M)"
  file="/backups/calendar_${stamp}.dump"
  # Write to a temporary name first, so a half-finished dump is never mistaken
  # for a good one.
  if pg_dump --format=custom --file="${file}.partial"; then
    mv "${file}.partial" "${file}"
    echo "$(date '+%F %T') Backup saved: $(basename "$file") ($(du -h "$file" | cut -f1))"
  else
    rm -f "${file}.partial"
    echo "$(date '+%F %T') Backup FAILED, trying again in $((RETRY_SECONDS / 60)) minutes" >&2
    sleep "$RETRY_SECONDS"
    continue
  fi
  find /backups -name 'calendar_*.dump' -mtime +"$KEEP_DAYS" -delete
  sleep "$INTERVAL_SECONDS"
done
