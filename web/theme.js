// Light or dark: "Auto" (the default) follows the device's own setting, live.
// A choice is remembered in this browser; app.js also saves it to the account
// of a signed-in user, so it follows them to other devices.
// (index.html runs a tiny copy of applyTheme before the page draws, to avoid a flash.)
const KEY = 'slotted-theme';
const THEMES = ['auto', 'light', 'dark'];
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const radios = [...document.querySelectorAll('input[name="theme"]')];

let choice = 'auto';
try { choice = localStorage.getItem(KEY) ?? 'auto'; } catch { /* storage blocked */ }

export const currentTheme = () => choice;

export function applyTheme(wanted) {
  choice = THEMES.includes(wanted) ? wanted : 'auto';
  const dark = choice === 'dark' || (choice === 'auto' && systemDark.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  for (const radio of radios) radio.checked = radio.value === choice;
}

// Pass null to forget the choice (after signing out).
export function cacheTheme(value) {
  try { if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

// onChoose runs after the person picks a theme with the switch.
export function initThemeSwitch(onChoose) {
  for (const radio of radios) radio.addEventListener('change', () => {
    applyTheme(radio.value);
    cacheTheme(choice);
    onChoose(choice);
  });
  // In Auto, switch the moment the device does (for example at sunset).
  systemDark.addEventListener('change', () => { if (choice === 'auto') applyTheme('auto'); });
  applyTheme(choice);
}
