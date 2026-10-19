-- 010: a schedule can leave out labs and tutorials ('lectures'), or add only
-- them ('labs'). 'all' (the default) is everything, as before.
-- (Each lab's own "every other week" and first/last dates live inside the
-- courses JSON, as course.repeat, so they need no column.)
ALTER TABLE schedules ADD COLUMN include_parts text NOT NULL DEFAULT 'all'
  CONSTRAINT schedules_include_parts_check CHECK (include_parts IN ('all', 'lectures', 'labs'));
