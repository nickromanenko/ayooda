import { defineConfig } from 'vite'

export default defineConfig({
  // The dashboard preview runs in a sandboxed srcdoc iframe (opaque origin).
  // CORS is only needed by the local module build; the production IIFE comes from the CDN.
  server: { cors: true },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'AyoodaWidget',
      fileName: () => 'widget.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    target: 'es2020',
    minify: true,
  },
})
