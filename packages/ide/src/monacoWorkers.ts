// Monaco's workers, bundled with the app (no CDN: the Content-Security-Policy of /ui allows only this origin)
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

;(self as any).MonacoEnvironment = {
	getWorker (_id: string, label: string) {
		if (label === 'typescript' || label === 'javascript') return new TsWorker()
		if (label === 'json') return new JsonWorker()
		return new EditorWorker()
	}
}
