/**
 * The themes of the app, as Ilusor has them (services/app/src/shared/theme/themes.ts): each one with its colors and
 * whether it is dark (the editors and the drawings follow that). `system` takes light or dark as the system says.
 */
export interface ThemeColors { background: string, surface: string, border: string, text: string, muted: string, primary: string }
export interface ThemeDefinition { id: string, name: string, dark: boolean, colors: ThemeColors }

export const THEMES: ThemeDefinition[] = [
	{ id: 'light', name: 'Light', dark: false, colors: { background: '#f7f8fa', surface: '#ffffff', border: '#e5e7eb', text: '#111827', muted: '#6b7280', primary: '#2f6fed' } },
	{ id: 'dark', name: 'Dark', dark: true, colors: { background: '#0f172a', surface: '#1e293b', border: '#334155', text: '#f1f5f9', muted: '#94a3b8', primary: '#3b82f6' } },
	{ id: 'dracula', name: 'Dracula', dark: true, colors: { background: '#21222c', surface: '#282a36', border: '#44475a', text: '#f8f8f2', muted: '#a4acc9', primary: '#bd93f9' } },
	{ id: 'night', name: 'Night', dark: true, colors: { background: '#16161e', surface: '#1a1b26', border: '#292e42', text: '#c0caf5', muted: '#787c99', primary: '#7aa2f7' } },
	{ id: 'nord', name: 'Nord', dark: true, colors: { background: '#2e3440', surface: '#3b4252', border: '#4c566a', text: '#eceff4', muted: '#a3adbf', primary: '#88c0d0' } },
	{ id: 'solarized-light', name: 'Solarized Light', dark: false, colors: { background: '#eee8d5', surface: '#fdf6e3', border: '#e0d9c3', text: '#073642', muted: '#657b83', primary: '#268bd2' } },
	{ id: 'solarized-dark', name: 'Solarized Dark', dark: true, colors: { background: '#00212b', surface: '#002b36', border: '#0d4150', text: '#eee8d5', muted: '#839496', primary: '#268bd2' } },
	{ id: 'monokai', name: 'Monokai', dark: true, colors: { background: '#1e1f1c', surface: '#272822', border: '#3e3d32', text: '#f8f8f2', muted: '#a59f85', primary: '#66d9ef' } },
	{ id: 'high-contrast', name: 'High Contrast', dark: false, colors: { background: '#ffffff', surface: '#ffffff', border: '#000000', text: '#000000', muted: '#2b2b2b', primary: '#0033cc' } }
]

export const themeOf = (id: string, systemDark: boolean): ThemeDefinition =>
	THEMES.find(t => t.id === id) ?? THEMES.find(t => t.id === (systemDark ? 'dark' : 'light'))!

/** The variables of app.css (and, through them, of the workspace) for a theme */
export const themeVariables = (theme: ThemeDefinition): Record<string, string> => ({
	'--bg': theme.colors.surface,
	'--panel': theme.colors.background,
	'--fg': theme.colors.text,
	'--muted': theme.colors.muted,
	'--border': theme.colors.border,
	'--accent': theme.colors.primary
})

/** The cultures offered for the numbers and dates (the browser knows them all) */
export const CULTURES = ['en-US', 'en-GB', 'es-ES', 'es-AR', 'es-MX', 'es-CL', 'es-CO', 'pt-BR', 'pt-PT', 'fr-FR', 'it-IT', 'de-DE', 'nl-NL', 'ca-ES', 'gl-ES', 'eu-ES']
