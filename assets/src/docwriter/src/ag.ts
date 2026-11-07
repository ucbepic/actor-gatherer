// The app's SDK (app_kit/js/app.js, which index.html loads from the app's own origin, /_ag/app.js): this page's one
// way to the dashboard around it -- its agent's state, transcript and messages, its tools' calls, its backend's
// messages, the theme. `connectAg` once, first (main.ts); `ag()` after.
export interface AgState {
	channel?: string; status?: string; turn_over?: boolean; name?: string | null;
	asking?: { call: string; harness?: string; questions?: Array<{ question: string; options?: Array<{ label: string }> }> } | null;
	failing?: { text?: string } | null; stopped?: { kind: string } | null;
	session?: { session_id?: string; terminal?: boolean } | null;
}
export interface Ag {
	gatherer: string;
	instance: string;
	agents: {
		attached: string[];
		onChange(cb: (attached: string[]) => void): void;
		state(channel: string): AgState | null;
		onState(cb: () => void): void;
		send(channel: string, text: string): Promise<unknown>;
		answer(channel: string, call: string, choice: unknown): Promise<unknown>;
		interrupt(channel: string): Promise<unknown>;
		transcript(channel: string, opts?: { after?: number }): Promise<{ items?: any[] }>;
	};
	tools: { handle(name: string, fn: (args: Record<string, unknown>) => unknown): void };
	theme: { current: { mode: string } | null; on(cb: (t: { mode: string }) => void): void };
	onMessage(cb: (m: any) => void): void;
}

let it: Ag | null = null;

export async function connectAg(): Promise<Ag> {
	it = await (globalThis as { AgApp?: { connect(): Promise<Ag> } }).AgApp!.connect();
	return it;
}

export const ag = (): Ag => it!;

/** This DocWriter's agent: the first attached to it (the one started with it), as the host has it. */
export const agent = (): string => it?.agents.attached[0] ?? '';
