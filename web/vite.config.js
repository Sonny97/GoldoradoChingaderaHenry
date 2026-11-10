import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3003,
    open: true,
    strictPort: false,
    /**
     * Todo lo que empiece por /api se reenvia al BFF REST del puerto 3000
     * (bff/). El navegador ve un solo origen (localhost:3003), asi que CORS no
     * entra en juego en desarrollo y src/services pide rutas relativas
     * ('/api/...') que siguen valiendo al compilar para produccion.
     *
     * xfwd: true agrega X-Forwarded-For/Host/Proto. El BFF los usa para armar
     * las URL de retorno de OAuth y de Wompi con el host que ve el navegador
     * (localhost:3003 y no localhost:3000) y para aplicar el limite de
     * peticiones por la IP real del cliente y no por la del proxy.
     */
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
  preview: { port: 3003 },
});
