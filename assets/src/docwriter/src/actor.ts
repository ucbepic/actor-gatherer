// The actor DocWriter's agent is (its first attached agent: ag.ts), as the dashboard's page sees it: its status,
// whether its turn is over, what it asks -- the SDK's agents.state, told again on each change -- and the dashboard's
// theme, light or dark.
import { ag, agent, type AgState } from './ag';

export type Actor = AgState;

const listeners = new Set<() => void>();
const themeListeners = new Set<(theme: string) => void>();
let theme: string | null = null;

/** Called once the SDK is connected (main.ts): the actor's and the theme's changes passed on. */
export function wireActor(): void {
	const a = ag();
	const told = () => { for (const l of [...listeners]) l(); };
	a.agents.onState(told);
	a.agents.onChange(told);
	theme = a.theme.current?.mode ?? null;
	a.theme.on((t) => {
		if (t.mode === theme) return;
		theme = t.mode;
		for (const l of [...themeListeners]) l(theme);
	});
}

/** The dashboard's theme, light or dark (null: not known). */
export const dashboardTheme = (): string | null => theme;

/** Called with the dashboard's theme, light or dark, each time it changes. */
export function onTheme(l: (theme: string) => void): void {
	themeListeners.add(l);
}

export const current = (): Actor | null => {
	const ch = agent();
	return ch ? ag().agents.state(ch) : null;
};

/** Called on each change of the actor; the returned function stops it. */
export function onActor(l: () => void): () => void {
	listeners.add(l);
	return () => listeners.delete(l);
}
