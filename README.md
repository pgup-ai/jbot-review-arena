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

Set repository variable `JBOT_COMMIT_SHA` to a published 40-character J-Bot
commit SHA. Configure spend-capped organization secrets using the environment
names accepted by that image; J-Bot resolves the requested model and credential.

The long-lived arena PR is intentionally content-free; each new `/compare`
comment creates a new immutable sample.
