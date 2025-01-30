#!/usr/bin/env node

import { execSync } from "child_process";
import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import prompts from "prompts";
import { fileURLToPath } from "url";
import chalk from "chalk";
import boxen from "boxen";
import figlet from "figlet";
import semver from "semver";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const packageJson = require("./package.json");

const LIBRARY_NAME = packageJson.name;
const __filename = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);

// 🚀 Ensure '-run' flag is present
if (!args.includes("-run")) {
    console.log(chalk.red.bold(`\nUsage: npx ${LIBRARY_NAME} -run [--env-path <path>]`));
    console.log(chalk.yellow("Missing '-run' argument. Exiting...\n"));
    process.exit(1);
}

// 🌱 Get `.env` path
const envPathIndex = args.indexOf("--env-path");
const envFilePath = envPathIndex !== -1 && args[envPathIndex + 1]
    ? path.resolve(args[envPathIndex + 1])
    : path.resolve(process.cwd(), ".env.openrouter");

// 🎨 Print Header
function displayHeader() {
    console.log(chalk.cyan(figlet.textSync(LIBRARY_NAME, { horizontalLayout: "fitted" })));
    console.log(chalk.blueBright(`🚀 ${LIBRARY_NAME} v${packageJson.version}\n`));
}
displayHeader();

// 📢 Check for Updates
async function checkForUpdates() {
    try {
        const response = await fetch(`https://registry.npmjs.org/${LIBRARY_NAME}/latest`);
        const data = await response.json();
        const latestVersion = data.version;

        if (latestVersion && semver.gt(latestVersion, packageJson.version)) {
            console.log(boxen(
                chalk.yellow.bold("⚠️  Update available!") + "\n" +
                chalk.cyan("Latest version: ") + chalk.greenBright(`v${latestVersion}`) + "\n" +
                chalk.cyan("Your version: ") + chalk.redBright(`v${packageJson.version}`) + "\n\n" +
                chalk.white.bold(`Run: npm update -g ${LIBRARY_NAME}`),
                { padding: 1, borderStyle: "round", borderColor: "yellow" }
            ));
        }
    } catch (error) {
        console.warn(chalk.red("⚠️ Failed to check for updates."));
    }
}
await checkForUpdates();

// 🛠 Load Environment Variables
console.log(chalk.cyan(`🔍 Loading environment variables from: ${envFilePath}\n`));
dotenv.config({ path: envFilePath });

// 🛑 Ignore these files in commits and analysis
const IGNORED_FILES = [
    // Node.js dependencies
    "node_modules/", "package-lock.json", ".npm/",

    // Python dependencies & environments
    "venv/", "env/", "__pycache__/", "*.pyc", "*.pyo", "*.pyd", "Pipfile", "Pipfile.lock", "poetry.lock", ".python-version",

    // Environment variables & secrets
    ".env", ".env.*", ".env.openrouter",

    // Logs & temporary files
    "logs/", "*.log", "npm-debug.log*", "yarn-debug.log*", "debug.log*", "*.swp", "*.swo",

    // Build & cache files
    ".cache/", ".pnp.js", ".pnp.cjs", ".pnp.mjs", "dist/", "build/", "site/", ".pytest_cache/", ".mypy_cache/",

    // Editor & IDE settings
    ".idea/", "*.iml", ".vscode/", ".editorconfig",

    // OS-specific files
    ".DS_Store", "Thumbs.db",

    // Coverage reports
    "coverage/", ".coverage", "htmlcov/", "nosetests.xml", "coverage.xml", "*.cover", "*.py,cover", ".hypothesis/",

    // Git-related files
    ".gitignore", ".gitattributes",

    // CI/CD configuration
    ".github/", ".gitlab/", ".circleci/", ".travis.yml",

    // Jupyter Notebook checkpoints
    ".ipynb_checkpoints/"
];

class GitGPT {
    constructor() {
        this.config = this.loadConfig();
        this.setupExitHandler();
    }

    loadConfig() {
        let config = {
            apiKey: process.env.OPENROUTER_API_KEY || "",
            model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-r1",
        };
        if (!config.apiKey) {
            console.error(chalk.red.bold("\n❌ Missing OpenRouter API key."));
            console.log(chalk.yellow("Follow the setup instructions:"));
            console.log(chalk.blueBright(`📖 https://www.npmjs.com/package/${LIBRARY_NAME}\n`));
            process.exit(1);
        }
        return config;
    }

    setupExitHandler() {
        process.on("SIGINT", () => {
            console.log(chalk.red.bold("\n🚨 Process interrupted. No changes were made."));
            process.exit(0);
        });
        process.on("SIGTERM", () => {
            console.log(chalk.red.bold("\n🚨 Process terminated. No changes were made."));
            process.exit(0);
        });
    }

