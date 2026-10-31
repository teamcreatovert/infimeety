import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const host = process.env.TAURI_DEV_HOST;
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

/** Dev only: the soundboard's pack at /sounds, built from the repo's sounds/ folder as the website does. */
function soundPack(): Plugin {
  const site = fileURLToPath(new URL('../server/pages/public', import.meta.url));
  const types: Record<string, string> = { '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.webm': 'audio/webm' };
  return {
    name: 'sound-pack',
    apply: 'serve',
    configureServer(server) {
      execFileSync(process.execPath, [fileURLToPath(new URL('../server/scripts/sound-pack.mjs', import.meta.url))], { stdio: 'inherit' });
      server.middlewares.use((req, res, next) => {
        const path = normalize(decodeURIComponent((req.url ?? '').split('?')[0]));
        const file = join(site, path);
        if (!path.replace(/\\/g, '/').startsWith('/sounds/') || !file.startsWith(site) || !existsSync(file)) return next();
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), soundPack()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'chrome110',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        overlay: fileURLToPath(new URL('./overlay.html', import.meta.url)),
      },
    },
  },
});
