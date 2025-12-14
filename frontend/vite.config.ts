import path from "path"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Allow Emergent preview domains to access the dev server during deploy/preview.
    // See: "Blocked request. This host (...) is not allowed."
    allowedHosts: [".preview.emergentagent.com", "deploy-analyzer-1.preview.emergentagent.com"],
    host: true,
  },
  preview: {
    allowedHosts: [".preview.emergentagent.com", "deploy-analyzer-1.preview.emergentagent.com"],
    host: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
