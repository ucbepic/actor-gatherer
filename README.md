<div align="center">

# The Actor-Gatherer Framework for AI Agents

[![Project page](https://img.shields.io/badge/Project%20page-actor--gatherer-blue)](https://ucbepic.github.io/actor-gatherer/)
[![Docs](https://img.shields.io/badge/Docs-actor--gatherer%2Fdocs-green)](https://ucbepic.github.io/actor-gatherer/docs.html)
[![Blog](https://img.shields.io/badge/Blog-read%20the%20post-purple)](https://ucbepic.github.io/actor-gatherer/blog.html)
[![Works with Claude Code, Codex, OpenCode and Pi](https://raw.githubusercontent.com/ucbepic/actor-gatherer/main/assets/works-with.svg)](#quickstart)

[What is the Actor-Gatherer Framework](#what-is-the-actor-gatherer-framework) · [Install](#install) · [Quickstart](#quickstart) · [Examples](#examples) · [How it works](#how-it-works) · [Extensions](#extensions)

</div>

---

## What is the Actor-Gatherer Framework

Actor-Gatherer is a new paradigm in agent design where the context across agents is managed proactively and externally, separating solving a task from context management needed to do so. 
An **Actor** (your coding agent: Claude Code, Codex, OpenCode or Pi) works on
the task. A **Gatherer** (also AI-powered) monitors the Actor, other agents and the environment,
and before every model call decides what context the Actor gets. The Gatherer:

- **Shares information across agents:** Actors using the same Gatherer can benefit from each other’s work, even when they run on different harnesses,
- **Keeps context relevant:** It identifies what's relevant for the current task from past interactions, paging in useful information and removing redundant details, and
- **Tracks the environment:** If a file the Actor relies on changes, the Gatherer surfaces the update before the Actor acts on outdated information.

Without a Gatherer, each agent operates largely on its own history, which is typically summarized as it grows. This can leave agents unaware of relevant past interactions, work done by other agents, or changes made by the user.


---

## Install

You need Python 3.11+ and the harness you want to run on your `PATH`. Install `ag` from PyPI:

```bash
pip install actor-gatherer
```

Or from source:

```bash
git clone https://github.com/ucbepic/actor-gatherer && cd actor-gatherer
pip install -r requirements.txt        # `ag` from this clone, editable, with every dependency
```

### Set the Gatherer's LLM

The Gatherer uses LLMs to manage the context of Actors, so you must set the model the
Gatherer uses. It can be an API-based model, called through
[LiteLLM](https://docs.litellm.ai/docs/providers). Name it as `provider/model`, and set that provider's API key, e.g.,

```bash
ag model openai/gpt-6-sol                    # "provider/model"; the key from OPENAI_API_KEY
export OPENAI_API_KEY=...

ag model gemini/gemini-3.8-flash             # or a Gemini model; the key from GEMINI_API_KEY
export GEMINI_API_KEY=...
```

Or it can be a coding agent, such as Claude Code or Codex, named as

```bash
ag model claude-code/sonnet
ag model codex/gpt-6-sol
```

which runs Claude Code or Codex for the Gatherer. To use Codex, make sure OpenAI's Codex SDK is installed:

```bash
pip install openai-codex
```

To check the model that is set:

```bash
ag model
```

## Quickstart

Put `ag --gatherer NAME` in front of the agent command you would normally run.

```bash
ag --gatherer demo claude                                # Claude Code
ag --gatherer demo codex exec "fix the tests"            # Codex
ag --gatherer demo opencode run "add a --verbose flag"   # OpenCode
ag --gatherer demo pi                                    # Pi
```
Agents join the gatherer specified (`demo` above).  Agents with the same gatherer 
share information with each other, whichever harness runs them (see the [example](#awareness-across-agents)). Agents in
different gatherers don't share context and each gatherer keeps its own history.

For example, the first two agents below share information; the third, in a
gatherer of its own, sees neither of them:

```bash
ag --gatherer frontend claude                            # shares with the Codex below
ag --gatherer frontend codex                             # shares with the Claude Code above
ag --gatherer backend codex                              # shares with neither
```

Without `--gatherer`, a session joins the gatherer `default`:

```bash
ag codex                                                 # the same as: ag --gatherer default codex
```

Use `--gatherer .` to create a new, unnamed gatherer. Agents created
this way don't share context with other agents:

```bash
ag --gatherer . codex
```

To see every gatherer:

```bash
ag gatherers                                             # each one's policy, pollers, event count, last activity
```

## Examples

The Actor-Gatherer framework improves accuracy in three settings:

- **Long-running sessions:** the Gatherer decides what matters from a long history
  for the task at hand, pages in relevant information when needed and removes irrelevant ones.
- **Sharing information across parallel agents:** agents in the same gatherer,
  even in different harnesses, get what they need from each other's work.
- **Observing the environment:** when something an agent relied on changes, such
  as a file, the Gatherer tells it before it answers from a stale copy.

Below is an example of each.

### Long-running sessions

When a session's history no longer fits, a coding agent compacts it into a summary
of its own, and an early decision can be lost. The Gatherer instead splits the
history into tasks, records what each task established, and gives the agent the
earlier tasks the request at hand needs.

In this example, the database has a trap. Its catalogue links to its studios
through two columns that both match every row: the declared foreign key
(`catalogue.studiolink`) is stale, and the right join is the undeclared
`catalogue.feed_tag = companies.callsign`. Early in the session:

> **You → Codex:** Which studios have the most catalogue entries? Top five, name and count.
>
> **Codex:** I joined `catalogue` to `companies` on `catalogue.feed_tag = companies.callsign`: …
>
> **You → Codex:** Good, that's correct.

Ten turns of other work on the catalogue follow, and then:

> **You → Codex:** Which five studios have the most Drama entries? Name and count.

| | correct |
|---|---|
| `codex`, compacting along the way | 0 of 3: joins on `studiolink` |
| `ag codex` | 3 of 3: joins on `feed_tag` |

Codex's summary of the early turns keeps "Good, that's correct" but not what was
correct, so it falls back on the declared foreign key. Under `ag`, the Gatherer
records "join catalogue to companies on `catalogue.feed_tag = companies.callsign`,
not `catalogue.studiolink = companies.company_id`" for that task, and gives it to
the agent with the Drama question.

To run it yourself (every turn is a real model call):

```bash
demo/long_session/run.sh ag       # Codex under ag
demo/long_session/run.sh plain    # Codex alone
```

The session is short, so both run with lowered limits to make the history
overflow within it: 10,000 tokens for the Gatherer, and compaction at 18,000 for
Codex. The numbers above are with Gemini 3.8 Flash as both Codex's model and the
Gatherer's. See [`demo/long_session`](https://github.com/ucbepic/actor-gatherer/tree/main/demo/long_session)
for how the session is set up.

### Awareness across agents

`ag` proactively shares information across agents when one needs it, as long as
they are in the same gatherer, even if they run in different harnesses.

**1. Terminal 1: start Codex in a gatherer named `demo`, with a first message.**

```bash
ag --gatherer demo codex "Let X = 5. What is 2X?"
```

> **You → Codex:** Let X = 5. What is 2X?
>
> **Codex:** If X = 5, then 2X = 2 × 5 = 10.

**2. Terminal 2 (or after the first session has ended): start Claude Code in the
same gatherer.**

```bash
ag --gatherer demo claude "What is 3X?"
```

> **You → Claude Code:** What is 3X?
>
> **Claude Code:** 3X = 15.
>
> Your question doesn't define X, so I took X = 5 from your message to the other
> agent ("Let X = 5. What is 2X?").

Claude Code never saw the Codex session. Both are in `demo`, so the Gatherer
gave it Codex's request, and told it where to read the rest of that session's
work.

### Information from the environment

`ag` observes the agent's environment, such as the files in its working
directory, and tells the agent when something it relied on has changed. The
example's data file is in this repo, at [`demo/salaries.csv`](https://github.com/ucbepic/actor-gatherer/blob/main/demo/salaries.csv).

**1. Terminal 1: copy the demo file and start Codex next to it.** The copy keeps
the repo's file as it is when you edit it.

```bash
mkdir -p /tmp/ag-salaries && cp demo/salaries.csv /tmp/ag-salaries/ && cd /tmp/ag-salaries
ag --gatherer salaries codex
```

**2. In Codex: ask about the file.**

> **You → Codex:** I'm putting together a compensation benchmark from salaries.csv.
> Where does Germany's average salary sit relative to the median of the countries
> listed?
>
> **Codex:** Germany ($58,940) sits $3,820 above the median ($55,120, the United
> Kingdom).

**3. Terminal 2: change the file while the Codex session stays open.** This
changes Japan from 42,180 to 47,152 (or edit the file by hand):

```bash
f=/tmp/ag-salaries/salaries.csv; c=$(<"$f"); printf '%s\n' "${c/Japan,42180,/Japan,47152,}" > "$f"
```

**4. In the same Codex session: ask a second question.**

> **You → Codex:** How large is the gap between France and Japan, in USD?
>
> **Codex:** France: $49,310. Japan: $47,152. The gap between France and Japan is
> $2,158.

Before this question reached the model, the Gatherer told Codex that
`salaries.csv` had changed after it last read it, so Codex read the file again.

**To compare,** repeat the steps with plain `codex`, starting from a fresh copy:

```bash
mkdir -p /tmp/plain-salaries && cp demo/salaries.csv /tmp/plain-salaries/ && cd /tmp/plain-salaries
codex
```

Asked the same two questions, with the same change in between, plain Codex answers
$7,130 to the second, which is incorrect: it uses Japan's old value from its first
read.

## How it works

![Actor-Gatherer architecture: each Actor (a harness plus its adaptor) calls insert and get_context on the Gatherer, which holds the context and insertion policy and a database; pollers watch the environment and insert events](https://raw.githubusercontent.com/ucbepic/actor-gatherer/main/assets/architecture.png)

The **Gatherer** is a server that many **Actors** talk to, and the Actors can come
from different coding harnesses. An Actor is a harness plus its **adaptor**, which
turns the harness's messages into a unified data representation and the Gatherer's context back into
message format the harness supports. Each Actor uses two calls on the Gatherer:
- **`insert`** gives the Gatherer what the Actor has seen and done.
- **`get_context`** runs before each model call, and returns the context the model gets.

**Pollers** bring in information from the environment, such as files changed under
the working directory. The Gatherer asks them for new events in the environment, and they insert
those events like an Actor would. A **context management policy** inside the
Gatherer then decides what context each Actor gets, using everything it has
gathered from every Actor and from the environment.

`ag` currently uses:
- **Adaptors:** [`ClaudeAdaptor`](https://github.com/ucbepic/actor-gatherer/blob/main/ag/integrations/harnesses/claude/adaptor/adaptor.py),
  [`CodexAdaptor`](https://github.com/ucbepic/actor-gatherer/blob/main/ag/integrations/harnesses/codex/adaptor/adaptor.py),
  [`OpencodeAdaptor`](https://github.com/ucbepic/actor-gatherer/blob/main/ag/integrations/harnesses/opencode/adaptor/adaptor.ts) and
  [`PiAdaptor`](https://github.com/ucbepic/actor-gatherer/blob/main/ag/integrations/harnesses/pi/adaptor/adaptor.ts), each with the
  launcher `ag` uses to start that harness connected to the Gatherer.
- **Pollers:** [`FileChangePoller`](https://github.com/ucbepic/actor-gatherer/blob/main/ag/ag_pollers/file_changes.py),
  which reports files changed under the agent's working directory since it last
  looked.
- **Context Policy:** [`ProactiveContextManager`](https://github.com/ucbepic/actor-gatherer/blob/main/ag/ag_policies/proactive_context_manager/policy.py),
  which searches earlier history in the
  background, and adds what other sessions asked for and what changed in the
  environment.

## Extensions

`ag` is extensible. You can:

- write your own [context policy](https://ucbepic.github.io/actor-gatherer/docs.html#write-policy), which decides what the
  agent's context holds,
- write your own [poller](https://ucbepic.github.io/actor-gatherer/docs.html#write-poller), which brings in information from the
  environment, or
- [add a harness](https://ucbepic.github.io/actor-gatherer/docs.html#write-adaptor), so another coding agent can run with `ag`.

See [Extending ag](https://ucbepic.github.io/actor-gatherer/docs.html#extending) in the docs.