    fetchGitStatus() {
        console.log(chalk.blue("🔍 Checking Git status..."));
        try {
            const gitStatus = execSync("git status --short", { encoding: "utf-8" }).trim();
            if (!gitStatus) {
                console.log(chalk.green("✅ No changes detected.\n"));
                return [];
            }

            const files = gitStatus
                .split("\n")
                .map(line => line.trim().split(" ").pop())
                .filter(file => !IGNORED_FILES.some(ignored => file.includes(ignored)));

            if (files.length === 0) {
                console.log(chalk.yellow("🛑 No relevant changes detected. Ignored standard files.\n"));
                process.exit(0);
            }

            console.log(boxen(
                chalk.cyan.bold("📂 Changed Files:") + "\n" +
                files.map(file => `  - ${chalk.green(file)}`).join("\n"),
                { padding: 1, borderStyle: "round", borderColor: "cyan" }
            ));
            return files;
        } catch (error) {
            console.error(chalk.red("❌ Failed to retrieve changed files."), error);
            return [];
        }
    }

    
    async generateCommitMessage(diff, changedFiles) {
        console.log(chalk.cyan(`🤖 Generating commit message using model: ${this.config.model}...`));
        const startTime = Date.now();
        try {
            const systemMessage = `
                Generate a concise Git commit message.
                The following files have changed: ${changedFiles.join(", ")}
            `.replace(/\s+/g, " ").trim();

            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.config.apiKey}` },
                body: JSON.stringify({ model: this.config.model, messages: [{ role: "system", content: systemMessage }, { role: "user", content: diff }], temperature: 0.7 }),
            });

            const data = await response.json();
            console.log(chalk.magenta(`⏳ Commit message generated in ${((Date.now() - startTime) / 1000).toFixed(2)} seconds.`));

            return data.choices?.[0]?.message?.content?.trim() || null;
        } catch (error) {
            console.error(chalk.red("❌ Failed to connect to OpenRouter API"), error);
            return null;
        }
    }

    fetchDiffWithLimit(files) {
        const diffs = files.map(file => {
            try {
                const diff = execSync(`git diff ${file}`, { encoding: "utf-8" }).trim();
                return { file, diff: diff.slice(0, 1000) };
            } catch {
                return { file, diff: "" };
            }
        }).filter(item => item.diff.length > 0);

        return diffs.map(d => `${d.file}:\n${d.diff}`).join("\n\n").slice(0, 4000);
    }

    async promptForStaging() {
        const addFiles = await prompts({
            type: "confirm",
            name: "value",
            message: "Would you like to add all changes to the commit?",
            initial: true,
        });
        if (!addFiles.value) {
            console.log(chalk.red("❌ Commit aborted."));
            process.exit(0);
        }
    }

    async pushToGit(commitMessage) {

        commitMessage = commitMessage.trim();

        if(!commitMessage) {
            console.log(chalk.red("❌ No commit message. Exiting..."));
            process.exit(1);
        }
        
        console.log(chalk.green("\n✅ Preparing commit..."));

        const filesToCommit = this.fetchGitStatus();
        const stagedFiles = filesToCommit.map(file => `"${file}"`).join(" ");
        execSync(`git add ${stagedFiles}`, { stdio: "inherit" });

        console.log(chalk.green("\n✅ Committing changes..."));
        execSync(`git commit -m "${commitMessage.replace(/"/g, "'")}" && git push`, { stdio: "inherit" });

        console.log(chalk.green("🎉 Commit created successfully!"));
    }

    async commitChanges() {
        const changedFiles = this.fetchGitStatus();
        if (!changedFiles.length) process.exit(0);

        await this.promptForStaging();
        const diff = this.fetchDiffWithLimit(changedFiles);

        let msg = await this.generateCommitMessage(diff, changedFiles);
        console.log(
            chalk.blue("\n💡 Suggested Commit Message:"),
            boxen(chalk.green.bold(msg), { padding: 1, borderStyle: "round", borderColor: "cyan" })
        );

        const { action } = await prompts({
            type: "select",
            name: "action",
            message: "What would you like to do?",
            choices: [
                { title: "✅ Use AI-generated commit", value: "use" },
                { title: "📝 Enter custom commit", value: "custom" },
                { title: "❌ Exit", value: "exit" },
            ],
        });

        if (action === "custom") {
            const { customMessage } = await prompts({ type: "text", name: "customMessage", message: "Enter your custom commit message:" });
            msg = customMessage || msg;
        } else if (action === "exit") {
            console.log(chalk.red("❌ Commit aborted."));
            process.exit(0);
        }

        this.pushToGit(msg);
    }
}


// 📌 Run the program
(async () => {
    const gitgpt = new GitGPT();
    await gitgpt.commitChanges();
})();
