import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// the UI the gateway serves at {basePath}/ui/: relative paths, so it works under any base path
export default defineConfig({
	root: __dirname,
	base: './',
	plugins: [react()],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		chunkSizeWarningLimit: 8000
	},
	worker: { format: 'es' }
})
