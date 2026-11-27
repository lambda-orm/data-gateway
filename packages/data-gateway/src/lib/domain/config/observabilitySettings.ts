import { ObservabilityConfig } from '@lambdaorm/base'
import { ExploreConfig } from './dataGatewayConfig'

type Raw = Record<string, any>
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The sections of observability (docs/DATA_GATEWAY.md §8.2): what an override of the administration replaces, whole */
export const OBSERVABILITY_SECTIONS = ['serviceName', 'resource', 'exporter', 'traces', 'metrics', 'logs', 'explore'] as const
export type ObservabilitySection = typeof OBSERVABILITY_SECTIONS[number]

const EXPLORE_KEYS = ['grafana', 'tempo', 'prometheus', 'loki', 'orgId']

/**
 * observability.explore: where a person sees what the gateway sends, in Grafana: the traces (Tempo), the metrics
 * (Prometheus) and the logs (Loki), each by the uid of its datasource (tempo, prometheus, loki when not given)
 */
export const readExplore = (raw: unknown, issues: string[], key = 'observability.explore'): ExploreConfig | undefined => {
	if (raw === undefined || raw === null) return undefined
	if (!isObject(raw)) {
		issues.push(`${key} must be an object: { grafana, tempo, prometheus, loki, orgId }`)
		return undefined
	}
	const unknown = Object.keys(raw).filter(k => !EXPLORE_KEYS.includes(k))
	if (unknown.length) issues.push(`${key}: unknown keys ${unknown.join(', ')} (${EXPLORE_KEYS.join(', ')})`)
	const grafana = raw.grafana
	if (typeof grafana !== 'string' || !/^https?:\/\/[^\s]+$/.test(grafana)) {
		issues.push(`${key}.grafana: the URL of Grafana (http or https)`)
		return undefined
	}
	const uid = (name: 'tempo' | 'prometheus' | 'loki'): string => {
		const value = raw[name] === undefined || raw[name] === null ? name : String(raw[name]).trim()
		if (!value) issues.push(`${key}.${name}: the uid of the datasource of ${name[0].toUpperCase()}${name.slice(1)}`)
		return value
	}
	const orgId = raw.orgId === undefined ? 1 : Number(raw.orgId)
	if (!Number.isInteger(orgId) || orgId < 1) issues.push(`${key}.orgId: an integer, 1 or more`)
	return { grafana: grafana.replace(/\/+$/, ''), tempo: uid('tempo'), prometheus: uid('prometheus'), loki: uid('loki'), orgId: Number.isInteger(orgId) && orgId >= 1 ? orgId : 1 }
}

/**
 * The part of observability that goes to the SDK of λORM (without explore, which is of the gateway). Its exporter
 * never has headers: they carry tokens, and go only in OTEL_EXPORTER_OTLP_HEADERS.
 */
export const readObservabilitySdk = (raw: unknown, issues: string[], key = 'observability'): ObservabilityConfig | undefined => {
	if (raw === undefined || raw === null) return undefined
	if (!isObject(raw)) {
		issues.push(`${key} must be an object (the same shape as infrastructure.observability of a lambdaORM.yaml)`)
		return undefined
	}
	if (raw.exporter?.headers !== undefined) {
		issues.push(`${key}.exporter.headers is not allowed: the headers carry tokens; use OTEL_EXPORTER_OTLP_HEADERS`)
	}
	const sdk: Raw = { ...raw }
	delete sdk.explore
	return sdk as ObservabilityConfig
}

/** An override of the administration: only the sections of observability, each an object (serviceName a text) */
export const readObservabilityOverride = (raw: unknown, issues: string[]): Raw | undefined => {
	if (!isObject(raw)) {
		issues.push(`the observability is an object of ${OBSERVABILITY_SECTIONS.join(', ')}`)
		return undefined
	}
	const unknown = Object.keys(raw).filter(k => !(OBSERVABILITY_SECTIONS as readonly string[]).includes(k))
	if (unknown.length) issues.push(`unknown sections of the observability: ${unknown.join(', ')} (${OBSERVABILITY_SECTIONS.join(', ')})`)
	for (const [section, value] of Object.entries(raw)) {
		if (section === 'serviceName') { if (typeof value !== 'string' || !value) issues.push('serviceName: a text') } else if (value !== null && !isObject(value)) issues.push(`${section}: an object`)
	}
	return raw
}

/**
 * The observability that applies: the one of the YAML with the sections of the override replacing theirs, whole (a
 * section the override doesn't say stays as the YAML has it; one it says null goes)
 */
export const mergeObservability = (yaml: { observability?: ObservabilityConfig, explore?: ExploreConfig }, override: Raw | undefined): Raw | undefined => {
	const base: Raw = { ...(yaml.observability ?? {}), ...(yaml.explore ? { explore: yaml.explore } : {}) }
	if (!override) return Object.keys(base).length ? base : undefined
	const merged: Raw = { ...base }
	for (const [section, value] of Object.entries(override)) {
		if (value === null) delete merged[section]
		else merged[section] = value
	}
	return Object.keys(merged).length ? merged : undefined
}
