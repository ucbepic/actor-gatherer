# The dashboard on a standard stack: plan

Status: A0–A4, B1, B3, B4 and B5 built; A3b (the old page as modules, `src/legacy/` gone) built; A5 begun (the renderers
the views share, in `core/ui/`; Chat; the list, all of it TypeScript; Details, Transcript, Messages, History and
Terminal's frame); A6 begun (the layout model, steps 1-4c-3c, all of it: the model the page's source, rendered; the panes as parts of
one page; the page's pop-ups on Radix; the layout in TypeScript). A1's build step, the server serving it and `publish.yml` building it come with A3, the
first step with something to build. It moves the
dashboard to the tools most web front ends and Python APIs are built with now, in steps that keep it working.

## Why

- **One file takes every change.** `page.html` is 11,146 lines (816 KB): about 2,200 lines of CSS, 8,800 of JS in
  one `<script>`, and the body. Since 2026-10-01, 198 commits touched it; `data.py`, the next busiest, had 67.
  Two open PRs (#211, #212) and most of the worktrees under `ucbepic-actor-gatherer-worktrees/` change it now, so
  actors working in parallel conflict there whatever they work on.
- **Everything is hand-built.** The page draws with its own `el()` and `replaceChildren`, keeps its own "what was
  last drawn" checks, positions its own menus and popovers, and resizes its own splits. Many bugs we fixed one by
  one came from this: flicker while typing, the idle layout loop in Chrome, the running glyph moving what's beside
  it, a pane's name left behind after it closed.
- **One scope for everything.** About 440 functions and 47 top-level `let`s share one script scope. Any section can
  call or overwrite any other, and two features picking the same name clash (`MARKS`, in #193).
- **Each pane is the whole page again**, in an iframe, with its own copy of the code and state.
- **Tests cut the page apart by marker strings.** `test_dashboard_code.py`, `_plan`, `_esc`, `_coordination` and
  `_avatars` slice sections out of `page.html` and run them in Node with stubs. Visual checks are one-off CDP
  scripts, rewritten for each change.
- **The server routes by if-chain.** `server.py`'s `do_GET` has about 65 `if url.path == "..."` checks, each
  validating its own query, and the route list is kept by hand in its docstring. Nothing describes the shape of
  what each route returns, so the page and the server agree only by habit.

## The stack

| Concern | Today | Standard choice | Why |
|---|---|---|---|
| Build and dev server | None; esbuild only for the Editor's bundle | **Vite**, **TypeScript**, **pnpm** | The default for new front ends: hot reload in development, a bundle for release, types checked in CI. pnpm keeps one package store for all worktrees. |
| UI | Hand-built DOM and redraw checks | **React** | The most used UI library. The other choices below have React versions, and the agents that build this dashboard write it fluently. |
| Client state | One `state` object and 47 globals | **Zustand** store, fed by the event stream; **TanStack Query** for data fetched on demand (history pages, files, search) | The common pairing: pushed state in a store, fetched data cached by key. |
| Styling | 2,200 lines in one `<style>`, theme as CSS variables | **CSS Modules**, one per component; the theme's CSS variables kept | Keeps today's CSS and look, scoped to its component. |
| Menus, popovers, dialogs, tooltips | Hand-written (`popMenu`, `placePop`, `openPop`) | **Radix UI** primitives, unstyled | Keyboard use, focus and placement handled; styled with our CSS. |
| Long lists (chat, transcript) | `content-visibility`, its own "pull earlier" | **react-virtuoso** | Lists that follow new items at the bottom and load earlier ones at the top. |
| Splits and resizing | `widthGrip`, `topGrip`, the panes' own layout | **Our own**: a tree of splits as data (`tree.ts`), the reader's moves on it (`arrange.ts`), each panel placed at its spot (`place.ts`) | Not react-resizable-panels (or dockview): a split there is a nesting of elements, so a split made or undone moves panels in the page -- and an app's panel is an iframe, which a move loads again (a Browser's page, an editor's state lost). Here a panel stays where it is in the page and only its box changes. |
| Panes | The page again in an iframe per pane | Components in one page, one stream | Iframes stay only for outside content: DocWriter's page, the preview, the Browser's screen. |
| Terminal, editor | xterm.js; CodeMirror 6 with Yjs | The same, each in a component | Already the standard libraries. |
| Markdown, code | marked + DOMPurify; our own highlighter (486 lines) | marked + DOMPurify kept; **Shiki** for highlighting, optional later | |
| Server | `http.server`, standard library only | **FastAPI** (Starlette, uvicorn): one `APIRouter` per feature, **Pydantic** models, **sse-starlette** for the streams | The standard Python API stack; checks each request's parameters and describes every route in an OpenAPI schema. |
| API types | None | **openapi-typescript**: TypeScript types generated from FastAPI's schema | The page fails to compile when a route's shape changes. |
| Tests | Python `unittest`; Node on sections cut out of the page; one-off CDP scripts | **Vitest** with Testing Library for the front end; **Playwright** for end-to-end tests and screenshots; `unittest` kept for Python | |
| Structure rules | `test_harness_untouched.py` | **ESLint** (typescript-eslint, **eslint-plugin-boundaries**), Prettier | Import rules between folders, checked in the editor and CI. |
| CI | Docs and publishing only | A workflow on every PR: lint, types, Vitest, the Python suite, Playwright | |

**What it costs:**
- **Node for development.** Each worktree runs `pnpm install` (one shared store, so it's quick) and either the Vite
  dev server or a build.
- **A build after a pull.** The built front end goes to `ag_dashboard/static/`, which is not in git. `publish.yml`
  builds it before `python -m build`, so the PyPI package carries it. From a checkout, `ag dashboard` builds it
  when it starts and the build is missing or older than `frontend/` (`ag_dashboard/page_build.py`), so a pull
  needs nothing more than a restart.
- **The dashboard stops being standard-library only:** it adds fastapi, uvicorn, pydantic and sse-starlette.
  ag itself doesn't change.
- **Views are rewritten, not moved.** That is where the risk is. Each view gets its Playwright tests before it is
  rewritten, and keeps them after.

## Where the code goes

```
frontend/                  the dashboard's front end: Vite, TypeScript, React
  package.json, vite.config.ts, tsconfig.json, eslint.config.js, index.html
  src/
    main.tsx               mounts the app
    core/                  imports nothing from features/, apps/ or layout/
      api/                 client.ts (fetch), stream.ts (the event stream into the store), types.gen.ts (generated)
      store/               Zustand slices: home, actors, layout, prefs
      ui/                  shared components: Avatar, Badge, Icon, Menu, Popover, Dialog, Markdown, Code
      format.ts            times, counts, sizes
    layout/                the shell: the list's column, the panels of the work area placed from a tree of splits
                           (tree.ts, arrange.ts, place.ts), Details; the `layout` slice is the arrangement as data
    features/
      list/                AgentList, Rail, Monitor, naming, seen
      panes/               Pane, PaneHead, new-actor menus, branches
      chat/                ChatView, Turn, Bubble, the files-and-commands panel, Composer, drafts, AskCard
      details/             Details, ContextCard, SizeCard, charts
      transcript/  terminal/  history/  settings/
      editor/              CodeMirror and Yjs, Tree, Changes, Conflicts, Preview
    apps/                  index.ts (APPS), docwriter/, browser/
    compat/                agDashboard.chatView, for <home>/dashboard/views/*.js
    page.js, styles.ts     page.html's script and styles as modules (A3, A3b): started in its order; each module goes
                           as its view moves to React (core/page/ and the .js files of features/)
  tests/                   Vitest
  e2e/                     Playwright: a spec per view, screenshots (tests/web_home.py builds and serves its home)
ag_dashboard/
  static/                  the built front end (not in git; in the package)
  server.py                the page (`page()`, snapshots) and `Server`: the parts the routes share, run by uvicorn
  app.py                   the FastAPI app: routers, the own-page check (`OwnPage`), errors as the page reads them
  api/                     one router per feature: page, home, stream, agent, files, history, sessions, terminal,
                           editor, preview, branches, monitor, settings, browser, docwriter; common.py, what they share
  models.py                Pydantic models of what the main routes return
  apps.py                  the apps: (docwriter, browser)
  data.py, files.py, …     the logic, unchanged
```

**Snapshots** (`ag-dashboard --out FILE`) stay one file: the built `index.html` with its script, styles and the data
inlined, as `page()` inlines the vendored scripts today.

**Your own chat views** in `<home>/dashboard/views/*.js` keep working: `compat/` keeps `agDashboard.chatView`, and a
component mounts what a view's `render()` returns.

## Rules

Checked by ESLint and tests in CI:

1. `core/` imports nothing from `features/`, `apps/` or `layout/`.
2. A feature imports `core/` and its own folder, not another feature; what two features share moves to `core/`.
3. No code of the dashboard names an app (DocWriter, the Browser, the Preview): each is in `ag_apps/`, reached only
   through the app host and app_kit's contract (app_kit/DESIGN.md), as one written by anyone else would be
   (`test_dashboard_apps.py`).
4. Only `layout/` arranges the page. A view draws into the element it is given, and never moves an iframe: a browser
   reloads an iframe that is moved.
5. `tsc --noEmit` passes, and `types.gen.ts` matches the server's schema.
6. No file over 500 lines (ESLint's `max-lines`).
7. `test_harness_untouched.py` stays: the dashboard names no harness.

## Working on the page

```
cd frontend && corepack pnpm install     # once per checkout or worktree (one package store for all of them)
corepack pnpm build                      # the page the dashboard serves (ag_dashboard/static/)
AG_DASHBOARD_URL=http://127.0.0.1:4200 corepack pnpm dev   # the page from source, reloading on each change
corepack pnpm test && corepack pnpm e2e  # unit tests; browser tests (AG_PYTHON, PW_CHANNEL: playwright.config.ts)
```

## Order of work

There are two tracks. They touch different files, so separate actors can run them at the same time.

### Track A: the front end

**A0. Playwright tests of today's page.** These are the safety net for everything after.
- A test home (`tests/web_home.py`): the newest recorded Claude Code and Codex sessions in `tests/fixtures/harnesses`,
  stored through the calls ag's hooks make, with the clock held so every run draws the same page. There is no
  Antigravity fixture to build one from yet.
- A spec per view: Chat, Terminal, Transcript, History, Details, the list's three modes, panes, the Editor, settings.
- Specs for what we fixed by hand that a stored session shows: opening and closing panes, no layouts while idle.
  What needs a live harness (Esc taking a message back, a pending message, answering a question card) and the
  Editor, Transcript, DocWriter and Browser get specs as their step comes (A5).
- Screenshots of each view (`toHaveScreenshot`).

All files are new, so this conflicts with nothing.

**A1. The toolchain.**
- `frontend/` with Vite, TypeScript, ESLint, Prettier, Vitest and pnpm, building into `ag_dashboard/static/`.
- The CI workflow, and `publish.yml` building the front end.
- The server serves the build when there is one and `page.html` otherwise, so nothing switches yet.

**A2. Shared `let`s into `state`.** Three top-level `let`s are written from other sections: `chatViewId`,
`chatSend` and `interrupting` (the other `cfg`s were local `const`s). A module can't assign another's, so they
moved into `state`. A3's script checks the same at its finer cuts, where a section splits into several files.

**A3. The split: `page.html` into `frontend/`, by a script (`frontend/scripts/split.mjs`).**
- **Where it went:** the markup into `frontend/index.html`; the styles into `src/legacy/css/` (12 files, cut at the
  comments that open each feature's rules); the script into `src/legacy/` (22 files, one per section divider). Every
  line is as it was in `page.html`, apart from the line that reads a snapshot's data.
- **One module, not 22:** `vite-plugin-legacy.ts` joins the script's files, in the order of `src/legacy/order.json`,
  into one module (`virtual:legacy`), with a source map back to each file. The sections share one scope and run top
  to bottom, as they did in one `<script>`. Turned into modules that import each other, they would run in import
  order instead, and a section's code that runs at load would reach another's values before they are set. The
  files are temporary: each goes as its view is rewritten (A5, A6), and new code is ordinary modules. (A3b made
  them modules too, started in this order.)
- **The server** serves the build (`ag_dashboard/static/`: `index.html` and `/assets/`, the assets cached for good
  since their names change with their content), and the vendored scripts each on its own too, for `vite` in
  development. A snapshot inlines the build's script and styles, so it is still one file. With no build, the page
  and `ag dashboard`'s start say how to build; `ag dashboard` also says when the build is older than `frontend/`.
- **Porting a branch begun before the split:** since the lines are unchanged, `split.mjs --port` rewrote a diff of
  `page.html` as a diff of the new files (the script went with A3b; a branch from before the split is ported by
  hand now):

  ```
  base=$(git merge-base HEAD origin/main)
  git show $base:ag_dashboard/page.html > /tmp/page.html
  git diff $base -- ag_dashboard/page.html > /tmp/page.diff
  node frontend/scripts/split.mjs --port /tmp/page.diff /tmp/page.html | git apply
  ```
- **Tests** that read the page (`test_dashboard_code`, `_plan`, `_esc`, `_coordination`, `_avatars`,
  `test_harness_untouched`) read it through `tests/page_source.py`, which puts `page.html`'s text back together.
  `split.test.ts` checks the split and the port.
- **Installing and pulling.** The dashboard is an extra, `actor-gatherer[dashboard]` (its Python packages), so
  ag alone needs neither them nor Node. `ag_dashboard/page_build.py` builds the page (pnpm through Node's
  corepack, a pnpm of one's own, or npx), and `ag dashboard` runs it when it starts and the build is missing or
  older than `frontend/`: the first start in an editable install, and the first after a pull. So only those who
  use the dashboard need Node, and after a pull a restart is enough. A wheel built from a checkout builds it too
  (`setup.py`'s one build step; with no Node, the wheel goes without it), and `publish.yml` builds it before
  `python -m build`, whose wheel then takes it from the sdist. A git hook was the first choice for pulls; it
  needed turning on in each clone, and it rebuilt the page under a dashboard still running the old server.

Left open: the production build carries no source maps. `build.sourcemap` is set to no effect with this setup
(a small project gets them; this one did not, and why is not found yet), so it is off; in development
`vite` maps each line to its file.

Checks: the browser tests pass against the screenshots taken of `page.html` (A0), now failing on any error thrown in
the page; the page also runs under `vite` in development with no errors.

**A3b. The old page as modules, `src/legacy/` gone.** A5 stopped after Chat's turn list, and the old page kept
growing where it was: from 8,844 lines in 22 files at the split to 11,206 in 28, new features going into the one
scope where everything they touched already was. So its files became ordinary modules, without being rewritten:
- **Where they went:** each file whole into the feature it draws (`07-panes.js` into `features/layout/panes.js`,
  `10-chat.js` into `features/chat/chat.js`, ...), and what they all share (`00-preamble.js`, `01-helpers.js`,
  `11-code.js`) into `core/page/`: `state.js`, `helpers.js`, `code.js`. Their styles beside them, cascading in the
  same order (`src/styles.ts`). Every statement is as it was; a script made the imports and exports each module
  needs from the one scope's references.
- **core/ first:** `core/page/` imports no feature, as all of `core/` (ESLint checks it). The few helpers that
  needed a feature went to it (the list's `closeSession`, `discardSession`; `statusOf` beside `unseen`; `actorLogo`
  beside `appMark`; `toggleType` beside `renderMain`), and plain ones the helpers needed came into core
  (`signature`, `escapeHtml`, `MAC`, `BESIDE_KEY`). So core loads before any feature, whatever order the features'
  import cycles load in.
- **Started in the old order:** a module only declares as it loads. What a file did as the script ran -- its
  listeners, what it set up and drew -- is its exported `start()`, and `src/page.js` imports every module and then
  calls each `start()` in the order the files ran, so listeners are added, and things drawn, in the same order as
  before. The script checked that no declaration reads, as it loads, a feature module's `const` (which may not have
  loaded yet): the two that did (`window.agDashboard`, `CHAT_HOST`'s `BESIDE_KEY`) became a statement and a core
  constant.
- **No module assigns another's variables** (modules can't): the five places that did call a function of the
  variable's own module now (`setAutoShown`, `rekeyTask`, `dropFolderClosing`, `keepAvatarMode`).
- **Lint:** ESLint covers them now. Unused code it found went (`MIN_PANE`, `shownTheme`, `unplanned`); the import
  rules leave out the old feature modules, which still import each other as the one script they were; and the seven
  over 500 lines are listed in `eslint.config.js`, a list that only shrinks. They stay plain JS, and out of Prettier
  (`.prettierignore`) so that a branch that changed `src/legacy/` still merges: git takes each file's move as a
  rename and puts the branch's changes into it. Formatting them is a change of its own once no such branch is open.
- **Tests** that read the page read it through `tests/page_source.py`, which follows `page.js`'s imports.
- **The new code imported, not bridged** (after A3b): the old modules import what they call of the new code -- the
  renderers (`core/ui/`), the stream, the apps' host and links, Chat's turns, the settings' store, the work area --
  as any module does, in place of `window.agNext` and the one-line functions calling it. `window.agNext` keeps only
  the stream and the markdown renderer, which the browser tests reach for. The descriptions of A4 and A5 below say
  how it was done at the time.

Each of these modules still goes as its view is rewritten (A5, A6), and a new view's code is TypeScript.

**A4. React and the store, and the first view in React: ag's settings.**
- **How the two halves talk** (`src/bridge.ts`): the bridge runs first and sets `window.agNext`, which the old page
  calls: it hands over the stream's home (`04-seen.js`'s `takeHome`) and asks for ag's settings (opening the panel,
  Esc closing the config.toml dialog). The old page hands back `window.agLegacy` (`03-settings.js`): what the new
  code calls of it (the panel opened or closed; whether this is a snapshot). Both go when nothing calls them.
- **One stream.** The old page's stream stays the only one, and copies what it takes into the store
  (`core/store`, Zustand). It moves into `core/api/stream.ts` with the shell (A6). Since the panes are parts of the page
  (A6), it serves them all -- each pane's actor an `actor` of it -- still the old page's code (settings/panel.js's
  `connect`, `streamTake`).
- **The first view:** ag's part of the dashboard's panel (the model, the defaults, the harnesses, Browser logins,
  config.toml's dialog) is `features/settings/` now: a component drawn into the old panel's `#cfg`, its own Zustand
  store for config.toml, its markup and classes as before so it looks the same. Its tests (`AgSettings.test.tsx`,
  Testing Library) cover what each form sends and shows.
- **The rules** (`eslint.config.js`): React's hooks rules, and eslint-plugin-boundaries: `core/` imports no feature,
  a feature imports only `core/` and itself, and the app's own files (`main.ts`, `bridge.ts`) any. The old
  page's modules (A3b) are linted; the import rules leave out its feature modules until each is rewritten.
- **One look changed, a fix:** the Browser logins' site picker showed, empty, before Chrome was read (its CSS
  `display` overrode `hidden`); it shows once read now. The settings screenshot was taken again for it.

**A5. The views in React, one PR each.** Each PR:
- adds the view's Playwright specs if A0 didn't have them;
- rewrites it with Radix primitives for its menus and popovers, and react-virtuoso for long lists;
- deletes its old module (a `.js` file of the page's script, A3b).

Order: Chat (where most of the redraw bugs were), Details, Transcript, History, the list (with the rail and
monitor), settings, Terminal, Editor, then DocWriter and Browser as entries in `APPS`.

**A5, first part: the renderers the views share, in `core/ui/`.** Before Chat, what draws its code and markdown moved
out of the old script, as one implementation that the old page and React both use:
- **Where it went:** `11-code.js`'s highlighter into `core/ui/highlight/`: the languages and their rules
  (`languages.ts`: `hlLang`, `langOfPath`, `guessWeb`), the shell reader (`shell.ts`: `shLex`, `hereLang`), the
  highlighter (`highlight.ts`: `hlTokens`, `hlLines`, `hlPart`, `hlInside`, `quoteRole`), a command laid out
  (`command.ts`: `shellHtml`, `tildePath`), a command's output (`output.ts`: `ansiHtml`, `outputHtml`) and a fenced
  block (`fence.ts`: `codeFence`, `foldCode`, the blocks folded by a click, and `codeClick`, the click on a block's
  Fold, Show all and Copy). `12-transcript.js`'s `escapeHtml` into `core/ui/html.ts`, and its `markdown` with the
  harnesses' reply blocks (`replyBlocks`, `unplanned`) into `core/ui/md.ts`. All TypeScript, the output the same to
  the byte: checked once against the old code on the repository's files and recorded sessions' commands, outputs and
  messages.
- **marked and DOMPurify** stay the vendored scripts index.html loads before the page (`window.marked`,
  `window.DOMPurify`, typed in `md.ts`), set up on the first message drawn. The reply blocks are read from the
  store's home (the stream's, as the old page hands it over), not the old page's `state`.
- **How the old page reaches them:** `bridge.ts` puts them on `window.agNext.ui`; in the old files, each function it
  still calls is a one-line `function` calling that (`function hlLines(...a) { return window.agNext.ui.hlLines(...a); }`),
  declared so the sections before can call it. Functions only the moved code called have none. `11-code.js` still
  registers the click listener (now `codeClick`), at the same point of the page's start, and keeps `shellSpan`, a
  DOM builder on the old page's `el`.
- **For React, not used by a view yet:** `core/ui/Markdown.tsx` (the same HTML in the same boxes as `markdown()`) and
  `core/ui/Code.tsx` (a block as `codeFence` draws it). Their buttons work by the document's one `codeClick`
  listener, the old page's for now; it moves with the shell (A6).
- **Tests:** `test_dashboard_code.py` and `test_dashboard_plan.py`'s cases are Vitest's now, beside the modules
  (`highlight/*.test.ts`, `md.test.ts`); the components' own in `Markdown.test.tsx` and `Code.test.tsx`. Vitest runs
  the vendored marked and DOMPurify (`core/ui/testing.ts`). The plan's cases use the reply blocks in
  `core/ui/harness-info.json`; `test_dashboard_plan.py` checks those are harness_kit's.

**A5, second part: Chat's turn list in React (`features/chat/`).** The conversation at the right of the Chat view (the
old page's "Files view") is React now; what is around it is still the old page's.
- **What moved:** `16-files-view.js`'s `filesTalk` and what only it used: a turn and its replies (a message, a run of
  thinking, the harness's notes: `notedReply`), the latest call's line (`lastCall`), how a turn stopped (`stoppedLine`),
  the line under a running turn and the turn over (`working`, `finished`, `miniAvatar`), what waits to reach the agent
  (`pendingTalk`, `openings`), a turn the session opened before ag stored it (`openedTurn`, `turnsBegan`), the earlier
  turns and pulling them in (`TURNS_SHOWN`, `pullEarlier` and its listeners, `showMore`, `keepTurn`, `talkShown`),
  `filesRender`'s cases before the first turn is stored (the opened turns; the actor waving hello, `01-helpers.js`'s
  `helloLine`), and the bubbles only it drew (`05-agent-list.js`'s `userWords`, `bubbleClass`, `crewBand`, `crewWords`,
  `sentBubble`, `crewText` and its sizes). Into `Turns.tsx` (the conversation), `Turn.tsx`, `Reply.tsx`, `Bubble.tsx`,
  `Working.tsx`, `Pending.tsx`, `Hello.tsx`, `pull.ts`, `store.ts`, `mount.tsx`, `Hosted.tsx`, `types.ts`; and, for any
  view, `core/format.ts` (counts and times: the old page's `plural`, `ago`, `spell`, ..., which it keeps until it goes)
  and `core/ui/Icon.tsx` (`StrokeIcon`). The markup and classes are the old page's: its DOM, compared with the old
  page's in 16 states of the test home (each actor, folds, pulls, the side), is the same but for the old page's
  `data-morph` marks (instructions to its `patch()`) and the order of attributes.
- **How the data comes:** one way, at each draw of the page. The stream and the loading stay the old page's
  (`state.files`, `state.agent`); at each draw of the Chat view, `filesRender` builds the feed (`talkFeed`: the actor's
  turns, the actor and its status, what the user wrote and the page sent and the session has not had -- `heard()`,
  `sentHereNow()`, which the message box sends from -- whether Esc was sent or would interrupt, the side folded, the
  setting "Chat's earlier turns") and calls `window.agNext.chat.draw(feed, CHAT_HOST)`. That renders the turn list at
  once (`flushSync`), so it is in place when `keepingPlace()` puts the scroll back and follows the end, as `filesTalk`'s
  nodes were. Nothing else renders it: a click on it changes its store and redraws the page (the host's `redraw`,
  `keepingPlace(renderMain)`), as clicks did; the setting picked calls `agNext.chat.clearFlips()`. The feed carries the
  page's home, so the turn list reads nothing of the page's but its feed and host.
- **What it calls of the page** (`CHAT_HOST`, `types.ts`'s `ChatHost`), what stays there for later steps: the actor's
  stage (`atWork`, `atRest`, `greeting`: its rewrite comes later); a call as the files-and-commands panel draws it
  (`callView`, `callLabel`: that panel, `fileBlock` and the rest of `filesRender`'s side stay); an actor's face
  (`crewFace`, the panes' too) and the message parsing the list shares (`envelope`, whose patterns
  `test_dashboard_coordination.py` checks against coordination.py's); a Browser's message (`bwWords`: only `apps/`
  names an app); a message's words as matched (`typedAs`, `sameWords`, the message box's); the icons; and the page's
  redraw, its side (`foldSide`, `setFilesTurn`), its views, and the end of an Esc. The message box and sending, Esc
  (`interrupt`, `canInterrupt`), and the question, plan and error cards (`10-chat.js`) stay too.
- **Where its state lives:** `store.ts` (Zustand): the replies folded by a click, the turns whose earlier messages
  show, the turns flipped against the setting, the first turn drawn -- kept across draws and views, and started over
  when the page's files feed is (`feed.files`, the `state.files` made for each actor picked), as they were in
  `state.files`; the turn last brought into view (`talkShown`), again when the view opens afresh; when opened turns
  began. The mount reads it at each draw and hands it down; a click writes it, then redraws.
- **The node that stays:** each actor's conversation is a node of its own (`.fl-talk`, its React root), the same from
  draw to draw. `filesRender` hands it to the frame held apart (`kids`), so building the frame does not take it from
  the page, and marks it with the actor (`data-sig`), so `patch()` leaves it where it is, never patched into another
  actor's: React then changes in place only what changed. When the first turn is stored, the node moves from the
  frame's top into the grid: `filesRender` takes it out first, as `patch()` would look for it where it was.
- **The stage's animations:** the stage is the old page's DOM, put first in a React element by `useStage`
  (`Hosted.tsx`): made again at each render, as each draw made it, and the node on the page kept while it shows the
  same (its `data-sig`, `patch()`'s rule) -- or the next moment the stage put in its place on its own clock. Its node
  and animations stay across redraws (checked in the browser), and across one that replaces the grid around it too,
  where the old page drew the conversation anew. Nodes the page builds that nothing changes after (a call opened, its
  line, a face, a Browser's message) are drawn as React's own (`Html`).
- **Tests:** `e2e/turns.spec.ts`, written against the old page first: "N earlier turns" and pulling them in (the wheel,
  keys, the reader's place kept), an earlier turn's replies and its earlier messages shown and folded, the latest
  reply folded and kept so across views (another actor's pick starting over), the setting picked again, a subagent's
  report and encrypted thinking, an interrupted turn's call and stopped line, messages joined mid-turn, the actor done,
  the hello (its stage kept across a redraw) and the first turn drawn in its place; two screenshots more. Vitest:
  `Turns.test.tsx` (the turn list drawn by the mount, with a host standing in: `testing.tsx`), `Bubble.test.tsx`,
  `Hosted.test.tsx`, `pull.test.ts`, `Working.test.tsx` (the cases `test_dashboard_esc.py` ran on the old
  `stoppedLine`, on the words in `core/ui/harness-info.json`, which that test now checks are harness_kit's),
  `core/format.test.ts`.

**A5, third part: Chat's data, and its frame in React (`features/chat/`).** Chat's data was fetched and compared over and
over, and its frame drawn by the old page around the turn list:
- **Its data:** the stream's view of each actor's conversation (`chat`, a pane's `actor`) goes into a store, by actor
  (`data.ts`, kept for the twelve actors shown last): the one source of the turns, the files' turns only before a view
  came (the page paused). A turn's files and commands are fetched through TanStack Query (`core/api/query.ts`,
  `files.ts`), cached by actor, directory and turn (an earlier turn by its row too): the latest turn's fetched again only
  once a view's turns have moved on from those they were fetched with (`stampOf`), not at every `home` and `agent` of the
  stream as before; an earlier turn's once. The page's change check compares which view was taken and which files object
  is kept, not their JSON. The old cache of actors shown lately (`chatKept`) went: the query cache and the store keep them.
- **Its frame:** the Chat view's frame (`#chat-list`) is React's, each actor's a node of its own kept from draw to draw
  (`mount.tsx`, through the view's `mount`, which chat.js's chatCard holds apart from the card it builds so it is never
  taken from the page): "Loading…", the actor's hello, or the grid -- the files and commands at the left (`side/`:
  `Side.tsx`, `Tree.tsx`, `FileView.tsx`, `CallView.tsx`, their state in `side/store.ts`), the file picked, the
  conversation (`ChatMain.tsx`, `Talk.tsx`). It draws again by itself when its store, its query or a fold changes -- a
  click no longer redraws the page (`keepingPlace(renderMain)`) -- and as the page draws, with the page's feed. Only the
  frame on the page does (`useOnPage`): one kept off the page stays as it was. Each turn is drawn inside an error
  boundary (`Boundary.tsx`): one that throws says so in its place. What the agent asks (the question, plan and error
  cards) is still the page's DOM, put after the conversation by the page's `patch()`; a call opened is React's, drawn
  once as a node for a minimized pane's history (`side/nodes.tsx`).
- **Its message box:** the Chat view's (`Composer.tsx`, through the view's `composer`) is React's too, each actor's a
  node of its own: a controlled box showing the actor's draft from a store (`drafts.ts`, kept in the tab's
  sessionStorage as before), so a send emptying it, a failed one putting it back, an Esc's take-back put in it show at
  once. chatCard holds every node of a view's own that is on the page apart from the card it builds, so the box keeps its
  focus and caret through the page's draws -- which no longer wait while it is typed in (data.js's TYPING_MS holds them
  only for the other views' boxes). Sending, Esc and the error line under the box are still chat.js's.
- **Its turns, react-virtuoso's list** (`Turns.tsx`): Virtuoso's scroller is the conversation's box (`.fl-talk`, with
  `fl-list`), each turn in an item box of its own (`.fl-item`), the count of earlier turns its header (`.fl-top`), the
  actor at work or done under the latest and a turn opened since its footer (`.fl-foot`). Before the first turn is stored
  (the hello, a turn opening) the box is a plain one, as before. The list's items are the turns' numbers (the first
  one's is its `firstItemIndex`); each item draws its turn from the feed (`TurnItem`, kept by its number), so a draw of
  the page changes the turns in place, and Virtuoso draws its list again only as turns come or are pulled in.
  - *What is on the page:* the turns in sight and 4,000px above and below them (`core/ui/lists.tsx`'s `OVERSCAN_PX`);
    as the list is made, before it has measured its box, up to 60 at once. The browser's find reads only what is on the
    page: with the latest five drawn (`TURNS_SHOWN`) and five more a pull, an ordinary conversation is there whole, as is
    every spec's; only a long one -- pulled far up, or a turn picked far back (a minimized pane's card) -- is there
    around where the reader is (3,000 turns, the first picked: about 100 on the page).
  - *Earlier turns* are still the latest five and a pull past the top (`pull.ts`: the wheel, a finger, the keys), not
    Virtuoso's `startReached`, which a conversation shorter than its box is at as it opens; the top is its
    `atTopStateChange` (the document's scroll listener went). Those pulled in are put before the first (`firstItemIndex`):
    Virtuoso keeps the reader's place by the height it guesses they have and draws them a frame later at theirs, so the
    turn the reader looked at is held (`holdTurn`) and put back in that draw, to the pixel; the count above them changes
    as the first turn is drawn, not a frame before (`Top`'s `firstDrawn`).
  - *A turn brought into view* (picked, or the latest at its end): at once where it is drawn, else by `scrollToIndex` --
    a turn picked held at the top as it is drawn, since the count above goes as the first turn comes.
  - *The end followed* by the reader's last scroll, as before (`follow.ts`): the box's size, and now each turn's item box
    and the footer watched (`followContent`) -- a turn added, a reply streaming in, a turn growing in, the actor done --
    in the same frame. Not Virtuoso's `followOutput` or `atBottomStateChange`: its at-bottom turns false as a turn grows,
    and its next draw scrolls to the end on that, undoing a turn kept in place by a click (`keepTurn`, which stays).
  - *Gone:* `showMore` (the place kept by hand as earlier turns came), the scroll listener, the keep-at-end after each
    draw of the turns, the box's `data-keep`/`data-follow` (the page's `keepingPlace()` no longer keeps or follows it:
    the node is React's from draw to draw, and Virtuoso and `follow.ts` keep its place), the stage after the latest
    turn's box (in the footer). Virtuoso's scroller has no tab stop of its own (`tabIndex` left out), as the box had none.
  - *The look:* Virtuoso measures each box without its margins, so none sticks out of one: the box's 6px and 24px of
    padding are its header's and footer's, a turn's top margin its item box's padding, and margins that met (two turns,
    a turn and the stage under it, the short box's) meet as they did. Checked against the page before in eleven states
    (each actor, pulled, a turn shown, short, narrow, at work, a turn opening, History): every turn, line, stage, reply
    and row in the same place, to the pixel. `turns.spec.ts` and `Turns.test.tsx` read the turns, the stage and the
    count in their boxes (`.fl-item > .fl-turn`, `.fl-foot > .fl-done`, `.fl-top > .fl-earlier`); `long-lists.spec.ts`
    has a conversation of 3,000 turns and a history of 4,000.

**A5, fourth part: Chat scoped to the actor it is given (`features/chat/`).** What was left of Chat on the old page --
the cards, sending, Esc, the line under the box, the header -- each read the page's one actor (`state.selected`) and
drew by redrawing the whole main view (`keepingPlace(renderMain)`). So that a later step can show several actors' Chats
as components of one page:
- **The cards** (`asking/`): what the agent waits on the user for (a question, a plan, a permission, a dialog its
  terminal shows), the model call its turn stopped on, an answer recorded otherwise than picked. `ask.ts` reads the
  actor (which card, where an ask is answered, its harness's words), `answers.ts` is the answers as they are made (a
  store by what they answer: picks, words typed, the question shown, the answer on its way or why it was not taken, the
  cards dismissed), and `Cards.tsx`, `Asking.tsx`, `Options.tsx` draw them in the old markup. A single choice's options
  are Radix's RadioGroup (the arrow keys move between them; a click, not the arrow keys, moves on to the next question,
  as before). Chat draws them in its frame; the other views and the reader's own (`agDashboard.askingNote`,
  `.errorNote`) get a node per actor kept from draw to draw (`asking/mount.tsx`), the card's box itself. The call a
  permission is for is still the old page's node (the host's `permissionView`).
- **Chat's own state of each actor** (`actors.ts`, a store by the actor's key): the messages sent from here the
  server's view does not have yet, a send on its way, why the last one failed, the Esc sent, the turn picked. Its
  actions: `send.ts` (from any view's box; what it needs of the page handed to it, `SendFrom`), `esc.ts` (Esc, and the
  message the harness took back put in the box -- `test_dashboard_esc.py`'s cases are `esc.test.ts` now), `showTurn` (a
  turn picked once its files have come). The frame reads it itself (`feed.ts`'s `feedOf`), so a send, a failure, an Esc,
  an answer or a pick draws only Chat, at once -- not the page. `SendError.tsx` (the line under the box) and
  `Controls.tsx` (the header: the view's tools and Chat's "Latest", the view switch, Minimize, Details, in a
  `display: contents` box of their own in `#controls`) are React's.
- **The boundary:** the page hands Chat a feed for the actor key it is given (`talkFeed(actor, ...)`, a `PageFeed`:
  what only the page knows -- the actor as the home has it, its turn's files, the page's flags); `state.selected`
  becomes that key in one place (`files-view.js`'s `chatActor`). The host's calls name the actor (`setFilesTurn`,
  `foldSide`). A minimized pane's lines (`mini-history.js`, still the old page's) are drawn again when the store
  changes. `chat.js` (the chat card and Details' cards) is off the long files' list.
- **Left:** the turn list's own state is one actor's at a time (`store.ts`'s folds, `useOnPage`), and its pulls and a
  turn kept in place by a click find the conversation on the page (`pull.ts`); switching views is the page's draw
  (its other views are its DOM); the message box of the other views (`ctx.input`) and a minimized pane are the old
  page's.

**A5, the Apps page in React (`features/apps/catalog/`), and Radix with it.** The Apps page (Nov 17) had been built by
hand again, with its own `el()`, menu and modal; it was the smallest view standing alone, so it came first, to set the
pattern the list and Chat follow:
- **Its state in a store** (`catalog/store.ts`, Zustand): the apps read, the search, the app picked, the note at the
  top, and the dialog open as one typed value (`Dialog`). Every action (install, update, uninstall, a setting, an
  agent's request answered) is a function of the store, so the components only draw and call.
- **Radix for what floats:** its dialogs are Radix's Dialog -- focus kept in it while open and given back after, Esc and
  a press outside closing it, the title announced -- in a root of their own on the page (`catalog.ts`'s `dialogs`), so
  an agent's request is asked even with the page not shown. A row's ⋯ is Radix's DropdownMenu (arrow keys, Home/End,
  typing a letter, Esc). Both styled by the page's own classes (`ap-dim`, `ap-dlg`, `ap-menu`).
- **Mounted in a host of its own** in the tab's box (`display: contents`), which the page around it empties for a new
  tab's page and hands back: the host put back, the root as it was.
- Its specs (`apps-page.spec.ts`, `app-on-task.spec.ts`) passed unchanged; unit tests drive the page and its dialogs
  (`AppsPage.test.tsx`).

**A5, the list in React (`features/list/`).** The list of actors (aside#agents) was drawn whole at every change, by
`renderAgents()` (77 callers), and worked out what it drew as it drew it. In two steps:
- *Its view-model, typed and tested:* what it draws is worked out by pure modules -- `status.ts` (an actor's status,
  its group, saved, what its × does; an app's notification), `tree.ts` (folders, what is filed where, closed folders,
  tallies, a box's order), `tasks.ts` (membership, lead, state, name), `groups.ts` (hidden and inactive groups, titles,
  folders of groups, groups placed in another's folder, actors on their own, coordinator nodes, counts and the top
  bar's totals), `envelope.ts` (a message between actors in a line; its patterns checked against coordination.py's) --
  and `model.ts`'s `buildList(ctx, view)` turns the home (`ListCtx`: the home and what the page knows of it) and the
  reader's choices and what is shown (`ListView`) into one tree of plain data (`rows.ts`). `list.ts`'s `CTX` is the
  home they read; `bound.ts` binds them to it under the names the old page's modules call. Vitest: `derive.test.ts`,
  `model.test.ts`.
- *Drawn by React:* `renderAgents()` builds the model and hands it to `mount.tsx`'s `drawList` (a Zustand store,
  `store.ts`, rendered at once with `flushSync`, as Chat's turn list is), then does what it did after drawing (the
  hover card, the pick bar, the tabs). `AgentList.tsx`, `Boxes.tsx` and `RowViews.tsx` draw every node by its key,
  so a row stays the same element from one draw to the next: in focus, hovered or dragged, it stays so. What a press
  does, and what of a row the page still builds -- what a gatherer's and a folder's "+" holds, the form for a new
  actor, a branch, a harness's mark -- the list asks of its host (`host.ts`'s `ListHost`, `list-host.ts`'s
  `LIST_HOST`); the built parts go whole into the list's own elements (`useFilled`), so the DOM, and every class the
  CSS and the browser specs read, is as before. A row's "+" is Radix's DropdownMenu.
  Gone with the redraws: the name box carried through them (`nameMoving`, the caret put back), the press held till
  its click (`pressHeld`). The rows' slide into their new places stays (`listPlaces`, `slideList`, on the same nodes
  now); the drag kept from redraws (`listDrag.later`, `DRAG_LOST_MS`), the menus found again by `data-pop` and the
  card kept off a resting pointer (`hover.still`) stay for the rail, the cards and the menus, still drawn by hand.
  Vitest: `AgentList.test.tsx` (the list drawn by its mount, with a host standing in for the page).
- *No button inside another:* a row is a box (`div.agent`: what is hovered, dragged and dropped on, its `data-key`,
  `data-card`, `data-open`, and `data-current` for the CSS) holding its main button (`.a-main`: its state, name and face,
  the whole box -- a press, F2 and a right-click on the row are its, and `aria-current` and its title) and, beside it,
  its own real buttons, each named -- "+", bookmark and × in `.a-acts`, and a selected actor's check (`.pick`, set on
  its face's corner by list.css, as the rail's on its avatar's). The rail's tiles are built the same way (`div.r-actor`,
  `.r-main`), and the card's rows' bookmark and × are buttons too. The keys reach the main button, then each of its own
  in turn; their focus rings are the same as before, as is every pixel of the rows, tiles and cards in each state
  (hovered, in focus, selected, shown). The hover card is shown for a row's main button in focus from the keys, and
  described by it (`aria-describedby`).
- *The list's other shapes, then:* each a view-model from the same derivations and view, drawn by React into its box at
  once (`modes-mount.tsx`), by its keys -- the rail (`rail-model.ts`, `rail-rows.ts`; `Rail.tsx`, `RailTiles.tsx`),
  the monitor (`monitor-model.ts`; `Monitor.tsx`: a card drawn again only when its signature changes, the cards in view
  watched as before), the top bar's counts (`Totals.tsx`), the hover card (`Card.tsx`, `CardTask.tsx`,
  `CardFolder.tsx`, `CardParts.tsx`: the page still decides which card, where and when, and places it), and Manage
  groups with a move's question (`manage-model.ts`; `ManageGroups.tsx`, on Radix's Dialog, each still a `<dialog>`
  with its classes, on a backdrop of its own, `.mg-dim`). What a press does is handed to the views as hosts. Gone with
  the redraws: the drag kept from them (`listDrag.later`,
  `DRAG_LOST_MS` -- the row dragged now says its dragend itself, by a listener of its own), the card kept off a
  resting pointer (`hover.still`), the card's name box carried through them (`cardMoving`) and Manage groups' (`manage.
  drawing`); a box a draw itself takes away is not the reader leaving it (`drawingNow`). A rail tile's bookmark and ×
  are kept from draw to draw like the tile, so none fades in under a resting pointer; they show on hover or keyboard
  focus (`:focus-visible`), not on any focus, so one pressed doesn't stay shown once the pointer leaves. A gatherer's and a folder's "+" and "⋯" are Radix's
  DropdownMenu (`Menus.tsx`; the page says what each holds: `startMenu`, `gathererMore`, `folderMore`), closed by a
  press the page never hears as the page's own drop-downs are (`pressedAway`'s `PRESSED_AWAY`); an item that opens a box
  or the branch picker opens it from the same button, the menu closed (its second step, `openPop` by the button's
  `data-pop`). The card's "+ actor" and "+ ⋯", the new-tab page's and the panes' drop-downs are `openPop`'s, which
  shows them on Radix since A6 (`features/layout/Pops.tsx`).
- *The rest of the list in TypeScript:* what was left of it in the old page's JS -- list.js, group-moves.js, modes.js,
  seen.js, gatherer-folders.js -- is gone, into modules of `features/list/` by what each does: the reader's choices,
  the home's hiding, titles and bookmarks, the selection and the list's draw (`list.ts`, its host `list-host.ts`);
  folders (`folders.ts`), folders of groups (`gatherer-folders.ts`), naming (`naming.ts`), the apps read
  (`apps.ts`), tasks and what a press on an item does (`task-acts.ts`), dragging (`drag.ts`), moves between groups
  (`group-moves.ts`) and Manage groups with the move's question (`manage.ts`), the list's shapes, its hiding and the
  rail (`modes.ts`), the hover card (`hover-card.ts`), the monitor's feed (`monitor-feed.ts`), the rows' slide
  (`slide.ts`), what the page has seen (`seen.ts`), the faces the old page's modules draw (`faces.ts`). What of it is
  only logic is apart and tested: what a drag may do and what its drop does (`drag-rules.ts`), what a change of the
  folders does to a tree and the names it refuses (`folder-edits.ts`), what a move between groups says first
  (`move-plan.ts`), the looks and tasks a home brings (`seen-model.ts`), where the hover card goes (`card-place.ts`)
  -- Vitest: `moves.test.ts`. The parts still drawn by hand are React's: the list's head (`Head.tsx`: the drop outside
  every group, a new group, an actor on its own, the coordinator agent over everything), its own buttons over the list,
  the rail and in the top bar (`ListButtons.tsx`), a folder of groups' buttons (`Menus.tsx`'s `GfActs`), and the bar
  for the actors selected (`PickBar.tsx`, `pick-bar.tsx`) -- Vitest: `bars.test.tsx`. Its "Move to…" and a task card's
  "+" are Radix's DropdownMenu as the list's other menus are (`Menus.tsx`'s `PageMenu`: closed by a press the page never
  hears, the page resizing or its box scrolling; a card stays while its menu is open, `hover-card.ts`'s `cardLetGo`).
  The head's "+" for an actor on its own opens the panes' start box (`openPop`, `railNewBox`).
  A feature's TypeScript may not import another feature's modules, nor the old page's plain JS: what the list takes of
  them -- the panes and their tasks, the page's data and state, Chat's, the apps' -- comes through one link
  (`link.ts`'s `ListPage`, typed member by member), each module's namespace handed over by `src/list-link.js` before any
  module starts (page.js), so a value one of them changes later is read as it is then. The old page's modules import
  the list as before, from `list.ts`, `seen.ts`, `modes.ts`, `group-moves.ts` and `gatherer-folders.ts`. The list's
  modules load one another in a ring, so none reads another's value as it loads: what an object needs of another
  module it reads when asked (a getter, or a host made at its first use).

**A5, the actor's other views in React.** What the old page still drew by hand of an actor beside Chat, each moved as
Chat was: a component scoped to the actor key the page hands it (taken from `state.selected` in one place, chat's
`chatActor`), its state in a store, what it fetches through TanStack Query, the same DOM, classes, roles and labels.
- **Details** (`features/details/`): the panel (`Details.tsx`), its context and size cards (`Context.tsx`), how a context
  or all calls divide (`Decomposition.tsx`) and the size chart (`Charts.tsx`), what they show worked out apart
  (`model.ts`). The panel's `aside` is its React root, the same node from draw to draw (`mount.tsx`'s `drawDetails`, from
  main-view.js's `detailsPanel`). The read picked on the chart is the actor's (`store.ts`'s `usePicked`, let go of when
  another actor is shown: data.js's `takeAgent`); a read's context is a query by gatherer and read, fetched before the page
  draws it (`loadContext`) and before a pick shows it (`pickRead`). The chart measures its box as it is put on the page and
  as it is resized (a ResizeObserver), where it was drawn again only on the window's resize. The types the lists show (the
  chips) are a store in `core/model/items.ts`, with the items' types and groups the old page took from helpers.js and
  state.js; a harness's facts the views read are `core/model/harness.ts`. Gone: chat.js's cards, main-view.js's panel and
  facts, `details/charts.js`, the page's `state.readId`, `state.context`, `drawCharts`. The reader's own views keep
  `agDashboard.contextItem`, `.columns`, `.typeChips`, `.contextCard` and `.sizeCard`: the same components, each drawn in a
  node of its own (`core/ui/node.tsx`'s `nodeOf`, its root, so its clicks reach React). Vitest: `model.test.ts`,
  `Details.test.tsx`.
- **Messages and Transcript** draw their frames themselves (a view's `mount`, as Chat's): `core/ui/frame.tsx`'s
  `viewFrame`, one `#chat-list` node per view, its React root, drawn at once as the page draws, so its `keepingPlace()`
  keeps the frame's scroll and follows its end as before; each lists what waits for the turn to end and says there is
  nothing yet itself (chatCard hands it `noneYet`). Messages (`details/Messages.tsx`) lists the context card's rows; the
  Transcript (`features/transcript/`) is its blocks worked out apart (`blocks.ts`: the stretches of calls, "+N more",
  thinking, notes) and drawn by key (`TranscriptView.tsx`), a call by its shape (`calls.tsx`: `summary`, the folded
  output, a change's lines -- and the permission card's call, `permissionNode`, which chat.js's permissionView now is,
  its paths no longer shown from whichever actor's directory the Transcript last drew). Their feeds are stores by actor,
  their loaders moved from data.js: `details/events.ts` (`/api/history`, the feed the reader's own views draw from by
  default) and `transcript/data.ts` (`/api/transcript`, a page at a time); the page still draws them at each change of
  the feed (mainSignature). The notes switch is a store (`useNotes`), as the type chips are. Gone: transcript.js,
  `state.chat`, `state.tx`, `state.txCwd`. The reader's own views keep `agDashboard.transcriptBlocks`, `.foldedOutput`
  and `.notesSwitch`, as nodes. Vitest: `transcript.test.tsx`, `details/messages.test.tsx`.
- **History** (`features/history/`): the view (`HistoryView.tsx`: the bar, the list, each row drawn by its key and
  drawn again only when what it shows changed), the panel at the right (`Side.tsx`, a record's saving in `Save.tsx`), the
  tree, its rows and what a selection holds worked out apart (`tree.ts`), selecting by press, drag, shift and ⌘ and the
  keys (`select.ts`: while a drag goes on only the selection changes), its own state in a store (`store.ts`: grouped,
  opened, searched, selected -- started over for another gatherer's rows -- the panel, a record being saved). What it
  fetches is TanStack Query's (`data.ts`): the outline by actor (loaded a page at a time, then what came after; kept for
  an actor shown again, where it was fetched afresh), the gatherer's records (fetched again after 10 s, every 2 s while
  one is made), a search's hits, an opened message's whole text. The types shown are Radix's DropdownMenu (checkbox
  items; a pick keeps it open), in place of a `details` closed by a click elsewhere; its button and menu restyled as the
  summary and box were. history.js only registers the view (and keeps `enc`, which the list's monitor feed uses); it is
  off the long files' list. Its rows are react-virtuoso's list (`Rows`): every row listed -- the 2,000-row cap and its
  "Show more" went -- those in sight and `OVERSCAN_PX` around them on the page, the first 200 as the view opens; "Load
  more" (the outline not all loaded) its footer. A row is told whether it is the first or the last (`first`, `last`:
  where the timeline down the left begins and ends, which `:first-child` and `:last-of-type` said while the rows were
  each other's siblings), and is contained as `content-visibility` had it in sight, not skipped out of sight, where
  Virtuoso would measure it at a guessed size. Selecting works on the rows' keys, the presses on Virtuoso's scroller:
  a shift-click selects to a row thousands away, ⌘A every row listed. The browser's find reads the rows on the page;
  the view's own search, all of them. Vitest: `history.test.tsx`.
- **Terminal**: xterm.js as it was, wrapped -- the terminal's session (`terminal/term.ts`: one xterm at a time, its node
  kept across draws, its stream, what is typed sent in order; TypeScript now, what it asks of the page handed to it,
  `setTermHost`) and the view's frame React's (`mount.tsx`'s `drawTerminal`: xterm's node first in it, never React's,
  the cover after it, `TerminalView.tsx`). terminal.js registers the view and hands on `term`, `termFor`, `termListen`,
  `termWebgl` and `fullscreenFor` to the old modules that use them (the shell's pane, the list, the panes, sending).
  Vitest: `terminal.test.tsx`.

**A6. The shell in React.**
- The arrangement becomes the store's `layout` slice: the list's mode and width, the Editor open and its height, the
  panes, Details, the chat minimized. It replaces today's separate browser keys, which are read once and dropped.
- The splits are our own (`tree.ts`, `arrange.ts`, `place.ts`), not react-resizable-panels: its splits nest the panels
  in the page, so changing one moves them, and an app's panel, an iframe, would load again (see "The stack").
- Panes become components in one page, sharing one stream (built, below).
- `page.js` has no module left to start, and goes with the bridge.

**The panes in one page (built).** Each pane beside the first was the page again in an iframe (the `PANE` flag): a
second copy of the bundle, the home and its actor's updates handed to it by the page's stream, a copy of everything the
page drew. Now each actor's pane is a part of the one page:
- *Its record* (`features/page/pane-view.js`'s `makePane`; `panes.here`, then `panes.others`): its parts -- head, who,
  controls, ×, main view (`features/layout/pane.ts`: the page's own pane keeps index.html's ids, those beside it the
  same markup by class) -- its actor (the page's own pane's is the page's selection, `state.selected`, which the list
  sets; `state.agent` reads that pane's), and what it shows of it: the view picked (`view`: the page's own kept as the
  page's choice, the others with the layout's panes), Details open (`details`), the actor's calls (`agent`, drawn again
  as `agentVersion` moves on), Chat's files feed (`files`), its message box's send (`chatSend`), what was last drawn
  (`drawn`). `paneInfo`, `paneKey`, `paneAt` (the pane holding a node), `paneOf`, `paneWith` find what a pane shows.
- *Every view takes the pane it is given*: main-view.js's `renderPane(p)` and `drawPane(p)` (renderMain's place, its
  place kept by `keepingPlace(draw, p)`), data.js's `loadAgent(p)`, `takeAgent(agent, p)`, `loadChat(p)` and
  `mainSignature(p)` (render() draws each pane whose signature moved), Chat's card (`chatCard(p, info)`), views
  (`chatView(p)`, `setChatView(p, id)`, the feeds' `load(p)`/`data(p)`), files feed (`loadFiles(p)`, `setFilesTurn(p,
  n)`, `foldSide(p, fold)`, `barActs(p)`), a minimized pane (top.ts's `chatMin(p)`, `setChatMin(p, on)`, `minRedraw(p)`;
  mini-history.js's lines and its one card, for the pane hovered), the shell's pane, Details, History, Esc
  (`escapeShown(p)`, `interrupt(p, info)`), the links clicked in a pane (`linkClicked(href, ev, path, p)`). Nothing in a
  view reads `state.selected`; a list module calling with no pane (`select`'s `loadChat()`, `chatToEnd()`, `showKept`)
  means the page's own. The reader's own views (`agDashboard`) are drawn for the pane being drawn (`drawingPane`).
- *Each actor's own state in the new code*, where it was the page's one: Chat's folds (`store.ts`'s `foldsOf(key)`), the
  frames on the page (`useOnPage`'s keys), the files panel folded and too narrow (`side/store.ts`'s `panels`), a pull
  and a turn kept in place in their pane's conversation (`pull.ts`), the read picked on the size chart
  (`details/store.ts`'s `picks`); one view frame per view and actor (`core/ui/frame.tsx`), one Details panel per actor,
  one head's controls per pane (`Controls.tsx`); one xterm per session a pane shows (`terminal/term.ts`'s `termFor`, let
  go of by `termsKept` once no pane shows it; `term` stays for the list's following of a renamed codex session). The
  host's calls from React name their actor (`barActs(actor)`, `setChatView(id, channel)`).
- *One stream, one home*: a pane opened beside loads its actor's calls and view from the page (`paneGiven`), its actor
  an `actor` of the page's stream from then on -- no frame, no page loaded again, no home of its own
  (`pane-home.spec.ts`).
- Gone: `PANE_URL`, `panes.home` and `panes.actors`, the frames' bridges (`agPanes`, `agPane`, `agTop`, `paneReady`,
  `panesTake`, `paneUrl`, `fitMini`), the frame CSS (`pane-mode`, `pane-focused`), the bridge's `pane` flag. `PANE` is a
  constant `null`, kept only for the list's modules till they are rewritten.
- Kept: the placement (`tree.ts`, `arrange.ts`, `work.ts`, `place.ts`), which places every pane absolutely and never
  moves a node; the apps' panels, which stay iframes, placed over the work area as before and never moved in the DOM
  (a moved iframe reloads).
- Specs: those that reached into an actor pane's frame reach the pane in the page (`.pane-close`, `.controls`, `main`);
  the minimized lines' drag marks the pane dragged in (`.pane[data-mini-drag]`) and the page's root, where it marked two
  documents.

**The page's pop-ups on Radix (built).** What `openPop` hung from a button -- a panel's moves (its head right-clicked),
the rail's and the hover card's "+ actor" and "+ ⋯", the new-tab page's "In", "Directory" and "On", the boxes for a
new actor's directory (`railNewBox`, also the list head's actor on its own) and an app's folder (`appStartBox`), the
list's moves -- was placed, focused and closed by hand. `features/layout/Pops.tsx` shows them now, one at a time: a
menu (`popMenu`'s: its heading, its choices) as Radix's DropdownMenu, a box -- the page's own form -- in Radix's
Popover; both placed by Radix under the button (beside it from the rail), flipped above where there is no room, closed
by the button pressed again, a press elsewhere, Esc (the focus back on the button), the page resizing or the page or a
box holding the button scrolling. `openPop(key, button, what)`, `popMenu`, `closePop` and `rowPop` keep their roles, as
the list's modules still call them; `placePop` went. Vitest: `Pops.test.tsx`. The forms in the boxes are React's
(`StartBoxes.tsx`: `railNewBox`, `appStartBox`, the new-tab page's `DirBox`, the folders a click away, `FolderPicks`),
each told the pop-up it is in (`usePop`) so it closes that one alone once it has started (`closePopIf`); the branch
picker is Radix's too (`Branches.tsx`): its drop-down of a group's sources a DropdownMenu hung from the button that
opened it, its popup a Dialog in the page's `<dialog>` look (`.br-dialog`) on Manage groups' backdrop (`.mg-dim`), its
state a store (`usePicker`).

**The layout in TypeScript (built).** The layout's last hand-written JavaScript -- `panes.js` (2,373 lines),
`new-tab.js`, `top.js` -- is typed modules of `features/layout/`, each under max-lines (panes.js left the long files'
list), the pure ones tested:
- *What is open* (`open.ts`): the actors in the panes, the one in focus and the app selected (the store's `focus` and
  `lastActor`), each panel's task (`taskKey`, `appPaneTask`), the task of apps alone, the task entered, the tasks laid
  out, the page's own pane out of sight (`away`), the panels shown (`shownPanels`) and what is open as a plan reads it
  (`openNow`). *What each task was left with* (`remember.ts`: `rememberTask`, `taskLayout`, `taskAppsFound`,
  `taskFacts`, `keysNow`), its decisions pure (`facts.ts`'s `factsOf`, `taskKeysNow`; Vitest: `facts.test.ts`).
- *Changes to what a tab shows*: an actor shown, in the pane in focus or beside it, through the screen tabs (`show.ts`:
  `pick`, `show`, `openBeside`, `viaTabs`); a task entered, opened beside, left alone, closed here, a tab's tasks shown
  (`enter.ts`), each a plan (`plan.ts`) rendered by `render.ts` (`renderLayout`; the panes beside made to match the
  store, `renderPanes`; the page's own pane closed, `closeHerePane`).
- *The work area* (`work-area.ts`: `startPlacing`, `placeWork`, what a block is called, its faces, a task's states in
  its tab), a panel moved (`moves.ts`; its menu's choices pure, `move-choices.ts`), the panes' heads (`heads.ts`), the
  apps' panels (`app-panels.ts`: rendered from the store, held for a tab left or an agent at work), what a panel is given
  (`app-hooks.ts`; what it is told of an actor's question and the media type of an intent pure, `app-said.ts`), links
  clicked in a pane (`pane-links.ts`; which the page takes pure, `link-rules.ts`).
- *Starting* (`starts.ts`: the list's "+", the rail's "+ actor" and "+ ⋯", what each start does; what starts where pure,
  `start-rules.ts`; a coordinator agent, `crew.ts`), the list's form for a new actor (`new-form.ts`), the pop-ups
  (`popups.ts` over `Pops.tsx`), a minimized pane (`top.ts`), a new tab's page (`new-tab.ts`, drawn by React in
  `NewTab.tsx`: drawn afresh each time it comes in sight, its message box from the tab's draft, its chips and apps again
  as the home changes).
- `panes.ts` is the facade the old page's modules and the list import, under the names they used. What a minimized
  pane draws in Chat's card (its footer, a shell's strip) is still built as nodes (top.ts): Chat's card patches it in.
- *The link*: a feature's TypeScript imports only `core/` and its own folder, so what the layout takes of the page around
  it -- the old page's state, helpers, data and panes' views, Chat's, the list's, the apps' host and links, the
  terminal's -- is typed in `features/layout/link.ts` (`LayoutPage`, its own types in `types.ts`) and handed over by
  `src/links/layout.ts`, an app-level TypeScript file (`src/links/` is app-level for ESLint's boundaries) called once from
  page.js before any module starts. The other features' TypeScript modules are checked there against what the layout
  says it reads of them (where the list's types are narrower than what the layout hands it, the adapter says so: its
  `openTask`); the old page's plain-JS modules come through `links/plain.js`, untyped (`plain.d.ts`), each to be imported
  by layout.ts itself as it becomes TypeScript. Vitest: `facts`, `move-choices`, `start-rules`, `branch-model`,
  `link-rules`, `app-said`, `Pops`.

The layout slice comes first, in four steps, each with every test passing:
1. *The model* (built): `features/layout/model.ts`, one `Layout` value -- the screen tabs, the tab shown, what each
   task was left with -- and pure functions for every change, by the rules `tabs.ts` and `rememberTask` have; with
   `migrate()` from the six keys (`panes`, `top-apps`, `task-layouts-2`, `screen`, `screen-tabs`, `task-trees`).
2. *Shadow mode* (built): `shadow.ts` runs the model beside the page. Each change is told where the page makes it --
   the tab bar's operations, a task entered (`enterTask`, `enterAppsTask`), opened beside, an app's panel added, a
   task's last panel closed, the actor the page opens on by itself -- and once the page is quiet, the tasks shown and
   every tab's are checked against it. The browser tests record each difference (`AG_LAYOUT_STRICT` fails on one). (The
   check went with step 4c-3c, once the model was the page's source.)
   A task's key is read as it is now (`keysNow`): the task an item joined, or the items of one that dissolved, those
   whose panels are open.
3. *The tab bar on the model* (built): `tabs.ts` keeps no tabs of its own -- it reads the model's, and every change it
   makes is the model's rule for it (`fresh`, `show`, `close`, `put`, ...), with the page's side effects (panes entered
   or cleared, the arrangement set) after. The tab shown's tasks are the model's, kept by the page's tells: `note()` no
   longer copies `shown()` into the tab, only the arrangement and the focus, and saves what changed. ⌥ (`take`) only
   takes the task out of the other tabs; the page's entering it opens it. The check stays, and on a difference still
   sets the model to the page. Entering a tab's tasks on a switch or a reload (`hooks.enter`) stays till step 4.
4. *The page's state into the model, then one renderer* -- moved a record at a time, the full suite after each:
   - 4a (built): each task's record is the model's -- what it was left with (`left`, the old page's `taskLayouts`,
     with whatever else an older page kept there) and its tree and tabs (`tasks.ts`'s `Tasks`, now pure rules:
     `setTree`, `addTaskTab`, `showTaskTab`, `changeTaskTab`, `closeTaskTab`, `renameTaskTab`). The model is kept under
     one key, `ag-dashboard-layout` (`load`), made once from the keys of before (`migrate`), which are then dropped:
     `screen-tabs`, `task-layouts-2`, `task-trees`.
   - 4b (built): the page's panes and the apps' panels above them as it last showed them (`savePanes`,
     `saveAppPanes`: the model's `panes` and `apps`, page-wide as they were) and the tab shown's arrangement (`work.ts`:
     the tab's `screen`) -- the one key holds all; `panes`, `top-apps` and `screen` are dropped with the others. Its own
     pane out of sight (`hereAway`) and a task of apps only (`appsOnly`), this page's alone and never kept, are 4c's:
     the renderer makes them from the model.
   - 4c-1 (built): focus is the model's -- one item in focus, an actor's pane or an app's panel selected (`focus`), and
     the actor last in focus (`lastActor`) it goes back to when the app is unselected -- in place of the page's
     `panes.focus` and `appSel`; `focusedPane()` and `appSelected()` read it, and a pane given another actor in place
     (`retarget`) takes focus with it. This page's alone: not kept.
   - 4c-2 (built): the apps' panels shown are the model's `apps` (since 4b a copy of them, now their source): what opens
     or closes one says so to the model -- `showAppPanel` (a panel shown: an app opened, selected, linked to, its
     actor's, a task's), `closeAppPane`, `unwantTaskApps` (a task entered, left or closed: the others' apps, those
     still opening too), `appClosed` (an instance closed, an app uninstalled) -- and `renderApps` makes the panels
     match: a wanted one whose instance is known opened at once (in the frame that asked, as before: no flicker), the
     rest once the host gives it, if still wanted then; one no longer wanted closed, or held out of sight while its
     agent is at work. Panels held for agents at work stay outside the model. The check also compares the model's apps
     with the panels shown.
   - 4c-3a (built): the panes beside the page's own are the model's `panes.others` (a copy since 4b, now their source):
     `openBeside` wants one at its place, `closePane` (and every loop closing a task's panes through it) and `closeHere`
     no longer want one, a pane given another actor (`retarget`) changes its entry, `restorePanes` renders those kept
     still in the home, and `renderPanes` makes the frames match; `savePanes` notes only the page's own pane, the focus,
     and each pane's view and width. The check also compares the model's panes with the frames.
   - 4c-3b (built): the page's own pane out of sight or closed (`away`, the page's `hereAway`/`hereClosed`) and the task
     of apps only shown (`appsOnly`) are the model's, this page's alone and not kept: `putAway`, `backInSight`,
     `setAppsOnly` write it, `isAway`, `isShut` and `appsOnlyKey()` read it.
   - 4c-3c, first part (built): the last of the page's own variables are the model's, as `away` and `appsOnly` are (this
     page's alone, not kept): the task last entered (`entered`, the page's `taskNow`: what the apps it opens wait on),
     the tasks laid out in this page (`laidOut`, `tasksLaidOut`: still a set's has/add/delete over it for the list's
     `openTask`), and the task the page opened on by itself (`auto`, `autoShown`) -- `setEntered`, `layOut`, `setAuto`.
     `taskLayouts` went with 4a, the six keys with 4b (read once by `migrate`).
   - 4c-3c, second part (built): a tab shown is worked out at once, then rendered -- `features/layout/plan.ts`'s
     `tabPlan` (pure; Vitest: `plan.test.ts`) turns its tasks, each as it was left (`taskFacts`: the actor it opens first,
     its others, its views, its apps, the actor and app in focus then), and what is open now into the page's panels: the
     actor of the page's own pane (kept, if the page opened on it), the panes beside in the order the page opened them,
     the apps' panels, the task of apps alone, what is in focus, the actors left out for room. `renderLayout(plan)` makes
     the model so (the tab's tasks, `panes.others`, `apps`, `appsOnly`, `away`, `laidOut`, `entered`) and the page match
     it -- this page's own pane given its actor (the list's `select`), the panes and panels opened and closed
     (`renderPanes`, `renderApps`), the focus -- in place of `enterTasks` entering the tasks one by one through
     `openTask`, `show` and `openTaskBeside`. The apps the page did not know yet are opened once read, if the tab is still
     the one shown.
   - 4c-3c, third part (built): the page's other changes to what a tab shows are plans too, each pure and tested in
     `plan.test.ts`, made from what is open (`openNow`: each panel with its task, the pane in focus, the page's own out
     of sight) and rendered by `renderLayout`: a task closed here (`closePlan`, its card head's ×), a new tab
     (`clearPlan`), a task left alone (`onlyPlan`, ⌥+click), a task's own tab shown (`itemsPlan`), the page's own pane
     closed (`herePlan`), a task of apps alone entered (`appsPlan`), another task entered by a click (`enterPlan`: the
     others' panels closed; its actor shown and the rest of it laid out after, through `openBeside`). `renderLayout`
     puts the page's own pane out of sight, or back in sight, before anything is placed -- placed in sight a moment, its
     actor would be put in its task's arrangement.
   - 4c-3c, fourth part (built): a task opened beside (`besidePlan`, for `openTaskBeside` and `outOfAppsOnly`) and the
     rest of a task laid out beside its actor just shown (`layOutPlan`, for `layOutTask`), sharing the rule `tabPlan`'s
     tasks beside follow; and the model holds each task's items open as last placed (`items`, `open`: `noteOpen`, at
     each placing), which `keysNow` reads in place of what it kept of each task itself (`heldSeen`) and of the panels.
   - 4c-3c, last part (built): a task clicked in the list (features/list/task-acts.ts's `openTask`, through link.ts) is
     one plan too -- `openTaskHere` (enter.ts): the task's facts as it was left (`taskFacts`, the actor asked for first),
     `tabPlan` of that task alone, rendered -- so every change to what a tab shows is a plan of the model's, rendered by
     `renderLayout`. With that, two full browser runs with the check on (`AG_LAYOUT_STRICT`) found no difference between
     the model and the page, and `shadow.ts` became the layout's store: the one layout value, changed only by the
     model's rules (`update`), kept under one key (`persist`, leaving out what is this page's alone: model.ts's
     `PAGE_ONLY`), read by its tasks' keys now (`now`, through the page's `keysWith`: what each task held open). Gone:
     the tells (each change told by name, logged), the check against the page after each placement (`later`, `check`,
     `flush`, the mismatches) and its workarounds (`waitWhile`, `appsWith`, `panesWith`), `window.agLayoutShadow`, the
     browser tests' `layoutAgreed` and its file of differences, and `AG_LAYOUT_STRICT` with its CI setting. `keysWith`
     stays: not the check's, how a tab's task reads once an item joined or left it.

### Track B: the server

**B1. FastAPI beside the old server, then in its place.** Built.
- A router per feature, ported route by route: 118 routes in 15 routers (`api/`), each handler's docstring saying
  what it answers -- the old hand-kept list in `server.py`'s docstring is gone; `python -m ag_dashboard --routes`
  prints the table, and a test checks every route has one.
- Pydantic models for the main responses: home, agent, transcript, files, history.
- The own-page check as middleware, and the streams (home and agent, terminal, editor, preview) on sse-starlette.

Check: every route in today's docstring list, requested of both servers on a scratch home, gives the same status and
body. Then `ag dashboard` runs on uvicorn and `server.py`'s handler goes. `tests/compare_servers.py` does it: the old
`server.py` from git beside the new one, on `tests/web_home.py`'s home, 197 requests -- every GET route with good
parameters and bad, and the writes that change nothing (refused, malformed, not found). All the same (status, type,
body), but for HEAD and OPTIONS: 501 from both, http.server's as an HTML page.

What went another way, and why:
- **The models describe, they do not serialize.** Each main route declares its model (`response_model`, for the
  schema B2 generates types from) but sends the JSON `json.dumps` writes, as before. Serialized through Pydantic,
  the keys would be reordered, non-ASCII written as is, NaN refused, and a model's field the answer lacks (every
  route answers `{error}` for a gatherer with no database) a 500. `test_dashboard_app.py` checks each model takes
  real answers and gives them back unchanged. Every field may be left out, and fields not named are kept.
- **Bad parameters are still "not found".** Query parameters are declared with types (`Whole`: digits only, as the
  old `isdigit()` checks; `Decimal`), and a request FastAPI finds invalid is answered 404 "not found", text: the old
  server's if-chain fell through to that, and the page and tests read it so. Errors raised by the logic are answered
  as before (`common.Errors`: a GET's editor or preview error 400, a POST's ValueError 400 with `box`, a Browser's its
  own status, the rest 500, JSON `{error}`); DocWriter's and the Browser's routes keep their own (`<type>: <error>`).
- **The query is read as `parse_qs` read it** (`app.first_values`): a blank value is no value, a repeated key its
  first. Starlette keeps blanks and takes the last; the page's `?channel=` and `?to=` would have meant something new.
  The path's leading slashes are made one, as http.server did.
- **POST bodies are a dict, not a model.** The routes read them as before (`str(body.get(...) or "")`): a model
  would refuse what the old server took (a number for a string). Typing them is left for when the page is typed (B2).
- **Streams** (`common.Events`, a sse-starlette `EventSourceResponse`) send the same bytes: `event:`/`data:` lines
  ended by `\n`, a `: keepalive` comment as before (sse-starlette's own ping off). Each blocking wait runs in a thread
  (`anyio.to_thread`, given up on when the page goes), and what a stream holds (its hub watch, its editor room, its
  preview or DocWriter queue, its Browser viewer) is let go -- and its waiting thread woken -- as soon as the page
  disconnects, where the old one noticed at its next write (up to 15 s). A server stopping ends every open stream, so
  uvicorn's wait for connections to close is short.
- **The page's streams share one WebSocket** (`api/ws.py`, `/api/ws`; the page's `core/api/stream.ts`), added after
  the move. A browser keeps at most six HTTP/1.1 connections to the dashboard open, for all its tabs together, and an
  EventSource holds one for as long as it is open: two tabs, or one with a terminal, an Editor and a Preview, held them
  all, and every other request the page made (a message sent, Chat's turns, a key typed) waited in the browser for one
  to close. On the socket, each stream is opened by its URL and runs as that GET would -- the same route, its checks,
  what it holds let go when the page lets it go -- its events passed on as they come; the routes are unchanged and
  still answer a plain GET. Only the dashboard's own page may open the socket (its Origin is this host's: a page
  elsewhere may open a WebSocket to any server). `stream(url)` behaves as `new EventSource(url)`, tried again as one
  is; where the socket never works (a dashboard without wsproto), each stream is an EventSource again. A pane's frame
  opens a socket of its own. DocWriter's page, built apart (vendor/docwriter), still uses an EventSource.
- **uvicorn runs in a thread of its own** under `Server.serve_forever()`, on the socket `serve()` bound (so port 0
  works and `server_port` is known at once): the caller's thread keeps Ctrl-C and `__main__.py`'s SIGTERM and SIGHUP
  handlers, and `shutdown()` and `server_close()` work as socketserver's did, so the tests and `__main__` are unchanged.
  FastAPI and uvicorn are imported only once a server is made: `page()` and `--out` need neither.
- **No /docs, /redoc or /openapi.json** are served (none were); `app.create().openapi()` makes the schema for B2.
- Rule 3 was not met yet on the server: `/api/send` composed a Browser actor's message and the home said whether
  DocWriter and the Browser are offered, outside their routers, as `server.py` did. B3 moved them.

**B2. Generated types.** FastAPI's OpenAPI schema generates `frontend/src/core/api/types.gen.ts`, and CI fails when
it is stale. This needs B1 and A1.

**B3. The apps behind one list.** Built. `apps.py`'s `APPS` lists DocWriter and the Browser, each an `App` giving
what the shared code asks of it -- found there by name (`named`), by its page's path (`under`) or by its actor's
session (`of`):
- `name` (its role's key, its routes' first part, its flag in `ag actors new`) and `label`;
- `start(sessions)`: its running part, one per dashboard (`Server.apps`, by name), which `create(gatherer, cwd, harness,
  model)`s a new one and its actor, `name_actor(key, name)`s it and `close()`s; `served_at(origin)`;
- `available(running)`, and `home(running)`, what the home says of it (`home_fields`, which `models.Home` adds);
- `key_of(session)`, `launch_args(session)` (`sessions.extra_args`), `compose(running, session, text)` (`/api/send`);
- `error` (its status the HTTP status), `path()`, `max_body` and `page_writes` (`OwnPage`), `router()`.

`sessions.py`, `coordination.py`, `server.py`, `app.py`, `models.py` and `api/sessions.py` loop over `APPS` instead of
naming each. A session's role is still `{"<app name>": key}`, so stored sessions don't change. `test_dashboard_apps.py`
checks rule 3 on the server (no module but the apps' own, `apps.py` and their routers names one in its code: strings and
identifiers, not comments and docstrings), with an allow-list of six entries, each saying why, and that each app gives the
interface. `compare_servers.py` still finds all 197 answers the same.

What went another way, and why:
- **No `asked(text)`.** The server never takes an app's state block (`<workspace_state>`, `<browser_state>`) off what its
  actor was asked: the page does (`legacy/19-docwriter.js`, `20-browser.js`), so it goes to the front end's `APPS`.
- **`create` is the running part's**, not the `App`'s: an app's documents, Chrome and tools live in it
  (`docwriter.DocWriters`, `browser.Browsers`), made once per server by `start`; the routers and `coordination.py`
  reach it in `Server.apps`.
- **`ag actors new`'s flags are the apps' names**: `Coordination.new(..., **app)` takes `docwriter=True` or
  `browser=True` as before, and `/api/actors/new` passes each app's flag. Its errors for flags that do not go together
  are now said the same for every app: "a Browser's actor works in its folder, not on a branch: --browser or --branch,
  not both" (was "--browser alone"), "an actor is one app's at most: --docwriter alone or --browser alone" (was "a
  Browser's actor is neither a DocWriter nor on a branch"); DocWriter's with a branch says "a DocWriter's actor works in
  its folder" for "a DocWriter writes in its folder".
- **Moved into the apps' own code:** the Browser's error status (from `api/common.py` into `api/browser.py`'s
  `BrowserErrors`, for all its routes: the same answers); DocWriter's MCP server's name (`mcp.NAME` is now a generic
  default, "ag-dashboard"; DocWriter passes `docwriter.MCP_NAME`), its body limit (`server.DOCWRITER_BODY`, now
  `docwriter.MAX_BODY`) and its availability (`docwriter.available()`); `docwriter.key_of`, which also checks the key
  is one (16 hex digits) where `coordination.py` took any string -- a role nothing writes.
- **The routers' order:** the apps' come last in `APPS`' order, so `--routes` lists DocWriter's before the Browser's. No
  path of one is another's.
- **`preview.py` still names DocWriter**, allowed: it shows a PDF in pdf.js, which DocWriter's build puts under
  `vendor/docwriter/pdfjs`, with DocWriter's file types and SyncTeX. A module of their own (and pdf.js out of
  DocWriter's folder) would end that; not done here.
- **`compare_servers.py`** gives the old server's call of `Coordination` (an argument per app) its new form
  (`_as_before`): the old `server.py` runs on today's modules.

**B4. The dashboard's database in one place (`store.py`).** Built. Twelve modules each opened `dashboard.db` their
own way (37 `sqlite3.connect` calls), made their tables on every write, added columns by hand, and kept their own lists
of which tables follow an actor that moves group, a group merged or an actor discarded; two such lists disagreed (a
discarded actor's task row left behind, a moved actor's branch left under its old group). Now:
- **Each table is declared once,** by the module that keeps it (`store.table`): its statements, the columns added
  since, and what its rows do when an actor moves (`actor`, `on_move`), a group is merged (`merged`: MOVE, DROP, STAY or
  a function; required of any table with a `gatherer` column, so a new one is decided, not forgotten), or an actor is
  discarded (`discarded`), and a `tidy` after any of these.
- **Made at the first write** (`store.write`, `store.transaction`), and given its columns since once per database a
  process opens (looked at again after any schema change, `PRAGMA schema_version`). A read never makes one: some
  tell "never kept" by its absence.
- **Moves, merges and discards** (`move_actors`, `merge_group`, `discard_actor`) go over every declared table; groups.py
  and sessions.py no longer list tables.
- **A locked database is an error**, after the connection's TIMEOUT: a read no longer takes it for "nothing kept". The
  page's stream keeps the home it has and reads it again at the next wake.
- **A gatherer's database** (ag's) is opened read-only by `store.gatherer`, not by three copies of it.
Checked against a copy of a real home: `data.home()`'s output is the same, byte for byte, before and after.

**B5. Where each thing is, read once (`placement.py`).** Built. Which group each actor is in, the folders and what is
filed in them, each app instance's group and when each group last changed were each worked out from ag's records in
their own place: `data._groups` (once per group, for each group listed), `alone_names`, `changed`, `_instances_of`,
`folders._records`. Two of them missed a move once (an actor listed under its old group; an app's notices left under
it). Now one pass over those records gives all of it, kept until a record of theirs is added (their last row id, how
many, their sum), and every one of those reads it: a home read replays them once, not once per group. `data.home()`
gives the same output on a copy of a real home.

### Dependencies

- A0 comes first.
- A3 needs A1 and A2; A4–A6 follow in order.
- B1 can start any time; B2 needs B1 and A1; B3 needs B1.

## Room for later

Not built now. Each becomes a change in one place, given the steps above:

| Later | What it takes |
|---|---|
| Another app like DocWriter | A folder in `frontend/src/apps/` and its entry in `APPS`; a module and its entry in `apps.py`; its router. Rule 3 shows anything missed. |
| Apps from outside the repo | A public `agDashboard.app(...)` beside `chatView`, and Python entry points adding to `apps.py`'s list. |
| `ag actors new --app <name>` | One flag over `apps.py`'s list, with `--docwriter` and `--browser` kept as aliases. |
| Dragging panels anywhere | `layout/` only: the `layout` slice becomes a tree of splits and tabs drawn by [dockview](https://github.com/mathuo/dockview) (`dockview-react`; no dependencies, drag to dock, saved layouts, MIT). Its docs require `renderer: 'always'` for panels holding iframes, which matches rule 4. |
| Saved or preset arrangements | The `layout` slice, saved and loaded. |
| Shiki for code | `core/ui/Code` only. |

## Decisions for you

- **React** (recommended) or another framework (Vue, Svelte). React for its libraries and because the agents
  write it most fluently.
- **FastAPI** (recommended), so the dashboard is no longer standard-library only.
- **The build after a pull** in your editable install: a git hook, or by hand. (Built: `ag dashboard`'s start
  builds it, `page_build.py`.)
- **When to run A3:** the open `page.html` work has to be merged first, or ported that day.

## Projects built this way

Checked on each project's current default branch (2026-11-02). None matches all of it; each shows one part.

| Project | Look at | Shows |
|---|---|---|
| [marimo](https://github.com/marimo-team/marimo/tree/main/marimo/_server/api/endpoints) | `marimo/_server/api/endpoints/*.py` (23 files, each a `router`, mounted in `api/router.py`); `frontend/src/{components,core,plugins}` | The closest overall: a Python server with a router per feature, and a React, TypeScript and Vite front end with `core/` state (jotai), CodeMirror 6 and xterm.js. It streams over a WebSocket. |
| [mitmproxy](https://github.com/mitmproxy/mitmproxy/tree/main/web/src/js) | `web/src/js/ducks/store.ts` (Redux Toolkit); `mitmproxy/tools/web/app.py` | A Python tool's React and TypeScript UI, built by Vite, with one store fed by live updates (A4). |
| [Gitea](https://github.com/go-gitea/gitea/tree/main/web_src/js/features) | `web_src/js/features/*.ts`, `web_src/js/components/*.vue`, `web_src/css/features/` | Moving a large hand-written front end gradually, over many PRs (jQuery removed piece by piece), as A3–A6 do. Built by Vite. |
| [Ray dashboard](https://github.com/ray-project/ray/tree/master/python/ray/dashboard/modules) | `modules/<feature>/*_head.py` with `@routes.get(...)`; `client/src/pages/<feature>` | Server modules per feature, mirrored by the client's pages. |
| [pgAdmin 4](https://github.com/pgadmin-org/pgadmin4/tree/master/web/pgadmin/tools/psql) | `tools/psql/` (Flask routes beside a React component using xterm.js); `tools/sqleditor/` (CodeMirror 6) | A Python server with React, xterm.js and CodeMirror; zustand for state. |
| [VS Code](https://github.com/microsoft/vscode/tree/main/src/vs/workbench/contrib) | `src/vs/workbench/contrib/<feature>/browser/*.contribution.ts` | Features that register themselves, and import rules between layers checked by lint. Very large. |
| [ttyd](https://github.com/tsl0922/ttyd/tree/main/html/src) | `html/src/components/terminal/` | A terminal component around xterm.js, and a whole UI built into one inlined HTML file, as our snapshots are. Preact; its server is C. |

None of them streams over server-sent events as ours did; they use WebSockets, socket.io or polling. Ours now go over
one WebSocket per page (`core/api/stream.ts`, `api/ws.py`), still written as server-sent events by their routes.
