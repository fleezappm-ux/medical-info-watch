import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// リポジトリ名を変更する場合は base も合わせて変更すること
export default defineConfig({
  base: '/medical-info-watch/',
  plugins: [react()],
})
