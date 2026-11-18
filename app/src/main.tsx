// First: crash recovery decides on Safe Mode before the stores read saved settings.
import './lib/boot';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GuestApp } from './guest/GuestApp';
import { getToken } from './lib/api';
import { meetingInLocation } from './lib/meeting';
import { startPhoneApp } from './lib/phone';
import { startErrorReports } from './lib/errors';
import { watchLite } from './lib/lite';
import { startPrefsSync } from './lib/prefsSync';
import { isTauri } from './lib/platform';
import './styles.css';

// Browsers get the whole app at infimeety.pages.dev/web/. A meeting link (/web/?meet=CODE)
// opens the guest flow, unless you're signed in here: then you join as yourself.
const meeting = isTauri ? null : meetingInLocation();
// The website's home page opens the web app directly for people who use it here.
if (!isTauri) {
  try {
    localStorage.setItem('infimeety.web', '1');
  } catch {
    /* private mode */
  }
}
startErrorReports();
startPhoneApp();
const asGuest = !!meeting && (!getToken() || new URLSearchParams(location.search).has('guest'));

// No StrictMode: its double-mounted effects would open duplicate WebSocket/WebRTC sessions in dev.
// Lite mode for slow PCs (lib/lite.ts), before the first paint.
watchLite();
// Theme, accent and wallpaper follow the account (lib/prefsSync.ts).
startPrefsSync();

createRoot(document.getElementById('root')!).render(<ErrorBoundary>{asGuest ? <GuestApp code={meeting} /> : <App />}</ErrorBoundary>);
