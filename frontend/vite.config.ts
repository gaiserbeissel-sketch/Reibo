import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发(dev)与本地预览(preview)共用：把 /api 等转到本机 uvicorn，否则浏览器请求会落在 Vite/静态服务器上 → 404。
const BACKEND_ORIGIN = 'http://127.0.0.1:8000'
const apiProxy = {
  '/api': { target: BACKEND_ORIGIN, changeOrigin: true },
  '/static-data': { target: BACKEND_ORIGIN, changeOrigin: true },
  '/static': { target: BACKEND_ORIGIN, changeOrigin: true },
} as const

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // 允许局域网访问
    port: 5173,
    // frp 经域名访问时 Host 为 ruibo.us，须放行否则 Vite 会拒连接
    allowedHosts: ['ruibo.us', 'www.ruibo.us'],
    proxy: { ...apiProxy },
  },
  // npm run build && npm run preview：须同样代理，否则 POST /api/ipbrain/extract 会得到 404（仅 dev 有 proxy 时易忽略）
  preview: {
    host: '0.0.0.0',
    port: 4173,
    proxy: { ...apiProxy },
  },
})
