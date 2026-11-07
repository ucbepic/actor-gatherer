// DocWriter's /api/render, with the actor as its agent: the request -- what the author asked, or a wake-up, a
// critique pass -- made into DocWriter's per-turn prompt (as upstream's routes/api/render/+server.ts builds it,
// buildMultiTabPrompt and its parts, from this page's documents), sent to the actor as a message (the dashboard
// types it into its terminal, or starts it with it: the SDK's agents.send), and the actor's turn, as ag records it in the
// gatherer (the dashboard's /api/transcript), streamed back as the events DocWriter's page reads -- its words,
// thinking, tool calls and results, a question it asks -- until the turn is over (actor.ts: the dashboard's status
// of it). The hooks DocWriter runs on its agent's turns run here too: PostToolUse after each matching call's result,
// Stop at the turn's end (${base}/api/hooks/run).
//
// Not as upstream: no retry round (a feedback turn that proposed nothing is not run again), no images (the message
// is typed), no cost; a plan-first turn ends with the actor's plan in words, shown as DocWriter's plan card.
import type { CommentThread } from '$lib/types';
import { readCommentThreads } from '$lib/shared/ydoc-codec';
import { proposedText, proposalThreadIds, summarizeThreadMarks } from '$lib/shared/proposals';
import { unifiedLineDiff } from '$lib/shared/text-diff';
import { formatDismissedThreadsHint } from '$lib/shared/list-threads';
import { findReviewer, type Reviewer } from '$lib/shared/reviewers';
import { buildCritiqueMessage } from '$lib/server/reviewers';
import { isBinaryTabPath } from './server/document-files';
import { getYDocForTab, whenYDocReadyForTab } from './yjs-doc';
import { base } from './base';
import { config, meta, tabs, noteTabs } from './state';
import { current, onActor } from './actor';
import { ag, agent } from './ag';

const json = { 'Content-Type': 'application/json' };
const PROMPT_DIFF_CAP_CHARS = 8_000;
const QUIET_MS = 20_000;            // a turn whose actor has been idle this long, with nothing new, is over
const POLL_MS = 1_500;              // the most between two looks at the gatherer, the page's notice aside
const SILENT_MS = 20_000;           // no word of the message in the gatherer this long: the actor may be held up
const DOC_TOOLS = /(?:^|__|\.|docwriter_)(edit_doc|read_doc|write_doc|comment_doc|reply_to_comment|list_threads)$/;

async function getJSON(url: string): Promise<any> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	return res.json();
}

async function kvGet(names: string[]): Promise<Record<string, string | null>> {
	return getJSON(`${base}/kv?${new URLSearchParams({ names: JSON.stringify(names) })}`);
}
async function kvSet(values: Record<string, string>): Promise<void> {
	await fetch(`${base}/kv`, { method: 'POST', headers: json, body: JSON.stringify({ set: values }) });
}

// ---- The per-turn prompt: upstream's, from this page's documents --------------------------------------------------

interface TabPromptInfo {
	tabId: string;
	currentMd: string;
	lastSeenMd: string | null;
	commentThreads: CommentThread[];
	pendingEditThreadIds: string[];
	threadPassages: Record<string, string>;
}

const GENERIC_WAKEUP_MESSAGE =
	'I clicked Wake-up without a specific request. Decide what, if anything, to do per the Autonomy section of your instructions.';
const DIRECTIVE_RE = /(?:\[\[([\s\S]*?)\]\]|\(\(([\s\S]*?)\)\)|<<([\s\S]*?)>>)/g;

function extractInlineDirectives(text: string, limit = 8): string[] {
	const directives: string[] = [];
	let match: RegExpExecArray | null;
	DIRECTIVE_RE.lastIndex = 0;
	while ((match = DIRECTIVE_RE.exec(text)) && directives.length < limit) {
		const normalized = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\s+/g, ' ').trim();
		if (!normalized) continue;
		directives.push(normalized.length > 280 ? normalized.slice(0, 277) + '...' : normalized);
	}
	return directives;
}

