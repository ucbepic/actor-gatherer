// What concerns this page, from the app's backend (core.py's `_Page`): its documents' changes (`doc`, each with its
// tab), the live notices (`live`: a built preview changed) -- the backend's messages to its panels (the SDK's
// onMessage), each addressed to one page (`to`: this page's `conn`), the others' ignored. The page joins (page/join),
// says it is still there every ALIVE ms (page/alive) -- let go meanwhile, it joins again, its documents with it
// (`down`, then `open`: yjs-doc.ts) -- and leaves as it goes (page/leave). The agent's tool calls come through the
// SDK too (tools.ts).
//
// DocWriter's own page asks for the live notices with `new EventSource('/api/live')` (in its page, its preview
// button, its preview page): those get a stand-in fed from this bus (`installLive`) -- the preview page, in a frame
// of this one or a window it opened, from this page's.
import { base } from './base';
import { ag } from './ag';

type Handler = (value: any) => void;
export interface Bus {
	conn: string;
	on(name: string, h: Handler): () => void;
	isOpen(): boolean;
}

const RealEventSource = window.EventSource;
const ALIVE = 10_000;
const json = { 'Content-Type': 'application/json' };

export function makeBus(): Bus {
	const conn = crypto.randomUUID();
	const handlers = new Map<string, Set<Handler>>();
	let open = false;
	const emit = (name: string, v: unknown) => { for (const h of [...(handlers.get(name) ?? [])]) h(v); };
	const say = (what: string) => fetch(`${base}/page/${what}`, { method: 'POST', headers: json, body: JSON.stringify({ conn }), keepalive: what === 'leave' });
	const join = async () => {
		try {
			const res = await say('join');
			if (!res.ok) return;
		} catch { return; }
		open = true;
		emit('open', null);
	};
	ag().onMessage((m) => { if (m && m.to === conn && typeof m.name === 'string') emit(m.name, m.value); });
	void join();
	setInterval(async () => {
		let alive = false;
		try { alive = !!(await (await say('alive')).json()).alive; } catch { /* the dashboard away a moment */ }
		if (alive) return;
		if (open) { open = false; emit('down', null); }
		await join();
	}, ALIVE);
	addEventListener('pagehide', () => { void say('leave').catch(() => {}); });
	return {
		conn,
		isOpen: () => open,
		on(name, h) {
			if (!handlers.has(name)) handlers.set(name, new Set());
			handlers.get(name)!.add(h);
			return () => handlers.get(name)?.delete(h);
		}
	};
}

/** Resolves once the bus is open: what is asked of the dashboard about this page's stream waits for it. */
export function whenOpen(bus: Bus): Promise<void> {
	return new Promise((resolve) => {
		if (bus.isOpen()) return resolve();
		const off = bus.on('open', () => { off(); resolve(); });
	});
}

/** A stand-in for DocWriter's EventSource of its live notices, fed from `bus`. */
class LiveSource extends EventTarget {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSED = 2;
	readyState = 0;
	onopen: ((ev: Event) => void) | null = null;
	onerror: ((ev: Event) => void) | null = null;
	onmessage: ((ev: MessageEvent) => void) | null = null;
	withCredentials = false;
	private offs: Array<() => void> = [];

	constructor(readonly url: string, bus: Bus) {
		super();
		const opened = () => {
			this.readyState = 1;
			const ev = new Event('open');
			this.dispatchEvent(ev);
			this.onopen?.(ev);
			this.dispatchEvent(new MessageEvent('connected', { data: '{}' }));
		};
		this.offs.push(bus.on('open', opened));
		this.offs.push(bus.on('down', () => {
			this.readyState = 0;
			const ev = new Event('error');
			this.dispatchEvent(ev);
			this.onerror?.(ev);
		}));
		this.offs.push(bus.on('live', (v: { event: string; data: unknown }) => {
			this.dispatchEvent(new MessageEvent(v.event, { data: JSON.stringify(v.data ?? {}) }));
		}));
		if (bus.isOpen()) setTimeout(opened);
	}

	close(): void {
		for (const off of this.offs.splice(0)) off();
		this.readyState = 2;
	}
}

/** `new EventSource(<base>/api/live)` answered from `bus`; any other EventSource is the browser's. */
export function installLive(bus: Bus | null): void {
	if (!bus) return;
	const live = `${base}/api/live`;
	function EventSourceShim(this: unknown, url: string | URL, init?: EventSourceInit) {
		const u = new URL(String(url), location.href);
		if (u.origin === location.origin && u.pathname === live) return new LiveSource(u.href, bus!);
		return new RealEventSource(url, init);
	}
	Object.assign(EventSourceShim, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });
	EventSourceShim.prototype = RealEventSource.prototype;
	(window as any).EventSource = EventSourceShim;
}
