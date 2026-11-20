import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '../..', // read VITE_* settings from the project's root .env (only VITE_* reach the browser)
  server: { port: 5173, strictPort: true }, // must match WEB_ORIGINS in .env (CORS)
});
