// ag's settings (config.toml, settings.py), as the panel shows and changes them.
import { create } from "zustand";
import { get, post } from "../../core/api/client";
import type { Settings } from "../../core/api/types";

interface SettingsState {
  settings: Settings | null;
  /** Each time the settings are read again: the forms start over from them (their `key`). */
  rev: number;
  /** What the server last said about the model just set (settings.py's `said`). */
  said: string;
  /** Said under the defaults once they are saved. */
  savedDefaults: string;
  /** The config.toml dialog: open, its last error, and each opening's number (the form starts over each time). */
  file: { open: boolean; error: string; rev: number };
  load: () => Promise<Settings>;
  take: (settings: Settings, said?: string) => void;
  setModel: (model: string, apiBase: string, keyEnv: string) => Promise<Settings>;
  setDefaults: (policy: string | null, pollers: string[], gatherer: string) => Promise<Settings>;
  openFile: () => Promise<void>;
  closeFile: () => void;
  saveFile: (text: string) => Promise<void>;
}

export const useSettings = create<SettingsState>()((set, getState) => ({
  settings: null,
  rev: 0,
  said: "",
  savedDefaults: "",
  file: { open: false, error: "", rev: 0 },
  load: async () => {
    const s = await get<Settings>("/api/settings");
    getState().take(s);
    return s;
  },
  take: (settings, said = "") => set((st) => ({ settings, said, savedDefaults: "", rev: st.rev + 1 })),
  setModel: async (model, apiBase, keyEnv) => {
    const got = await post<Settings>("/api/settings/model", { model, api_base: apiBase, key_env: keyEnv });
    getState().take(got, got.said);
    return got;
  },
  setDefaults: async (policy, pollers, gatherer) => {
    const got = await post<Settings>("/api/settings/defaults", {
      version: getState().settings?.version,
      policy,
      pollers,
      gatherer,
    });
    set((st) => ({ settings: got, said: "", savedDefaults: "Saved: new groups get these.", rev: st.rev + 1 }));
    return got;
  },
  openFile: async () => {
    await getState()
      .load()
      .catch(() => {});
    if (getState().settings) set((st) => ({ file: { open: true, error: "", rev: st.file.rev + 1 } }));
  },
  closeFile: () => set((st) => ({ file: { ...st.file, open: false, error: "" } })),
  saveFile: async (text) => {
    try {
      const got = await post<Settings>("/api/settings/file", { version: getState().settings?.version, text });
      set((st) => ({ settings: got, said: "", rev: st.rev + 1, file: { ...st.file, open: false, error: "" } }));
    } catch (e) {
      set((st) => ({ file: { ...st.file, open: true, error: (e as Error).message } }));
    }
  },
}));

/** Whether no model is set, in the file or for this dashboard (AG_LLM_MODEL): every Gatherer call fails until one is. */
export const unset = (s: Settings | null) => !!s && !s.llm.model && !(s.env || {}).AG_LLM_MODEL;
