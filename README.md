# ORCommit

### AI-powered Git commits with security, standards, and full control

<p align="center">
  <img src="https://unpkg.com/orcommit@latest/preview.png" alt="ORCommit Banner" width="600" />
</p>

> Generate **accurate, conventional, and secure** git commit messages using **OpenAI, Claude, OpenRouter, or local models (Ollama)**.

```bash
git add .
orc commit
```

✔ Conventional Commits
✔ Secret scanning (Gitleaks)
✔ Cloud & local AI
✔ Zero-config to start

<p align="center">
  <a href="https://badge.fury.io/js/orcommit"><img src="https://badge.fury.io/js/orcommit.svg" alt="npm version"></a>
  <a href="https://github.com/ellerbrock/typescript-badges/"><img src="https://badges.frapsoft.com/typescript/code/typescript.svg?v=101" alt="TypeScript"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

---

## TL;DR

**ORCommit** is a production-grade CLI that:

* analyzes your staged git diff
* generates a high-quality commit message via LLMs
* enforces Conventional Commits
* blocks secrets and dependency folders **before** commit
* works with both **cloud and local** AI models

If you care about **clean history, security, and standards** — this tool is for you.

---

## ✨ Key Features

### 🤖 AI Providers

* OpenRouter (200+ models — Gemini, Claude, GPT, and more)
* OpenAI (GPT‑4o, GPT‑4o‑mini)
* Local models via **Ollama** (offline & private)
* **Any OpenAI‑compatible endpoint** — bring your own provider with a custom
  `baseUrl`, API key, model, and auth header (see [Custom providers](#-custom-providers))

Sensible defaults out of the box: `google/gemini-2.5-flash-lite` on OpenRouter
(cheap, fast, great structured output) and `gpt-4o-mini` on OpenAI.

### 🧠 Smart Commit Generation

* **Schema-constrained output** — the model is forced to return valid structured
  JSON (json_schema / constrained decoding), so responses don't need brittle parsing
* **Grounded in your diff** — messages describe only what the diff actually shows,
  no invented or boilerplate changes
* Token-aware diff chunking (large repos supported)
* Interactive regeneration with feedback
* Custom prompts & project context
* Conventional Commits by default

### 🔐 Security by Default

* Secret scanning via **Gitleaks** (100+ patterns)
* Blocks API keys, tokens, private keys
* Prevents committing `node_modules/`, `vendor/`, etc.
* Secure API key storage (600 permissions)

### ⚙️ Git-Native Workflow

* Breaking change detection
* Optional push after commit
* Git hooks support

### ⚡ Fast & Reliable

* Per-repository memory + disk cache (no cross-project message bleed)
* Parallel API calls
* Strict TypeScript + comprehensive tests

---

## 🚀 Quick Start

```bash
npm install -g orcommit
orc config set openrouter YOUR_API_KEY

git add .
orc commit
```

That’s it.

> **Don't use `sudo npm install -g`.** A root-owned global install creates files
> that break every later (non-sudo) update with `EACCES`. If `npm install -g`
> asks for elevated permissions, your npm prefix is system-owned — fix it once
> with a user-owned prefix (no sudo ever again):
>
> ```bash
> mkdir -p ~/.npm-global
> npm config set prefix ~/.npm-global
> echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
> source ~/.zshrc
> ```

### Updating

```bash
npm install -g orcommit@latest
```

orc also tells you when a newer version is available. It never auto-installs and
never asks for sudo.

### Troubleshooting

If `orc` reports the wrong version, won't update, or you suspect duplicate
installs, run the built-in diagnostic — it inspects your npm prefix, every `orc`
on your `PATH`, and the installed-vs-latest version, then prints exact fixes:

```bash
orc doctor
```

---

## 🛠 Common Commands

```bash
orc commit                 # interactive commit
orc commit --yes           # auto-confirm
orc commit --context "..." # extra context
orc commit --emoji         # gitmoji
orc commit --breaking      # breaking change
orc commit --dry-run       # preview only
orc doctor                 # diagnose install / PATH / update issues
```

👉 [Full CLI reference](https://github.com/markolofsen/openrouter-commit/blob/main/docs/cli.md)

---

## 🔐 Security Highlights

ORCommit includes **mandatory security checks**:

* 🔍 Secret scanning via **Gitleaks**
* 🚫 Blocks API keys, tokens, private keys
* 🚫 Prevents committing dependency folders

These checks run **before** commit creation and cannot be bypassed accidentally.

👉 [Security details](https://github.com/markolofsen/openrouter-commit/blob/main/docs/security.md)

---

## 💡 Who Is ORCommit For?

* **Teams** — enforce commit standards automatically
* **Open Source** — keep contribution quality high
* **Enterprise** — prevent leaks and ensure compliance

---

## ⚙️ Configuration

Config is stored at `~/.config/orcommit.json` (permissions `600`).

```json
{
  "providers": {
    "openrouter": {
      "model": "google/gemini-2.5-flash-lite"
    }
  },
  "preferences": {
    "defaultProvider": "openrouter",
    "commitFormat": "conventional",
    "temperature": 0.3
  }
}
```

> A low `temperature` (default `0.3`) keeps messages grounded in the actual diff
> and avoids drifting into generic, memorized phrasings.

Environment variables are also supported:

```bash
export OPENROUTER_API_KEY="your-key"
export OPENAI_API_KEY="your-key"
```

---

## 🔌 Custom providers

Providers are an **open dictionary** — you're not limited to OpenRouter and
OpenAI. Any OpenAI‑compatible `/chat/completions` endpoint works: point ORCommit
at its `baseUrl`, give it a key, a model, and (if it doesn't use
`Authorization: Bearer`) a custom auth header.

```bash
# One command to configure a brand‑new provider:
orc config provider <name> \
  --base-url <url> \
  --key <api-key> \
  --model <model> \
  --auth-header <header>   # optional, default: Authorization
  --auth-scheme <scheme>   # optional, default: Bearer (pass "" to send the key raw)
```

Then commit with it via `-p <name>`, or make it the default:

```bash
orc commit -p <name>
orc config get               # lists every configured provider + its model
orc config remove-provider <name>
```

> Custom providers **must** set `--model` — ORCommit ships default models only
> for the built‑in `openrouter`/`openai` providers; it can't guess a third
> party's catalog.

### Example: cmdop router

[cmdop](https://cmdop.com)'s router is OpenAI‑compatible but authenticates with
an `X-API-Key` header (not `Authorization: Bearer`) and uses quality‑tier model
aliases like `@cheap` / `@fast` / `@balanced` / `@smart`:

```bash
orc config provider cmdop \
  --base-url https://router.cmdop.com/v1 \
  --key YOUR_CMDOP_API_KEY \
  --model @fast \
  --auth-header X-API-Key

orc commit -p cmdop
```

This writes an entry to `~/.config/orcommit.json`:

```json
{
  "providers": {
    "cmdop": {
      "baseUrl": "https://router.cmdop.com/v1",
      "apiKey": "YOUR_CMDOP_API_KEY",
      "model": "@fast",
      "authHeader": "X-API-Key"
    }
  }
}
```

Because `authHeader` is not `Authorization`, the key is sent **raw** (no `Bearer`
prefix). For endpoints that do use bearer auth with a non‑standard scheme, set
`--auth-scheme` instead.

---

## 📚 Documentation

* [CLI Reference](https://github.com/markolofsen/openrouter-commit/blob/main/docs/cli.md)
* [Security Model](https://github.com/markolofsen/openrouter-commit/blob/main/docs/security.md)
* [Architecture](https://github.com/markolofsen/openrouter-commit/blob/main/docs/architecture.md)
* [Advanced Usage](https://github.com/markolofsen/openrouter-commit/blob/main/docs/advanced.md)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests
4. Submit a pull request

---

## 🏢 About the Maintainers

ORCommit is built and maintained by **[Reforms.ai](https://reforms.ai)** — a team specializing in AI-powered developer tools.

Commercial support, consulting, and custom AI integrations are available.

---

## 📄 License

MIT License — see [LICENSE](LICENSE).

---

Built with ❤️ using TypeScript and modern AI tooling.
