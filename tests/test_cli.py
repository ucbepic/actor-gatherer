"""ag, the command line (cli/), whatever the harness: its own settings (the
[cli] section of config.toml), named gatherers, its options, the harnesses it
knows only from config.toml -- each a launcher and an adaptor -- and its check
that the policy takes what the adaptor and the pollers output. Each harness's
launcher is tested in test_<harness>_launch.py, and where things may live in
test_layout.py; the harnesses are not run."""

import json
import os
import subprocess
import re
import sys
import tempfile
import unittest
from unittest import mock

from ag.cli import config, main
from ag.cli.launch import Run
from cli_home import Home

LAUNCHER = '''
from ag.cli.launch import Launch, Launcher

class EchoLauncher(Launcher):
    """A stand-in harness: echoes what it would run. `launched` says it ran."""
    defaults = {"command": ["echo"], "env": {}}
    launched = []

    def launch(self, run):
        EchoLauncher.launched.append(run)
        return Launch([*run.command, "via", run.adaptor, *run.args], run.env, ["echo set up"])
'''

ADAPTOR = '''
from ag.integrations.tools.ag_orchestrator.adaptor import AG, Adaptor

class Plain(Adaptor):
    name, outputs, accepts = "plain", ("user_message", "agent_message"), ("user_message", "agent_message", AG)
    def to_events(self, messages): return []
    def to_messages(self, context, messages): return []

class Odd(Plain):
    name, outputs = "odd", ("user_message", "hologram")

class Threaded(Plain):
    name, properties = "threaded", ("channel",)

class Tagged(Plain):
    name, properties = "tagged", ("channel", "user")
'''


NARROW = '''from ag.ag_policies.proactive_context_manager import ProactiveContextManager
from ag.ag_policies.proactive_context_manager.events import ENVIRONMENT_UPDATE, EVENT_TYPES


class Narrow(ProactiveContextManager):
    """A policy without environment_update: the file_changes poller is not for it."""
    name = "narrow"
    event_types = tuple(t for t in EVENT_TYPES if t.name != ENVIRONMENT_UPDATE)
'''


def add_narrow(home: str) -> None:
    """A second policy in the home's catalog, `narrow`, from a plugin: one that does not take
    what the shipped poller outputs."""
    config.ensure()
    os.makedirs(os.path.join(home, "plugins"), exist_ok=True)
    with open(os.path.join(home, "plugins", "narrow.py"), "w") as fh:
        fh.write(NARROW)
    with open(config.path(), "a") as fh:
        fh.write('\n[policies.available.narrow]\nfile = "narrow.py"\nclass = "Narrow"\n')


def set_entry(harness: str, key: str, value: str) -> None:
    """In config.toml, `key = value` in [cli.harnesses.<harness>] (the line replaced, or added)."""
    with open(config.path()) as fh:
        text = fh.read()
    head = f"[cli.harnesses.{harness}]\n"
    start = text.index(head) + len(head)
    end = text.find("\n[", start)
    end = len(text) if end < 0 else end
    block = text[start:end]
    line = re.compile(rf"^{key}\s*=.*$", re.M)
    block = line.sub(f"{key} = {value}", block) if line.search(block) else f"{key} = {value}\n" + block
    with open(config.path(), "w") as fh:
        fh.write(text[:start] + block + text[end:])


class WithPlugins(Home):
    """A home, with a stand-in harness's launcher and adaptors importable."""

    def setUp(self):
        super().setUp()
        self.mods = tempfile.mkdtemp()
        for name, source in (("echo_launch.py", LAUNCHER), ("echo_adaptor.py", ADAPTOR)):
            with open(os.path.join(self.mods, name), "w") as fh:
                fh.write(source)
        sys.path.insert(0, self.mods)
        self.addCleanup(sys.path.remove, self.mods)
        for mod in ("echo_launch", "echo_adaptor"):
            self.addCleanup(sys.modules.pop, mod, None)

    def add_harness(self, name: str, adaptor: str = "echo_adaptor:Plain", launcher: str = "echo_launch:EchoLauncher"):
        config.ensure()
        lines = [f"[cli.harnesses.{name}]"]
        if launcher:
            lines.append(f'launcher = "{launcher}"')
        if adaptor:
            lines.append(f'adaptor = "{adaptor}"')
        with open(config.path(), "a") as fh:
            fh.write("\n" + "\n".join(lines) + "\n")


