"""The parts stay apart.

  * The harness side -- `ag/integrations/`: `harnesses/`, what is each
    harness's, and `tools/`, what every harness uses -- reaches the context
    manager only through its server, over stdio, and the context manager
    (`ag_harness/`) knows nothing of any harness.
  * `ag/integrations/harnesses/` holds harnesses alone, and each harness three folders:
      ag_orchestrator/  the context manager as the harness's hook
      adaptor/          the POLICY-SPECIFIC half: to_events and to_messages
      setup/            the setup that wires the hook in, and the launcher
    `ag/integrations/tools/` holds ag_connection/ (the ag server's client, the
    protocol), ag_orchestrator/ (call_ag, on ag_connection) and hook_server/
    (on neither), and reaches into no harness.
  * ROUTING (every ag_orchestrator -- the tools' and each harness's -- and
    each setup) orchestrates and never looks inside a message: that is the
    adaptor's, which only its ag_orchestrator reaches, and only through its
    two functions. A harness's ag_orchestrator builds on the tools'
    ag_orchestrator and ag_connection, its adaptor on the protocol alone,
    codex's setup on the hook server alone.
  * The hook server is generic: it names nothing of any harness, and codex's
    context manager does not know it is what calls it.
  * LAUNCHING: each harness's launcher (`harnesses/<harness>/setup/launch.py`)
    and adaptor are named by its entry in ag's config (`ag/cli/harnesses.toml`,
    written into config.toml); of its harness a launcher reaches the setup
    alone. `ag`'s code names no harness and imports nothing of the harness
    side: it imports what an entry names, at run time."""

import ast
import io
import os
import re
import tokenize
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AG_SIDE = ("ag_harness", "ag_interface", "ag_tools", "ag_policies", "ag_pollers")   # the context manager's packages
HARNESS_SIDE = ("integrations",)                     # its package, and its folder
H_DIR = os.path.join("ag", "integrations", "harnesses")
T_DIR = os.path.join("ag", "integrations", "tools")
TOOLS = ("ag_connection", "ag_orchestrator", "hook_server")
HARNESSES = ("codex", "pi", "opencode", "claude", "antigravity")
PARTS = ("ag_orchestrator", "adaptor", "setup")
TS_IMPORT = re.compile(r"""(?:^|\n)\s*import\s([^;]*?)\sfrom\s+["']([^"']+)["']""")
# The event types the policies expect: named in a harness's adaptor, never in its routing. ("context" is
# left out: it is also pi's event's name.)
TYPE_NAMES = ("user_message", "agent_message", "tool_call", "tool_output")
EXT = {"codex": ".py", "pi": ".ts", "opencode": ".ts", "claude": ".py", "antigravity": ".py"}
TOOLS_CONNECTION = os.path.join(REPO, T_DIR, "ag_connection") + os.sep
TOOLS_ORCHESTRATOR = os.path.join(REPO, T_DIR, "ag_orchestrator") + os.sep


#: Every package lives under ag/: `ag.ag_harness` in ag/ag_harness/, `ag.integrations` in ag/integrations/.
AG_PACKAGES = ("ag_harness", "ag_interface", "ag_tools", "ag_policies", "ag_pollers", "integrations", "cli")


def folder(top: str) -> str:
    """A package's folder: ag/<name>."""
    first = top.split(os.sep)[0]
    return os.path.join("ag", top) if first in AG_PACKAGES else top


def name_of(module: str) -> str:
    """A module, named the way the rules name packages: `ag.ag_harness.x` is `ag_harness.x`,
    `ag.integrations.x` is `integrations.x`."""
    head, _, rest = module.partition(".")
    return rest if head == "ag" and rest.split(".")[0] in AG_PACKAGES else module


def files(top: str, ext: str):
    for root, dirs, names in os.walk(os.path.join(REPO, folder(top))):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for name in names:
            if name.endswith(ext):
                yield os.path.join(root, name)


