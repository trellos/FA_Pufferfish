import { defineConfig } from 'vite';

export default defineConfig({
  // Production build serves under /<repo>/ on GitHub Pages. Dev + tests stay at /.
  base: process.env.VITE_BASE ?? (process.env.NODE_ENV === 'production' ? '/FA_Pufferfish/' : '/'),
  server: { port: 5173 },
  build: { target: 'es2020' },
});
