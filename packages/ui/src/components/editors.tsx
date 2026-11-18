import React from 'react'
import { CodeEditor, CodeEditorProps } from './CodeEditor'

type EditorProps = Omit<CodeEditorProps, 'language' | 'ariaLabel'> & { ariaLabel?: string }

/** A λORM query, with the autocompletion of the schema's domain (after setSchemaTypings) */
export const QueryEditor: React.FC<EditorProps> = props => <CodeEditor ariaLabel="query" {...props} language="typescript" />

/** A 3xpr script (executeScript) */
export const ScriptEditor: React.FC<EditorProps> = props => <CodeEditor ariaLabel="script" height={220} {...props} language="javascript" />

/** JSON: the data of a query, its options */
export const DataEditor: React.FC<EditorProps> = props => <CodeEditor ariaLabel="data" height={110} {...props} language="json" />