def python_imports(path: str):
    """The top-level package of each absolute import in a Python file."""
    tree = ast.parse(open(path, encoding="utf-8").read(), path)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            yield from (name_of(alias.name).split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            yield name_of(node.module).split(".")[0]


def part(harness: str, folder: str, name: str) -> str:
    return os.path.join(REPO, H_DIR, harness, folder, name)


def routing_files():
    """Every file of the harness side's routing: the tools, and each
    harness's ag_orchestrator and setup."""
    yield from files(T_DIR, ".ts")
    yield from files(T_DIR, ".py")
    for harness in HARNESSES:
        yield part(harness, "ag_orchestrator", "context_manager" + EXT[harness])
        yield part(harness, "setup", "setup" + EXT[harness])


def ts_relative(path: str):
    """(names, the file it resolves to) for each relative import of a TypeScript file."""
    for names, spec in TS_IMPORT.findall(open(path, encoding="utf-8").read()):
        if spec.startswith("."):
            yield names.strip(), os.path.normpath(os.path.join(os.path.dirname(path), spec))


def rel(path):
    return os.path.relpath(path, REPO)


class ContextManagerTest(unittest.TestCase):
    """The context manager's own four packages: ag_interface the contract,
    ag_harness what runs it, ag_policies and ag_pollers what plugs into it."""

    def imports(self, top):
        for path in files(top, ".py"):
            yield path, set(python_imports(path))

    def test_the_interface_imports_none_of_the_others(self):
        for path, imported in self.imports("ag_interface"):
            self.assertEqual(imported & {"ag_harness", "ag_tools", "ag_policies", "ag_pollers"}, set(), rel(path))

    def test_the_tools_import_the_interface_and_themselves_alone(self):
        for path, imported in self.imports("ag_tools"):
            self.assertLessEqual(imported & set(AG_SIDE + HARNESS_SIDE), {"ag_interface", "ag_tools"}, rel(path))

    def test_policies_and_pollers_import_the_interface_and_themselves_alone(self):
        for top in ("ag_policies", "ag_pollers"):
            for path, imported in self.imports(top):
                ours = imported & set(AG_SIDE + HARNESS_SIDE)
                self.assertLessEqual(ours, {"ag_interface", top}, rel(path))
                tree = ast.parse(open(path, encoding="utf-8").read())
                deep = [n.level for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.level]
                self.assertLessEqual(max(deep, default=0), 2 if top == "ag_policies" else 1, rel(path))  # stays inside

    def test_the_interface_defines_no_event_type(self):
        for path in files("ag_interface", ".py"):
            tree = ast.parse(open(path, encoding="utf-8").read())
            made = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and getattr(n.func, "id", "") == "EventType"]
            self.assertEqual(made, [], f"{rel(path)} defines an event type")
            for node in tree.body:
                if isinstance(node, ast.Assign) and isinstance(node.value, (ast.Constant, ast.Tuple)):
                    names = [t.id for t in node.targets if isinstance(t, ast.Name)]
                    self.assertFalse(set(names) & {"TYPES", "USER_MESSAGE", "ENVIRONMENT_UPDATE", "CONTEXT_STREAM"},
                                     f"{rel(path)} defines {names}")

    def test_the_harness_imports_no_policy_or_poller(self):
        for path, imported in self.imports("ag_harness"):
            self.assertEqual(imported & {"ag_policies", "ag_pollers"}, set(), rel(path))

    def test_the_harness_names_no_property(self):
        """What an event's properties are is the policies': no name or string
        in the harness's code (its comments and docs aside) is a channel."""
        for path in files("ag_harness", ".py"):
            with open(path, encoding="utf-8") as fh:
                tokens = list(tokenize.generate_tokens(io.StringIO(fh.read()).readline))
            for tok in tokens:
                docs = tok.type == tokenize.STRING and tok.string.lstrip("rbfu").startswith(('"' * 3, "'" * 3))
                if tok.type == tokenize.NAME or (tok.type == tokenize.STRING and not docs):
                    self.assertNotIn("channel", tok.string.lower(), f"{rel(path)}:{tok.start[0]}")

    def test_the_catalog_names_the_policies_and_pollers_by_class_path(self):
        import tomllib
        from ag.ag_harness.home import TEMPLATE
        cfg = tomllib.loads(TEMPLATE)
        for kind, top in (("policies", "ag_policies"), ("pollers", "ag_pollers")):
            for name, entry in cfg[kind]["available"].items():
                self.assertTrue(entry["class"].startswith(f"ag.{top}."), f"{kind}.{name}: {entry['class']}")


