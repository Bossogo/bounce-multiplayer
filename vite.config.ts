import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const wsPort = Number(env.VITE_WS_PORT || 3001);

  return {
    server: {
      port: 5173,
      proxy: {
        '/api/ws': {
          target: `ws://localhost:${wsPort}`,
          ws: true,
        },
        '/ws': {
          target: `ws://localhost:${wsPort}`,
          ws: true,
          rewrite: () => '/api/ws',
        },
      },
    },
  };
});
