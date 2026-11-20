"""codex's launcher (ag/integrations/harnesses/codex/setup/launch.py): the provider codex would use and where
it relays, what codex is started with -- and nothing codex reads written --
and the hook servers it starts."""

import json
import os
import unittest
from unittest import mock

from ag.integrations.harnesses.codex.setup import launch as codex
from ag.integrations.harnesses.codex.setup.hook_servers import HookServers, _listening, config_part
from ag.cli.launch import LaunchError
from cli_home import Home


GEMINI = '''model_provider = "gemini"
[model_providers.gemini]
base_url = "http://127.0.0.1:4011/v1"
env_key = "LITELLM_KEY"
wire_api = "responses"
[model_providers.azure]
base_url = "https://example.azure.com/openai/v1"
[profiles.work]
model_provider = "azure"
'''

NO_COMPACTION = ["-c", "model_auto_compact_token_limit=1000000000000000"]     # codex's own compaction off


class Plan(Home):
    def codex_config(self, text: str) -> str:
        path = os.path.join(self.codex_home, "config.toml")
        with open(path, "w") as fh:
            fh.write(text)
        return path


    def test_the_provider_codex_would_use(self):
        self.codex_config(GEMINI)
        p = codex.plan(["exec", "hi"], {}, dict(os.environ))
        self.assertEqual((p.provider, p.upstream, p.path), ("gemini", "http://127.0.0.1:4011", "/v1"))
        self.assertEqual(p.argv(["codex"], "http://127.0.0.1:4013", "demo"),
                         ["codex", *NO_COMPACTION, "-c",
                          'model_providers.gemini.base_url="http://127.0.0.1:4013/h/demo/v1"', "exec", "hi"])
        self.assertEqual(p.base_url("http://127.0.0.1:4013", None), "http://127.0.0.1:4013/v1")

    def test_arguments_and_profiles_choose_it(self):
        self.codex_config(GEMINI)
        env = dict(os.environ)
        self.assertEqual(codex.plan(["-c", "model_provider=azure"], {}, env).provider, "azure")
        self.assertEqual(codex.plan(["--config=model_provider=\"azure\""], {}, env).provider, "azure")
        work = codex.plan(["-p", "work", "exec"], {}, env)
        self.assertEqual((work.provider, work.upstream, work.path),
                         ("azure", "https://example.azure.com", "/openai/v1"))
        self.assertEqual(codex.plan([], {"provider": "azure"}, env).provider, "azure")    # [cli.harnesses.codex]'s

    def test_a_base_url_in_the_arguments_is_where_it_relays_and_is_taken_out(self):
        self.codex_config(GEMINI)
        p = codex.plan(["-c", 'model_providers.gemini.base_url="http://10.0.0.1:9/api"', "exec", "x"], {},
                       dict(os.environ))
        self.assertEqual((p.upstream, p.path, p.args), ("http://10.0.0.1:9", "/api", ["exec", "x"]))

    def test_codex_s_built_in_openai_by_its_openai_base_url(self):
        self.codex_config('model = "gpt"\n')
        env = dict(os.environ)
        p = codex.plan(["exec", "hi"], {}, env)                                       # an API key: the API
        self.assertEqual((p.provider, p.upstream, p.path), ("openai", "https://api.openai.com", "/v1"))
        self.assertEqual(p.argv(["codex"], "http://127.0.0.1:4013", "demo"),
                         ["codex", *NO_COMPACTION, "-c", 'openai_base_url="http://127.0.0.1:4013/h/demo/v1"',
                          "exec", "hi"])
        with open(os.path.join(self.codex_home, "auth.json"), "w") as fh:            # a ChatGPT login
            json.dump({"auth_mode": "chatgpt", "tokens": {"access_token": "t"}}, fh)
        p = codex.plan([], {}, env)
        self.assertEqual((p.upstream, p.path), ("https://chatgpt.com", "/backend-api/codex"))
        self.codex_config('openai_base_url = "http://10.0.0.1:9/v1"\n')             # config.toml's
        self.assertEqual(codex.plan([], {}, env).upstream, "http://10.0.0.1:9")
        p = codex.plan(["-c", 'openai_base_url="http://10.0.0.2:9/api"', "exec"], {}, env)   # the arguments'
        self.assertEqual((p.upstream, p.path, p.args), ("http://10.0.0.2:9", "/api", ["exec"]))

    def test_codex_s_local_providers_by_its_environment(self):
        self.codex_config('model = "gpt-oss:20b"\n')
        env = {k: v for k, v in os.environ.items() if not k.startswith("CODEX_OSS_")}
        p = codex.plan(["-c", "model_provider=ollama", "exec", "hi"], {}, env)
        self.assertEqual((p.provider, p.upstream, p.path), ("ollama", "http://localhost:11434", "/v1"))
        self.assertEqual(p.argv(["codex"], "http://127.0.0.1:4013", "demo"),
                         ["codex", *NO_COMPACTION, "-c", "model_provider=ollama", "exec", "hi"])   # not a -c: the env
        self.assertEqual(p.env({"A": "1"}, "http://127.0.0.1:4013", "demo"),
                         {"A": "1", "CODEX_OSS_BASE_URL": "http://127.0.0.1:4013/h/demo/v1"})
        self.assertEqual(codex.plan(["--oss", "--local-provider=lmstudio"], {}, env).upstream,
                         "http://localhost:1234")
        self.codex_config('oss_provider = "ollama"\n')
        self.assertEqual(codex.plan(["--oss"], {}, {**env, "CODEX_OSS_PORT": "9"}).upstream, "http://localhost:9")
        self.assertEqual(codex.plan(["--oss"], {}, {**env, "CODEX_OSS_BASE_URL": "http://10.0.0.1:5/v1"}).upstream,
                         "http://10.0.0.1:5")

    def test_what_it_cannot_hook(self):
        self.codex_config('model = "gpt"\n')
        env = dict(os.environ)
        with self.assertRaisesRegex(LaunchError, "signs each request"):
            codex.plan(["-c", "model_provider=amazon-bedrock"], {}, env)
        with self.assertRaisesRegex(LaunchError, "not defined"):
            codex.plan(["-c", "model_provider=nowhere"], {}, env)
        with self.assertRaisesRegex(LaunchError, "--local-provider"):
            codex.plan(["--oss"], {}, env)                                            # oss_provider unset

    def test_codex_s_own_compaction_is_off_for_the_run(self):
        self.codex_config(GEMINI)
        p = codex.plan(["exec", "hi"], {}, dict(os.environ))
        self.assertTrue(p.compaction_off)
        self.assertEqual(p.argv(["codex"], "http://127.0.0.1:4013", None)[1:3], NO_COMPACTION)

    def test_a_compaction_limit_of_the_user_s_own_stays(self):
        env = dict(os.environ)
        self.codex_config(GEMINI)
        given = codex.plan(["-c", "model_auto_compact_token_limit=50000", "exec"], {}, env)        # the arguments'
        self.codex_config(GEMINI.replace('[profiles.work]\n', '[profiles.work]\nmodel_auto_compact_token_limit = 40000\n'))
        profile = codex.plan(["-p", "work"], {}, env)                                              # the profile's
        self.codex_config("model_auto_compact_token_limit = 30000\n" + GEMINI)
        configured = codex.plan([], {}, env)                                                      # config.toml's
        for p, limit in ((given, 50000), (profile, 40000), (configured, 30000)):
            self.assertFalse(p.compaction_off)
            self.assertNotIn(NO_COMPACTION[1], p.argv(["codex"], "http://127.0.0.1:4013", None))
            self.assertTrue(any(f"model_auto_compact_token_limit={limit}" in n for n in p.notes), p.notes)
        self.assertIn("model_auto_compact_token_limit=50000", given.argv(["codex"], "http://127.0.0.1:4013", None))

    def test_other_wire_apis_are_noted(self):
        self.codex_config('model_provider = "c"\n[model_providers.c]\nbase_url = "http://h/v1"\nwire_api = "chat"\n')
        self.assertIn("wire_api", codex.plan([], {}, dict(os.environ)).notes[0])

    def test_the_thread_a_resume_opens_is_known_so_ag_claims_it(self):
        self.codex_config(GEMINI)
        env, thread = dict(os.environ), "01a174b3-97cf-7663-9a49-842b19cf2a67"
        for args in (["resume", thread], ["-m", "m", "--no-alt-screen", "resume", thread],
                     ["exec", "--json", "-m", "resume", "resume", thread, "-"]):         # a model named "resume"
            self.assertEqual(codex.plan(args, {}, env).session, thread, args)
        for args in ([], ["exec", "hi"], ["resume"], ["resume", "--last"], ["exec", "resume", "--last", "-"],
                     ["-m", "resume", thread]):                                          # new, or not said which
            self.assertIsNone(codex.plan(args, {}, env).session, args)

    def test_a_run_names_itself_in_the_url_and_a_dry_run_does_not(self):
        from ag.cli.launch import Run
        self.codex_config(GEMINI)
        launcher = codex.CodexLauncher(dict(codex.CodexLauncher.defaults), self.home)
        launcher.servers.start = lambda *a, **k: type("Server", (), {"url": "http://127.0.0.1:4013"})()
        launcher.servers.running = lambda: []
        run = lambda dry: Run(["exec", "hi"], ["codex"], dict(os.environ), "demo", "/w", dry_run=dry)
        url = 'model_providers.gemini.base_url="http://127.0.0.1:4013/h/demo{}' + config_part(self.codex_home) + '/l/244800/v1"'
        self.assertIn(url.format(f"/r/{os.getpid()}"), launcher.launch(run(False)).argv)   # codex's process, once exec'd;
        self.assertIn(url.format(""), launcher.launch(run(True)).argv)                     # its home, where its rollouts are
        mine = Run(["exec", "hi"], ["codex"], dict(os.environ), "demo", "/w", channel="dash-1")
        self.assertIn(url.format(f"/r/{os.getpid()}/a/dash-1"), launcher.launch(mine).argv)   # its thread's channel, chosen

    def test_codex_runs_without_its_background_server_where_it_can(self):
        self.codex_config(GEMINI)
        env = dict(os.environ)
        for args, given, first in (([], True, "--no-daemon"), (["exec", "hi"], True, "--no-daemon"),
                                   (["--no-daemon", "resume", "t"], True, "-c"),       # said already: not twice
                                   (["exec", "hi"], False, "-c")):                   # a codex without it
            p = codex.plan(args, {}, env)
            p.daemonless = given
            argv = p.argv(["codex"], "http://127.0.0.1:4013", "demo")
            self.assertEqual((argv[1], argv.count("--no-daemon")), (first, int(given or "--no-daemon" in args)), args)
        fake = os.path.join(self.tmp, "fake-codex")
        for helps, expect in (("  --no-daemon  Run without the shared background server", True), ("  --no-daemonize", False)):
            with open(fake, "w") as fh:
                fh.write(f"#!/bin/sh\necho '{helps}'\n")
            os.chmod(fake, 0o755)
            self.assertEqual(codex.takes([fake], env, "--no-daemon"), expect)
        self.assertFalse(codex.takes([os.path.join(self.tmp, "none")], env, "--no-daemon"))

    def test_dry_run_writes_nothing_codex_reads(self):
        path = self.codex_config(GEMINI)
        before = self.read(path)
        code, out, err = self.run_ag("--dry-run", "--gatherer", "demo", "codex", "exec", "hi")
        self.assertEqual(code, 0, err)
        self.assertIn(f'model_providers.gemini.base_url="http://127.0.0.1:4013/h/demo{config_part(self.codex_home)}/l/244800/v1"', out)
        self.assertIn("model_auto_compact_token_limit=1000000000000000", out)
        self.assertNotIn("AG_GATHERER", out)                                              # the URL carries it
        self.assertEqual(self.read(path), before)
        self.assertEqual(os.listdir(self.codex_home), ["config.toml"])
        with open(os.path.join(self.home, "config.toml")) as fh:                       # ag's own, in its home
            text = fh.read()
        self.assertIn("[cli.harnesses.codex]", text)
        self.assertIn("[policies.available.proactive_context_manager]", text)                              # beside the catalog           # ag's own, in its home


