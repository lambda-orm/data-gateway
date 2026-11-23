import './monacoWorkers'
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@lambdaorm/ui/styles.css'
import './app.css'
import { AppShell } from './shared'
import { EmbeddedApp } from './embedded'
import { IdeApp } from './ide'

/**
 * One app, two ways: the IDE (its own image: connections to data-gateways, no login) and, built with --mode embedded,
 * the UI a data-gateway serves at {basePath}/ui (its login, its current connection).
 */
const EMBEDDED = import.meta.env.MODE === 'embedded'

createRoot(document.getElementById('root')!).render(
	<AppShell>{dark => EMBEDDED ? <EmbeddedApp dark={dark} /> : <IdeApp dark={dark} />}</AppShell>
)
