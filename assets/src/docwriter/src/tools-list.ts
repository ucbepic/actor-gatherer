// DocWriter's document tools as agents are given them -- name, description, the JSON Schema of the input -- for the
// build to write into the app's tools.json (build.mjs): the same list the page answers (tools.ts).
import { z } from 'zod';
import { DOC_TOOLS } from '$lib/server/mcp-doc-tools';

export const TOOLS = (DOC_TOOLS as readonly any[]).map((t) => ({
	name: t.name as string,
	description: t.description as string,
	inputSchema: z.toJSONSchema(z.object(t.inputSchema)) as Record<string, unknown>
}));
