/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// library build: ESM + CJS, styles.css; React, Monaco and js-yaml stay dependencies of the application
export default defineConfig({
	plugins: [react()],
	build: {
		outDir: 'build/lib',
		emptyOutDir: true,
		sourcemap: true,
		lib: {
			entry: resolve(__dirname, 'src/index.ts'),
			formats: ['es', 'cjs'],
			fileName: format => format === 'es' ? 'index.js' : 'index.cjs',
			cssFileName: 'styles'
		},
		rollupOptions: {
			external: ['react', 'react-dom', 'react/jsx-runtime', 'js-yaml', /^monaco-editor/]
		}
	},
	test: {
		environment: 'jsdom',
		include: ['tests/**/*.test.{ts,tsx}']
	}
})
