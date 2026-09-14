import { CATEGORY_OUTCOMES, isPlayInput } from './volleyball-stats.ts';
import type { PlayInput } from './volleyball-stats.ts';

export const INPUT_HIGHLIGHT_MS = 600;

type Scheduler = {
  schedule: (callback: () => void, delay: number) => () => void;
};

const scheduler: Scheduler = {
  schedule(callback, delay) {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
};

// UI-only acceptance feedback; never serialized with match data.
export class InputHighlight {
  private generation = 0;
  private cancelTimer: (() => void) | null = null;
  private disposed = false;
  private readonly notify: (key: string | null) => void;
  private readonly clock: Scheduler;

  constructor(notify: (key: string | null) => void, clock: Scheduler = scheduler) {
    this.notify = notify;
    this.clock = clock;
  }

  record(input: PlayInput, accept: (input: PlayInput) => boolean): boolean {
    if (this.disposed || !isPlayInput(input) ||
      !CATEGORY_OUTCOMES[input.category].includes(input.outcome)) return false;
    if (!accept(input)) return false;
    if (this.disposed) return true;
    this.invalidate();
    const generation = this.generation;
    this.notify(`${input.category}:${input.outcome}`);
    this.cancelTimer = this.clock.schedule(() => {
      if (this.disposed || generation !== this.generation) return;
      this.cancelTimer = null;
      this.notify(null);
    }, INPUT_HIGHLIGHT_MS);
    return true;
  }

  private invalidate() {
    this.generation++;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  dispose() {
    this.disposed = true;
    this.invalidate();
  }
}
