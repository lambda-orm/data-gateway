/** A set of listeners of one kind of event: subscribe answers how to unsubscribe; a failing listener doesn't stop the rest */
export class Listeners<T> {
	private readonly listeners = new Set<(value: T) => void>()

	public subscribe (listener: (value: T) => void): () => void {
		this.listeners.add(listener)
		return () => { this.listeners.delete(listener) }
	}

	public emit (value: T): void {
		for (const listener of [...this.listeners]) {
			try { listener(value) } catch { /* a listener's problem */ }
		}
	}
}
