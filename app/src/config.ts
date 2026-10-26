export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '');
export const WS_URL = API_URL.replace(/^http/, 'ws');
export const APP_VERSION = __APP_VERSION__;
/** Windows and Mac downloads; the web app links here. */
export const DOWNLOAD_PAGE = 'https://infimeety.pages.dev/download';
/** The privacy policy on the website. */
export const PRIVACY_PAGE = 'https://infimeety.pages.dev/privacy';