class Harnesses(WithPlugins):
    def test_the_shipped_harnesses_are_written_into_the_config(self):
        harnesses = config.load()["harnesses"]
        self.assertEqual(sorted(harnesses), ["antigravity", "claude", "codex", "opencode", "pi"])
        for name, entry in harnesses.items():
            self.assertEqual(entry["launcher"].split(":")[0], f"ag.integrations.harnesses.{name}.setup.launch")
            self.assertIn("adaptor", entry)

    def test_any_harness_in_the_config_runs(self):
        self.add_harness("echo")
        code, out, err = self.run_ag("--dry-run", "echo", "hi")
        self.assertEqual(code, 0, err)
        self.assertEqual(out.strip(), "echo via echo_adaptor:Plain hi")

    def test_a_policy_that_does_not_take_the_adaptor_s_outputs_is_refused_before_anything_runs(self):
        self.add_harness("odd", adaptor="echo_adaptor:Odd")
        code, out, err = self.run_ag("--dry-run", "odd", "hi")
        self.assertEqual(code, 1)
        self.assertIn("adaptor odd outputs: hologram", err)
        self.assertIn("proactive_context_manager takes: user_message", err)
        from echo_launch import EchoLauncher
        self.assertEqual((out, EchoLauncher.launched), ("", []))

    def test_the_properties_an_adaptor_sets_must_be_the_policy_s(self):
        self.add_harness("threaded", adaptor="echo_adaptor:Threaded")
        self.add_harness("tagged", adaptor="echo_adaptor:Tagged")
        code, _, err = self.run_ag("--dry-run", "--no-pollers", "--gatherer", "p1", "threaded", "hi")
        self.assertEqual(code, 0, err)                                   # the policy's types declare the channel
        code, _, err = self.run_ag("--dry-run", "--no-pollers", "--gatherer", "p2", "tagged", "hi")
        self.assertEqual(code, 1)
        self.assertIn("adaptor tagged sets user on user_message, which declares channel, cwd", err)
        self.assertIn("proactive_context_manager takes: user_message (channel*, cwd)", err)

    def test_a_required_property_must_be_set_by_whoever_sends_the_type(self):
        contract = {"policy": "strict", "pollers_from": "given",
                    "event_types": [{"name": "user_message", "properties": [{"name": "channel", "required": True}]},
                                    {"name": "agent_message", "properties": []},
                                    {"name": "tick", "properties": [{"name": "channel", "required": True}]}],
                    "pollers": {"clock": ["tick"]}, "poller_properties": {"clock": ["poller"]}}
        saved = main.home_cli, main.adaptor_declarations
        main.home_cli = lambda args, capture=False: subprocess.CompletedProcess(args, 0, json.dumps(contract), "")
        main.adaptor_declarations = lambda spec: {"name": "plain", "outputs": ["user_message", "agent_message"],
                                                  "accepts": [], "properties": []}
        try:
            problems = main.contract_problems("h", "x:Y", None, {"policy": None, "pollers": [], "no_pollers": False})
        finally:
            main.home_cli, main.adaptor_declarations = saved
        text = "\n".join(problems)
        self.assertIn("adaptor plain does not set channel, which user_message requires", text)
        self.assertIn("poller clock does not set channel, which tick requires", text)
        self.assertIn("poller clock sets poller on tick, which declares channel", text)
        self.assertNotIn("agent_message requires", text)
        self.assertIn("strict takes: user_message (channel!), agent_message, tick (channel!)", text)

    def test_a_poller_the_policy_does_not_take_is_refused(self):
        self.add_harness("echo")
        add_narrow(self.home)
        code, _, err = self.run_ag("--dry-run", "--gatherer", "x", "--policy", "narrow",
                                   "--poller", "file_changes", "echo")
        self.assertEqual(code, 1)
        self.assertIn("poller file_changes outputs: environment_update", err)
        self.assertFalse(os.path.exists(os.path.join(self.home, "gatherers", "x")))          # nothing made

    def test_the_default_pollers_are_checked_against_whatever_policy_is_named(self):
        self.add_harness("echo")
        add_narrow(self.home)
        code, _, err = self.run_ag("--dry-run", "--gatherer", "y", "--policy", "narrow", "echo")
        self.assertEqual(code, 1)                                                        # file_changes, by default
        self.assertIn("poller file_changes outputs: environment_update", err)
        self.assertIn("[pollers] default: choose others with --poller", err)
        code, out, err = self.run_ag("--dry-run", "--gatherer", "y", "--policy", "narrow", "--no-pollers", "echo")
        self.assertEqual(code, 0, err)                                                   # none: nothing to take
        self.assertEqual(self.run_ag("--dry-run", "--gatherer", "y", "--no-pollers", "--poller", "file_changes",
                                     "echo")[0], 1)
        main.prepare_gatherer("z", "proactive_context_manager", [], none=True)                           # what a real run does first
        self.assertIn("pollers = []", open(os.path.join(self.home, "gatherers", "z", "gatherer.toml")).read())
        main.prepare_gatherer("z", "proactive_context_manager", [], none=True)                           # the same again: fine
        with self.assertRaisesRegex(main.AgError, "exists with pollers -"):
            main.prepare_gatherer("z", None, ["file_changes"])

    def test_a_harness_may_not_take_one_of_ag_s_own_names(self):
        for name in ("stop", "gatherers", "home"):
            self.add_harness(name)
            code, _, err = self.run_ag("--dry-run", "codex", "hi")          # any command: the config is refused
            self.assertEqual(code, 1, name)
            self.assertIn(f"[cli.harnesses.{name}]: {name} is ag's own command", err)
            with open(config.path()) as fh:
                text = fh.read()
            with open(config.path(), "w") as fh:
                fh.write(text.replace(f"[cli.harnesses.{name}]", "[cli.harnesses.renamed_" + name + "]"))

    def test_the_home_s_gatherer_commands_at_the_top(self):
        # the home runs as its own process, on the terminal: what it made and its exit codes show it ran
        self.assertEqual(self.run_ag("new", "made", "--no-pollers")[0], 0)      # ag home new
        self.assertTrue(os.path.exists(os.path.join(self.home, "gatherers", "made", "gatherer.toml")))
        self.assertEqual(self.run_ag("new", "made")[0], 1)                       # exists, as ag home new says
        self.assertEqual((self.run_ag("gatherers")[0], self.run_ag("show", "made")[0]), (0, 0))
        self.assertIn("made", main.home_cli(["gatherers"], capture=True).stdout)

    def test_an_entry_without_a_launcher_or_an_adaptor(self):
        self.add_harness("nolauncher", launcher="")
        self.add_harness("noadaptor", adaptor="")
        self.assertIn("names no adaptor", self.run_ag("--dry-run", "noadaptor")[2])
        self.assertIn("names no launcher", self.run_ag("--dry-run", "nolauncher")[2])
        self.add_harness("broken", launcher="no_such_module:Nope")
        self.assertIn("cannot be imported", self.run_ag("--dry-run", "broken")[2])

    def test_a_harness_the_config_does_not_name(self):
        code, _, err = self.run_ag("vim")
        self.assertEqual(code, 1)
        self.assertIn("codex, pi, opencode", err)


