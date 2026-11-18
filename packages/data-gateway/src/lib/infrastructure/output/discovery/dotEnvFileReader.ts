import fs from 'fs'
import path from 'path'

/** KEY=value lines; # comments; optional quotes; `export KEY=value` accepted. No interpolation. */
export const parseDotEnv = (text: string): Record<string, string> => {
	const values: Record<string, string> = {}
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) continue
		const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(line)
		if (!match) continue
		let value = match[2].trim()
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
		else value = value.replace(/\s+#.*$/, '')
		values[match[1]] = value
	}
	return values
}

/** The .env of a workspace (folder of lambdaORM.yaml), if it has one */
export class DotEnvFileReader {
	public read (workspace: string): Record<string, string> {
		const dir = fs.existsSync(workspace) && fs.statSync(workspace).isDirectory() ? workspace : path.dirname(workspace)
		const file = path.join(dir, '.env')
		return fs.existsSync(file) ? parseDotEnv(fs.readFileSync(file, 'utf8')) : {}
	}
}
