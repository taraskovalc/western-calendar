-- 002: Western's 2026-27 undergraduate dates
-- Source: westerncalendar.uwo.ca/sessionaldates.cfm
INSERT INTO terms (academic_year, season, starts_on, ends_on, no_class_dates) VALUES
  ('2026-27', 'fall',   '2026-09-09', '2026-12-09',
     ARRAY['2026-09-30',                                                    -- Truth and Reconciliation
           '2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16' -- Fall reading week
          ]::date[]),
  ('2026-27', 'winter', '2027-01-04', '2027-04-09',
     ARRAY['2027-02-15','2027-02-16','2027-02-17','2027-02-18','2027-02-19', -- Winter reading week (incl. Family Day)
           '2027-03-26'                                                     -- Good Friday
          ]::date[]);
