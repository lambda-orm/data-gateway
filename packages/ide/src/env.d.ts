/// <reference types="vite/client" />
/** the version of the IDE (package.json), given by vite.config.ts */
declare const __APP_VERSION__: string
/** swagger-ui-react has no types of its own: what the IDE uses of it */
declare module 'swagger-ui-react' {
	import type { FC } from 'react'
	const SwaggerUI: FC<{ spec?: unknown, url?: string, tryItOutEnabled?: boolean, persistAuthorization?: boolean, requestInterceptor?: (request: any) => any }>
	export default SwaggerUI
}
declare module 'swagger-ui-react/swagger-ui.css'
