import { defineConfig } from 'vite';
export default defineConfig({ base: '/LotBook/', define: { __APP_VERSION__: JSON.stringify('1.2.0') }, build: { target: 'es2022' } });
