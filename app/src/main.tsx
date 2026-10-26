import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GuestApp } from './guest/GuestApp';
import { getToken } from './lib/api';
import { meetingInLocation } from './lib/meeting';
import { isTauri } from './lib/platform';
import './styles.css';

// Browsers get the whole app at infimeety.pages.dev/web/. A meeting link (/web/?meet=CODE)
// opens the guest flow, unless you're signed in here: then you join as yourself.
const meeting = isTauri ? null : meetingInLocation();
const asGuest = !!meeting && (!getToken() || new URLSearchParams(location.search).has('guest'));

// No StrictMode: its double-mounted effects would open duplicate WebSocket/WebRTC sessions in dev.
createRoot(document.getElementById('root')!).render(<ErrorBoundary>{asGuest ? <GuestApp code={meeting} /> : <App />}</ErrorBoundary>);
