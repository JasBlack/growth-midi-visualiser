import { defineConfig } from 'vite'

export default defineConfig({
  // Organism / Crystal render with three's WebGPURenderer (WebGL2 fallback when
  // navigator.gpu is missing). Alias bare `three` → the WebGPU build so loaders
  // (GLTFLoader, OBJLoader, STLLoader) share ONE three instance with it.
  resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] },
  // Relative asset urls: the built folder can be served from any path, and the
  // release script inlines the bundle into a single self-contained HTML file.
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
  server: { port: 5180 },
})