class SidesTest(unittest.TestCase):
    def test_the_harness_side_imports_nothing_of_the_context_manager(self):
        for top in HARNESS_SIDE:
            for path in files(top, ".py"):
                self.assertEqual(set(python_imports(path)) & set(AG_SIDE), set(), rel(path))

    def test_the_harness_side_s_typescript_stays_on_the_harness_side(self):
        inside = tuple(os.path.join(REPO, folder(top)) + os.sep for top in HARNESS_SIDE)
        for top in HARNESS_SIDE:
            for path in files(top, ".ts"):
                for _names, target in ts_relative(path):
                    self.assertTrue(target.startswith(inside), f"{rel(path)} imports {target}")

    def test_the_context_manager_side_imports_no_harness(self):
        for top in AG_SIDE:
            for path in files(top, ".py"):
                self.assertEqual(set(python_imports(path)) & set(HARNESS_SIDE), set(), rel(path))

    def test_there_is_no_adapter_layer_between_them(self):
        self.assertFalse(os.path.exists(os.path.join(REPO, "adapters")))

    def test_the_context_manager_names_no_harness(self):
        for path in (p for top in AG_SIDE for p in files(top, ".py")):
            source = open(path, encoding="utf-8").read()
            for harness in ("codex", "opencode"):
                # openai_codex is OpenAI's SDK, an LLM backend (ag/ag_tools/llm/cli_client.py), not the harness side
                self.assertNotRegex(source, rf"\bimport\s+{harness}\b|from\s+(?!openai_codex\b)\S*{harness}\S*\s+import",
                                    rel(path))

    def test_every_harness_speaks_to_the_same_server(self):
        server = "ag.ag_harness.server"
        for client in ("ag_client.ts", "ag_client.py"):
            self.assertIn(f'"-m", "{server}"', open(os.path.join(REPO, T_DIR, "ag_connection", client)).read())


class FoldersTest(unittest.TestCase):
    def test_integrations_holds_the_harnesses_and_what_they_share(self):
        found = {n for n in os.listdir(os.path.join(REPO, "ag", "integrations")) if n not in ("__init__.py", "__pycache__")}
        self.assertEqual(found, {"harnesses", "tools"})

    def test_harnesses_holds_harnesses_alone(self):
        found = {n for n in os.listdir(os.path.join(REPO, H_DIR)) if n not in ("__init__.py", "__pycache__")}
        self.assertEqual(found, set(HARNESSES))

    def test_each_harness_is_its_ag_orchestrator_adaptor_and_setup(self):
        for harness in HARNESSES:
            found = {n for n in os.listdir(os.path.join(REPO, H_DIR, harness))
                     if n not in ("__init__.py", "__pycache__")}
            self.assertEqual(found, set(PARTS), harness)

    def test_tools_holds_its_three_tools_alone(self):
        found = {n for n in os.listdir(os.path.join(REPO, T_DIR)) if n not in ("__init__.py", "__pycache__")}
        self.assertEqual(found, set(TOOLS))

    def test_the_tools_reach_into_no_harness(self):
        for path in files(T_DIR, ".py"):
            for _level, module in imports_of(path):
                self.assertFalse(module.startswith("integrations.harnesses"), f"{rel(path)} imports {module}")
            tree = ast.parse(open(path, encoding="utf-8").read())
            self.assertFalse([n for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.level > 1], rel(path))
        for path in files(T_DIR, ".ts"):
            for _names, target in ts_relative(path):
                self.assertTrue(target.startswith(os.path.join(REPO, T_DIR) + os.sep),
                                f"{rel(path)} imports {target}")


