import { execSync } from 'child_process';
import { accessSync, constants as fsConstants } from 'fs';
import { join, delimiter } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

/**
 * Self-diagnostics for the `orc` installation.
 *
 * Most "it won't update" / "wrong version" reports are not bugs in orcommit but
 * environment problems: a root-owned global prefix, multiple `orc` binaries on
 * PATH, or a user prefix that isn't on PATH at all. `orc doctor` inspects all of
 * that and prints concrete, copy-pasteable fixes — turning a confusing failure
 * into a one-command answer. It never modifies the system itself.
 */

export interface DoctorCheck {
  readonly name: string;
  readonly status: 'ok' | 'warn' | 'error' | 'info';
  readonly detail: string;
  readonly fix?: string;
}

export interface DoctorReport {
  readonly checks: DoctorCheck[];
  readonly hasProblems: boolean;
}

const BIN_NAME = 'orc';

/** Run a command, returning trimmed stdout or null on any failure. */
function safeExec(command: string): string | null {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 15000,
    }).trim();
  } catch {
    return null;
  }
}

/** All directories on PATH that contain an `orc` executable, in PATH order. */
function findBinariesOnPath(): string[] {
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const found: string[] = [];

  for (const dir of dirs) {
    const candidate = join(dir, BIN_NAME);
    try {
      accessSync(candidate, fsConstants.X_OK);
      found.push(candidate);
    } catch {
      // not here
    }
  }
  return found;
}

export class Doctor {
  constructor(private readonly currentVersion: string) {}

  async run(): Promise<DoctorReport> {
    const checks: DoctorCheck[] = [];

    const prefix = safeExec('npm config get prefix');
    const inHomePrefix = prefix ? prefix.startsWith(homedir()) : false;
    const binaries = findBinariesOnPath();

    // 1. npm global prefix
    if (!prefix) {
      checks.push({
        name: 'npm prefix',
        status: 'warn',
        detail: 'Could not read `npm config get prefix` (is npm installed?).',
      });
    } else if (inHomePrefix) {
      checks.push({
        name: 'npm prefix',
        status: 'ok',
        detail: `${prefix} (user-owned — global installs need no sudo)`,
      });
    } else {
      checks.push({
        name: 'npm prefix',
        status: 'warn',
        detail: `${prefix} (system-owned — global installs may require sudo, which causes permission problems)`,
        fix: [
          'Switch to a user-owned prefix so installs never need sudo:',
          `  mkdir -p ${join(homedir(), '.npm-global')}`,
          `  npm config set prefix ${join(homedir(), '.npm-global')}`,
          `  echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc`,
          '  source ~/.zshrc',
        ].join('\n'),
      });
    }

    // 2. orc binaries on PATH
    if (binaries.length === 0) {
      checks.push({
        name: `${BIN_NAME} on PATH`,
        status: 'error',
        detail: `No \`${BIN_NAME}\` executable found on PATH.`,
        fix: prefix && inHomePrefix
          ? `Ensure ${join(prefix, 'bin')} is on your PATH, then: npm install -g orcommit`
          : 'npm install -g orcommit',
      });
    } else if (binaries.length === 1) {
      checks.push({
        name: `${BIN_NAME} on PATH`,
        status: 'ok',
        detail: `${binaries[0]} (single installation)`,
      });
    } else {
      // Multiple installations — the first on PATH wins, the rest shadow it.
      const active = binaries[0]!;
      const shadowed = binaries.slice(1);

      // The usual culprit is an old system install (e.g. a previous `sudo npm
      // i -g` under /usr/local) coexisting with a newer user-prefix install.
      // Recommend removing the system-owned ones regardless of which is active,
      // since those are what cause the confusion and the EACCES update failures.
      const systemBinaries = binaries.filter(b => !b.startsWith(homedir()));
      const removalLines = systemBinaries.length > 0
        ? systemBinaries.map(b => `  sudo rm -f ${b}`).join('\n')
        : shadowed.map(b => `  rm -f ${b}`).join('\n');

      checks.push({
        name: `${BIN_NAME} on PATH`,
        status: 'error',
        detail:
          `Multiple installations found — the first on PATH wins:\n` +
          `    active:   ${active}\n` +
          shadowed.map(b => `    shadowed: ${b}`).join('\n'),
        fix:
          'Remove the installations you do not want so exactly one remains.\n' +
          'A common cause is an old system install shadowing a newer user one.\n' +
          (systemBinaries.length > 0 ? 'To remove the system install (needs sudo):\n' : 'To remove the extra install:\n') +
          removalLines,
      });
    }

    // 3. Active binary points where we expect (matches the prefix)
    if (prefix && binaries.length >= 1) {
      const expectedBin = join(prefix, 'bin', BIN_NAME);
      const active = binaries[0]!;
      if (active !== expectedBin) {
        checks.push({
          name: 'active binary vs npm prefix',
          status: 'warn',
          detail:
            `The \`${BIN_NAME}\` that runs (${active}) is not the one npm manages ` +
            `(${expectedBin}). Updates via npm may not affect the binary you run.`,
          fix: `Make sure ${join(prefix, 'bin')} comes first on PATH, or remove the other binary.`,
        });
      }
    }

    // 4. Version vs latest on the registry
    const latest = safeExec('npm view orcommit version');
    if (!latest) {
      checks.push({
        name: 'version',
        status: 'info',
        detail: `Installed ${this.currentVersion} (could not reach registry to check latest).`,
      });
    } else if (this.isNewer(latest, this.currentVersion)) {
      checks.push({
        name: 'version',
        status: 'warn',
        detail: `Installed ${this.currentVersion}, latest is ${latest}.`,
        fix: 'npm install -g orcommit@latest',
      });
    } else {
      checks.push({
        name: 'version',
        status: 'ok',
        detail: `${this.currentVersion} (up to date)`,
      });
    }

    const hasProblems = checks.some(c => c.status === 'error' || c.status === 'warn');
    return { checks, hasProblems };
  }

  /** Render a report to the console with colors and fix hints. */
  static print(report: DoctorReport): void {
    const icon: Record<DoctorCheck['status'], string> = {
      ok: chalk.green('✔'),
      warn: chalk.yellow('⚠'),
      error: chalk.red('✗'),
      info: chalk.gray('ℹ'),
    };

    console.log(chalk.bold('\norc doctor\n'));

    for (const check of report.checks) {
      console.log(`${icon[check.status]} ${chalk.bold(check.name)}`);
      for (const line of check.detail.split('\n')) {
        console.log(`  ${chalk.gray(line)}`);
      }
      if (check.fix) {
        console.log(chalk.cyan('  fix:'));
        for (const line of check.fix.split('\n')) {
          console.log(chalk.cyan(`    ${line}`));
        }
      }
      console.log('');
    }

    if (report.hasProblems) {
      console.log(chalk.yellow('Some issues were found — see the fix hints above.\n'));
    } else {
      console.log(chalk.green('Everything looks good. 🎉\n'));
    }
  }

  private isNewer(latest: string, current: string): boolean {
    const a = latest.replace(/^v/, '').split('.').map(Number);
    const b = current.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const l = a[i] || 0;
      const c = b[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }
}
