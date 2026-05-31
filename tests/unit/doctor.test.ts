import { Doctor } from '../../src/modules/doctor.js';

// Mock child_process.execSync (npm prefix + registry version lookups)
jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

// Mock fs.accessSync so we can decide which PATH dirs "contain" an orc binary
jest.mock('fs', () => ({
  accessSync: jest.fn(),
  constants: { X_OK: 1 },
}));

const mockExecSync = require('child_process').execSync as jest.Mock;
const mockAccessSync = require('fs').accessSync as jest.Mock;

const HOME = process.env.HOME || '/Users/test';

/** Make execSync answer the two commands Doctor issues. */
function mockNpm({ prefix, latest }: { prefix: string | null; latest: string | null }) {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd.includes('npm config get prefix')) {
      if (prefix === null) throw new Error('npm not found');
      return prefix;
    }
    if (cmd.includes('npm view orcommit version')) {
      if (latest === null) throw new Error('offline');
      return latest;
    }
    throw new Error(`unexpected command: ${cmd}`);
  });
}

/** Treat only the given dirs as containing an executable `orc`. */
function orcExistsIn(dirs: string[]) {
  mockAccessSync.mockImplementation((p: string) => {
    if (dirs.some(d => p === `${d}/orc`)) return undefined;
    throw new Error('ENOENT');
  });
}

describe('Doctor', () => {
  const originalPath = process.env.PATH;

  afterEach(() => {
    process.env.PATH = originalPath;
    jest.clearAllMocks();
  });

  it('reports all-good for a clean user-prefix single install that is up to date', async () => {
    const prefix = `${HOME}/.npm-global`;
    process.env.PATH = `${prefix}/bin:/usr/bin`;
    mockNpm({ prefix, latest: '1.2.18' });
    orcExistsIn([`${prefix}/bin`]);

    const report = await new Doctor('1.2.18').run();

    expect(report.hasProblems).toBe(false);
    expect(report.checks.find(c => c.name === 'npm prefix')?.status).toBe('ok');
    expect(report.checks.find(c => c.name === 'orc on PATH')?.status).toBe('ok');
    expect(report.checks.find(c => c.name === 'version')?.status).toBe('ok');
  });

  it('flags multiple installations and recommends removing the shadowed one', async () => {
    const prefix = `${HOME}/.npm-global`;
    // System bin first → it shadows the user install
    process.env.PATH = `/usr/local/bin:${prefix}/bin`;
    mockNpm({ prefix, latest: '1.2.18' });
    orcExistsIn(['/usr/local/bin', `${prefix}/bin`]);

    const report = await new Doctor('1.2.18').run();

    const pathCheck = report.checks.find(c => c.name === 'orc on PATH');
    expect(pathCheck?.status).toBe('error');
    expect(pathCheck?.detail).toContain('Multiple installations');
    expect(pathCheck?.fix).toContain('sudo rm -f /usr/local/bin/orc');
    expect(report.hasProblems).toBe(true);
  });

  it('warns when an outdated version is installed', async () => {
    const prefix = `${HOME}/.npm-global`;
    process.env.PATH = `${prefix}/bin`;
    mockNpm({ prefix, latest: '1.3.0' });
    orcExistsIn([`${prefix}/bin`]);

    const report = await new Doctor('1.2.18').run();

    const versionCheck = report.checks.find(c => c.name === 'version');
    expect(versionCheck?.status).toBe('warn');
    expect(versionCheck?.fix).toBe('npm install -g orcommit@latest');
  });

  it('warns about a system-owned prefix and suggests a sudo-free fix', async () => {
    const prefix = '/usr/local';
    process.env.PATH = `${prefix}/bin`;
    mockNpm({ prefix, latest: '1.2.18' });
    orcExistsIn([`${prefix}/bin`]);

    const report = await new Doctor('1.2.18').run();

    const prefixCheck = report.checks.find(c => c.name === 'npm prefix');
    expect(prefixCheck?.status).toBe('warn');
    expect(prefixCheck?.fix).toContain('npm config set prefix');
    // The fix must not rely on a sudo command (the word may appear in prose,
    // but there must be no `sudo <cmd>` invocation).
    expect(prefixCheck?.fix).not.toMatch(/sudo\s+\S/);
  });

  it('errors when no orc binary is on PATH', async () => {
    const prefix = `${HOME}/.npm-global`;
    process.env.PATH = `${prefix}/bin`;
    mockNpm({ prefix, latest: '1.2.18' });
    orcExistsIn([]); // nothing found

    const report = await new Doctor('1.2.18').run();

    const pathCheck = report.checks.find(c => c.name === 'orc on PATH');
    expect(pathCheck?.status).toBe('error');
    expect(report.hasProblems).toBe(true);
  });
});
