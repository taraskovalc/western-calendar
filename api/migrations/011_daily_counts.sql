-- 011: anonymous daily totals, to see how many people Slotted helps.
-- One row per day and kind ('calendar_file' = a calendar file downloaded,
-- 'calendar_link' = a new calendar link made). Only the number is stored:
-- nothing about who did it (no IP, no account, no device).
CREATE TABLE daily_counts (
  day   date    NOT NULL,
  kind  text    NOT NULL CHECK (kind IN ('calendar_file', 'calendar_link')),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
