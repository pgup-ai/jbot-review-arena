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

The workflow resolves the latest J-Bot image to an immutable digest and records
its source commit in every comparison. All repository-accessible secrets except
Actions' built-in GitHub token aliases reach the trusted image, so scope them
narrowly and cap spend. Secret names must match the credential environment
names accepted by the pinned J-Bot image.

The long-lived arena PR is intentionally content-free; each new `/compare`
comment creates a new immutable sample.
