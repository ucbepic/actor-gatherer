// What the dashboard's routes answer, by the names the page gives it: the types generated from the server's schema
// (./types.gen.ts, from ag_dashboard/models.py: `pnpm gen:types`), so a change of the server's that breaks what the page
// reads fails `tsc` where it is read (ag_dashboard/DESIGN.md, B2). Each type's fields, and what each is, are the
// model's: a field always there is required, one sometimes left out optional, one perhaps null `| null`.
import type { components } from "./types.gen";

type Schemas = components["schemas"];

/** A route's answer when it has none to give: its gatherer has no database yet, nothing is stored, or a read failed. */
export type Failed = Schemas["Failed"];

/** Whether an answer is {error}, not what was asked for. */
export const failed = <T extends object>(got: T | Failed): got is Failed => "error" in got;

// ---- the home: /api/home, and the stream's `home`

/** /api/home, and the stream's `home`: every gatherer and its actors, what the reader keeps of them, what each harness
 * is, and what a new session starts from here. */
export type Home = Schemas["Home"];
/** A gatherer, or group, and its actors. */
export type Gatherer = Schemas["Gatherer"];
/** An actor, as the home has it (data.py's), with its session if the dashboard has one, and its avatar. */
export type Actor = Schemas["Actor"];
/** A session the dashboard started or keeps (sessions.py's). */
export type Session = Schemas["Session"];
/** What an actor waits on the user for (data.py's `asking`). */
export type Ask = Schemas["Ask"];
export type AskQuestion = Schemas["AskQuestion"];
export type AskOption = Schemas["AskOption"];
/** The last answer sent from the page to what an actor asked (data.py's `answer`). */
export type Answered = Schemas["Answered"];
/** An actor's model calls failing, retried (data.py's `failing`). */
export type Failing = Schemas["Failing"];
/** How a turn stopped short (data.py's `stopped`, files.py's). */
export type Stopped = Schemas["Stopped"];
/** The message a harness put back in its box, stopped before any of its answer came. */
export type TakenBack = Schemas["TakenBack"];
/** An app instance's open notifications (data.py's `app_notices`). */
export type AppNotices = Schemas["AppNotices"];
/** A folder of a gatherer's, or of the gatherers'. */
export type Folder = Schemas["Folder"];
/** A tree of folders: the folders, and where each item is filed. */
export type Folders = Schemas["Folders"];
/** A gatherer's tasks, and the task each item is in. */
export type Tasks = Schemas["Tasks"];
export type Task = Schemas["Task"];
/** A shell open, listed under its gatherer. */
export type Shell = Schemas["Shell"];
/** What the dashboard knows of a harness (data.py's `harness_info`, from harness_kit). */
export type HarnessInfo = Schemas["HarnessInfo"];
/** A harness's words for a turn stopped short (harness_kit's `stopped_says`). */
export type StoppedSays = Schemas["StoppedSays"];
/** How a reader answers what a harness asks (harness_kit's `ask_says`). */
export type AskSays = Schemas["AskSays"];

// ---- one actor: /api/agent (the stream's `agent`), /api/context, /api/history, /api/transcript

/** One actor over time (/api/agent, the stream's `agent`): its calls and reads, what is pending, its tasks and builds. */
export type Agent = Schemas["Agent"];
/** A model call ag answered (a read) and its sizes. */
export type Read = Schemas["Read"];
/** An item of a context, of an actor's history, or pending. */
export type Item = Schemas["Item"];
export type Usage = Schemas["Usage"];
export type UsageEntry = Schemas["UsageEntry"];
export type Build = Schemas["Build"];
export type Llm = Schemas["Llm"];
export type LlmRow = Schemas["LlmRow"];
/** The context a call sent (/api/context). */
export type Context = Schemas["Context"];
/** An actor's own events from a row (/api/history), and an event of it. */
export type History = Schemas["History"];
export type HistoryItem = Schemas["HistoryItem"];
/** An actor's transcript (/api/transcript), and an event of it. */
export type Transcript = Schemas["Transcript"];
export type TranscriptItem = Schemas["TranscriptItem"];
/** A part of an event, as the transcript shows it. */
export type Part = Schemas["Part"];

// ---- a turn's files and commands (/api/files), and Chat's view (the stream's `chat`)

/** An actor's turns, and the one shown with its files and commands (/api/files). */
export type Files = Schemas["Files"];
/** A turn: the user's message, what the agent said and did, how it ended. */
export type Turn = Schemas["Turn"];
export type Reply = Schemas["Reply"];
/** What the agent does now: a call, or thinking. */
export type Doing = Schemas["Doing"];
/** What an actor's turn is doing, from its calls (work.py's summary). */
export type Work = Schemas["Work"];
/** A turn's latest call, while nothing readable followed it. */
export type CallRun = Schemas["CallRun"];
export type UserMessage = Schemas["UserMessage"];
export type SentMessage = Schemas["SentMessage"];
/** A file a turn touched, and a call of a turn as its commands list it. */
export type TurnFile = Schemas["TurnFile"];
export type Command = Schemas["Command"];
/** What Chat shows of an actor's conversation (the stream's `chat`: chat_view.py's). */
export type ChatView = Schemas["ChatView"];
export type Opening = Schemas["Opening"];
export type Current = Schemas["Current"];
export type Waits = Schemas["Waits"];
/** The monitor's actors (/api/monitor), each its latest turn. */
export type MonitorActor = Schemas["MonitorActor"];

// ---- the History view: /api/outline, /api/extracts, /api/search, /api/event

export type Outline = Schemas["Outline"];
export type OutlineEvent = Schemas["OutlineEvent"];
export type OutlineTask = Schemas["OutlineTask"];
export type BuildState = Schemas["BuildState"];
/** What the Gatherer's model made of a gatherer's history (/api/extracts). */
export type Extract = Schemas["Extract"];
export type Search = Schemas["Search"];
export type Event = Schemas["Event"];

// ---- the apps: /api/apps, the Apps page's /api/apps/catalog

/** The apps found, and a gatherer's open instances, the agents attached to each, its tasks (/api/apps). */
export type Apps = Schemas["Apps"];
/** An app found, as the host lists it. */
export type AppListed = Schemas["AppListed"];
/** An app's open instance. */
export type Instance = Schemas["Instance"];
/** The Apps page (/api/apps/catalog), and an app as it lists it. */
export type Catalog = Schemas["Catalog"];
export type CatalogApp = Schemas["CatalogApp"];
export type InstalledApp = Schemas["InstalledApp"];
export type Broken = Schemas["Broken"];
/** An app copied aside and checked by the server (/api/apps/stage), to be installed or discarded. */
export type Staged = Schemas["Staged"];
/** An agent's asking to install, update or uninstall an app, as the home lists them. */
export type AppRequest = Schemas["AppRequest"];
/** What "+" on an actor or a task does with an app (app_policy.py). */
export type OnTask = NonNullable<CatalogApp["on_task"]>;

// ---- the settings

/** /api/settings (settings.py's `read`): ag's config.toml as the panel shows it. */
export type Settings = Schemas["Settings"];