class RoutingTest(unittest.TestCase):
    def test_every_harness_has_its_two_policy_specific_halves(self):
        for harness in HARNESSES:
            names = ("to_events", "to_messages") if EXT[harness] == ".py" else ("toEvents", "toMessages")
            for module, name in zip(("to_events", "to_messages"), names):
                path = part(harness, "adaptor", module + EXT[harness])
                self.assertRegex(open(path, encoding="utf-8").read(), rf"(def|function) {name}\(", rel(path))

    def test_routing_names_no_event_type(self):
        for path in routing_files():
            source = open(path, encoding="utf-8").read()
            for name in TYPE_NAMES:
                self.assertNotIn(f'"{name}"', source, f"{rel(path)} names {name}")

    def test_each_tool_builds_only_on_the_ones_below_it(self):
        below = {"ag_connection": (), "ag_orchestrator": ("ag_connection",), "hook_server": ()}
        for tool, uses in below.items():
            allowed = tuple(os.path.join(REPO, T_DIR, t) + os.sep for t in (tool, *uses))
            for path in files(os.path.join(T_DIR, tool), ".ts"):
                for _names, target in ts_relative(path):
                    self.assertTrue(target.startswith(allowed), f"{rel(path)} imports {target}")
            for path in files(os.path.join(T_DIR, tool), ".py"):
                for level, module in imports_of(path):
                    if level == 0 and module.startswith("integrations."):
                        self.assertIn(module.split(".")[2], uses, f"{rel(path)} imports {module}")
                    self.assertLess(level, 2, f"{rel(path)} imports {'.' * level}{module}")

    def test_an_orchestrator_reaches_its_adaptor_only_through_its_adaptor_class(self):
        for harness in ("pi", "opencode"):
            path = part(harness, "ag_orchestrator", "context_manager.ts")
            adaptor = os.path.dirname(part(harness, "adaptor", "x")) + os.sep
            for names, target in ts_relative(path):
                if names.startswith("type "):
                    continue                                   # a type, erased: no code reached
                if target.startswith(adaptor):
                    self.assertEqual((target, names), (adaptor + "adaptor.ts", f"{{ {harness.capitalize()}Adaptor }}"),
                                     rel(path))
                else:                                          # the tools' orchestrator and connection alone
                    self.assertTrue(target.startswith((TOOLS_ORCHESTRATOR, TOOLS_CONNECTION)),
                                    f"{rel(path)} imports {target}")
        path = part("codex", "ag_orchestrator", "context_manager.py")
        tree = ast.parse(open(path, encoding="utf-8").read())
        for level, module in imports_of(path):
            if level == 0 and module.startswith("integrations."):
                self.assertTrue(module.startswith(("integrations.tools.ag_orchestrator.", "integrations.tools.ag_connection.")),
                                f"{rel(path)} imports {module}")
        relative = [n for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.level]
        self.assertEqual(sorted((n.level, n.module, [a.name for a in n.names]) for n in relative),
                         [(1, "ag_clients", ["AgClients"]),                       # its own orchestrator's
                          (1, "counting", ["Counter"]),                           # its own orchestrator's
                          (2, "adaptor.adaptor", ["CodexAdaptor"])])

    def test_an_adaptor_class_declares_what_it_outputs_and_accepts(self):
        for harness in ("pi", "opencode"):
            source = open(part(harness, "adaptor", "adaptor.ts"), encoding="utf-8").read()
            for field in ("adaptorName", "outputs", "accepts"):
                self.assertRegex(source, rf"static readonly {field} =", harness)
        source = open(part("codex", "adaptor", "adaptor.py"), encoding="utf-8").read()
        for field in ("name", "outputs", "accepts"):
            self.assertRegex(source, rf"\n    {field} = ", "codex")

    def test_only_its_orchestrator_reaches_an_adaptor_s_code(self):
        interface = TOOLS_ORCHESTRATOR + "adaptor.ts"
        for harness in ("pi", "opencode"):
            adaptor = os.path.dirname(part(harness, "adaptor", "x")) + os.sep
            for folder in ("setup", "adaptor"):
                for path in files(os.path.join(H_DIR, harness, folder), ".ts"):
                    for names, target in ts_relative(path):
                        if target.startswith(adaptor) and folder == "setup":
                            self.assertTrue(names.startswith("type "), f"{rel(path)} imports {names} from the adaptor")
                        if folder == "adaptor":                # the protocol and the adaptor interface, of the tools
                            self.assertTrue(target.startswith(adaptor) or target in (TOOLS_CONNECTION + "protocol.ts",
                                                                                       interface),
                                            f"{rel(path)} imports {target}")
        for path in files(os.path.join(H_DIR, "codex", "setup"), ".py"):
            tree = ast.parse(open(path, encoding="utf-8").read())
            self.assertFalse([n for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)
                              and (n.module or "").startswith("adaptor")], rel(path))
        for level, module in imports_of(part("codex", "adaptor", "adaptor.py")):
            if level == 0 and module.startswith("integrations."):
                self.assertEqual(module, "integrations.tools.ag_orchestrator.adaptor")

    def test_a_setup_reaches_only_its_orchestrator(self):
        for harness in ("pi", "opencode"):
            path = part(harness, "setup", "setup.ts")
            for names, target in ts_relative(path):
                if not names.startswith("type ") and target != TOOLS_ORCHESTRATOR + "adaptor.ts":   # loadAdaptor
                    self.assertEqual(target, part(harness, "ag_orchestrator", "context_manager.ts"), rel(path))
        path = part("codex", "setup", "setup.py")
        setup = open(path, encoding="utf-8").read()
        self.assertIn('HOOK = "ag.integrations.harnesses.codex.ag_orchestrator.context_manager:CodexContextManager"', setup)
        imported = {(n.level, n.module) for n in ast.walk(ast.parse(setup)) if isinstance(n, ast.ImportFrom)}
        self.assertEqual(imported, {(0, "ag.integrations.tools.hook_server")}, rel(path))                  # the hook server


