// Builds a made-up saved DraftMySchedule "My Current Schedule" page for tests.
// Every name, course and number here is invented: no real student data.
// Built in code because .gitignore keeps saved *.html pages out of the repo.

export const COURSES = [
  { subject: 'TEST', number: '1000A', description: 'INTRO TO TESTING II', component: 'LEC', section: '001', classNbr: '1111',
    meetings: [['M W', '02:30 PM-03:30 PM', 'MC-110'], ['F', '09:30 AM-10:30 AM', 'MC-110']], instructor: 'Staff', delivery: 'In Person', status: 'Enrolled' },
  { subject: 'TEST', number: '1000A', description: 'INTRO TO TESTING II', component: 'LAB', section: '002', classNbr: '1112',
    meetings: [['Th', '11:30 AM-01:30 PM', 'NSC-7']], instructor: 'Staff', delivery: 'In Person', status: 'Enrolled' },
  { subject: 'MOCK', number: '2000B', description: 'SAMPLE DATA', component: 'LEC', section: '650', classNbr: '2222',
    meetings: [['Tu Th', '08:30 AM-10:30 AM', 'UCC-56']], instructor: 'Staff', delivery: 'In Person', status: 'Enrolled' },
  { subject: 'FAKE', number: '3000G', description: 'ONLINE ONLY', component: 'LEC', section: '001', classNbr: '3333',
    meetings: [['', 'TBA', '']], instructor: 'Staff', delivery: 'Online', status: 'Enrolled' },
];

const HEADERS = ['Subject', 'Course Number', 'Description', 'Component', 'Section', 'Class Nbr', 'Days/Times/Location', 'Instructor', 'Delivery Type', 'Status'];

const row = c => `<tr><td>${c.subject}</td><td>${c.number}</td><td>${c.description}</td><td>${c.component}</td><td>${c.section}</td><td>${c.classNbr}</td>
  <td><table>${c.meetings.map(m => `<tr>${m.map(t => `<td>${t}</td>`).join('')}</tr>`).join('')}</table></td>
  <td>${c.instructor}</td><td>${c.delivery}</td><td>${c.status}</td></tr>`;

export function schedulePage({ courses = COURSES, term = 'Fall/Winter 2026' } = {}) {
  // Like the real page: a term menu listing other years, then the class list
  // inside a layout table whose header cell holds the whole list.
  return `<!DOCTYPE html><html><head><title>DraftMySchedule</title></head><body>
  <select><option>Fall/Winter 2025</option><option>Summer 2026</option><option selected>Fall/Winter 2026</option></select>
  <h2>Class List for Test Student - ${term}</h2>
  <table><tr><td>
    <table>
      <tr>${HEADERS.map(h => `<th>${h}</th>`).join('')}</tr>
      ${courses.map(row).join('\n')}
    </table>
  </td></tr></table>
  </body></html>`;
}
