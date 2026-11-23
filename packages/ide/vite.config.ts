import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// the data-gateway-ide (its own image) and, with --mode embedded, the UI a gateway serves at {basePath}/ui/:
// relative paths, so it works under any base path
export default defineConfig({
	root: __dirname,
	base: './',
	plugins: [react()],
	define: { __APP_VERSION__: JSON.stringify(pkg.version) },
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		chunkSizeWarningLimit: 8000
	},
	worker: { format: 'es' }
})
