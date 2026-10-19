-- 009: two new settings.
--   1. Theme can now be 'auto' (follow the device's light/dark setting), and
--      that's the new default. Accounts still on the old default ('light')
--      move to 'auto'; anyone who picked dark keeps dark.
--   2. Each schedule can have a calendar colour (#RRGGBB) that Apple Calendar
--      may use when someone subscribes to the calendar link. NULL = let the
--      calendar app choose.
ALTER TABLE users DROP CONSTRAINT users_theme_check;
UPDATE users SET theme = 'auto' WHERE theme = 'light';
ALTER TABLE users ALTER COLUMN theme SET DEFAULT 'auto';
ALTER TABLE users ADD CONSTRAINT users_theme_check CHECK (theme IN ('auto', 'light', 'dark'));

ALTER TABLE schedules ADD COLUMN calendar_color text
  CONSTRAINT schedules_calendar_color_check CHECK (calendar_color ~ '^#[0-9A-F]{6}$');
