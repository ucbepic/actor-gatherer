// What the dashboard's routes answer, generated from the server's OpenAPI schema (ag_dashboard/models.py) by
// scripts/gen-types.mjs: `pnpm gen:types` writes it again, and CI fails when it is stale. Not edited by hand: the page
// names these types through ./types.ts.
export interface paths {
  "/manifest.webmanifest": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Manifest
     * @description The page as an app (its web app manifest, which index.html links): its name and the icons a browser installs it
     *     with -- Chrome's "Install", Safari's "Add to Dock" -- and shows in the Dock or the task bar; opened in a window of
     *     its own at this dashboard's page.
     */
    get: operations["manifest_manifest_webmanifest_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/icons/{name}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * App Icon
     * @description One of the app's icons (icons/<name>, a PNG): those the manifest names, and Safari's (apple-touch-icon.png).
     */
    get: operations["app_icon_icons__name__get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * The Page
     * @description The page: static/index.html, the vendored scripts in it (server.py's `page()`); or, not built yet, how to build
     *     it.
     */
    get: operations["the_page__get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/index.html": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * The Page
     * @description The page: static/index.html, the vendored scripts in it (server.py's `page()`); or, not built yet, how to build
     *     it.
     */
    get: operations["the_page_index_html_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/assets/{name}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Assets
     * @description What the page's build made (static/assets/): its script and styles, kept by the browser for good (named by
     *     their content).
     */
    get: operations["assets_assets__name__get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/vendor/pdfjs/{rel}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Pdfjs
     * @description pdf.js and its viewer, which the Editor shows a PDF in (libs.py: the copy apps' panels load too).
     */
    get: operations["pdfjs_vendor_pdfjs__rel__get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/vendor/{name}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Vendored
     * @description A vendored script or stylesheet the page has inside it (marked, DOMPurify, xterm.js and its add-ons), on its
     *     own, for the page in development (frontend/'s `vite`).
     */
    get: operations["vendored_vendor__name__get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/avatars/{name}.svg": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Avatar
     * @description An avatar's picture (ag_dashboard/avatars/<kind>/<name>.svg); ?bare=1: without its circle, the character alone
     *     (the Chat view's, at work). Kept by the browser a while (the list is drawn again often), its scripts never run
     *     even opened on its own: a picture put in the folder by hand is the reader's, not ours.
     */
    get: operations["avatar_avatars__name__svg_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/views": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Views
     * @description The reader's own chat views: <home>/dashboard/views/*.js, by name.
     */
    get: operations["views_api_views_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/views/{name}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * View
     * @description One of the reader's chat views (<name>.js), which the page loads.
     */
    get: operations["view_views__name__get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/home": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * The Home
     * @description data.home(), each actor with its avatar (avatars.py's `assign`), and the shells open (sessions.py's `shells`):
     *     read now, a page's first (its stream's after it, shared).
     */
    get: operations["the_home_api_home_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/gatherers": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * New Gatherer
     * @description {name}: a new gatherer (`ag new`), no session yet -> {name}.
     */
    post: operations["new_gatherer_api_gatherers_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/hiding": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Hide
     * @description {gatherer, choice}: keep "hidden" / "shown" / "" for it (hiding.py) -> every choice.
     */
    post: operations["hide_api_hiding_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/title": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Title
     * @description {gatherer, title}: the reader's name for the gatherer ("": none), shown in its place (titles.py) -> every title.
     */
    post: operations["title_api_title_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/saved": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Save
     * @description {gatherer, channel, saved}: the actor saved for later, or no longer (saved.py) -> every one saved.
     */
    post: operations["save_api_saved_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/folders": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Folder
     * @description {gatherer, do, ...}: the gatherer's folders changed (folders.py) -> {folders: every gatherer's, made?}.
     *
     *     new {name, parent?} (made: its id), rename {id, to}, move {id, parent?} (a folder put in another; none: at the
     *     top), delete {id} (what was in it moved up), file {channels, folder?} (actors put in a folder; none: at the top),
     *     close {id} (every actor in it closed, its bookmark off, its terminals ended, then it marked closed, with the
     *     folders in it: `left`, the actors in it left open, and `saved`, every one saved after), reopen {id}.
     */
    post: operations["folder_api_folders_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/groups": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Group
     * @description {gatherer, to, do, channels?, folder?, into?}: actors, or a folder with every actor in it, moved from one group
     *     to another (groups.py), in the home's one database -> plan: what it would do, for the page to ask first; move: it
     *     done -> {moved, folders, tasks}. split {gatherer, folder}: the folder made a group of its own -> {split, ...}.
     *     alone {gatherer, channel}: the actor taken out of every group, on its own -> {alone, ...}. new {name, folder?}: a
     *     folder made outside every group, made a group (in that folder of groups) -> {made, titles, gatherer_folders}.
     *     merge_plan / merge {gatherer, to, into?}: the group `gatherer` made a folder of `to` (in its folder `into`) -> what
     *     it would do; {merged, ...}. place {gatherer, to, into?}: the group (an actor on its own's too) put in `to`'s folder
     *     `into`, keeping its own group (`to` "": at the list's top) -> {placed, places, gatherer_folders}. own {gatherer,
     *     folder}: the folder given a group of its own where it is -> {own, ...}. above {gatherer}: a group placed in another's
     *     folder merged into that group -> {merged, ...}. alone's `here`: the actor stays in its folder, on its own there.
     */
    post: operations["group_api_groups_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/groups/manage": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Manage Groups
     * @description `ag groups` (ag/cli/groups.py): the home's groups read, or changed by name, each change said first -- and only
     *     said, `dry_run` (group_admin.py) -> {said: [lines], done, ...}.
     */
    post: operations["manage_groups_api_groups_manage_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/tasks": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Task
     * @description {gatherer, do, ...}: the gatherer's tasks changed (tasks.py) -> {tasks: every gatherer's, now, task?, attached?}. An
     *     item is an actor, by its channel, or an app's instance, "app:<its id>"; attachment follows (task_links.py): every
     *     agent of a task attached to every app of it, one leaving detached from them.
     *
     *     add {to, items, name?} (the items put in the task the item `to` is in -- in none, one made of them all, called
     *     `name`, none: named by what is in it -- each agent among them attached to the task's apps before its agent starts, so
     *     it is given their tools as it starts: `attached`, {channel: [instance ids]}), out {items} (taken out of their
     *     tasks), rename {id, to} ("": named by what is in it again). `channels` is `items`, as it was called before apps were items.
     *     An app among `items` is put in the task only if that is what adding it to an actor or a task does (app_policy.py).
     */
    post: operations["task_api_tasks_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/gatherer-folders": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Gatherer Folder
     * @description {do, ...}: the folders gatherers are kept in changed (gatherer_folders.py) -> {gatherer_folders: all, made?}.
     *
     *     new {name, parent?} (made: its id), rename {id, to}, move {id, parent?} (a folder put in another; none: at the
     *     top), delete {id} (what was in it moved up), file {gatherers, folder?} (gatherers put in a folder; none: at the top).
     */
    post: operations["gatherer_folder_api_gatherer_folders_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/name": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Name
     * @description {gatherer, channel, name, harness?, cwd?}: the reader's name for the actor ("": none) -> {name, store, error,
     *     terminal}.
     *
     *     A `name` event in its gatherer, put in by ag (naming.py), given to its harness's own store too (`store`: what was
     *     done there, `error`: why not), and -- where the dashboard runs its terminal -- typed there as the harness's own
     *     command once its turn is over (sessions.py's `rename`; `terminal`: held for it).
     */
    post: operations["name_api_name_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/seen": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Look
     * @description {seen: [[gatherer, channel, last], ...]}: those actors looked at, each with its `last` (seen.py) -> every one
     *     seen. Not rung: a home costs every stream a read of every gatherer; the page that looked has it, the others with
     *     their next home (KEEPALIVE at most).
     */
    post: operations["look_api_seen_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/stream": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Stream
     * @description Server-sent events, until the page goes: `home` (data.home()) and, with `gatherer` and `channel`, `agent`
     *     (data.agent(G, C)) and `chat` (what Chat shows of it: chat_view.py's `view`, made from one read) at once -- `chat`
     *     first, each sent as soon as it is read -- then again each time they change; `chat` also as time alone changes it
     *     (a send not seen for long), checked every KEEPALIVE.
     *
     *     Woken by ag's notifications or the fallback check (live.py) -- what the harness's own record of a session says (the
     *     user writing to it as it works, a question answered in its terminal, Esc) among them, as ag's hook records it --
     *     and every KEEPALIVE seconds a comment, or `home` if the time alone changed it (Running/Idle). `also` (JSON
     *     [[G2, C2], ...]): the page's other actors, its other panes, each sent the same way as `actor` {gatherer, channel,
     *     agent, chat}: one stream for all a page shows, as a browser keeps few open.
     */
    get: operations["stream_api_stream_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/agent": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Agent
     * @description data.agent(G, C): the actor's state, its calls and reads.
     */
    get: operations["agent_api_agent_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/read": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Read
     * @description data.read(G, N): what the read N held.
     */
    get: operations["read_api_read_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/context": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Context
     * @description data.context(G, N): the context the read N gave.
     */
    get: operations["context_api_context_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/history": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * History
     * @description data.history(G, C, A, B): the actor's history from A (to B).
     */
    get: operations["history_api_history_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/transcript": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Transcript
     * @description data.transcript(G, C, A, B): the actor's transcript, after A or before B.
     */
    get: operations["transcript_api_transcript_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/files": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Files
     * @description files.files(G, C, N, D): the actor's turns and the files of each (the turn N's, in the directory D).
     */
    get: operations["files_api_files_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/files/changes": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Changes
     * @description files.changes(G, C, P, S, D): the actor's changes to the file P since S (seconds).
     */
    get: operations["changes_api_files_changes_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/image": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Image
     * @description files.image(G, R, I): the image the call I's result holds, as stored in event R.
     */
    get: operations["image_api_image_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/outline": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Outline
     * @description history.outline(G, C, A): the events after row A (the channel's only, with one), light, and the tasks.
     */
    get: operations["outline_api_outline_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/event": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Event
     * @description history.event(G, R): one event, as the transcript shows it.
     */
    get: operations["event_api_event_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/search": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Search
     * @description history.search(G, C, Q): the events whose words hold Q (the channel's only, with one).
     */
    get: operations["search_api_search_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/extracts": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Extracts
     * @description history.extracts(G): what the model made of the history, newest first.
     */
    get: operations["extracts_api_extracts_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/history/export": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Export
     * @description {gatherer, rows, format}: those events as a file -> {name, text} (history.py).
     */
    post: operations["export_api_history_export_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/history/extract": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Extract
     * @description {gatherer, rows, kind, ask?}: the Gatherer's model asked for a summary, memory or skill of them, in the
     *     background -> its record.
     */
    post: operations["extract_api_history_extract_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/history/delete": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Delete
     * @description {id}: a record removed, its job stopped -> {id}.
     */
    post: operations["delete_api_history_delete_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/history/build": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Build
     * @description {gatherer, channel}: ag asked to build the actor's history (history.build).
     */
    post: operations["build_api_history_build_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/history/save": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Save
     * @description {id, target, dir?, version?, harness?}: where the harness reads it -- the plan, without `version`; with the
     *     plan's, the files written -> {saved, where}.
     */
    post: operations["save_api_history_save_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/sessions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Listed
     * @description The sessions started from the page (sessions.py).
     */
    get: operations["listed_api_sessions_get"];
    put?: never;
    /**
     * Start
     * @description {gatherer, cwd?, permission_mode?, harness?, model?, alone?}: a new session (harness claude, the default, or
     *     codex) -> the session. `alone`: an actor on its own from its start, run under `gatherer` (groups.py's
     *     `start_alone`). By keyword: `start_alone` and `create` take their options in different orders.
     */
    post: operations["start_api_sessions_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/models": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Models
     * @description ?harness=H: the models a new session of H can run on (sessions.py's `models`).
     */
    get: operations["models_api_models_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/send": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Send Message
     * @description {session_id, text, cols?, rows?, fullscreen?, cid?} or {gatherer, channel, text, ...}: a message to the session ->
     *     the session. `cid`: the send's id, as the page knows it (Chat's view, chat_view.py, tells the message it became by it).
     *
     *     Typed into its terminal, or one opened for it (that size, that screen), or to its agent (sessions.py's `send`);
     *     a Claude Code or codex session not started here (gatherer, channel) taken into the table first (sessions.py's
     *     `adopt`). While the codex in the dashboard's terminal asks whether to implement its plan, what to change instead
     *     ("No, stay in Plan mode", then the message); refused while it waits on a question there (`dialog`), and while its
     *     terminal's message box is not there, empty, to take it -- a dialog, a menu, a question, a permission asked, or
     *     something typed there and not sent: the error then has `box` (sessions.py's NotAtBox). The message goes as typed:
     *     an app tells its agent what it needs to by events of its own (a Browser: what the user did and picked in it).
     */
    post: operations["send_message_api_send_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/upload": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Upload
     * @description {type, data (base64)}: a file pasted into a message, kept in the home for its agent to read (home.py's
     *     `save_upload`) -> where.
     */
    post: operations["upload_api_upload_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/stop": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Stop
     * @description {session_id}: its agent, idle, ended -- or its terminal closed -> the session.
     */
    post: operations["stop_api_stop_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/discard": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Discard
     * @description {session_id}: one that never started -- no process of it running, no conversation of it in its gatherer
     *     (data.py's `has_conversation`: an app's notes to an agent it started, which no model call has carried, are none) --
     *     forgotten: listed nowhere, nothing of it kept (sessions.py's `discard`) -> {}.
     */
    post: operations["discard_api_discard_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/answer": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Answer Ask
     * @description {session_id, id, choice}: what it asks (data.py's `asking`: a question, a plan, a permission -- the one whose id
     *     is `id`; `call`, as the page named it before -- or a dialog only its terminal's screen shows, `shown_ask`'s: a menu
     *     as it starts, a permission no hook reported), answered with `choice` (answers.py; a dialog's, {"pick": its option})
     *     -> the answer. The one path for every kind: the dashboard's terminal for the session answered with its dialog's
     *     keys (sessions.py's `answer`).
     */
    post: operations["answer_ask_api_answer_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/coordinator": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Coordinator
     * @description {over | gatherer, cwd?, harness?}: the coordinator agent over the node `over` (coordinators.py: "all",
     *     "groups:<id>", "group:<name>", "folder:<id>"; `gatherer`, a group's name: that group), started (with no message
     *     yet) if it has none (coordination.py) -> the session.
     */
    post: operations["coordinator_api_coordinator_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/actors/{op}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Actors
     * @description {actor, ...}: what an actor's `ag actors <op>` asks (coordination.py; `actor`, its id) -> what it answers; an
     *     error's text for the command to print (400).
     *
     *     list {all?}, coordinators, show {ref}, who {path}, send {ref, text, with?} (with: the actors of a conflict, for
     *     `coordinator`), new {text, cwd?, harness?, model?, like?, name?, folder?, group?,
     *     <app>? (an app that starts an agent of its own: docwriter?, browser?), branch?, approve?}, when {ref, note?}, watches, unwatch {watch},
     *     save {ref, folder?, unfiled?}, unsave {ref}, folders, folder {do: new | rename | move | split | delete, name, to?,
     *     group?}, move {refs, folder, group?} (folders: by path, "top" or none for the gatherer's top; group: another one,
     *     groups.py), alone {ref}.
     */
    post: operations["actors_api_actors__op__post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/terminal": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Terminal
     * @description Server-sent events, until the page goes: what the session's (or the shell's: S its id) terminal prints.
     *
     *     `out` {data (base64), at (where it ends), reset (all that is kept: start over -- a full screen then drawn all
     *     again, sessions.py's `redraw`)}, then `exit` {code} when its process ends; `none` when it has no terminal.
     */
    get: operations["terminal_api_terminal_get"];
    put?: never;
    /**
     * Open Terminal
     * @description {session_id | gatherer, channel, cols, rows, fullscreen?}: the session opened in a terminal, Claude Code's own
     *     UI (sessions.py's `terminal`), in its classic screen unless `fullscreen` -> the session.
     */
    post: operations["open_terminal_api_terminal_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/terminal/input": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Typed
     * @description {session_id, data}: what was typed in it -> {}.
     */
    post: operations["typed_api_terminal_input_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/terminal/resize": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Resize
     * @description {session_id, cols, rows}: its new size -> {}.
     */
    post: operations["resize_api_terminal_resize_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/shells": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Shell
     * @description {gatherer, cwd, cols?, rows?, folder?}: a shell opened in `cwd`, listed under the gatherer -- in its folder
     *     `folder` (folders.py's id), if given (sessions.py's `shell`) -> the shell, its id the session_id its terminal is
     *     reached by.
     */
    post: operations["shell_api_shells_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/shells/close": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Close Shell
     * @description {id}: the shell's terminal closed, as a window is -> {}.
     */
    post: operations["close_shell_api_shells_close_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/projects": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Projects
     * @description {projects, suggestions}: the gatherer's projects, the repositories its actors' branches are made from, and those
     *     the directories D (?dirs=[D, ...]) are in (branches.py).
     */
    get: operations["projects_api_projects_get"];
    put?: never;
    /**
     * Set Project
     * @description {gatherer, add | remove, dirs?}: a project set for the gatherer (a folder in a repository, or a GitHub
     *     repository: cloned), or no longer -> as GET /api/projects.
     */
    post: operations["set_project_api_projects_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/branches": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Under
     * @description The actors' branches of the projects R is in or holds, each with its changes held for the reader (branches.py's
     *     `under`).
     */
    get: operations["under_api_branches_get"];
    put?: never;
    /**
     * New Branch
     * @description {gatherer, project, harness?, approve?, model?}: a new session on a new branch of the project, in a worktree of
     *     its own (branches.py's `create`) -> the session.
     */
    post: operations["new_branch_api_branches_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/branches/approve": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Approve
     * @description {session_id, approve}: whether every change of its branch's is asked about -> the session.
     */
    post: operations["approve_api_branches_approve_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/branches/decide": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Decide
     * @description {session_id, path, take}: each change of its branch's to the file held for the reader, taken in ("theirs") or
     *     left out ("mine") -> the branch.
     */
    post: operations["decide_api_branches_decide_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/monitor": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * The Monitor
     * @description ?actors=[[G, C, D], ...]: monitor.actors, what each is doing, its latest turn -> {actors}.
     */
    get: operations["the_monitor_api_monitor_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/settings": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Read
     * @description ag's settings, its config.toml (settings.py).
     */
    get: operations["read_api_settings_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/settings/model": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Model
     * @description {model, api_base?, key_env?}: the Gatherer's model, by `ag model` -> the settings.
     */
    post: operations["model_api_settings_model_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/settings/defaults": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Defaults
     * @description {version, policy?, pollers?, gatherer?}: a new gatherer's defaults -> the settings.
     */
    post: operations["defaults_api_settings_defaults_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/settings/file": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Config File
     * @description {version, text}: config.toml as the reader edited it -> the settings.
     */
    post: operations["config_file_api_settings_file_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Apps Listed
     * @description The apps found (each its manifest, its panel's origin), those whose manifest can't be read (`broken`), and --
     *     for gatherer G -- its open instances, the agents attached to each, and its tasks (tasks.py: which an app is in, read
     *     with them), with when they were read (`now`, as the home's: the page takes no tasks read before those it has).
     */
    get: operations["apps_listed_api_apps_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/open": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Open
     * @description The app's instance for the gatherer (and folder, for an app with one per folder or checkout): the open one, or
     *     a new one -- `reuse`, for an app with any number, one open at that folder and in no task, if there is one. With
     *     `channel`, that agent attached to it when they come to be in one task -- the app, in no task, put in the agent's;
     *     the agent, in none, in the app's (task_links.py's `link`) -- unless adding the app to an actor doesn't put it in a
     *     task (app_policy.py: "folder", "no"): then only opened.
     */
    post: operations["apps_open_api_apps_open_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/close": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Close
     * @description The instance closed: its agents detached, its backend told; out of its task.
     */
    post: operations["apps_close_api_apps_close_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/rename": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Rename
     * @description The instance named by the user (app_host.py's `rename`; "" takes the name back) -> the instance.
     */
    post: operations["apps_rename_api_apps_rename_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/sleep": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Sleep
     * @description The instance put to sleep, its task closed (app_host.py's `sleep_instance`): what runs for it let go of, the
     *     instance kept open, in its task.
     */
    post: operations["apps_sleep_api_apps_sleep_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/attach": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Attach
     * @description An agent (its channel) attached to the instance by the reader: put in the app's task, so attached to its other
     *     apps too (task_links.py's `link`, `move`) -- the app in none, the app put in the agent's.
     */
    post: operations["apps_attach_api_apps_attach_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/detach": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Detach
     * @description An agent detached from the instance by the reader: in the app's task, taken out of it (task_links.py's
     *     `unlink`), so detached from its other apps too.
     */
    post: operations["apps_detach_api_apps_detach_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/events": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Apps Events
     * @description The instance's events of TYPES (comma-separated) after row AFTER, as the app may read them.
     */
    get: operations["apps_events_api_apps_events_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/insert": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Insert
     * @description Events the app's panel puts into its instance's gatherer, checked as its backend's are.
     */
    post: operations["apps_insert_api_apps_insert_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/notify": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Notify
     * @description A notification the app's panel sends the user (app_kit's Host.notify), checked as its backend's is -> {id}.
     */
    post: operations["apps_notify_api_apps_notify_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/notices/settle": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Notice Settle
     * @description An instance's open notification (`which`: its id, or its key) settled: `by` "user", dismissed from the list or a
     *     pop-up; "app", cleared by its panel (`app` then names it, and it may clear only its own).
     */
    post: operations["apps_notice_settle_api_apps_notices_settle_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/call": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Call
     * @description A tool of the app called by the user, from its panel: the backend's answer, as MCP gives one.
     */
    post: operations["apps_call_api_apps_call_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/answer": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Answer
     * @description A panel's answer to a tool call it was asked (its `ag: call` message): MCP's result.
     */
    post: operations["apps_answer_api_apps_answer_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/mcp/{actor}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Mcp
     * @description The apps' MCP server for an actor (tool_gateway.py): its gatherer's apps' tools, their instructions, and each
     *     call to the instance the actor is attached to.
     */
    post: operations["apps_mcp_mcp__actor__post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/agent": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Agent
     * @description What `ag apps` lists for an actor: its gatherer's apps, their tools and instructions, and its instances.
     */
    post: operations["apps_agent_api_apps_agent_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/apps/mark/{name}.svg": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Apps Mark
     * @description An app's mark (its manifest's `mark`), from the dashboard's own origin: the badge on an agent it started.
     */
    get: operations["apps_mark_apps_mark__name__svg_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/start": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Start
     * @description {app, gatherer, cwd, harness?, model?}: a new instance of an app that starts an agent of its own ([agent] start),
     *     and a new actor there attached to it (app_agents.py) -> {instance, session}.
     */
    post: operations["apps_start_api_apps_start_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/guard": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Guard
     * @description {path}: an agent of `gatherer` (`channel`) about to change `path` with its harness's own edit tools, asked by
     *     its guard (app_guard.py) -> {deny: why} when an app it is attached to refuses it (an app asking `edit_guard`).
     */
    post: operations["apps_guard_api_apps_guard_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/agent/call": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Agent Call
     * @description A tool called by an actor through `ag apps call`: MCP's result, as its MCP server would give it.
     */
    post: operations["apps_agent_call_api_apps_agent_call_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/stream": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Apps Stream
     * @description Server-sent events, until the page goes: `event` (a new row of TYPES the app may read, after AFTER) and --
     *     unless MESSAGES is 0 -- `message` (what its backend tells its panels: one stream of a panel's takes them).
     */
    get: operations["apps_stream_api_apps_stream_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/apps/host/{name}/{op}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Host Op
     * @description What an app in its own process asks of the host (app_kit's remote.py), with the token it was started with.
     */
    post: operations["host_op_apps_host__name___op__post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/catalog": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Apps Catalog
     * @description Every app installed (what it gives agents and costs them, what it may do, where it came from, its windows open,
     *     its data), the folders that couldn't load, and the apps that can be installed.
     */
    get: operations["apps_catalog_api_apps_catalog_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/updates": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Apps Updates
     * @description The apps installed from git that have a newer commit: {updates: {name: commit}} (asks each source).
     */
    get: operations["apps_updates_api_apps_updates_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/stage": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Stage
     * @description A folder or git URL copied aside and its app.toml checked: what it is, its staging id, and -- one installed of
     *     that name -- what an update changes.
     */
    post: operations["apps_stage_api_apps_stage_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/install": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Install
     * @description The staged app (`id`) installed -- `update`: in place of the one installed -- or (`builtin`) an app that comes
     *     with ag installed again. On in every group at once.
     */
    post: operations["apps_install_api_apps_install_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/discard": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Discard
     * @description A staged app removed, not installed.
     */
    post: operations["apps_discard_api_apps_discard_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/uninstall": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Uninstall
     * @description The app uninstalled: its windows close, its backend stops, agents lose its tools at their next start; its data
     *     kept unless `data`.
     */
    post: operations["apps_uninstall_api_apps_uninstall_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/settings": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apps Settings
     * @description {app, agent?, on_task?}: the reader's choices of the app, from now on -- `agent`, started with an agent of its
     *     own when opened from a menu, or on its own (only for an app that can have one); `on_task`, what "+" on an actor or
     *     a task does with it (app_policy.py: one it can take; its manifest's own, no choice kept). Each checked before
     *     either is kept.
     */
    post: operations["apps_settings_api_apps_settings_post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/requests": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Apps Requests
     * @description The agents' requests waiting for the user (app_requests.py).
     */
    get: operations["apps_requests_api_apps_requests_get"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/apps/requests/{rid}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Apps Request
     * @description One request, as its agent's `ag apps` waits on it.
     */
    get: operations["apps_request_api_apps_requests__rid__get"];
    put?: never;
    /**
     * Apps Request Settle
     * @description The user's answer to an agent's request: {approve: true} done as asked; else declined. The agent told.
     */
    post: operations["apps_request_settle_api_apps_requests__rid__post"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    /**
     * Actor
     * @description An actor, as the list shows it (data.py's `_agents`; one started here with no message yet, `_with_started`'s),
     *     with its session, if the dashboard has one, and its avatar (avatars.py's `attach`).
     */
    Actor: {
      channel: string;
      harness: string | null;
      name: components["schemas"]["Name"] | null;
      /** @description running, idle, closed, background, asking, error */
      status: string;
      cwd: string | null;
      created: number | null;
      /** @description its latest activity */
      last: number | null;
      last_event: number | null;
      last_read: number | null;
      last_user_message: string | null;
      recap: components["schemas"]["Recap"] | null;
      events: number;
      reads: number;
      tasks: number;
      est_tokens: number | null;
      real_tokens: number | null;
      limit_tokens: number | null;
      sent_tokens: number | null;
      running: boolean;
      building: boolean;
      turn_over: boolean;
      /** @description the page may message it */
      chattable: boolean;
      background: components["schemas"]["Background"][];
      avatar: string | null;
      avatar_hue: string | null;
      avatar_motion: unknown;
      /** @description what it says before its first message */
      avatar_hello: string | null;
      pid?: number | null;
      alive?: boolean | null;
      since?: number | null;
      holder?: components["schemas"]["Holder"];
      said_at?: number | null;
      /** @description how its last turn stopped: the model call it stopped on */
      stopped?: components["schemas"]["Stopped"] | null;
      asking?: components["schemas"]["Ask"] | null;
      failing?: components["schemas"]["Failing"] | null;
      taken_back?: components["schemas"]["TakenBack"] | null;
      session?: components["schemas"]["Session"];
      /** @description a coordinator agent's, or an app's actor's ({app: key}) */
      role?: unknown;
      /** @description a coordinator agent's node (coordinators.py): "all", "groups:<id>", "folder:<id>"; none, its group's */
      over?: string;
      answer?: components["schemas"]["Answered"];
    };
    /**
     * Agent
     * @description One actor over time (/api/agent, and the stream's `agent`): its calls and reads, what is pending, its tasks,
     *     builds and checks, the Gatherer's model calls for it.
     */
    Agent: {
      gatherer: string;
      channel: string;
      harness: string | null;
      reads: components["schemas"]["Read"][];
      pending: components["schemas"]["Item"][];
      typed: components["schemas"]["Typed"][];
      /** @description what the channel has since the latest call: the next call will carry it */
      after_read: components["schemas"]["Item"][];
      tasks: components["schemas"]["AgentTask"][];
      builds: components["schemas"]["Build"][];
      checks: components["schemas"]["Check"][];
      rebuilds: number;
      llm: components["schemas"]["Llm"];
      usage: components["schemas"]["Usage"];
      llm_attributed_by_time: number;
    };
    /**
     * AgentOffer
     * @description An app's `[agent]`: whether it can be opened with an agent of its own, and the name that agent is given.
     */
    AgentOffer: {
      offered: boolean;
      name: string;
    };
    /**
     * AgentTask
     * @description A task ag made of the actor's history.
     */
    AgentTask: {
      index: number;
      name: string;
      description: string | null;
      first_row: number;
      last_row: number;
      tokens: number | null;
      started: number | null;
      ended: number | null;
    };
    /**
     * Answered
     * @description The last answer sent from the page to what it asked (data.py's `answer`): what it was, when, and -- once its
     *     harness recorded it -- what that made of it.
     */
    Answered: {
      call: string | null;
      at: number;
      summary: string;
      result: string | null;
      recorded: boolean | null;
    };
    /**
     * AppData
     * @description Where an app keeps its data, how much, and whether it is there.
     */
    AppData: {
      path: string;
      bytes: number;
      there: boolean;
    };
    /**
     * AppListed
     * @description An app found, as the host lists it (/api/apps): its manifest (app_kit's `to_dict`), its panel's origin and
     *     folder, whether the reader opens it with an agent of its own, why its backend failed (None: it didn't), and what
     *     "+" on an actor or a task does with it as chosen.
     */
    AppListed: {
      name: string;
      label: string;
      version: string;
      description: string;
      instances: string;
      access: string;
      /** @enum {string} */
      on_task: "join" | "folder" | "no";
      instructions: string;
      agent: components["schemas"]["AgentOffer"];
      mark: boolean;
      panel: string | null;
      tools: components["schemas"]["ToolListed"][];
      handles: components["schemas"]["Handles"][];
      links: components["schemas"]["LinkForm"][];
      capabilities: components["schemas"]["Capabilities"];
      origin: string;
      folder: string | null;
      opens_with_agent: boolean;
      failed: string | null;
    };
    /**
     * AppNotices
     * @description An app instance's open notifications (data.py's `app_notices`): `last`, when the newest came.
     */
    AppNotices: {
      app: string | null;
      notices: components["schemas"]["Notice"][];
      last: number | null;
    };
    /**
     * AppRequest
     * @description An agent's asking to install, update or uninstall an app (app_requests.py), waiting for the user.
     */
    AppRequest: {
      id: string;
      actor: string;
      gatherer: string | null;
      /** @enum {string} */
      op: "install" | "update" | "uninstall";
      args: {
        [key: string]: unknown;
      };
      about: components["schemas"]["CatalogApp"];
      state: string;
      said: string;
      at: number;
    };
    /**
     * Apps
     * @description The apps found, those whose manifest can't be read, and -- for a gatherer -- its open instances, the agents
     *     attached to each, and its tasks, with when they were read (`now`).
     */
    Apps: {
      apps: components["schemas"]["AppListed"][];
      broken: components["schemas"]["BrokenFolder"][];
      instances: components["schemas"]["Instance"][];
      attached: {
        [key: string]: string[];
      };
      tasks?: components["schemas"]["Tasks"];
      now?: number;
    };
    /**
     * Ask
     * @description What the agent waits on the user for (data.py's `ask_view`, `shown_ask`): questions, a plan to approve, a
     *     permission before a tool runs (the call as its harness shows it), or a dialog only its terminal's screen shows (a
     *     menu as it starts, or a permission no hook reported), with its options as the screen lists them.
     */
    Ask: {
      /** @description what an answer names it by: a permission's own key, else the call's */
      id: string | null;
      kind: string;
      harness: string | null;
      /** @description asked as it goes on working: its turn does not wait on the answer */
      async: boolean;
      /** @description when it asked */
      at: number | null;
      call: string | null;
      questions?: components["schemas"]["AskQuestion"][];
      plan?: string | null;
      /** @description a permission's call: its tool, what it is for, its input and view (the call's shape, as its harness reads it) */
      tool?: string;
      said?: string;
      input?: {
        [key: string]: unknown;
      };
      view?: {
        [key: string]: unknown;
      };
      /** @description the subagent asking; None: the session */
      agent?: unknown;
      /**
       * @description a dialog's: its title, lines and options, the one its cursor is on; a menu shown as it starts; the options its
       *     harness ends after to update itself
       */
      title?: string;
      lines?: string[];
      options?: string[];
      cursor?: number | null;
      menu?: boolean;
      restarts?: number[];
    };
    /** AskOption */
    AskOption: {
      label: string | null;
      description: string | null;
    };
    /** AskQuestion */
    AskQuestion: {
      id: unknown;
      header: string | null;
      question: string | null;
      multiSelect: boolean;
      options: components["schemas"]["AskOption"][];
    };
    /**
     * AskSays
     * @description How a reader answers what a harness asks (harness_kit's `ask_says`): its words, the ways to take a plan.
     */
    AskSays: {
      plan_verb: string;
      plan_choices: components["schemas"]["PlanChoice"][];
      plan_change: components["schemas"]["PlanChange"];
      own_answer: string;
    };
    /**
     * Background
     * @description A task its harness runs in the background (data.py's `record_background`), with its last sign of life.
     */
    Background: {
      id?: string | null;
      kind?: string | null;
      label?: string | null;
      started: number | null;
      active: number | null;
    };
    /**
     * Block
     * @description What a call did to a file (files.py's blocks), by `t`: the lines it read (`lines`, from `start`: None, not
     *     known), matches it found (`hits`: `rows`), a change (`diff`: `old` replaced by `new` at `at` -- None, not found --
     *     with the known lines `above` and `below`; `write`, `append`: its `lines`), what a command printed (`output`), an
     *     image its result holds (`image`: `row_id`, `id`), a note (`text`); `cut`, how many more lines there were.
     */
    Block: {
      t: string;
      lines?: string[];
      start?: number | null;
      cut?: number;
      rows?: [number, string][];
      at?: number | null;
      old?: string[];
      new?: string[];
      above?: [number, string][];
      below?: [number, string][];
      created?: boolean;
      row_id?: number;
      id?: string;
      text?: string;
    };
    /**
     * Branch
     * @description An actor's branch of a project, in a worktree of its own (branches.py's `listed`).
     */
    Branch: {
      session_id: string;
      channel: string | null;
      gatherer: string;
      project: string;
      worktree: string;
      branch: string;
      start: string | null;
      started_on: string | null;
      onto: {
        [key: string]: unknown;
      } | null;
      approve: boolean;
      held: {
        [key: string]: unknown;
      };
    };
    /**
     * Broken
     * @description An app whose manifest can't be read.
     */
    Broken: {
      folder: string;
      name: string;
      error: string;
      origin: string;
    };
    /** BrokenFolder */
    BrokenFolder: {
      folder: string;
      error: string;
    };
    /**
     * Build
     * @description A build of the actor's history (an analysis): why it started, how long it took, how it ended.
     */
    Build: {
      build_id: number;
      status: string;
      started: number | null;
      finished: number | null;
      through_row: number | null;
      error: string | null;
      reason: string | null;
    };
    /**
     * BuildState
     * @description How a channel's latest build of its own history stands, and the user messages since.
     */
    BuildState: {
      since: number;
      build_id?: number;
      status?: string;
      started?: number | null;
      finished?: number | null;
      error?: string | null;
      reason?: string | null;
    };
    /**
     * CallRun
     * @description A turn's latest call, while nothing readable followed it (files.py's `last`).
     */
    CallRun: {
      text: string;
      call: unknown;
      running: boolean;
      error: boolean;
      output: string;
      exit?: number | string | null;
      took?: string | null;
      id: string | null;
    };
    /**
     * Capabilities
     * @description What an app may do beyond its own panel and tools (its manifest's `[capabilities]`).
     */
    Capabilities: {
      native_view: boolean;
      reads: string[];
      files: boolean;
      commands: boolean;
      message_agents: boolean;
      transcript: boolean;
      edit_guard: boolean;
      docs: boolean;
      actors: boolean;
      notify: boolean;
      message_actors: boolean;
    };
    /**
     * Catalog
     * @description The Apps page (/api/apps/catalog): every app installed, those it can install, and those it can't read.
     */
    Catalog: {
      installed: components["schemas"]["InstalledApp"][];
      available: (components["schemas"]["UninstalledApp"] | components["schemas"]["IndexApp"])[];
      found: components["schemas"]["Found"];
      broken: components["schemas"]["Broken"][];
    };
    /**
     * CatalogApp
     * @description An app as the Apps page lists it, or as an agent's request names it: installed (`InstalledApp`), one that comes
     *     with ag, uninstalled (`UninstalledApp`), one of the index's (`IndexApp`), staged (`Staged`) -- or, an app that comes
     *     with ag no longer found, its name alone.
     */
    CatalogApp: {
      name: string;
      label: string;
      description?: string;
      /** @description where it is: "builtin" (comes with ag), "home" (installed), "path" (AG_APPS_PATH), "index", "staged" */
      origin?: string;
      kind?: string;
      source?: string;
      version?: string;
      mark?: boolean;
      commit?: string;
      installed_at?: unknown;
      /** @description who may use its instances: "task" (the agents in its task) or "group" (every agent of the group) */
      access?: string;
      /** @description it can be opened with an agent of its own (its manifest's [agent] offered) */
      with_agent?: boolean;
      /** @description opened, it starts with an agent of its own: the reader's choice (app_settings.py) */
      opens_with_agent?: boolean;
      instances?: string;
      /**
       * @description what "+" on an actor or a task does with it, as chosen; its manifest's own; and those it can take
       * @enum {string}
       */
      on_task?: "join" | "folder" | "no";
      /** @enum {string} */
      on_task_own?: "join" | "folder" | "no";
      on_task_can?: ("join" | "folder" | "no")[];
      tools?: string[];
      /** @description what its tools' descriptions cost an agent */
      tokens?: number;
      can?: string[];
      own_process?: boolean;
      panel?: boolean;
      schedules?: string[];
      /** @description its windows open: {gatherer: how many} */
      open?: {
        [key: string]: number;
      };
      data?: components["schemas"]["AppData"];
      failed?: string | null;
      needs?: string;
    };
    /**
     * Changes
     * @description What an update changes that the user should see.
     */
    Changes: {
      version: string[];
      tools_added: string[];
      tools_gone: string[];
      can_added: string[];
      own_process: boolean;
    };
    /**
     * ChatView
     * @description What Chat shows of an actor's conversation, as the server made it from one read (the stream's `chat`:
     *     chat_view.py's `view`).
     */
    ChatView: {
      turns: components["schemas"]["Turn"][];
      opening: components["schemas"]["Opening"] | null;
      current: components["schemas"]["Current"];
      waiting: components["schemas"]["Waits"][];
      /** @description the message Esc took back, before any of its answer came */
      taken_back: components["schemas"]["TakenBack"] | null;
      version: unknown[];
    };
    /**
     * Check
     * @description A check of whether a message began a new task.
     */
    Check: {
      row_id: number | null;
      asked: number | null;
      decided: number | null;
      new_task: boolean | null;
      why: string | null;
    };
    /** Choices */
    Choices: {
      default: string;
      available: string[];
    };
    /** Cli */
    Cli: {
      gatherer: string;
      harnesses: {
        [key: string]: {
          [key: string]: unknown;
        };
      };
    };
    /**
     * Command
     * @description A call of a turn, as its commands list it (files.py's `commands`): with the files it touched, and what it did to
     *     each (git's, as it ran, apart); a skill the user loaded with its /name, a call of its own (`loaded`).
     */
    Command: {
      text: string;
      call: unknown;
      running: boolean;
      error: boolean;
      output: string;
      exit?: number | string | null;
      took?: string | null;
      files: string[];
      loaded?: boolean;
      did?: {
        [key: string]: string[];
      };
      git?: {
        [key: string]: string[];
      };
      changed?: [number, number] | null;
    };
    /**
     * Context
     * @description The context a call sent (/api/context), in order; what the harness sent besides its messages (`preamble`).
     */
    Context: {
      read_id: number;
      cut: unknown;
      at: number | null;
      basis: number | string | null;
      real_tokens: number | null;
      tokens: number;
      preamble: components["schemas"]["Item"][];
      not_counted: number | null;
      items: components["schemas"]["Item"][];
    };
    /**
     * Current
     * @description The latest turn's state (chat_view.py's `_state`): a turn opening, at work, asking the user, done, stopped short
     *     (`stopped`: how), or no turn yet; the turn it is ("opening": the opening); what it does, and its calls failing.
     */
    Current: {
      /** @enum {string} */
      state: "opening" | "working" | "asking" | "done" | "stopped" | "idle";
      turn: number | "opening" | null;
      doing: components["schemas"]["Doing"] | null;
      failing: components["schemas"]["Failing"] | null;
      asking: components["schemas"]["Ask"] | null;
      stopped: components["schemas"]["Stopped"] | null;
    };
    /**
     * DescribedApp
     * @description An app as its manifest describes it (app_catalog.py's `described`): its words, what agents get of it, what it may
     *     do, where it came from.
     */
    DescribedApp: {
      name: string;
      label: string;
      description: string;
      origin: string;
      kind: string;
      source: string;
      version: string;
      mark: boolean;
      commit: string;
      installed_at: unknown;
      access: string;
      with_agent: boolean;
      opens_with_agent: boolean;
      instances: string;
      /** @enum {string} */
      on_task: "join" | "folder" | "no";
      /** @enum {string} */
      on_task_own: "join" | "folder" | "no";
      on_task_can: ("join" | "folder" | "no")[];
      tools: string[];
      tokens: number;
      can: string[];
      own_process: boolean;
      panel: boolean;
      schedules: string[];
      /** @description its windows open: {gatherer: how many} */
      open?: {
        [key: string]: number;
      };
      data?: components["schemas"]["AppData"];
      failed?: string | null;
      needs?: string;
    };
    /**
     * Doing
     * @description What the agent does now: a call, or thinking.
     */
    Doing: {
      kind: string;
      id?: string | null;
      text?: string;
    };
    /**
     * Event
     * @description One event as the transcript shows it (/api/event).
     */
    Event: {
      row_id: number;
      type: string | null;
      parts: components["schemas"]["Part"][];
    };
    /**
     * Extract
     * @description What the Gatherer's model made of a gatherer's history (history.py's records): a summary, memories, a skill.
     */
    Extract: {
      id: string;
      gatherer: string;
      kind: string;
      status: string;
      output: string;
      error: string | null;
      model: string | null;
      created: number;
      finished: number | null;
      /** @description the rows it was made of, as runs: [first, last] */
      rows: [number, number][];
      channels: string[];
      ask: string | null;
      messages: number;
      turns: number;
      dirs: string[];
      memories?: components["schemas"]["Memory"][];
      saved?: components["schemas"]["Saving"][];
    };
    /**
     * Failed
     * @description A route's answer when it has none to give: its gatherer has no database yet, nothing is stored, or the read
     *     failed (the stream's `agent` and `chat`).
     */
    Failed: {
      error: string;
    };
    /**
     * Failing
     * @description Its model calls failing, retried (data.py's `failing`): since when, how often, the latest's error.
     */
    Failing: {
      at: number;
      first: number;
      attempts: number;
      status: number | null;
      error: string | null;
      retrying: boolean;
    };
    /**
     * Files
     * @description An actor's turns, and the one shown (`turn`, its index; the latest, unless one is picked) with its files and
     *     commands (/api/files).
     */
    Files: {
      turns: components["schemas"]["Turn"][];
      turn: number | null;
      files: components["schemas"]["TurnFile"][];
      commands: components["schemas"]["Command"][];
      home: string;
    };
    /**
     * Folder
     * @description A folder of a gatherer's (folders.py), or of the gatherers' (gatherer_folders.py).
     */
    Folder: {
      id: number;
      parent: number | null;
      name: string;
      /** @description closed (folders.py's `close`): when, as an ISO time */
      closed?: string | null;
    };
    /**
     * Folders
     * @description A tree of folders: the folders, and where each item is filed (an actor by its channel, an app by its item, a
     *     gatherer by its name).
     */
    Folders: {
      folders: components["schemas"]["Folder"][];
      filed: {
        [key: string]: number;
      };
    };
    /**
     * Found
     * @description The apps the server found added, gone or changed as it read their folders again.
     */
    Found: {
      added: string[];
      gone: string[];
      changed: string[];
    };
    /**
     * Gatherer
     * @description A gatherer, or group, and its actors, newest created first.
     */
    Gatherer: {
      name: string;
      policy: string | null;
      agents: components["schemas"]["Actor"][];
      last: number | null;
      /** @description when it was made: its first event, else its config's time */
      created: number | null;
      /** @description its apps' open notifications, by instance */
      apps?: {
        [key: string]: components["schemas"]["AppNotices"];
      };
      /** @description an actor on its own: a group of one (groups.py's `alone`) */
      alone?: boolean;
      /** @description when what it holds last changed */
      changed?: number;
      /** @description its database could not be read */
      error?: string;
    };
    /**
     * Handles
     * @description An intent an app handles, for these types.
     */
    Handles: {
      intent: string;
      types: string[];
    };
    /**
     * HarnessInfo
     * @description What the page shows of a harness (data.py's `harness_info`, from harness_kit).
     */
    HarnessInfo: {
      label: string;
      /** @description its mark, an SVG */
      mark: string | null;
      /** @description the dashboard runs it: it can start and resume its sessions */
      runs: boolean;
      fullscreen: boolean;
      stopped: components["schemas"]["StoppedSays"];
      ask_says: components["schemas"]["AskSays"];
      /** @description whether its terminal, opened again, asks again what it asked before */
      asks_shown_again: boolean;
      reply_block: components["schemas"]["ReplyBlock"] | null;
      mcp: boolean;
      /** @description where it keeps its memory of a directory (a pattern its folders end with) */
      memory_folder: string | null;
      saves: {
        [key: string]: {
          [key: string]: unknown;
        };
      };
    };
    /**
     * History
     * @description An actor's own events from a row (/api/history); `more` counts the rest.
     */
    History: {
      first_row: number;
      last_row: number | null;
      items: components["schemas"]["HistoryItem"][];
      more: number;
    };
    /**
     * HistoryItem
     * @description An event of an actor's history (data.py's `history`): its type (`name`), size, time and text (`clipped`: how
     *     much more there is); to its newest, its pending events after them, as a context lists them (`Item`).
     */
    HistoryItem: {
      row_id: number | null;
      name: string;
      tokens: number;
      at: number | null;
      clipped: number;
      text: string;
      position?: number | null;
      group?: string;
      made_id?: number | null;
    };
    /** Hit */
    Hit: {
      row_id: number;
      snippet: string;
    };
    /**
     * Holder
     * @description The process that has its session open (ag's launcher, its calls).
     */
    Holder: {
      pid: number;
      by: string | null;
      /** @description the dashboard's own terminal, or a process under it */
      dashboard?: boolean;
    };
    /**
     * Home
     * @description The home (/api/home, and the stream's `home`): every gatherer and its actors, what the reader keeps of them, what
     *     each harness is; and what a new session starts from here (`Server.read_home`). A snapshot's home (`ag dashboard
     *     --out`: data.snapshot) is data.home()'s alone: none of read_home's fields (`app_groups` on).
     */
    Home: {
      home: string;
      /** @description the home's one database (ag home merge) */
      merged: boolean;
      now: number;
      running_seconds: number;
      gatherers: components["schemas"]["Gatherer"][];
      hook_servers: components["schemas"]["HookServer"][];
      /** @description {gatherer: "hidden" | "shown"} */
      hiding: {
        [key: string]: string;
      };
      /** @description the reader's names for gatherers */
      titles: {
        [key: string]: string;
      };
      /** @description {gatherer: {channel: when saved}} */
      saved: {
        [key: string]: {
          [key: string]: string;
        };
      };
      folders: {
        [key: string]: components["schemas"]["Folders"];
      };
      gatherer_folders: components["schemas"]["Folders"];
      places: {
        [key: string]: components["schemas"]["Place"];
      };
      tasks: {
        [key: string]: components["schemas"]["Tasks"];
      };
      /** @description {gatherer: {channel: last}}; None, never kept */
      seen: {
        [key: string]: {
          [key: string]: number;
        };
      } | null;
      harness_info: {
        [key: string]: components["schemas"]["HarnessInfo"];
      };
      /** @description the harness taken for an actor recorded before ag recorded its harness */
      harness_default: string;
      /** @description the group each open app is in, by its instance's id */
      app_groups: {
        [key: string]: string;
      };
      cwd: string;
      permission_modes: string[];
      terminals: boolean;
      /** @description the harnesses a new session can run on here */
      harnesses: string[];
      shells: components["schemas"]["Shell"][];
      home_dir: string;
      branches: components["schemas"]["Branch"][];
      app_requests: components["schemas"]["AppRequest"][];
    };
    /**
     * HookServer
     * @description A hook server ag started that still runs (home.py's `hook_servers`).
     */
    HookServer: {
      port: number | null;
      pid: number | null;
      upstream: string | null;
    };
    /**
     * IndexApp
     * @description An app of the index, to install from git.
     */
    IndexApp: {
      name: string;
      label: string;
      description: string;
      origin: string;
      kind: string;
      source: string;
      version?: string;
      mark?: boolean;
      commit?: string;
      installed_at?: unknown;
      /** @description who may use its instances: "task" (the agents in its task) or "group" (every agent of the group) */
      access?: string;
      /** @description it can be opened with an agent of its own (its manifest's [agent] offered) */
      with_agent?: boolean;
      /** @description opened, it starts with an agent of its own: the reader's choice (app_settings.py) */
      opens_with_agent?: boolean;
      instances?: string;
      /**
       * @description what "+" on an actor or a task does with it, as chosen; its manifest's own; and those it can take
       * @enum {string}
       */
      on_task?: "join" | "folder" | "no";
      /** @enum {string} */
      on_task_own?: "join" | "folder" | "no";
      on_task_can?: ("join" | "folder" | "no")[];
      tools?: string[];
      /** @description what its tools' descriptions cost an agent */
      tokens?: number;
      can?: string[];
      own_process?: boolean;
      panel?: boolean;
      schedules?: string[];
      /** @description its windows open: {gatherer: how many} */
      open?: {
        [key: string]: number;
      };
      data?: components["schemas"]["AppData"];
      failed?: string | null;
      needs: string;
    };
    /**
     * InstalledApp
     * @description An app installed: with its windows open, its data, and why its backend failed (None: it didn't).
     */
    InstalledApp: {
      name: string;
      label: string;
      description: string;
      origin: string;
      kind: string;
      source: string;
      version: string;
      mark: boolean;
      commit: string;
      installed_at: unknown;
      access: string;
      with_agent: boolean;
      opens_with_agent: boolean;
      instances: string;
      /** @enum {string} */
      on_task: "join" | "folder" | "no";
      /** @enum {string} */
      on_task_own: "join" | "folder" | "no";
      on_task_can: ("join" | "folder" | "no")[];
      tools: string[];
      tokens: number;
      can: string[];
      own_process: boolean;
      panel: boolean;
      schedules: string[];
      open: {
        [key: string]: number;
      };
      data: components["schemas"]["AppData"];
      failed: string | null;
      needs?: string;
    };
    /**
     * Instance
     * @description An app's open instance (app_kit's `Instance`): `name`, the user's ("": not named), shown over its `title`.
     */
    Instance: {
      id: string;
      app: string;
      gatherer: string;
      folder: string | null;
      title: string;
      data: {
        [key: string]: unknown;
      };
      name: string;
    };
    /**
     * Item
     * @description An item of a context (data.py's `context` items), or one the next call will carry (`_pending`, `_after_read`):
     *     an event, ag's made item, a preamble's part -- its group, its size and text (`clipped`: how much more there is).
     */
    Item: {
      position: number | null;
      group: string;
      name: string;
      tokens: number;
      row_id: number | null;
      made_id: number | null;
      at: number | null;
      clipped: number;
      text: string;
    };
    /**
     * LinkForm
     * @description The paths of `ag://<app>/...` links an app's panel opens (app_kit/links.py); `paths`, a file's path an agent
     *     writes with no app named opens in it.
     */
    LinkForm: {
      form: string;
      about: string;
      paths?: boolean;
    };
    /**
     * Llm
     * @description ag's own model calls for the actor, by what they were for.
     */
    Llm: {
      by_purpose: components["schemas"]["LlmRow"][];
      total: components["schemas"]["LlmTotal"];
      calls: components["schemas"]["LlmCall"][];
    };
    /** LlmCall */
    LlmCall: {
      purpose: string | null;
      started: number | null;
      seconds: number | null;
      tokens_in: number;
      tokens_out: number;
    };
    /**
     * LlmRow
     * @description ag's own model calls for the actor, for one purpose.
     */
    LlmRow: {
      purpose: string;
      calls: number;
      tokens_in: number;
      tokens_out: number;
      seconds: number;
      errors: number;
      cost: number;
      unpriced: number;
      models: string[];
    };
    /** LlmSetting */
    LlmSetting: {
      model: string;
      api_base: string;
      key_env: string;
    };
    /** LlmTotal */
    LlmTotal: {
      calls: number;
      tokens_in: number;
      tokens_out: number;
      errors: number;
      cost: number;
      unpriced: number;
    };
    /** Memory */
    Memory: {
      name: string;
      title: string;
      type: string;
      description: string;
      body: string;
    };
    /**
     * Monitor
     * @description The monitor's actors (/api/monitor).
     */
    Monitor: {
      actors: components["schemas"]["MonitorActor"][];
    };
    /**
     * MonitorActor
     * @description An actor's latest turn, as the monitor shows it (monitor.py's `actor`): {turns: 0} before its first message;
     *     {error} where it could not be read.
     */
    MonitorActor: {
      gatherer: string;
      channel: string;
      turns?: number;
      at?: number | null;
      asked?: string | null;
      more?: number;
      said?: string | null;
      now?: components["schemas"]["Doing"] | null;
      work?: unknown;
      steps?: components["schemas"]["MonitorStep"][];
      calls?: number;
      files?: {
        [key: string]: number;
      };
      error?: string;
    };
    /** MonitorStep */
    MonitorStep: {
      text: string;
      running: boolean;
      error: boolean;
    };
    /**
     * Name
     * @description An actor's name (data.py's `_names`): the reader's (`by` "user"), else its harness's own, or the dashboard's.
     */
    Name: {
      text: string;
      by: string | null;
    };
    /**
     * Notice
     * @description A notification an app sent, not settled since (app_kit's notices.py).
     */
    Notice: {
      id: string | null;
      key: string | null;
      title: string | null;
      text: string | null;
      show: unknown;
      where: unknown;
      at: number | null;
    };
    /**
     * Opening
     * @description A turn sent and not stored yet (chat_view.py's `opening`): its message, the send it is, when it was sent, whether
     *     the session has it (`seen`), not had for long (`unseen`), and stopped before its harness recorded anything.
     */
    Opening: {
      text: string;
      cid: string | null;
      began: number;
      seen: boolean;
      unseen: boolean;
      stopped?: components["schemas"]["Stopped"] | null;
    };
    /**
     * Outline
     * @description A gatherer's events after a row (/api/outline), the tasks ag made of them, each channel's latest build.
     */
    Outline: {
      events: components["schemas"]["OutlineEvent"][];
      tasks: components["schemas"]["OutlineTask"][];
      builds: {
        [key: string]: components["schemas"]["BuildState"];
      };
      more: boolean;
    };
    /**
     * OutlineEvent
     * @description An event of the outline (history.py's `outline`): light, its text cut short.
     */
    OutlineEvent: {
      row_id: number;
      channel: string;
      type: string;
      tokens: number;
      at: number | null;
      text: string;
    };
    /**
     * OutlineTask
     * @description A task ag found (its build's), from its first row.
     */
    OutlineTask: {
      channel: string;
      index: number;
      name: string;
      description: string | null;
      first_row: number;
      last_row: number;
      tokens: number | null;
    };
    /**
     * Part
     * @description A part of an event, as the transcript shows it, whatever harness wrote it (data.py's `parts`), by `kind`: "text"
     *     (`role`: user, assistant, system), "thinking" ("" when encrypted), "call" (`id`, `name`, `input`; what it does and
     *     how it is shown, as its harness's rules read it: `action`, `view`; a script's `calls`), "result" (its call's `id`,
     *     `error`, `text`; its harness's lines about the run taken off, `shown`, and what they said: `exit`, `took`), "note"
     *     (`name`, `text`; what its harness's rules read of it: `said`).
     */
    Part: {
      kind: string;
      role?: string;
      text?: string;
      id?: string | null;
      name?: string | null;
      input?: unknown;
      action?: unknown;
      view?: {
        [key: string]: unknown;
      };
      calls?: components["schemas"]["ToolCall"][];
      error?: boolean;
      shown?: unknown;
      exit?: unknown;
      took?: unknown;
      said?: unknown;
    };
    /**
     * Place
     * @description Where a group is placed in another group (folders.py's `places`): that group, and its folder there (None: its
     *     top).
     */
    Place: {
      in: string;
      folder: number | null;
    };
    /** PlanChange */
    PlanChange: {
      label: string;
      title: string | null;
    };
    /** PlanChoice */
    PlanChoice: {
      id: string;
      label: string;
      title: string | null;
      primary: boolean;
    };
    /** PollerChoices */
    PollerChoices: {
      default: string[];
      available: string[];
    };
    /**
     * Read
     * @description A model call ag answered (a read) and its sizes.
     */
    Read: {
      read_id: number;
      at: number | null;
      row_id: number | null;
      basis: number | string | null;
      recorded_tokens: number | null;
      est_tokens: number | null;
      real_tokens: number | null;
      limit_tokens: number | null;
      sent_tokens: number | null;
      preamble_tokens: number | null;
      /** @description the tasks begun by then */
      tasks: number;
      rebuild: boolean;
    };
    /**
     * Recap
     * @description What its harness said it did while the user was away (its recap), cut to a line.
     */
    Recap: {
      text: string;
      at: number | null;
    };
    /**
     * Reply
     * @description A message of the agent's in a turn (files.py's `replies`): what it said, a run of its thinking, or a note of its
     *     harness's (a subagent's report handed back, another session's message).
     */
    Reply: {
      kind: string;
      text?: string;
      /** @description thinking's runs; none readable when encrypted */
      texts?: string[];
      /** @description a report's task, or the session a message came from */
      name?: string | null;
      /** @description how many of the turn's calls came before it */
      after: number;
    };
    /**
     * ReplyBlock
     * @description A block its model writes in a reply that its terminal draws apart (a proposed plan, say).
     */
    ReplyBlock: {
      open: string;
      close: string;
      title: string;
    };
    /** Saving */
    Saving: {
      at: number;
      where: unknown;
      paths: string[];
    };
    /**
     * Search
     * @description What a search of a history found (/api/search): each matching row's snippet, and whether there were more.
     */
    Search: {
      hits: components["schemas"]["Hit"][];
      more: boolean;
    };
    /**
     * Sent
     * @description A message sent from Chat (sessions.py's `send`): its id, words and time.
     */
    Sent: {
      cid: string | null;
      text: string;
      at: number;
    };
    /**
     * SentMessage
     * @description A message the actor sent another (files.py's `sent`: `ag actors send`, or a new actor started with it).
     */
    SentMessage: {
      text: string;
      kind: string | null;
      to: string | null;
      to_name: string | null;
      at: number | null;
    };
    /**
     * Session
     * @description A session the dashboard started or keeps (sessions.py's table, with `list`'s state of it now).
     */
    Session: {
      session_id: string;
      gatherer: string;
      harness: string;
      cwd: string;
      permission_mode: string;
      created_at: string;
      turns: number;
      status: string;
      last_error: string | null;
      kept: number;
      model: string | null;
      started_as: string | null;
      ended: number;
      role: unknown;
      over: string | null;
      harness_id: string | null;
      /** @description its messages waiting in the dashboard's queue */
      queued: string[];
      /** @description the dashboard runs it in a terminal */
      terminal: boolean;
      answer: {
        [key: string]: unknown;
      } | null;
      /** @description when anything was last typed into its terminal */
      typed: number | null;
      /** @description when the key that stopped its turn was typed there */
      stopped_at: number | null;
      shown: {
        [key: string]: unknown;
      } | null;
      fullscreen: boolean;
      pid: number | null;
      /** @description when the dashboard's process of it started */
      since: number | null;
      sent: components["schemas"]["Sent"][];
    };
    /**
     * Settings
     * @description ag's settings (/api/settings: settings.py's `read`), its config.toml as the panel shows it; `error`, why it
     *     doesn't parse ("": it does). After setting the model, what it runs on, in words (`said`).
     */
    Settings: {
      path: string;
      exists: boolean;
      text: string;
      version: string;
      error: string;
      env: {
        [key: string]: string;
      };
      llm: components["schemas"]["LlmSetting"];
      policies: components["schemas"]["Choices"];
      pollers: components["schemas"]["PollerChoices"];
      cli: components["schemas"]["Cli"];
      said?: string;
    };
    /**
     * Shell
     * @description A shell open (sessions.py's `shell`), listed under its gatherer.
     */
    Shell: {
      id: string;
      gatherer: string;
      cwd: string;
      since: number;
      folder: number | null;
    };
    /**
     * Source
     * @description A call that touched a file (files.py's sources): what it did to it, by kind; how (`via`); the lines its changes
     *     added and removed. What git did as it ran is one apart (`git`). Where ag's hook server checked it on disk,
     *     `checked` (None: nothing to match), and `unnamed`, the file changed as it ran but the call doesn't name it.
     */
    Source: {
      via: string;
      kind: string;
      kinds: string[];
      error: boolean;
      call: unknown;
      blocks: components["schemas"]["Block"][];
      at: number | null;
      changed: [number, number] | null;
      git?: boolean;
      checked?: boolean | null;
      unnamed?: boolean;
    };
    /**
     * Staged
     * @description An app copied aside and checked (/api/apps/stage), to be installed or discarded: and the one installed of its
     *     name, with what installing it would change.
     */
    Staged: {
      name: string;
      label: string;
      description: string;
      origin: string;
      kind: string;
      source: string;
      version: string;
      mark: boolean;
      commit: string;
      installed_at: unknown;
      access: string;
      with_agent: boolean;
      opens_with_agent: boolean;
      instances: string;
      /** @enum {string} */
      on_task: "join" | "folder" | "no";
      /** @enum {string} */
      on_task_own: "join" | "folder" | "no";
      on_task_can: ("join" | "folder" | "no")[];
      tools: string[];
      tokens: number;
      can: string[];
      own_process: boolean;
      panel: boolean;
      schedules: string[];
      /** @description its windows open: {gatherer: how many} */
      open?: {
        [key: string]: number;
      };
      data?: components["schemas"]["AppData"];
      failed?: string | null;
      needs?: string;
      id: string;
      installed?: components["schemas"]["DescribedApp"];
      changes?: components["schemas"]["Changes"];
    };
    /**
     * Stopped
     * @description How a turn stopped short (data.py's `stopped`, files.py's): interrupted (Esc), on an error it gave up on, its
     *     process closed under it, or another reason its harness gives.
     */
    Stopped: {
      kind: string;
      at?: number | null;
      text?: string | null;
      status?: number | string | null;
      reason?: string | null;
    };
    /**
     * StoppedSays
     * @description A harness's words for a turn stopped short (harness_kit's `stopped_says`): the mark before them, an
     *     interruption, an error (with its HTTP status, `{status}`, when known), and other reasons, by their names.
     */
    StoppedSays: {
      lead: string;
      interrupted: string;
      error: string;
      error_status?: string;
      reasons?: {
        [key: string]: string;
      };
    };
    /**
     * Stream
     * @description The page's stream (/api/stream: server-sent events), each event's data by its name: `home`; with an actor, its
     *     `chat` and `agent`; the page's other actors, each an `actor`.
     */
    Stream: {
      home?: components["schemas"]["Home"];
      chat?: components["schemas"]["ChatView"] | components["schemas"]["Failed"];
      agent?: components["schemas"]["Agent"] | components["schemas"]["Failed"];
      actor?: components["schemas"]["StreamActor"];
    };
    /**
     * StreamActor
     * @description Another actor the page shows (the stream's `actor`): its agent and Chat's view of it.
     */
    StreamActor: {
      gatherer: string;
      channel: string;
      agent: components["schemas"]["Agent"] | components["schemas"]["Failed"];
      chat: components["schemas"]["ChatView"] | components["schemas"]["Failed"];
    };
    /**
     * TakenBack
     * @description The message its harness put back in its box, stopped (Esc) before any of its answer came (data.py's
     *     `taken_back`): its words, when, and when ag read the call before.
     */
    TakenBack: {
      text: string;
      at: number;
      since: number | null;
      /** @description the send it was, from Chat (Chat's view's) */
      cid?: string | null;
    };
    /** Task */
    Task: {
      id: number;
      name: string | null;
    };
    /**
     * Tasks
     * @description A gatherer's tasks (tasks.py), oldest first, and the task each item is in.
     */
    Tasks: {
      tasks: components["schemas"]["Task"][];
      tasked: {
        [key: string]: number;
      };
    };
    /**
     * ToolCall
     * @description A call a script makes (codex's code mode), as its harness's rules read it.
     */
    ToolCall: {
      name: string | null;
      input: unknown;
      action: unknown;
      view: {
        [key: string]: unknown;
      };
    };
    /**
     * ToolListed
     * @description A tool an app gives agents, and what handles its calls (its backend, or its panel).
     */
    ToolListed: {
      name: string;
      description: string;
      input_schema: {
        [key: string]: unknown;
      };
      handled_by: string;
    };
    /**
     * Transcript
     * @description An actor's transcript (/api/transcript): its events, oldest first; whether it has earlier ones, and whether these
     *     reach its newest.
     */
    Transcript: {
      items: components["schemas"]["TranscriptItem"][];
      earlier: boolean;
      newest: boolean;
    };
    /**
     * TranscriptItem
     * @description An event of the transcript: stored (its row), or pending (none).
     */
    TranscriptItem: {
      row_id: number | null;
      type: string;
      at: number | null;
      parts: components["schemas"]["Part"][];
    };
    /**
     * Turn
     * @description A turn (files.py's): the user's message, what the agent said and did, how it ended.
     */
    Turn: {
      n: number;
      row_id: number | null;
      at: number | null;
      /** @description its last event's time */
      end: number | null;
      text: string;
      replies: components["schemas"]["Reply"][];
      now: components["schemas"]["Doing"] | null;
      more: components["schemas"]["UserMessage"][];
      /** @description its latest call, while nothing readable followed it */
      last: components["schemas"]["CallRun"] | null;
      stopped: components["schemas"]["Stopped"] | null;
      /** @description its calls, as many as its commands list */
      calls: number;
      /** @description what the user's message is, as its harness's wrapper says (harness_kit's `words`) */
      kind: string;
      /** @description what the avatar acts out (work.py's summary) */
      work: unknown;
      sent?: components["schemas"]["SentMessage"][];
      /** @description a `!` command's output */
      output?: string | null;
      /** @description Chat's view's: the send it is (sent from Chat), and when its message was sent */
      cid?: string | null;
      began?: number | null;
    };
    /**
     * TurnFile
     * @description A file a turn touched (files.py's `files`): what each call did to it, by kind; the lines added and removed.
     */
    TurnFile: {
      path: string;
      kinds: string[];
      created: boolean;
      changed: [number, number] | null;
      /** @description what git changed of it as the turn's commands ran: its kinds */
      git: string[];
      sources: components["schemas"]["Source"][];
      temporary: boolean;
    };
    /**
     * Typed
     * @description What the user wrote to the session as it worked, or sent between turns (data.py's `typed`).
     */
    Typed: {
      text: string;
      at: number | null;
      sent: number | null;
      joins: boolean;
      chat?: boolean;
    };
    /**
     * UninstalledApp
     * @description An app that comes with ag, uninstalled: its data, kept or not.
     */
    UninstalledApp: {
      name: string;
      label: string;
      description: string;
      origin: string;
      kind: string;
      source: string;
      version: string;
      mark: boolean;
      commit: string;
      installed_at: unknown;
      access: string;
      with_agent: boolean;
      opens_with_agent: boolean;
      instances: string;
      /** @enum {string} */
      on_task: "join" | "folder" | "no";
      /** @enum {string} */
      on_task_own: "join" | "folder" | "no";
      on_task_can: ("join" | "folder" | "no")[];
      tools: string[];
      tokens: number;
      can: string[];
      own_process: boolean;
      panel: boolean;
      schedules: string[];
      /** @description its windows open: {gatherer: how many} */
      open?: {
        [key: string]: number;
      };
      data: components["schemas"]["AppData"];
      failed?: string | null;
      needs: string;
    };
    /**
     * Updates
     * @description The apps installed from git that have a newer commit (/api/apps/updates): {name: commit}.
     */
    Updates: {
      updates: {
        [key: string]: string;
      };
    };
    /**
     * Usage
     * @description Every item every call of the actor sent, added up by kind (data.py's `_usage`).
     */
    Usage: {
      tokens: number;
      entries: components["schemas"]["UsageEntry"][];
      not_counted: number;
      calls: number;
      real_tokens: number;
      real_calls: number;
    };
    /**
     * UsageEntry
     * @description One kind of what all calls sent, added up.
     */
    UsageEntry: {
      group: string;
      name: string;
      items: number;
      tokens: number;
    };
    /**
     * UserMessage
     * @description A message of the user's written while a turn ran (`more`), with its send's id, sent from Chat (Chat's view's).
     */
    UserMessage: {
      text: string;
      row_id: number | null;
      at: number | null;
      kind: string;
      cid?: string | null;
    };
    /**
     * Waits
     * @description What waits for the agent's next step (chat_view.py's `waiting`): held by its harness for its turn's end
     *     ("queued"), sent from Chat while it worked ("chat"), or in the dashboard's own queue for it ("dashboard").
     */
    Waits: {
      text: string;
      cid: string | null;
      /** @enum {string} */
      how: "queued" | "chat" | "dashboard";
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  manifest_manifest_webmanifest_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  app_icon_icons__name__get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        name: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  the_page__get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  the_page_index_html_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  assets_assets__name__get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        name: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  pdfjs_vendor_pdfjs__rel__get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        rel: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  vendored_vendor__name__get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        name: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  avatar_avatars__name__svg_get: {
    parameters: {
      query?: {
        bare?: string;
      };
      header?: never;
      path: {
        name: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  views_api_views_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  view_views__name__get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        name: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  the_home_api_home_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Home"];
        };
      };
    };
  };
  new_gatherer_api_gatherers_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  hide_api_hiding_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  title_api_title_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  save_api_saved_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  folder_api_folders_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  group_api_groups_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  manage_groups_api_groups_manage_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  task_api_tasks_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  gatherer_folder_api_gatherer_folders_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  name_api_name_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  look_api_seen_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  stream_api_stream_get: {
    parameters: {
      query?: {
        gatherer?: string | null;
        channel?: string | null;
        also?: string | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": components["schemas"]["Stream"];
        };
      };
    };
  };
  agent_api_agent_get: {
    parameters: {
      query: {
        gatherer: string;
        channel: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Agent"] | components["schemas"]["Failed"];
        };
      };
    };
  };
  read_api_read_get: {
    parameters: {
      query: {
        gatherer: string;
        read_id: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  context_api_context_get: {
    parameters: {
      query: {
        gatherer: string;
        read_id: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Context"] | components["schemas"]["Failed"];
        };
      };
    };
  };
  history_api_history_get: {
    parameters: {
      query: {
        gatherer: string;
        channel: string;
        from: number;
        to?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["History"] | components["schemas"]["Failed"];
        };
      };
    };
  };
  transcript_api_transcript_get: {
    parameters: {
      query: {
        gatherer: string;
        channel: string;
        after?: number | null;
        before?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Transcript"] | components["schemas"]["Failed"];
        };
      };
    };
  };
  files_api_files_get: {
    parameters: {
      query: {
        gatherer: string;
        channel: string;
        turn?: number | null;
        cwd?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Files"] | components["schemas"]["Failed"];
        };
      };
    };
  };
  changes_api_files_changes_get: {
    parameters: {
      query: {
        gatherer: string;
        channel: string;
        path: string;
        since: number;
        cwd?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  image_api_image_get: {
    parameters: {
      query: {
        gatherer: string;
        row_id: number;
        id: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  outline_api_outline_get: {
    parameters: {
      query: {
        gatherer: string;
        channel?: string | null;
        after?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Outline"] | components["schemas"]["Failed"];
        };
      };
    };
  };
  event_api_event_get: {
    parameters: {
      query: {
        gatherer: string;
        row_id: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Event"] | components["schemas"]["Failed"];
        };
      };
    };
  };
  search_api_search_get: {
    parameters: {
      query: {
        gatherer: string;
        channel?: string | null;
        q?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Search"] | components["schemas"]["Failed"];
        };
      };
    };
  };
  extracts_api_extracts_get: {
    parameters: {
      query: {
        gatherer: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Extract"][];
        };
      };
    };
  };
  export_api_history_export_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  extract_api_history_extract_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Extract"];
        };
      };
    };
  };
  delete_api_history_delete_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  build_api_history_build_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  save_api_history_save_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  listed_api_sessions_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  start_api_sessions_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  models_api_models_get: {
    parameters: {
      query?: {
        harness?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  send_message_api_send_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  upload_api_upload_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  stop_api_stop_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  discard_api_discard_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  answer_ask_api_answer_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  coordinator_api_coordinator_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  actors_api_actors__op__post: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        op: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  terminal_api_terminal_get: {
    parameters: {
      query?: {
        session_id?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  open_terminal_api_terminal_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  typed_api_terminal_input_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  resize_api_terminal_resize_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  shell_api_shells_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  close_shell_api_shells_close_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  projects_api_projects_get: {
    parameters: {
      query: {
        gatherer: string;
        dirs?: string | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  set_project_api_projects_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  under_api_branches_get: {
    parameters: {
      query?: {
        root?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  new_branch_api_branches_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  approve_api_branches_approve_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  decide_api_branches_decide_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  the_monitor_api_monitor_get: {
    parameters: {
      query?: {
        actors?: string | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Monitor"];
        };
      };
    };
  };
  read_api_settings_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Settings"];
        };
      };
    };
  };
  model_api_settings_model_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Settings"];
        };
      };
    };
  };
  defaults_api_settings_defaults_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Settings"];
        };
      };
    };
  };
  config_file_api_settings_file_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Settings"];
        };
      };
    };
  };
  apps_listed_api_apps_get: {
    parameters: {
      query?: {
        gatherer?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Apps"];
        };
      };
    };
  };
  apps_open_api_apps_open_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Instance"];
        };
      };
    };
  };
  apps_close_api_apps_close_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_rename_api_apps_rename_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_sleep_api_apps_sleep_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_attach_api_apps_attach_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_detach_api_apps_detach_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_events_api_apps_events_get: {
    parameters: {
      query?: {
        app?: string;
        gatherer?: string;
        instance?: string;
        types?: string;
        after?: number;
        channel?: string;
        limit?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_insert_api_apps_insert_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_notify_api_apps_notify_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_notice_settle_api_apps_notices_settle_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_call_api_apps_call_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_answer_api_apps_answer_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_mcp_mcp__actor__post: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        actor: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_agent_api_apps_agent_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_mark_apps_mark__name__svg_get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        name: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_start_api_apps_start_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_guard_api_apps_guard_post: {
    parameters: {
      query: {
        gatherer: string;
        channel: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_agent_call_api_apps_agent_call_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_stream_api_apps_stream_get: {
    parameters: {
      query?: {
        app?: string;
        gatherer?: string;
        instance?: string;
        types?: string;
        after?: number;
        messages?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  host_op_apps_host__name___op__post: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        name: string;
        op: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_catalog_api_apps_catalog_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Catalog"];
        };
      };
    };
  };
  apps_updates_api_apps_updates_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Updates"];
        };
      };
    };
  };
  apps_stage_api_apps_stage_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Staged"];
        };
      };
    };
  };
  apps_install_api_apps_install_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_discard_api_apps_discard_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_uninstall_api_apps_uninstall_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_settings_api_apps_settings_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_requests_api_apps_requests_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_request_api_apps_requests__rid__get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        rid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
  apps_request_settle_api_apps_requests__rid__post: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        rid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
    };
  };
}
