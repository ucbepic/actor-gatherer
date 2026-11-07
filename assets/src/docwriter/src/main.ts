// DocWriter's page in the dashboard: this DocWriter's settings read (which folder, which actor), the page's server
// routes answered (backend.ts), the agent's tool calls taken (tools.ts), and DocWriter's own page mounted.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/latin-400-italic.css';
import '@fontsource/lora/latin-500.css';
import '@fontsource/lora/latin-600.css';
import '@fontsource/lora/latin-700.css';
import { mount } from 'svelte';
import { config, loadConfig } from './state';
import { setRoot } from './server/document-files';
import { install } from './backend';
import { serveTools } from './tools';
import { makeBus, installLive } from './bus';
import { useBus } from './yjs-doc';
import App from './App.svelte';
import { onTheme, wireActor } from './actor';
import { connectAg } from './ag';
import { selectedTheme } from '$lib/stores';
import { themes, applyTheme } from '$lib/themes';

await connectAg();                                // the dashboard around this frame (app_kit's SDK), first
wireActor();
await loadConfig();
setRoot(config.root);
(globalThis as { __dwWake?: boolean }).__dwWake = config.wake;   // a pause in typing wakes the agent (vite.config.mjs)
// DocWriter's menus, less what is not offered here: Word comments, style calibration and its study data, its own
// agent sessions, API keys and skills (the actor has its own model, login, sessions and skills)
const LEFT_OUT = new Set(['Import feedback…', 'Calibrate your style', 'Export study data', 'Sessions', 'API keys', 'Skills']);
(globalThis as any).__dwMenus = (menus: Array<{ items: Array<{ label?: string }> }>) =>
	menus.map((m) => ({ ...m, items: m.items.filter((i) => !LEFT_OUT.has(i.label ?? '')) }));
install();
if (!config.error) {
	const bus = makeBus();                       // the page's one stream: its documents, tool calls, notices
	(window as any).__dwBus = bus;               // for its preview page, in a frame or a window of its own
	useBus(bus);
	installLive(bus);
	serveTools(bus);
}
mount(App, { target: document.getElementById('app')! });
// DocWriter in the dashboard's light or dark: at its start (backend.ts, as its session is read), and each time the
// dashboard's changes (another of its themes, picked in its View menu, holds until then)
onTheme((name) => {
	const theme = themes.find((t) => t.name === (name === 'dark' ? 'dark' : 'light'));
	if (!theme) return;
	selectedTheme.set(theme.name);              // as its own View menu does: kept, and applied
	applyTheme(theme);
});
