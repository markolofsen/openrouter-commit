// Jest custom matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidCommitMessage(): R;
      toBeApiKey(): R;
    }
  }
  
  function advanceTime(ms: number): void;
  function flushPromises(): Promise<void>;
}

export {};
