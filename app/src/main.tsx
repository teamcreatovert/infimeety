import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// No StrictMode: its double-mounted effects would open duplicate WebSocket/WebRTC sessions in dev.
createRoot(document.getElementById('root')!).render(<App />);