function buildImplicitWakeupMessage(activeTabId: string | null, infos: TabPromptInfo[]): string {
	const byTab = infos
		.map(({ tabId, currentMd }) => ({ tabId, directives: extractInlineDirectives(currentMd) }))
		.filter((e) => e.directives.length > 0);
	if (byTab.length === 0) return GENERIC_WAKEUP_MESSAGE;
	const lines = [
		'I clicked Wake-up without a specific request. The documents contain inline directives: notes I wrote for you, wrapped in [[ ]], (( )), or << >>. Treat them as the most likely tasks.'
	];
	const active = byTab.find((e) => e.tabId === activeTabId) ?? null;
	if (active) {
		lines.push('', `Active tab ${active.tabId}:`);
		for (const d of active.directives) lines.push(`- ${d}`);
	}
	const others = byTab.filter((e) => e.tabId !== activeTabId);
	if (others.length > 0) {
		lines.push('', 'Other open tabs with directives:');
		for (const e of others) for (const d of e.directives) lines.push(`- ${e.tabId}: ${d}`);
	}
	lines.push(
		'',
		'Resolve a directive by replacing its marker with the written-out result via edit_doc, one thread per directive (no thread_id; each directive edit opens its own review thread). Read other files first if that helps. For open tabs use read_doc, edit_doc, and write_doc, not the built-in file tools.'
	);
	return lines.join('\n');
}

function renderCommentThreadsBlock(threads: CommentThread[], pendingEditThreadIds: string[], passages: Record<string, string>): string {
	const open = threads.filter((t) => !t.resolved);
	const dismissedCount = threads.filter((t) => t.resolved).length;
	if (open.length === 0 && dismissedCount === 0) return '';
	const pending = new Set(pendingEditThreadIds);
	const lines: string[] = [];
	if (open.length > 0) {
		lines.push('Open threads (route per "Where a response goes"):');
		for (const thread of open) {
			const passage = (passages[thread.id] ?? '').replace(/\n+/g, ' ');
			const quote = passage.slice(0, 120);
			const ellipsis = passage.length > 120 ? '…' : '';
			const pendingNote = pending.has(thread.id) ? ' (pending edit)' : '';
			lines.push(passage
				? `- ${thread.id}${pendingNote} on: "${quote}${ellipsis}"`
				: `- ${thread.id}${pendingNote} (its passage is gone; re-attach with reply_to_comment anchor_text if you edit for it)`);
		}
	}
	const hint = formatDismissedThreadsHint(dismissedCount);
	if (hint) lines.push(hint);
	return '\n' + lines.join('\n');
}

function buildRulesDelta(current: string[], priorJson: string | null): string | null {
	let prior: string[] = [];
	if (priorJson) try { prior = JSON.parse(priorJson) as string[]; } catch { prior = []; }
	const priorSet = new Set(prior), currentSet = new Set(current);
	const added = current.filter((t) => !priorSet.has(t));
	const removed = prior.filter((t) => !currentSet.has(t));
	if (priorJson !== null && added.length === 0 && removed.length === 0) return null;
	if (priorJson === null) {
		return current.length === 0 ? 'Rules: none active.' : ['Rules:', ...current.map((t, i) => `${i + 1}. ${t}`)].join('\n');
	}
	return ['Rule changes:', ...added.map((t) => `+ ${t}`), ...removed.map((t) => `- ${t}`)].join('\n');
}

const SNAPSHOTS = ['last_render:rules', 'last_render:agency', 'last_render:audience', 'last_render:session'];

/** The prompt, as upstream's buildMultiTabPrompt makes it -- less the author style and style references, which are
 * not offered here -- and the snapshots it is compared against next time. */
