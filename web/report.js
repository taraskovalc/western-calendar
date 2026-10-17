// "Report a problem": sends the form to the Slotted API, which emails it to Taras.
// Nothing is opened in the visitor's own email app.
import { api, ApiUnavailable } from './api.js';

const form = document.querySelector('#report-form');
const status = document.querySelector('#report-status');
const send = document.querySelector('#report-send');
const MAX_FILE_BYTES = 700 * 1024;

// A friendly guess like "Safari on iPhone", which the person can correct.
function guessDevice() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'a device';
  return `${browser} on ${device}`;
}
form.elements.device.value = guessDevice();

// report.html?step=add-to-calendar  ->  that step is picked already.
const step = new URLSearchParams(location.search).get('step');
if (step && [...form.elements.step.options].some(o => o.value === step)) form.elements.step.value = step;

const setStatus = (text, error = false) => {
  status.textContent = text;
  status.classList.toggle('error', error);
};

// The file goes along as base64 text inside the JSON.
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (send.disabled) return;
  const message = form.elements.message.value.trim();
  if (message.length < 10) {
    setStatus('Tell me a little more about what went wrong (at least 10 characters).', true);
    form.elements.message.focus();
    return;
  }
  const file = form.elements.file.files[0];
  if (file && (!/\.html?$/i.test(file.name) || file.size > MAX_FILE_BYTES)) {
    setStatus('Only the saved schedule page (.html) can be attached, and it should be under 700 KB.', true);
    return;
  }

  const body = {
    message,
    ...(form.elements.step.value && { step: form.elements.step.value }),
    ...(form.elements.email.value.trim() && { email: form.elements.email.value.trim() }),
    ...(form.elements.device.value.trim() && { device: form.elements.device.value.trim() }),
    ...(form.elements.website.value && { website: form.elements.website.value }),
  };
  send.disabled = true;
  setStatus('Sending…');
  try {
    if (file) body.file = { name: file.name, content: await readFile(file) };
    await api('/report', { method: 'POST', body });
    form.hidden = true;
    const sent = document.querySelector('#report-sent');
    if (!body.email) document.querySelector('#report-sent-text').textContent = 'I read every report. You didn\'t leave an email, so I won\'t be able to reply, but I\'ll use it to fix the problem.';
    sent.hidden = false;
    sent.focus();
  } catch (err) {
    setStatus(err instanceof ApiUnavailable
      ? "Your report couldn't be sent because Slotted's server isn't reachable right now. Please try again later."
      : err.message, true);
  } finally {
    send.disabled = false;
  }
});
