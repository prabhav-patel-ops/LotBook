import { defineConfig } from 'vite';
export default defineConfig({ base: '/LotBook/', define: { __APP_VERSION__: JSON.stringify('1.6.2') }, build: { target: 'es2022' } });
