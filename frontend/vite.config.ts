import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 개발 시: Vite(5173) 가 /api 를 FastAPI(8000) 로 프록시한다.
// 아이폰에서 같은 Wi-Fi 로 테스트하려면 `npm run dev` 후 http://<PC IP>:5173 접속.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