function buildMultiTabPrompt(activeTabId: string | null, infos: TabPromptInfo[], previewTabs: string[], message: string,
	isUserMessage: boolean, kv: Record<string, string | null>): { prompt: string; snapshots: Record<string, string> } {
	const ruleTexts = meta.rules.map((r) => r.text);
	const agency = String(meta.agentSettings.agency ?? 'balanced');
	const audience = String(meta.agentSettings.intendedAudience ?? '').trim();
	const fresh = kv['last_render:session'] !== config.key;      // the actor has seen none of the snapshots
	const prior = (k: string) => (fresh ? null : kv[k] ?? null);

	const openTabLine = [
		...infos.map((t) => t.tabId + (t.tabId === activeTabId ? ' (active)' : '')),
		...previewTabs.map((t) => t + (t === activeTabId ? ' (active, preview-only)' : ' (preview-only)'))
	].join(', ') + (previewTabs.length > 0
		? '\nPreview-only tabs are binary files (PDF, images): not editable, no document tools. Use the built-in Read if you need to look at one.'
		: '');
	const tabSections = infos.length === 0 && previewTabs.length === 0
		? 'No files are open as tabs. Use Read / Glob / Grep to explore the workspace; use edit_doc({ path, ... }) to edit, or write_doc({ path, ... }) to create a file (the path argument is the workspace-relative path).'
		: 'Open tabs: ' + openTabLine + '\n\n' + infos.map(({ tabId, currentMd, lastSeenMd, commentThreads, pendingEditThreadIds, threadPassages }) => {
			const threadBlock = renderCommentThreadsBlock(commentThreads, pendingEditThreadIds, threadPassages);
			if (lastSeenMd === null) return `${tabId}\nNew this session. Call read_doc("${tabId}") to read it.${threadBlock}`;
			if (lastSeenMd !== currentMd) {
				const diff = unifiedLineDiff(lastSeenMd, currentMd);
				if (diff.length > PROMPT_DIFF_CAP_CHARS) {
					const added = (diff.match(/^\+/gm) ?? []).length;
					const removed = (diff.match(/^-/gm) ?? []).length;
					return `${tabId}\nChanged extensively since your last turn (+${added}/−${removed} diff lines — too large to inline). Call read_doc("${tabId}") for the current text.${threadBlock}`;
				}
				return `${tabId}\nChanged since your last turn:\n\`\`\`diff\n${diff}\n\`\`\`${threadBlock}`;
			}
			return `${tabId}\nUnchanged.${threadBlock}`;
		}).join('\n\n');

	const sections = [`<workspace_state>\n${tabSections}\n</workspace_state>`];
	const sessionParts: string[] = [];
	const rulesDelta = buildRulesDelta(ruleTexts, prior('last_render:rules'));
	if (rulesDelta) sessionParts.push(rulesDelta);
	if (agency !== prior('last_render:agency')) sessionParts.push(`Agency: ${agency}`);
	if (audience !== (prior('last_render:audience') ?? '')) {
		sessionParts.push(audience ? `Intended audience: ${audience}` : 'Intended audience: (cleared — no specific audience set.)');
	}
	if (sessionParts.length > 0) sections.push(`<session_state>\n${sessionParts.join('\n\n')}\n</session_state>`);
	if (!isUserMessage) {
		sections.push(message);
	} else {
		const threadId = message.match(/thread_id="([^"]+)"/)?.[1] ?? null;
		const mode = message.match(/\[mode: (auto|edit|discuss)\]/)?.[1] ?? null;
		sections.push(threadId
			? `<user_feedback thread="${threadId}"${mode ? ` mode="${mode}"` : ''}>\n${message}\n</user_feedback>`
			: `<user_message>\n${message}\n</user_message>`);
	}
	return {
		prompt: sections.join('\n\n'),
		snapshots: {
			'last_render:rules': JSON.stringify([...ruleTexts].sort()),
			'last_render:agency': agency,
			'last_render:audience': audience,
			'last_render:session': config.key
		}
	};
}

