// Western's undergraduate term dates, for pages that work without the server
// (guest mode). The same dates live in the database (migration 002) for the API.
// Source: westerncalendar.uwo.ca/sessionaldates.cfm
// Each new school year: add an entry here AND a new migration on the server.

const range = (startIso, days) => Array.from({ length: days }, (_, i) => {
  const d = new Date(`${startIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});

export const TERM_DATES = {
  '2026-27': [
    {
      season: 'fall', starts_on: '2026-09-09', ends_on: '2026-12-09',
      no_class_dates: ['2026-09-30', ...range('2026-10-12', 5)],
      labels: { '2026-09-30': 'National Day for Truth and Reconciliation', '2026-10-12': 'Fall reading week' },
      // 6-week quarter courses (Q = first half of fall, R = second half)
      quarters: { Q: ['2026-09-09', '2026-10-28'], R: ['2026-10-29', '2026-12-09'] },
    },
    {
      season: 'winter', starts_on: '2027-01-04', ends_on: '2027-04-09',
      no_class_dates: [...range('2027-02-15', 5), '2027-03-26'],
      labels: { '2027-02-15': 'Winter reading week', '2027-03-26': 'Good Friday' },
      // 6-week quarter courses (S = first half of winter, T = second half)
      quarters: { S: ['2027-01-04', '2027-02-12'], T: ['2027-02-22', '2027-04-09'] },
    },
  ],
};

export const LATEST_YEAR = '2026-27';
