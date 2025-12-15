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

* OpenAI (GPT‑4, GPT‑3.5)
* Claude via OpenRouter (200+ models)
* Local models via **Ollama** (offline & private)

### 🧠 Smart Commit Generation

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

* Memory + disk cache
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

---

## 🛠 Common Commands

```bash
orc commit                 # interactive commit
orc commit --yes           # auto-confirm
orc commit --context "..." # extra context
orc commit --emoji         # gitmoji
orc commit --breaking      # breaking change
orc commit --dry-run       # preview only
```

👉 Full CLI reference: `docs/cli.md`

---

## 🔐 Security Highlights

ORCommit includes **mandatory security checks**:

* 🔍 Secret scanning via **Gitleaks**
* 🚫 Blocks API keys, tokens, private keys
* 🚫 Prevents committing dependency folders

These checks run **before** commit creation and cannot be bypassed accidentally.

👉 Details: `docs/security.md`

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
  "preferences": {
    "defaultProvider": "openrouter",
    "commitFormat": "conventional",
    "temperature": 0.6
  }
}
```

Environment variables are also supported:

```bash
export OPENROUTER_API_KEY="your-key"
export OPENAI_API_KEY="your-key"
```

---

## 📚 Documentation

* CLI Reference → `docs/cli.md`
* Security Model → `docs/security.md`
* Architecture → `docs/architecture.md`
* Advanced Usage → `docs/advanced.md`

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