const PLAN_MODE = [
	'', '<mode>',
	'Plan-first mode is active. I asked for a plan before any edits. Do not call edit_doc, write_doc, or any other mutation tool this turn. Read what you need with read_doc, Read, Glob, and Grep, then end the turn with your plan in your reply.',
	'For each change, the plan states: the diagnosis (why the current text reads wrong, concretely), the intended change in one or two sentences, and the files it touches. Keep the plan short and concrete. I approve or reject it after your turn.',
	'</mode>'
].join('\n');

async function tabInfos(textTabs: string[]): Promise<TabPromptInfo[]> {
	const kv = await kvGet(textTabs.map((t) => `last_seen:${t}`));
	const out: TabPromptInfo[] = [];
	for (const tabId of textTabs) {
		const doc = getYDocForTab(tabId);
		await whenYDocReadyForTab(tabId);
		out.push({
			tabId,
			currentMd: proposedText(doc),
			lastSeenMd: kv[`last_seen:${tabId}`] ?? null,
			commentThreads: readCommentThreads(doc),
			pendingEditThreadIds: [...proposalThreadIds(doc)],
			threadPassages: Object.fromEntries(summarizeThreadMarks(doc).map((s) => [s.threadId, s.quote]))
		});
	}
	return out;
}

// ---- The actor's turn, streamed back -------------------------------------------------------------------------

interface Part {
	kind: string; role?: string; text?: string; id?: string; name?: string; input?: unknown; error?: boolean;
	calls?: Array<{ name?: string; input?: unknown }>;   // a codex code-mode script's: the tools it calls
}
interface Item { row_id: number | null; type: string; parts: Part[] }

const docName = (name: string): string => {
	const m = name.match(DOC_TOOLS);
	return m && /docwriter/.test(name) ? `mcp__docwriter-doc__${m[1]}` : name;
};
const bareName = (name: string): string => name.split(/__|\./).pop() ?? name;

/** The file a call's input names, for a hook's {{file}}: as upstream takes it. */
function fileOf(input: unknown): string | undefined {
	if (!input || typeof input !== 'object') return undefined;
	for (const k of ['file_path', 'path', 'file', 'target', 'source']) {
		const v = (input as Record<string, unknown>)[k];
		if (typeof v === 'string' && v) return v;
	}
	return undefined;
}

/** The actor's channel now: a codex actor's is renamed to its thread's after its first call (the dashboard page says). */
const channel = (): string => current()?.channel ?? agent() ?? config.channel;

async function newestRow(): Promise<number> {
	const t = await ag().agents.transcript(agent()).catch(() => null);
	return Math.max(0, ...((t?.items ?? []) as Item[]).map((i) => i.row_id ?? 0));
}

type Emit = (event: string, data: Record<string, unknown>) => void;

async function runHooks(emit: Emit, event: string, tool?: string, file?: string): Promise<void> {
	let hooks: any[] = [];
	try { hooks = (await getJSON(`${base}/api/hooks`)).hooks ?? []; } catch { return; }
	for (const h of hooks) {
		if (h.enabled === false || h.event !== event) continue;
		if (event !== 'Stop' && h.matcher) {
			let re: RegExp;
			try { re = new RegExp(`^(?:${h.matcher})$`); } catch { continue; }
			if (!tool || !(re.test(tool) || re.test(bareName(tool)))) continue;
		}
		emit('hook_run', { hookId: h.id, event, command: h.command, status: 'running' });
		try {
			const res = await fetch(`${base}/api/hooks/run`, { method: 'POST', headers: json, body: JSON.stringify({ id: h.id, file }) });
			const got = await res.json();
			emit('hook_run', { ...(got.entry ?? {}), hookId: h.id, event, command: h.command,
				status: got.entry?.status ?? 'failed', ...(got.entry ? {} : { stderr: got.error ?? `HTTP ${res.status}` }) });
		} catch (e) {
			emit('hook_run', { hookId: h.id, event, command: h.command, status: 'failed', stderr: String(e) });
		}
	}
}

/** Follows the actor's turn from row `after` of its channel until it is over: each new word, thought, call and
 * result emitted once (a reply not stored yet comes again once stored: known by its call's id, or its words). */
