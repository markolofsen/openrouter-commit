import { ProgressIndicator } from '../../src/modules/logger.js';

describe('ProgressIndicator', () => {
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    jest.useRealTimers();
  });

  it('should clear all timers on succeed to avoid hanging process exit', () => {
    const indicator = new ProgressIndicator('Analyzing changes', false);

    // One delayed spinner timer + one max duration timeout timer.
    expect(jest.getTimerCount()).toBe(2);

    indicator.succeed('Done');

    // Regression check: no pending timeout handles should remain.
    expect(jest.getTimerCount()).toBe(0);
  });
});
