import { defineConfig } from 'vite'

// GitHub Project Pages: https://<user>.github.io/<repo>/
// Keep this in sync with your GitHub repository name.
const repoBase = '/preditor/'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? repoBase : '/',
  optimizeDeps: {
    exclude: ['latex.js']
  }
}))
