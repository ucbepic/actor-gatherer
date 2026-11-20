// The Files app's panel: app_kit.fileedit's, its text files edited plain (plain.js's part, given to edAdd) -- no live
// document, no mode, no conflict zone, no actors' branches to approve. Its one entry (index.html): the rest imported.
import { edAdd } from "/_ag/lib/fileedit/editor.js";
import { edPlain } from "/_ag/lib/fileedit/plain.js";
import { edStart } from "/_ag/lib/fileedit/start.js";

edAdd({ plain: edPlain });
edStart();
