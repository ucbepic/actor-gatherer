// ag's settings in the panel: what they show of config.toml, and what each form sends.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../core/api/types";
import { AgSettings, ModelInput } from "./AgSettings";
import { useSettings } from "./store";

const SETTINGS: Settings = {
  path: "/home/u/.ag/config.toml",
  exists: true,
  error: null,
  version: "v1",
  text: '[policies.llm]\nmodel = ""\n',
  llm: { model: "", api_base: "", key_env: "" },
  env: {},
  policies: { available: ["proactive_context_manager", "pcm_small"], default: "proactive_context_manager" },
  pollers: { available: ["file_changes"], default: ["file_changes"] },
  cli: { gatherer: "", harnesses: { claude: { command: ["claude"], port: 4013 } } },
};

/** fetch answering each path with `answers[path]` (a function of the request's body, or a value). */
function answering(answers: Record<string, unknown>) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      const a = answers[path];
      const got = typeof a === "function" ? (a as (b: unknown) => unknown)(body) : a;
      return new Response(JSON.stringify(got ?? { error: "no such route" }), { status: got ? 200 : 404 });
    }),
  );
  return calls;
}

beforeEach(() =>
  useSettings.setState({
    settings: SETTINGS,
    rev: 1,
    said: "",
    savedDefaults: "",
    file: { open: false, error: "", rev: 0 },
  }),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgSettings", () => {
  it("says no model is set, and lists the harnesses ag runs", () => {
    render(<AgSettings closePanel={() => {}} />);
    const note = document.getElementById("cfg-model-note")!;
    expect(note.textContent).toMatch(/^No model set: every Gatherer call fails/);
    expect(note.className).toBe("cfg-note bad");
    expect(document.getElementById("cfg-harnesses")!.textContent).toBe("claude runs claude · hook port 4013");
    expect((screen.getByLabelText("Gatherer model") as HTMLInputElement).value).toBe("");
  });

  it("sets the model, says what it runs on, and closes the panel", async () => {
    const calls = answering({
      "/api/settings/model": (b: { model: string }) => ({
        ...SETTINGS,
        llm: { ...SETTINGS.llm, model: b.model },
        said: "Runs on Claude Code.",
      }),
    });
    const closePanel = vi.fn();
    render(<AgSettings closePanel={closePanel} />);
    fireEvent.change(screen.getByLabelText("Gatherer model"), { target: { value: "claude-code/sonnet" } });
    await act(async () => {
      fireEvent.submit(document.getElementById("cfg-model")!);
    });
    expect(calls).toEqual([
      { path: "/api/settings/model", body: { model: "claude-code/sonnet", api_base: "", key_env: "" } },
    ]);
    expect(closePanel).toHaveBeenCalledOnce();
    expect(document.getElementById("cfg-model-note")!.textContent).toBe("Runs on Claude Code.");
    expect((screen.getByLabelText("Gatherer model") as HTMLInputElement).value).toBe("claude-code/sonnet");
  });

  it("suggests models in the page under the box: filtered, picked by click or by keys", () => {
    let v = "";
    const { rerender } = render(<ModelInput value={v} onChange={(x) => (v = x)} />);
    const box = screen.getByLabelText("Gatherer model");
    fireEvent.focus(box);
    expect(screen.getAllByRole("option").length).toBe(5);
    rerender(<ModelInput value="codex" onChange={(x) => (v = x)} />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["codex/gpt-5-mini"]);
    fireEvent.mouseDown(screen.getByRole("option"));
    expect(v).toBe("codex/gpt-5-mini");
    expect(screen.queryByRole("listbox")).toBeNull();
    rerender(<ModelInput value="" onChange={(x) => (v = x)} />);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(v).toBe("claude-code/haiku");
  });

  it("saves the defaults, as the file's version had them, and says so", async () => {
    const calls = answering({ "/api/settings/defaults": () => SETTINGS });
    render(<AgSettings closePanel={() => {}} />);
    fireEvent.change(document.getElementById("cfg-policy")!, { target: { value: "pcm_small" } });
    fireEvent.click(screen.getByLabelText("file_changes"));
    await act(async () => {
      fireEvent.submit(document.getElementById("cfg-defaults")!);
    });
    expect(calls[0].body).toEqual({ version: "v1", policy: "pcm_small", pollers: [], gatherer: "" });
    expect(document.getElementById("cfg-defaults-note")!.textContent).toBe("Saved: new groups get these.");
  });

  it("opens config.toml as it is now, shows why a save failed, and closes", async () => {
    answering({
      "/api/settings": { ...SETTINGS, text: "fresh = 1\n" },
      "/api/settings/file": undefined, // refused
    });
    render(<AgSettings closePanel={() => {}} />);
    const dialog = document.getElementById("cfg-file")!;
    expect(dialog.hidden).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByText("Edit config.toml…"));
    });
    expect(dialog.hidden).toBe(false);
    expect((screen.getByRole("textbox", { name: "config.toml" }) as HTMLTextAreaElement).value).toBe("fresh = 1\n");
    await act(async () => {
      fireEvent.submit(document.getElementById("cfg-file-form")!);
    });
    expect(document.getElementById("cfg-file-err")!.textContent).toBe("no such route");
    fireEvent.click(screen.getByText("Cancel"));
    expect(dialog.hidden).toBe(true);
  });
});