class Options(WithPlugins):
    def test_command_and_env_come_from_the_harness_s_entry(self):
        config.ensure()
        set_entry("pi", "command", '["/opt/pi"]')
        set_entry("pi", "env", '{ PI_X = "1" }')
        with open(config.path()) as fh:
            text = fh.read()
        with open(config.path(), "w") as fh:
            fh.write(text.replace('gatherer = "default"', 'gatherer = "always"', 1))
        code, out, err = self.run_ag("--dry-run", "pi")
        self.assertEqual(code, 0, err)
        self.assertIn("--ag-gatherer always", out)
        self.assertIn("PI_X=1", out)
        self.assertIn("/opt/pi -e", out)

    def test_quiet_runs_the_same_without_ag_s_notes_but_with_its_warnings(self):
        self.add_harness("echo")
        code, out, err = self.run_ag("--dry-run", "echo", "hi")
        self.assertEqual(code, 0, err)
        self.assertIn("ag: echo set up\nag: gatherer default", err)
        quiet = self.run_ag("--dry-run", "--quiet", "echo", "hi")
        self.assertEqual(quiet[:2], (0, out))
        self.assertNotIn("set up", quiet[2])
        self.assertNotIn("gatherer default", quiet[2])
        self.assertIn("no LLM model set", quiet[2])                         # a warning is not a note

    def test_bad_gatherers_and_policies_without_one(self):
        self.assertEqual(self.run_ag("--dry-run", "--gatherer", "a/b", "pi")[0], 1)
        code, _, err = self.run_ag("--dry-run", "--gatherer", ".", "--policy", "proactive_context_manager", "pi")
        self.assertEqual(code, 1)
        self.assertIn("--gatherer .", err)
        self.assertEqual(self.run_ag("--nope", "pi")[0], 1)


