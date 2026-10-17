-- 008: the webpage also offers "Other" as a calendar app, so allow it here.
-- (Migration 001 only allowed apple, google and outlook, so saving a schedule
-- with "Other" chosen was refused.)
ALTER TABLE schedules DROP CONSTRAINT schedules_calendar_app_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_calendar_app_check
  CHECK (calendar_app IN ('apple', 'google', 'outlook', 'other'));
