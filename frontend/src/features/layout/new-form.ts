// The list's FORM FOR A NEW ACTOR, under its gatherer's row (state.adding: the list asks for it, features/list/Boxes.tsx's
// NewForm, and puts it in whole): the directory, a button for each harness -- an app with its agent on each harness that
// can give it its tools, a terminal -- and why it did not start. Enter starts the harness last chosen (the primary), not
// the first of the buttons; with none chosen (a new gatherer's first session), no harness is marked, and Enter waits
// for a click.
import { appMarkNode } from "./app-panels";
import { L, renderAgents, state } from "./link";
import { APP_START, SHELL_START, startKind } from "./start-rules";
import { noHarness, startAny, startable, startingApps, tooledOf } from "./starts";

export function newForm(): HTMLFormElement {
  const el = L.helpers.el,
    icons = L.helpers.ICONS;
  const adding = state.adding!,
    fixed = adding.gatherer,
    hs = startable(),
    shell = adding.harness === SHELL_START;
  const off = state.starting ? { disabled: "" } : {};
  const cwd = el("input", {
    name: "cwd",
    value: adding.cwd || state.home?.cwd || "",
    spellcheck: "false",
  }) as HTMLInputElement;
  const err = el("div", { class: "err", role: "alert", text: adding.error || (hs.length || shell ? "" : noHarness()) });
  const starts = hs.map((h) =>
    el(
      "button",
      { type: "submit", value: h, class: h === adding.harness ? "primary" : "", ...off },
      L.helpers.harnessBadge(h),
      L.helpers.harnessName(h),
    ),
  );
  const tooled = tooledOf(hs);
  for (const a of tooled.length ? startingApps() : [])
    for (const h of tooled) {
      const value = `${APP_START}${a.name}:${h}`;
      starts.push(
        el(
          "button",
          {
            type: "submit",
            value,
            class: adding.harness === value ? "primary" : "",
            title: `${a.label} with its agent on ${L.helpers.harnessName(h)}`,
            ...off,
          },
          a.mark ? appMarkNode(a) : L.helpers.strokeIcon(icons.app, 14),
          a.label,
          L.helpers.harnessBadge(h),
        ),
      );
    }
  if (state.home?.terminals !== false)
    starts.push(
      el(
        "button",
        { type: "submit", value: SHELL_START, class: shell ? "primary" : "", ...off },
        L.helpers.strokeIcon(icons.terminal, 14),
        "Terminal",
      ),
    );
  const kind = startKind(String(adding.harness || ""));
  const appAt = kind.kind === "app" ? L.appHost.named(kind.app) : null;
  const form = el(
    "form",
    { class: "newform", "aria-label": "New session" },
    el("div", {
      class: "desc",
      text: shell ? `New terminal in ${fixed}` : appAt ? `New ${appAt.label} in ${fixed}` : `New actor in ${fixed}`,
    }),
    el("label", {}, "Working directory", cwd),
    err,
    el(
      "div",
      { class: "row" },
      el(
        "button",
        {
          type: "button",
          onclick: () => {
            state.adding = null;
            renderAgents();
          },
        },
        "Cancel",
      ),
      ...starts,
    ),
  ) as HTMLFormElement;
  cwd.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const chosen = starts.find((b) => b.classList.contains("primary"));
    if (chosen) form.requestSubmit(chosen);
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const submitter = (ev as SubmitEvent).submitter as HTMLButtonElement | null;
    const harness = submitter ? submitter.value : adding.harness || "";
    Object.assign(adding, { cwd: cwd.value.trim(), harness, error: "" });
    try {
      await startAny(fixed, adding.cwd || "", harness);
    } catch (e) {
      adding.error = (e as Error).message;
      renderAgents();
    }
  });
  return form;
}