class DefaultGatherer(Home):
    def gatherer_given_pi(self, *args):
        code, out, err = self.run_ag("--dry-run", *args, "pi")
        self.assertEqual(code, 0, err)
        found = re.search(r"--ag-gatherer (\S+)", out)
        return found and found.group(1)

    def set_cli_gatherer(self, value: str) -> None:
        config.ensure()
        with open(config.path()) as fh:
            text = fh.read()
        with open(config.path(), "w") as fh:
            fh.write(re.sub(r'^gatherer = .*$', f"gatherer = {value}", text, count=1, flags=re.M))

    def test_every_run_files_into_the_default_gatherer(self):
        self.assertEqual(self.gatherer_given_pi(), "default")
        self.assertEqual(self.gatherer_given_pi("--gatherer", "demo"), "demo")
        self.assertIsNone(self.gatherer_given_pi("--gatherer", "."))                    # one per session

    def test_cli_gatherer_sets_it(self):
        self.set_cli_gatherer('"."')
        self.assertIsNone(self.gatherer_given_pi())
        self.assertEqual(self.gatherer_given_pi("--gatherer", "demo"), "demo")
        self.set_cli_gatherer('""')                                                   # as ag wrote it before
        self.assertEqual(self.gatherer_given_pi(), "default")


class GathererFromTheShell(Home):
    def test_ag_gatherer_is_not_read_or_passed_on(self):
        with mock.patch.dict(os.environ, {"AG_GATHERER": "stale"}):
            code, out, err = self.run_ag("--dry-run", "pi", "-p", "hi")
        self.assertEqual(code, 0, err)
        self.assertNotIn("stale", out)
        self.assertIn("AG_GATHERER is ignored", err)
        self.assertNotIn("AG_GATHERER", main.launcher("pi", config.load()).launch(Run(
            [], ["pi"], {"AG_GATHERER": "x"}, None, self.tmp)).argv)


class Gatherers(Home):
    def test_a_named_gatherer_made_with_its_policy_then_checked(self):
        add_narrow(self.home)
        main.prepare_gatherer("mine", "narrow", [], none=True)
        shown = main.home_cli(["show", "mine"], capture=True).stdout
        self.assertIn("policy:  narrow", shown)
        main.prepare_gatherer("mine", "narrow", [], none=True)                               # the same: fine
        with self.assertRaisesRegex(main.AgError, "exists with policy narrow"):
            main.prepare_gatherer("mine", "proactive_context_manager", [])
        with self.assertRaisesRegex(main.AgError, "no policy"):
            main.prepare_gatherer("other", "nonesuch", [])