class Lifecycle(Home):
    def test_one_started_with_another_adaptor_is_not_shared(self):
        port = 46000 + os.getpid() % 1000
        setup, servers = codex.SETUP, HookServers(self.home)
        mine = {"adaptor": "ag.integrations.harnesses.codex.adaptor.adaptor:CodexAdaptor"}
        server = servers.start(setup, "http://127.0.0.1:9", port, options=mine)
        self.addCleanup(servers.stop, server)
        self.assertEqual(server.options, mine)
        with open(os.path.join(servers.directory, f"{server.port}.json")) as fh:
            self.assertIn("CodexAdaptor", fh.read())                                  # recorded
        self.assertEqual(servers.find(setup, "http://127.0.0.1:9", "", mine).pid, server.pid)
        self.assertIsNone(servers.find(setup, "http://127.0.0.1:9", "", {"adaptor": "other:Adaptor"}))

    def test_started_once_shared_then_stopped(self):
        port = 47000 + os.getpid() % 1000
        setup, servers = codex.SETUP, HookServers(self.home)
        server = servers.start(setup, "http://127.0.0.1:9", port)
        self.addCleanup(servers.stop, server)
        self.assertTrue(_listening(server.port))
        self.assertEqual(servers.start(setup, "http://127.0.0.1:9", port).pid, server.pid)       # shared
        other = servers.start(setup, "http://127.0.0.1:10", port)                               # another upstream
        self.addCleanup(servers.stop, other)
        self.assertNotEqual(other.port, server.port)
        self.assertEqual({s.port for s in servers.running()}, {server.port, other.port})
        self.assertEqual(len(codex.CodexLauncher({}, self.home).status()), 2)
        code, out, _ = self.run_ag("stop")
        self.assertEqual(code, 0)
        self.assertEqual(servers.running(), [])

    def test_not_stopped_from_a_session_that_calls_through_it_unless_forced(self):
        port = 48000 + os.getpid() % 1000
        servers = HookServers(self.home)
        server = servers.start(codex.SETUP, "http://127.0.0.1:9", port)
        self.addCleanup(servers.stop, server)
        with mock.patch.dict(os.environ, {"OPENAI_BASE_URL": f"{server.url}/h/g/r/1"}):
            code, out, err = self.run_ag("stop")
            self.assertEqual(code, 1)
            self.assertIn(f"calls its model through {server.url}", err)
            self.assertEqual([s.port for s in servers.running()], [server.port])        # still serving it
            code, out, _ = self.run_ag("stop", "--force")
        self.assertEqual(code, 0)
        self.assertIn(f"stopped the hook server :{server.port}", out)
        self.assertEqual(servers.running(), [])
        self.assertEqual(self.run_ag("stop", "--now")[0], 1)                         # no other option

    def test_a_launcher_lists_and_stops_only_its_own_harness_servers(self):
        port = 45000 + os.getpid() % 1000
        servers = HookServers(self.home)
        server = servers.start(codex.SETUP, "http://127.0.0.1:9", port)
        self.addCleanup(servers.stop, server)
        # another harness's, recorded in the same directory (this process's pid: alive, and never signalled)
        other = os.path.join(servers.directory, "1.json")
        with open(other, "w", encoding="utf-8") as fh:
            json.dump({"port": 1, "pid": os.getpid(), "upstream": "http://127.0.0.1:11",
                       "setup": "ag.integrations.harnesses.claude.setup.setup"}, fh)
        self.addCleanup(lambda: os.path.exists(other) and os.remove(other))
        launcher = codex.CodexLauncher({}, self.home)
        self.assertEqual([line.split()[2] for line in launcher.status()], [f":{server.port}"])
        self.assertEqual(launcher.stop(), [f"stopped the hook server :{server.port} (-> http://127.0.0.1:9)"])
        self.assertEqual([s.port for s in servers.running()], [1])                     # the other harness's, kept

    def test_one_that_fails_to_start_says_why(self):
        with self.assertRaisesRegex(RuntimeError, "did not start"):
            HookServers(self.home).start("no.such.module", "http://127.0.0.1:9", 47999 - os.getpid() % 1000)

if __name__ == "__main__":
    unittest.main()
