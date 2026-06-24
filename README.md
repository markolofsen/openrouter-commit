# ORCommit

### AI-powered git commit messages — secure, conventional, multi-provider

<p align="center">
  <img src="https://unpkg.com/orcommit@latest/preview.png" alt="ORCommit Banner" width="600" />
</p>

```bash
git add .
orc commit
```

ORCommit reads your staged diff and writes a clean, [Conventional Commit](https://www.conventionalcommits.org/) message for you — using OpenRouter, OpenAI, a local model (Ollama), or any OpenAI-compatible API. It scans for secrets before committing, so you don't leak keys into git history.

<p align="center">
  <a href="https://badge.fury.io/js/orcommit"><img src="https://badge.fury.io/js/orcommit.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

---

## Install

```bash
npm install -g orcommit
```

> **Never use `sudo npm install -g`.** A root-owned install breaks every later
> update with `EACCES`. If the install asks for elevated permissions, fix your
> npm prefix once (no sudo ever again):
>
> ```bash
> mkdir -p ~/.npm-global
> npm config set prefix ~/.npm-global
> echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
> source ~/.zshrc
> ```

Update with `npm install -g orcommit@latest`. ORCommit tells you when a new
version exists — it never auto-installs and never asks for sudo.

---

## Setup (60 seconds)

Pick a provider and give it a key.

**OpenRouter** (recommended — 200+ models, one key):

```bash
orc config set openrouter YOUR_API_KEY
```

**OpenAI:**

```bash
orc config set openai YOUR_API_KEY
```

Then commit:

```bash
git add .
orc commit
```

That's it. **Whichever provider you configure last becomes the active one** —
configure a key (or a custom provider), and it's immediately used. You normally
keep just one active provider and never think about it.

---

## How it works

When you run `orc commit`, ORCommit:

1. **Reads** your staged diff (`git add` first — it only looks at staged changes).
2. **Scans** it for secrets with Gitleaks. If it finds an API key, token, or
   private key, it **stops** — nothing is committed.
3. **Sends** the diff to your AI provider, which returns a structured commit
   message (schema-constrained JSON, so no brittle text parsing).
4. **Shows** you the message. You confirm, regenerate with feedback, or edit it.
5. **Commits** (and optionally pushes).

Large diffs are chunked automatically, and messages are cached per-repository so
the same diff isn't re-billed.

---

## Everyday commands

```bash
orc commit                  # interactive — review before committing
orc commit -y               # auto-confirm, skip the prompt
orc commit -p openai        # use a specific provider for this commit
orc commit --dry-run        # generate the message, don't commit
orc commit --context "..."  # give the AI extra context
orc commit --emoji          # gitmoji style
orc commit --breaking       # mark as a breaking change
```

| Command | What it does |
|---|---|
| `orc commit` | Generate and create a commit |
| `orc config` | Manage providers and settings |
| `orc test [provider]` | Check a provider's connection works |
| `orc doctor` | Diagnose install / PATH / update problems |
| `orc cache` | Manage the commit-message cache |

Full flag list: `orc commit --help`.

---

## Managing providers

See everything that's configured:

```bash
orc config get              # all providers + the current default
orc config path             # where the config file lives
```

Set or change a key / model on an existing provider:

```bash
orc config set <provider> <api-key>
orc config model <provider> <model>
```

Add **any OpenAI-compatible endpoint** as a custom provider:

```bash
orc config provider <name> \
  --base-url <url> \
  --key <api-key> \
  --model <model> \
  --auth-header <header>   # optional — default: Authorization
  --auth-scheme <scheme>   # optional — default: Bearer (pass "" to send the key raw)
```

> Custom providers **must** set `--model`. ORCommit only ships default models for
> the built-in `openrouter` and `openai` providers — it can't guess a third
> party's catalog.

Use a provider for one commit, or remove it:

```bash
orc commit -p <name>
orc config remove-provider <name>     # can't remove the current default — switch first
```

### Switching the active provider

Configuring a provider already makes it active, so usually there's nothing to
do. To switch back to an already-configured provider (e.g. your default ran out
of credit and you want to use another one you'd set up earlier):

```bash
orc config default <name>
```

Or pass `-p <name>` on a single commit without changing the active provider.

Removing the active provider automatically falls back to another configured one
— you never end up with the default pointing at a provider that's gone.

---

## Example: a custom provider (cmdop)

[cmdop](https://cmdop.com)'s router is fully OpenAI-compatible — it authenticates
with the standard `Authorization: Bearer` header and uses quality-tier model
aliases like `@cheap` / `@fast` / `@balanced` / `@smart`. So you add it like any
other provider, no extra flags:

```bash
orc config provider cmdop \
  --base-url https://router.cmdop.com/v1 \
  --key YOUR_CMDOP_API_KEY \
  --model @fast

orc commit -p cmdop
```

This adds an entry to `~/.config/orcommit.json`:

```json
{
  "providers": {
    "cmdop": {
      "baseUrl": "https://router.cmdop.com/v1",
      "apiKey": "YOUR_CMDOP_API_KEY",
      "model": "@fast"
    }
  }
}
```

> Need a non-standard auth header (a provider that wants the key in `X-API-Key`
> instead of `Authorization: Bearer`)? Add `--auth-header X-API-Key` — see
> [Custom providers](#managing-providers) above. cmdop doesn't need it.

---

## Configuration

Config lives at `~/.config/orcommit.json` (permissions `600`). A minimal file:

```json
{
  "providers": {
    "openrouter": { "model": "google/gemini-2.5-flash-lite" }
  },
  "preferences": {
    "defaultProvider": "openrouter",
    "commitFormat": "conventional",
    "temperature": 0.3
  }
}
```

> A low `temperature` (default `0.3`) keeps messages grounded in the actual diff
> instead of drifting into generic phrasing.

API keys can also come from the environment:

```bash
export OPENROUTER_API_KEY="your-key"
export OPENAI_API_KEY="your-key"
```

Defaults out of the box: `google/gemini-2.5-flash-lite` on OpenRouter (cheap,
fast, good structured output) and `gpt-4o-mini` on OpenAI.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `402 Insufficient credits` | Your provider is out of credit. Top up, switch with `orc config default <name>`, or commit once via `-p <name>`. |
| Wrong version / won't update / duplicate installs | Run `orc doctor`. |
| Provider not responding | Run `orc test <provider>` to check the connection. |

---

## Documentation

* [CLI Reference](https://github.com/markolofsen/openrouter-commit/blob/main/docs/cli.md)
* [Security Model](https://github.com/markolofsen/openrouter-commit/blob/main/docs/security.md)
* [Architecture](https://github.com/markolofsen/openrouter-commit/blob/main/docs/architecture.md)
* [Advanced Usage](https://github.com/markolofsen/openrouter-commit/blob/main/docs/advanced.md)

---

## About

ORCommit is built and maintained by **[Reforms.ai](https://reforms.ai)**.
Commercial support and custom AI integrations are available.

MIT License — see [LICENSE](LICENSE).
