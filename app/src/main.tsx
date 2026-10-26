import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GuestApp } from './guest/GuestApp';
import { meetingInLocation } from './lib/meeting';
import { isTauri } from './lib/platform';
import './styles.css';

// In a browser the app only runs as a meeting guest (infimeety.pages.dev/web/?meet=CODE);
// the full app is desktop-only for now, except on the dev server.
const meeting = isTauri ? null : meetingInLocation();
if (!isTauri && !meeting && !import.meta.env.DEV) location.replace('/');

// No StrictMode: its double-mounted effects would open duplicate WebSocket/WebRTC sessions in dev.
createRoot(document.getElementById('root')!).render(<ErrorBoundary>{meeting ? <GuestApp code={meeting} /> : <App />}</ErrorBoundary>);
