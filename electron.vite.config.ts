import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const projectRoot = import.meta.dirname

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(projectRoot, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    build: {
      // A sandboxed preload cannot require anything at runtime, so everything
      // must be bundled into the single entry (docs/spec.md §10). A second
      // entry would make Rollup hoist shared imports into a chunk that the
      // sandbox then refuses to load.
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(projectRoot, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs', inlineDynamicImports: true },
      },
    },
  },
  renderer: {
    root: resolve(projectRoot, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          widget: resolve(projectRoot, 'src/renderer/widget/index.html'),
          settings: resolve(projectRoot, 'src/renderer/settings/index.html'),
          alert: resolve(projectRoot, 'src/renderer/alert/index.html'),
          quickadd: resolve(projectRoot, 'src/renderer/quickadd/index.html'),
        },
      },
    },
  },
})
