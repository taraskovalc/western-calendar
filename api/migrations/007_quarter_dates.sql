-- 007: dates for 6-week quarter courses (course numbers ending in Q, R, S or T).
-- Q/R are the first/second half of fall, S/T the first/second half of winter.
-- Source: westerncalendar.uwo.ca/sessionaldates.cfm
ALTER TABLE terms ADD COLUMN quarters jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE terms SET quarters = '{"Q": ["2026-09-09", "2026-10-28"], "R": ["2026-10-29", "2026-12-09"]}'
 WHERE academic_year = '2026-27' AND season = 'fall';
UPDATE terms SET quarters = '{"S": ["2027-01-04", "2027-02-12"], "T": ["2027-02-22", "2027-04-09"]}'
 WHERE academic_year = '2026-27' AND season = 'winter';
