import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // This project keeps its Vite variables in `src/.env`.
  envDir: 'src',
})
