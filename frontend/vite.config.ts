import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Dev: Vite serves the app with hot reload and forwards API calls to uvicorn, so the app
  // always uses same-origin URLs (apiBase ""), exactly as when the API serves the build.
  server: { port: 5173, strictPort: true, proxy: { "/v1": "http://localhost:8000" } },
})
