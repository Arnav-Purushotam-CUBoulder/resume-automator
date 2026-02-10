import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Desktop production uses file:// URLs; relative asset paths avoid blank windows.
  base: command === 'build' ? './' : '/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4100',
        changeOrigin: true,
      },
      '/artifacts': {
        target: 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
}));