async function follow(after: number, emit: Emit, signal: AbortSignal, planMode: boolean): Promise<string> {
	let cursor = after, asked = false, seenRunning = false, lastText = '', changedAt = Date.now(), told = false;
	const sentAt = Date.now();
	const seen = new Set<string>();
	const calls = new Map<string, { name: string; input: unknown }>();
	let wake: () => void = () => {};
	const stop = onActor(() => wake());
	try {
		while (!signal.aborted) {
			await new Promise<void>((r) => { wake = r; setTimeout(r, POLL_MS); });
			const a = current();
			if (a && (a.status === 'running' || a.status === 'asking')) seenRunning = true;
			let items: Item[] = [];
			try {
				items = (await ag().agents.transcript(agent(), { after: cursor })).items ?? [];
			} catch { continue; }
			let endsWithReply = false;
			for (const item of items) {
				if (item.row_id !== null) cursor = Math.max(cursor, item.row_id);
				if (item.type === 'user_message') { asked = true; endsWithReply = false; continue; }
				if (!asked) continue;
				for (const p of item.parts) {
					const key = p.kind === 'call' || p.kind === 'result' ? `${p.kind}:${p.id}` : `${p.kind}:${p.text}`;
					if (seen.has(key)) continue;
					if ((p.kind === 'text' || p.kind === 'thinking') && !p.text) continue;
					seen.add(key);
					changedAt = Date.now();
					if (p.kind === 'text' && p.role === 'assistant') {
						emit('assistant_text', { text: lastText = p.text! });
					} else if (p.kind === 'thinking') {
						emit('assistant_thinking', { text: p.text });
					} else if (p.kind === 'call' && p.id) {
						// codex calls DocWriter's tools from a script of its own (`exec`): shown as the tool it calls
						const inner = (p.calls ?? []).find((c) => DOC_TOOLS.test(c.name ?? ''));
						const name = docName(inner?.name ?? p.name ?? '?');
						const input = inner ? inner.input : p.input;
						calls.set(p.id, { name, input });
						emit('tool_call_start', { tool_name: name, tool_use_id: p.id });
						emit('tool_call', { tool_name: name, tool_use_id: p.id, input: typeof input === 'object' && input ? input : { input } });
						if (name === 'AskUserQuestion' && p.input && typeof p.input === 'object') {
							emit('user_question', { id: p.id, questions: (p.input as any).questions ?? [] });
						}
					} else if (p.kind === 'result' && p.id) {
						emit('tool_result', { tool_use_id: p.id, is_error: !!p.error, text: p.text ?? '' });
						const call = calls.get(p.id);
						if (call) await runHooks(emit, p.error ? 'PostToolUseFailure' : 'PostToolUse', call.name, fileOf(call.input));
					}
				}
				endsWithReply = item.type === 'agent_message' && !item.parts.some((p) => p.kind === 'call');
			}
			if (!asked && !told && Date.now() - sentAt > SILENT_MS) {
				told = true;
				emit('sdk_notification', { priority: 'high', text: 'No word from the actor yet: its terminal may be asking '
					+ 'something first, such as whether to trust this folder: see its Terminal (the view buttons above).' });
			}
			if (a?.status === 'error') throw new Error(a.failing?.text || 'The actor stopped on an error: see its Terminal.');
			const idle = !!a && a.status !== 'running' && a.status !== 'asking';
			if (asked && idle && (seenRunning || endsWithReply || Date.now() - changedAt > QUIET_MS)) break;
			if (!asked && idle && seenRunning && Date.now() - sentAt > QUIET_MS * 3) break;   // its turn came and went unseen
		}
	} finally {
		stop();
	}
	if (planMode && lastText && !signal.aborted) {
		emit('plan_proposed', { id: 'plan_' + crypto.randomUUID(), plan: lastText.trim() });
	}
	return lastText;
}