class Config(Home):
    def test_an_entry_over_its_launcher_s_defaults(self):
        from ag.integrations.harnesses.codex.setup.launch import CodexLauncher
        self.assertEqual(config.harness(config.load(), "codex", CodexLauncher.defaults)["port"], 4013)
        set_entry("codex", "port", "5000")
        set_entry("codex", "command", '"/bin/codex"')
        codex = config.harness(config.load(), "codex", CodexLauncher.defaults)
        self.assertEqual((codex["port"], codex["command"], codex["provider"]), (5000, ["/bin/codex"], ""))
        self.assertNotIn("launcher", codex)
        with open(config.path(), "w") as fh:
            fh.write("[cli\n")
        with self.assertRaises(config.ConfigError):
            config.load()



class CodexSdk(Home):
    def test_a_codex_model_without_the_sdk_is_refused_before_anything_runs(self):
        import importlib.util
        if importlib.util.find_spec("openai_codex") is not None:
            self.skipTest("the Codex SDK is installed here")
        with mock.patch.dict(os.environ, {"AG_LLM_MODEL": "codex/gpt-6-sol"}):
            code, out, err = self.run_ag("--dry-run", "pi")
        self.assertEqual((code, out), (1, ""))
        self.assertIn("pip install openai-codex", err)


class Reference(unittest.TestCase):
    """The data the docs and `ag --help` are made from says what the code does."""

    def test_the_parser_takes_exactly_the_listed_options(self):
        from ag.cli import usage
        listed = {word for option, _ in usage.OPTIONS for word in option.replace(",", " ").split()
                  if word.startswith("-")}
        source = open(main.__file__, encoding="utf-8").read()
        parsed = set(re.findall(r'"(--?[a-z][a-z-]*)"', source.split("def parse(")[1].split("\ndef ")[0]))
        self.assertEqual(parsed, listed)

    def test_every_command_is_listed(self):
        from ag.cli import usage
        text = " ".join(c for c, _ in usage.COMMANDS) + " " + " ".join(o for o, _ in usage.OPTIONS)
        for command in config.RESERVED:
            self.assertIn(command if command != "help" else "--help", text, command)

    def test_every_environment_variable_read_is_listed(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(main.__file__)))
        read = set()
        for dirpath, _, names in os.walk(root):
            for name in names:
                if name.endswith((".py", ".ts")):
                    text = open(os.path.join(dirpath, name), encoding="utf-8").read()
                    read |= set(re.findall(r"(?:environ(?:\.get)?\(?\[?|process\.env\.|process\.env\[)\s*[\"']?(AG_[A-Z_]+)", text))
                    read |= set(re.findall(r'^[A-Z_]*ENV\s*=\s*"(AG_[A-Z_]+)"', text, re.M))
        import tomllib
        from ag.cli.launch import load_launcher
        entries = tomllib.loads(open(config.HARNESSES_TOML, encoding="utf-8").read())["cli"]["harnesses"]
        listed = {name for name, *_ in config.ENVIRONMENT}
        listed |= {name for e in entries.values() for name, *_ in load_launcher(e["launcher"]).environment}
        self.assertEqual(read - listed, set())

    def test_every_llm_setting_is_listed(self):
        from ag.ag_harness.home import LLM_KEYS, LLM_SETTINGS
        from ag.ag_tools.llm.cli_client import CLIClient
        import inspect
        listed = {k for k, *_ in LLM_SETTINGS}
        commands = {p for p in inspect.signature(CLIClient).parameters if p.endswith("_command")}
        self.assertEqual((set(LLM_KEYS) | commands) - {"url", "file", "module"}, listed)

if __name__ == "__main__":
    unittest.main()
