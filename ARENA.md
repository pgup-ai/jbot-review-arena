# Model comparison arena

This pull request stays open as the command surface for J-Bot model comparisons.

Post a new comment using:

```text
/compare https://github.com/OWNER/REPOSITORY/pull/123 --models=provider/model-a,provider/model-b
```

Each command freezes the target pull request and runs the requested models independently. Results
are posted back to this pull request; the target repository is never modified.
