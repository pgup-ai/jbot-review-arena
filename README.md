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
commit SHA. Configure spend-capped `OPENROUTER_API_KEY` and `NVIDIA_API_KEY`
repository secrets for the providers you use.

The long-lived arena PR is intentionally content-free; each new `/compare`
comment creates a new immutable sample.
