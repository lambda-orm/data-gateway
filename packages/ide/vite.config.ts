import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// the data-gateway-ide (its own image, served by server/server.mjs): relative paths, so it works under any base path.
// npm run dev: its requests to /gw/ go to the backend (npm start, DATA_GATEWAY_IDE_TARGETS=* on port 8080)
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
	worker: { format: 'es' },
	server: { proxy: { '/gw/': { target: 'http://127.0.0.1:8080', ws: true } } }
})
