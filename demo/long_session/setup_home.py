"""setup_home.py <ag> <your config.toml> <scratch AG_HOME>: a scratch ag home for the demo, so your
own is left as it is. It gets the Gatherer's LLM from your config ([policies.llm]) and a policy,
`long_session_demo`: the proactive context manager with a 10,000-token limit, so a session of a
dozen turns goes over it, and section budgets lowered to fit under it."""
import os, subprocess, sys, tomllib

ag, yours, home = sys.argv[1:4]
llm = tomllib.load(open(yours, "rb")).get("policies", {}).get("llm", {})
if not llm.get("model"):
    sys.exit(f"no Gatherer LLM in {yours}: set one with `ag model provider/model` first")
args = [llm["model"]]
if llm.get("api_base"):
    args += ["--api-base", llm["api_base"]]
if llm.get("key_env"):
    args += ["--key-env", llm["key_env"]]
subprocess.run([*ag.split(), "model", *args], check=True, stdout=subprocess.DEVNULL,
               env={**os.environ, "AG_HOME": home})

with open(f"{home}/config.toml", "a") as fh:
    fh.write("""
[policies.available.long_session_demo]  # the demo: a 10,000-token limit, so a short session goes over it
class = "ag.ag_policies.proactive_context_manager:ProactiveContextManager"

[policies.available.long_session_demo.options]
min_context_tokens = 3000
max_context_tokens = 10000
all_task_tokens = 1200
parallel_index_tokens = 600
keep_temporal_relevant_tokens = 800
keep_task_relevant_tokens = 4000
keep_previous_task_tokens = 800
keep_so_far_tokens = 800
keep_pinned_tokens = 300
""")
