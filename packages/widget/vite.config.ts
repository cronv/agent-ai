import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

/**
 * Виджет собирается в один самодостаточный файл `dist/widget.js`.
 * Его подключают на чужой сайт строчкой <script src=".../widget.js" defer>,
 * поэтому: формат IIFE, никаких внешних зависимостей, стили внутри бандла
 * (виджет монтируется в Shadow DOM и стили сайта в него не протекают).
 */
export default defineConfig({
  plugins: [preact()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/index.tsx',
      name: 'NovostroykiWidget',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
})