/** The actor's turn stopped (Esc in its terminal), as Chat's own Esc does. */
async function interrupt(): Promise<void> {
	await ag().agents.interrupt(agent()).catch(() => {});
}

// ---- The route ------------------------------------------------------------------------------------------------

export async function render(body: any, signal: AbortSignal | null | undefined): Promise<Response> {
	const enc = new TextEncoder();
	const aborted = new AbortController();
	signal?.addEventListener('abort', () => { aborted.abort(); void interrupt(); });
	const stream = new ReadableStream<Uint8Array>({
		async start(ctrl) {
			const emit: Emit = (event, data) => {
				try { ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* the page went */ }
			};
			try {
				if (config.error) throw new Error(config.error);
				noteTabs(await getJSON(`${base}/api/tabs`));
				const textTabs = tabs.order.filter((t) => !isBinaryTabPath(t));
				const previewTabs = tabs.order.filter((t) => isBinaryTabPath(t));
				const active = tabs.active;
				const infos = await tabInfos(textTabs);
				let reviewer: Reviewer | null = null;
				if (body.reviewerId) {
					const customs = (await getJSON(`${base}/api/reviewers`).catch(() => ({ reviewers: [] }))).reviewers ?? [];
					reviewer = findReviewer(body.reviewerId, customs);
				}
				const userMessage: string = typeof body.userMessage === 'string' ? body.userMessage : '';
				const message = reviewer && active ? buildCritiqueMessage(reviewer, active) : userMessage || buildImplicitWakeupMessage(active, infos);
				const kv = await kvGet(SNAPSHOTS);
				const { prompt, snapshots } = buildMultiTabPrompt(active, infos, previewTabs, message, !!userMessage, kv);
				if (Array.isArray(body.images) && body.images.length) {
					emit('sdk_notification', { text: 'Images are not sent to the actor: only the words of the message.', priority: 'high' });
				}
				const after = await newestRow();
				if (!agent()) throw new Error('No actor works with this DocWriter: attach one (its head\'s agents).');
				await ag().agents.send(agent(), prompt + (body.planMode ? PLAN_MODE : ''));
				await kvSet(snapshots);
				emit('session', { sessionId: channel() });
				await follow(after, emit, aborted.signal, !!body.planMode);
				if (!aborted.signal.aborted) {
					await runHooks(emit, 'Stop');
					const seenNow: Record<string, string> = {};
					for (const t of textTabs) seenNow[`last_seen:${t}`] = proposedText(getYDocForTab(t));
					await kvSet(seenNow);
				}
				emit('result', { activeTabId: active });
			} catch (e) {
				emit('error', { error: (e as Error)?.message ?? String(e) });
			} finally {
				emit('done', {});
				try { ctrl.close(); } catch { /* closed */ }
			}
		},
		cancel() { aborted.abort(); }
	});
	return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

/** DocWriter's answer to a question the actor asked (AskUserQuestion), given to its terminal's dialog as the
 * dashboard answers one (/api/answer): each question's picked labels as their places among its options. */
export async function answerQuestion(body: { id?: string; answers?: Record<string, string> }): Promise<Response> {
	const a = current();
	const ask = a?.asking;
	if (!ask || ask.call !== body.id) {
		return new Response(JSON.stringify({ error: 'The actor is not asking that question now: answer it in its Terminal.' }), { status: 404 });
	}
	const answers = (ask.questions ?? []).map((q) => {
		const said = body.answers?.[q.question] ?? '';
		const labels = said.split(', ');
		const options = labels.map((l) => (q.options ?? []).findIndex((o) => o.label === l)).filter((i) => i >= 0);
		return options.length === labels.length ? { options, text: null } : { options: [], text: said };
	});
	try {
		await ag().agents.answer(agent(), ask.call, { answers });
		return new Response(JSON.stringify({ ok: true }), { status: 200 });
	} catch (e) {
		return new Response(JSON.stringify({ error: (e as Error)?.message ?? String(e) }), { status: 409 });
	}
}
