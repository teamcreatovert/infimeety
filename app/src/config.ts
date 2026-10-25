export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8787').replace(/\/$/, '');
export const WS_URL = API_URL.replace(/^http/, 'ws');
export const APP_VERSION = __APP_VERSION__;