class HookServerTest(unittest.TestCase):
    SERVER = os.path.join(REPO, T_DIR, "hook_server", "hook_server.py")

    def test_the_hook_server_names_no_harness(self):
        tree = ast.parse(open(self.SERVER, encoding="utf-8").read())
        doc = ast.get_docstring(tree) or ""
        code = open(self.SERVER, encoding="utf-8").read().replace(doc, "")     # the docstring may give examples
        for word in ("codex", "thread-id", "prompt_cache_key", "environment_context", '"input"', "/responses"):
            self.assertNotIn(word, code, word)

    def test_codex_s_context_manager_does_not_know_what_calls_it(self):
        path = part("codex", "ag_orchestrator", "context_manager.py")
        tree = ast.parse(open(path, encoding="utf-8").read())
        modules = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
        self.assertFalse(any("hook_server" in m for m in modules), modules)
        self.assertFalse(any(isinstance(n, ast.Import) and any("aiohttp" in a.name for a in n.names)
                             for n in ast.walk(tree)))


SIDE_REF = re.compile(r"(?<!cli\.)harnesses[./][\w./]+")   # not a config key, [cli.harnesses.<name>]


def imports_of(path):
    """(level, module) of every import in a Python file; level 0 for absolute."""
    tree = ast.parse(open(path, encoding="utf-8").read(), path)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            yield from ((0, name_of(alias.name)) for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            yield node.level, name_of(node.module or "") if node.level == 0 else (node.module or "")


class LaunchTest(unittest.TestCase):
    def test_every_harness_has_a_launcher_in_its_setup(self):
        for harness in HARNESSES:
            self.assertTrue(os.path.exists(part(harness, "setup", "launch.py")), harness)

    def test_the_launcher_base_names_no_harness(self):
        path = os.path.join(REPO, "ag", "cli", "launch.py")
        source = open(path, encoding="utf-8").read()
        for harness in HARNESSES:
            self.assertNotRegex(source, rf"\b{harness}\b", f"{rel(path)} names {harness}")

    def test_a_launcher_reaches_the_launcher_base_and_its_setup_alone(self):
        for harness in HARNESSES:
            path = part(harness, "setup", "launch.py")
            for level, module in imports_of(path):
                top = module.split(".")[0]
                if level == 0:
                    self.assertNotIn(top, HARNESS_SIDE + AG_SIDE, f"{rel(path)} imports {module}")
                    if top == "cli":
                        self.assertEqual(module, "cli.launch", f"{rel(path)} imports {module}")
                else:
                    self.assertEqual(level, 1, f"{rel(path)} imports {'.' * level}{module}")   # its setup's own

    def test_of_its_harness_a_launcher_names_the_setup_alone(self):
        for harness in HARNESSES:
            path = part(harness, "setup", "launch.py")
            for ref in SIDE_REF.findall(open(path, encoding="utf-8").read()):
                self.assertRegex(ref, rf"^harnesses[./]{harness}[./]setup([./][\w.]+)?$", f"{rel(path)}: {ref}")

    def test_ag_imports_nothing_of_the_harness_side(self):
        for path in files("cli", ".py"):
            for level, module in imports_of(path):
                top = module.split(".")[0]
                self.assertNotIn(top, HARNESS_SIDE + AG_SIDE, f"{rel(path)} imports {module}")   # found, or run
            for ref in re.findall(r"integrations[./]harnesses[./][\w./]+", open(path, encoding="utf-8").read()):
                self.assertRegex(ref, r"^integrations[./]harnesses[./]\w+[./]setup([./][\w.*]+)?$", f"{rel(path)}: {ref}")

    def test_every_harness_is_in_ag_s_default_config_by_its_launcher_and_adaptor(self):
        import tomllib
        with open(os.path.join(REPO, "ag", "cli", "harnesses.toml"), "rb") as fh:
            entries = tomllib.load(fh)["cli"]["harnesses"]
        self.assertEqual(sorted(entries), sorted(HARNESSES))
        for harness, entry in entries.items():
            module, _, cls = entry["launcher"].partition(":")
            self.assertEqual(module, f"ag.integrations.harnesses.{harness}.setup.launch")
            self.assertIn(f"class {cls}(Launcher)", open(part(harness, "setup", "launch.py"), encoding="utf-8").read())
            where, _, export = entry["adaptor"].rpartition(":") if EXT[harness] == ".ts" else \
                (entry["adaptor"].partition(":")[0].replace(".", "/") + ".py", None, entry["adaptor"].partition(":")[2])
            self.assertEqual(os.path.normpath(os.path.join(REPO, where)), part(harness, "adaptor", "adaptor" + EXT[harness]))
            self.assertRegex(open(os.path.join(REPO, where), encoding="utf-8").read(), rf"class {export}\b")

    def test_ag_names_no_harness(self):
        for name in ("main.py", "config.py"):
            path = os.path.join(REPO, "ag", "cli", name)
            source = open(path, encoding="utf-8").read()
            for harness in HARNESSES:
                self.assertNotRegex(source, rf"\b{harness}\b", f"{rel(path)} names {harness}")


if __name__ == "__main__":
    unittest.main()
