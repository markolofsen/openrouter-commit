import { execSync } from "child_process";
import chalk from "chalk";
import boxen from "boxen";
import { IGNORED_FILES } from "./constants.js";
import prompts from "prompts";
import path from "path";



export async function fetchGitStatus() {
    console.log(chalk.blue("🔍 Checking Git status..."));

    try {
        const gitStatus = execSync("git status --short", { encoding: "utf-8" }).trim();
        if (!gitStatus) {
            console.log(chalk.green("✅ No changes detected.\n"));
            return [];
        }

        const cwd = process.cwd();
        let files = gitStatus.split("\n").map(line => {
            const parts = line.trim().split(/\s+/);
            const status = parts[0];
            const filePath = parts.slice(1).join(" ");
            const relativePath = path.relative(cwd, path.resolve(cwd, filePath)).trim();

            // console.debug(`DEBUG: Status = ${status}, File = "${relativePath}"`);

            return { status, filePath: relativePath };
        });

        // Filter out ignored files
        files = files.filter(f => !IGNORED_FILES.some(ignored => f.filePath.includes(ignored)));

        if (files.length === 0) {
            console.log(chalk.yellow("🛑 No relevant changes detected. Ignored standard files.\n"));
            process.exit(0);
        }

        // Split into modified and deleted files
        const modifiedFiles = files.filter(f => f.status !== "D");
        const deletedFiles = files.filter(f => f.status === "D");

        if (modifiedFiles.length) {
            const maxWidth = Math.max(...modifiedFiles.map(f => f.filePath.length), 20);
            const formattedFiles = modifiedFiles.map(f => `  - ${chalk.green(f.filePath.padEnd(maxWidth))}`);

            console.log(boxen(
                `${chalk.cyan.bold("Changed Files")}` + "\n" + formattedFiles.join("\n"),
                { padding: 1, margin: 1, borderStyle: "round", borderColor: "cyan" }
            ));
        }

        if (deletedFiles.length) {
            const maxWidth = Math.max(...deletedFiles.map(f => f.filePath.length), 20);
            const formattedDeletedFiles = deletedFiles.map(f => `  ❌ ${chalk.red(f.filePath.padEnd(maxWidth))}`);

            console.log(boxen(
                `${chalk.yellow.bold("Deleted Files")}` + "\n" + formattedDeletedFiles.join("\n"),
                { padding: 1, margin: 1, borderStyle: "round", borderColor: "red" }
            ));

            const { confirmDelete } = await prompts({
                type: "confirm",
                name: "confirmDelete",
                message: "Do you want to commit these deletions?",
                initial: true,
            });

            if (!confirmDelete) {
                console.log(chalk.yellow("🚫 Skipping deleted files."));
                files = files.filter(f => f.status !== "D");
            }
        }

        return files.map(f => f.filePath);

    } catch (error) {
        console.error(chalk.red("❌ Failed to retrieve changed files."), error);
        return [];
    }
}


export function commitAndPush(commitMessage) {
    commitMessage = commitMessage.trim();
    
    if (!commitMessage) {
        console.log(chalk.red("❌ Empty commit message. Commit aborted."));
        process.exit(0);
    }

    console.log(chalk.green("\n✅ Staging all changes (including deletions)..."));
    execSync("git add -A", { stdio: "inherit" }); // ✅ Now correctly includes deleted files

    console.log(chalk.green("\n✅ Committing changes..."));
    execSync(`git commit -m "${commitMessage.replace(/"/g, "'")}"`, { stdio: "inherit" });

    console.log(chalk.blue("\n📤 Pushing to remote..."));
    execSync("git push", { stdio: "inherit" });

    console.log(chalk.green("🎉 Commit created and pushed successfully!"));
}
