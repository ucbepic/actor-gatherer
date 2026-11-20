# The dashboard on a standard stack: plan

Status: A0–A4, B1, B3, B4 and B5 built; A3b (the old page as modules, `src/legacy/` gone) built; A5 begun (the renderers
the views share, in `core/ui/`; Chat's turn list, in `features/chat/`). A1's build step, the server serving it and `publish.yml` building it come with A3, the
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
| Splits and resizing | `widthGrip`, `topGrip`, the panes' own layout | **react-resizable-panels** now; **dockview** later, for dragging panels | Standard split panes; layouts saved as data. |
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
    layout/                the shell: the list's column, the Editor above the panes, the panes, Details;
                           react-resizable-panels; the `layout` slice is the arrangement as data
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
  code calls of it (the panel opened or closed; whether this is a snapshot or a pane's frame). Both go when nothing
  calls them.
- **One stream.** The old page's stream stays the only one, and copies what it takes into the store
  (`core/store`, Zustand). It moves into `core/api/stream.ts` with the shell (A6): until panes stop being frames, the
  page around them streams for them, which is the old page's code.
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

**A6. The shell in React.**
- The arrangement becomes the store's `layout` slice: the list's mode and width, the Editor open and its height, the
  panes, Details, the chat minimized. It replaces today's separate browser keys, which are read once and dropped.
- react-resizable-panels draws the splits.
- Panes become components in one page, sharing one stream.
- `page.js` has no module left to start, and goes with the bridge.

The layout slice comes first, in four steps, each with every test passing:
1. *The model* (built): `features/layout/model.ts`, one `Layout` value -- the screen tabs, the tab shown, what each
   task was left with -- and pure functions for every change, by the rules `tabs.ts` and `rememberTask` have; with
   `migrate()` from the six keys (`panes`, `top-apps`, `task-layouts-2`, `screen`, `screen-tabs`, `task-trees`).
2. *Shadow mode* (built): `shadow.ts` runs the model beside the page. Each change is told where the page makes it --
   the tab bar's operations, a task entered (`enterTask`, `enterAppsTask`), opened beside, an app's panel added, a
   task's last panel closed, the actor the page opens on by itself -- and once the page is quiet, the tasks shown and
   every tab's are checked against it. The browser tests record each difference (`AG_LAYOUT_STRICT` fails on one).
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
   - 4c-3c: clicks call the model's functions, one renderer opens and closes panes to match it (in place of the tells,
     and of entering a tab's tasks), `shadow.ts` becomes the layout's store, and the old variables
   (`appsOnly`, `taskNow`, `hereAway`, `tasksLaidOut`, `autoShown`, `taskLayouts`) and the six keys go -- one key,
   `ag-dashboard-layout`. The model then holds each task's open items itself (what `keysNow` reads off the panels now).

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
