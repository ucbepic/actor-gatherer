// The page's types of what the server answers (src/core/api/types.gen.ts), generated from the server's OpenAPI schema --
// FastAPI's, from each route's parameters and `response_model` (ag_dashboard/models.py): `python -m ag_dashboard
// --openapi`, no server started -- by openapi-typescript, and formatted as Prettier formats the rest. The page names
// them through core/api/types.ts, so a change of the server's that breaks what the page reads fails `tsc` where it is
// read (ag_dashboard/DESIGN.md, B2).
//
//   pnpm gen:types      write the file
//   pnpm check:types    the file as it would be written compared with the one there: different, an error (CI's check)
//
// AG_PYTHON: the Python with the dashboard's dependencies (default python3). The schema is this checkout's: its root is
// put first on PYTHONPATH, whatever ag_dashboard the Python has installed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import openapiTS, { astToString } from "openapi-typescript";
import * as prettier from "prettier";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.resolve(import.meta.dirname, "../src/core/api/types.gen.ts");
const HEAD = `// What the dashboard's routes answer, generated from the server's OpenAPI schema (ag_dashboard/models.py) by
// scripts/gen-types.mjs: \`pnpm gen:types\` writes it again, and CI fails when it is stale. Not edited by hand: the page
// names these types through ./types.ts.
`;

function schema() {
  const env = { ...process.env, PYTHONPATH: [ROOT, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) };
  const python = process.env.AG_PYTHON || "python3";
  const out = execFileSync(python, ["-m", "ag_dashboard", "--openapi"], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

async function generated() {
  // a field the schema does not require is optional (`?`), a default or not: the models fill nothing in
  const ast = await openapiTS(schema(), { defaultNonNullable: false });
  const options = { ...(await prettier.resolveConfig(OUT)), filepath: OUT };
  return prettier.format(HEAD + astToString(ast), options);
}

const text = await generated();
if (process.argv.includes("--check")) {
  const there = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (there !== text) {
    console.error(
      `${path.relative(process.cwd(), OUT)} is not what the server's schema makes: run \`pnpm gen:types\` and commit it`,
    );
    process.exit(1);
  }
} else {
  fs.writeFileSync(OUT, text);
}
