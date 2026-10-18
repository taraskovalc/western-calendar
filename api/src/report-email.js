// Builds the "Report a problem" email that lands in Slotted's inbox.
//
// Every value here came from a stranger's form, so all of it is escaped before
// it goes into the HTML. Styles are inline because email apps (Gmail included)
// ignore most <style> blocks.

export const STEPS = {
  'sign-in': 'Signing in',
  'calendar-app': 'Choosing a calendar app',
  schedule: 'Adding the schedule file',
  'add-to-calendar': 'Adding classes to a calendar',
  'calendar-link': 'The calendar link',
  other: 'Something else',
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lines = text => esc(text).replace(/\r?\n/g, '<br>');

const C = { ink: '#2b2620', muted: '#6b6257', accent: '#b4532a', paper: '#fbf7ef', line: '#e7dfd0', field: '#f3ede1', bad: '#b03a2e', good: '#2f7d4f' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

function when(date) {
  return date.toLocaleString('en-CA', { timeZone: 'America/Toronto', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// A short preview of the message for the subject line.
function snippet(message, max = 60) {
  const one = message.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/**
 * @param {object} r  the validated report
 * @param {boolean} signedIn
 * @param {Date} [now]
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildReportEmail(r, signedIn, now = new Date()) {
  const where = r.step ? STEPS[r.step] : 'Not chosen';
  const subject = `Slotted report: "${snippet(r.message)}"`;

  /* ---------- plain text (for email apps that don't show HTML) ---------- */
  const text = [
    r.message,
    '',
    '----',
    `Where: ${where}`,
    `Reply to: ${r.email || 'No email given, so no reply is possible'}`,
    `Device: ${r.device || 'Unknown'}`,
    `Signed in: ${signedIn ? 'Yes' : 'No'}`,
    `Sent: ${when(now)}`,
    ...(r.schedule ? ['', r.schedule.read
      ? `Schedule file: Slotted read ${r.schedule.rows.length} meeting times${r.schedule.year ? ` (${r.schedule.year})` : ''}.`
      : `Schedule file: Slotted couldn't read it: ${r.schedule.error}`,
    ...(r.schedule.rows ?? []).map(x => `  ${x.course} ${x.type} ${x.section}  ${x.days}  ${x.time}  ${x.room}`.trimEnd()),
    ...(r.schedule.notes ?? []).map(n => `  Note: ${n}`),
    ...(r.schedule.table ? ['', 'Class list text:', r.schedule.table] : [])] : []),
  ].join('\n');

  /* ---------- HTML ---------- */
  const row = (label, value) => `
    <tr>
      <td style="padding:9px 0;border-top:1px solid ${C.line};color:${C.muted};font-size:13px;width:110px;vertical-align:top">${label}</td>
      <td style="padding:9px 0;border-top:1px solid ${C.line};color:${C.ink};font-size:14px;vertical-align:top">${value}</td>
    </tr>`;

  const replyCell = r.email
    ? `<a href="mailto:${esc(r.email)}" style="color:${C.accent};text-decoration:none;font-weight:600">${esc(r.email)}</a>`
    : `<span style="color:${C.muted}">No email given, so no reply is possible</span>`;

  let scheduleBlock = '';
  if (r.schedule) {
    const s = r.schedule;
    const banner = s.read
      ? `<div style="padding:10px 14px;border-radius:8px;background:#e8f3ec;color:${C.good};font-size:14px;font-weight:600">Slotted read ${new Set(s.rows.map(x => x.course + x.type)).size} classes from their file${s.year ? ` (${esc(s.year)})` : ''}.</div>`
      : `<div style="padding:10px 14px;border-radius:8px;background:#f8e6e3;color:${C.bad};font-size:14px"><b>Slotted couldn't read their file:</b> ${esc(s.error)}</div>`;
    const cell = (v, extra = '') => `<td style="padding:6px 8px;border-top:1px solid ${C.line};font-size:13px;color:${C.ink};${extra}">${esc(v)}</td>`;
    const table = s.rows?.length ? `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-top:12px">
        <tr>${['Course', 'Type', 'Sec', 'Days', 'Time', 'Room'].map(h => `<td style="padding:6px 8px;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:${C.muted}">${h}</td>`).join('')}</tr>
        ${s.rows.map(x => `<tr>${cell(x.course, 'font-weight:600;white-space:nowrap')}${cell(x.type)}${cell(x.section)}${cell(x.days, 'white-space:nowrap')}${cell(x.time, 'white-space:nowrap')}${cell(x.room)}</tr>`).join('')}
      </table>` : '';
    const notes = s.notes?.length
      ? `<ul style="margin:12px 0 0;padding-left:18px;color:${C.muted};font-size:13px">${s.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
    const raw = s.table
      ? `<p style="margin:18px 0 6px;font-size:12px;color:${C.muted}">The class list as text, straight from their file:</p>
         <div style="padding:10px 12px;border-radius:8px;background:${C.field};font:12px/1.5 ${MONO};color:${C.ink};white-space:pre-wrap;word-break:break-word">${lines(s.table)}</div>` : '';
    scheduleBlock = `
      <tr><td style="padding:26px 28px 0">
        <div style="font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:${C.muted};margin-bottom:10px">Their schedule</div>
        ${banner}${table}${notes}${raw}
      </td></tr>`;
  }

  const replyButton = r.email ? `
      <tr><td style="padding:22px 28px 0">
        <a href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Re: your Slotted report')}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:${C.accent};color:#fff;font-weight:600;font-size:14px;text-decoration:none">Reply to ${esc(r.email)}</a>
      </td></tr>` : '';

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#efe7d8">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#efe7d8;padding:24px 12px;font-family:${FONT}">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:${C.paper};border-radius:12px;overflow:hidden;border:1px solid ${C.line}">
      <tr><td style="background:${C.accent};padding:14px 28px;color:#fff;font-size:14px;font-weight:600;letter-spacing:.3px">Slotted · Problem report</td></tr>
      <tr><td style="padding:24px 28px 0">
        <div style="font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:${C.muted}">${esc(where)} · ${esc(when(now))}</div>
        <div style="margin-top:12px;padding:16px 18px;border-radius:10px;background:#fff;border:1px solid ${C.line};border-left:4px solid ${C.accent};font-size:16px;line-height:1.55;color:${C.ink}">${lines(r.message)}</div>
      </td></tr>
      ${replyButton}
      <tr><td style="padding:22px 28px 0">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
          ${row('Reply to', replyCell)}
          ${row('Where', esc(where))}
          ${row('Device', esc(r.device || 'Unknown'))}
          ${row('Signed in', signedIn ? 'Yes' : 'No')}
          ${row('Schedule', r.schedule ? (r.schedule.read ? 'Added, see below' : 'Added, but unreadable, see below') : `<span style="color:${C.muted}">Not added</span>`)}
        </table>
      </td></tr>
      ${scheduleBlock}
      <tr><td style="padding:26px 28px 24px;color:${C.muted};font-size:12px;line-height:1.5">
        Sent from the Report a problem form on slotted.taraskoval.ca. Nothing in this report is stored on the server.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { subject, text, html };
}
