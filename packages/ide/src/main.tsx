import './monacoWorkers'
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@lambdaorm/ui/styles.css'
import './app.css'
import { AppShell } from './shared'
import { IdeApp } from './ide'

/** The IDE: connections to data-gateways, no login; its backend reaches them (docs/DATA_GATEWAY.md §11.9) */
createRoot(document.getElementById('root')!).render(
	<AppShell>{dark => <IdeApp dark={dark} />}</AppShell>
)
