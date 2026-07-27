import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

import { mockApi } from './demo/mock-api.ts'

/**
 * Виджет собирается в один самодостаточный файл `dist/widget.js`.
 * Его подключают на чужой сайт строчкой <script src=".../widget.js" defer>,
 * поэтому: формат IIFE, никаких внешних зависимостей, стили внутри бандла
 * (виджет монтируется в Shadow DOM и стили сайта в него не протекают).
 *
 * В режиме разработки поднимается демо-страница `index.html` — витрина
 * агентства недвижимости с виджетом в углу — и мок API чата, чтобы смотреть
 * виджет без базы и ключа Anthropic. В сборку ничего из этого не попадает.
 */
export default defineConfig({
  plugins: [preact(), mockApi()],
  server: { port: 5174 },
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
