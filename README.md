# J-Bot Review Arena

Experimental model comparison harness for [J-Bot Review](https://github.com/pgup-ai/jbot-review).

On a pull request in this repository, an authorized collaborator can run:

```text
/compare https://github.com/OWNER/REPO/pull/123 --models=openrouter/model-a,nvidia/model-b
```

The workflow freezes the public target PR and J-Bot image, runs one isolated
worker per model, and posts a comparison plus full model reports back to the
arena PR. Target repositories are never modified.

## Repository configuration

The workflow resolves the latest J-Bot image to an immutable digest for every
comparison. All repository-accessible secrets and variables except Actions'
built-in GitHub token aliases reach the trusted image, so scope secrets narrowly
and cap spend. Names must match the environment names accepted by the pinned
J-Bot image.

The long-lived arena PR is intentionally content-free; each new `/compare`
comment creates a new immutable sample.

CommandCode tool access is frozen in `reviewConfig.commandCodeTools` and retained
in result provenance. Set the Arena repository variable `JBOT_COMMANDCODE_TOOLS`
to `false` to disable it; unset or blank enables it. This requires a J-Bot image
containing the manifest support from [jbot-review #206](https://github.com/pgup-ai/jbot-review/pull/206).
