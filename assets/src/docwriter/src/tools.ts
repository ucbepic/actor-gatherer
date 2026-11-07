// The agent's document tools -- DocWriter's own (mcp-doc-tools.ts: edit_doc, read_doc, write_doc, comment_doc,
// reply_to_comment, list_threads), run here, on this page's documents. The agent calls them through the dashboard's
// tool gateway (docwriter_<tool>: the app's tools.json, written from tools-list.ts); the host passes each call to a
// panel of this DocWriter, and the page answers it through the SDK. Upstream's server opened a document
// through Hocuspocus to change it; here that handle opens the page's own copy (yjs-doc.ts), and the change reaches
// the dashboard and every other page as any edit does.
import { DOC_TOOLS } from '$lib/server/mcp-doc-tools';
import { getYDocForTab, whenYDocReadyForTab, waitForTabSync, saveTab } from './yjs-doc';
import { base } from './base';
import { noteTabs } from './state';
import type { Bus } from './bus';
import { ag } from './ag';

(globalThis as any).__docwriterWsServer = {
	hocuspocus: {
		async openDirectConnection(tabId: string) {
			const doc = getYDocForTab(tabId);
			await whenYDocReadyForTab(tabId);
			return {
				transact: async (cb: (doc: unknown) => void | Promise<void>) => { await cb(doc); },
				disconnect: async () => { await waitForTabSync(tabId); await saveTab(tabId); }
			};
		}
	}
};

export { TOOLS } from './tools-list';

/** One call, run as upstream's handler runs it, the tabs known as the dashboard has them now. */
async function run(name: string, args: Record<string, unknown>) {
	const tool = (DOC_TOOLS as readonly any[]).find((t) => t.name === name);
	if (!tool) return { content: [{ type: 'text', text: `No tool ${name}.` }], isError: true };
	try {
		noteTabs(await (await fetch(`${base}/api/tabs`)).json());
		return await tool.handler(args);
	} catch (e) {
		return { content: [{ type: 'text', text: `${name} failed: ${(e as Error)?.message ?? e}` }], isError: true };
	}
}

/** This page answers the agent's calls of DocWriter's tools (the host passes each to an open panel: the SDK's
 * tools.handle), one at a time, in the order they come. */
export function serveTools(_bus: Bus): void {
	let chain: Promise<unknown> = Promise.resolve();
	for (const t of DOC_TOOLS as readonly any[]) {
		ag().tools.handle(t.name, (args) => {
			const done = chain.then(() => run(t.name, args ?? {}));
			chain = done.catch(() => {});
			return done;
		});
	}
}
