export type Category = 'serve' | 'reception' | 'block' | 'dig' | 'spike';

export type Outcome =
  | 'success'
  | 'ace'
  | 'miss'
  | 'failure'
  | 'regular';

export type PlayInput = Readonly<{
  category: Category;
  outcome: Outcome;
}>;

export type CategoryCounts = Readonly<Record<string, number> & { total: number }>;

export type MatchCounts = Readonly<Record<Category, CategoryCounts>>;

export type MatchState = Readonly<{
  counts: MatchCounts;
  history: readonly PlayInput[];
}>;

export type MatchAction =
  | Readonly<{ type: 'record'; input: PlayInput }>
  | Readonly<{ type: 'undo' }>
  | Readonly<{ type: 'restore'; history: readonly PlayInput[] }>;

export const CATEGORY_LABELS: Record<Category, string> = {
  serve: 'サーブ',
  reception: 'レセプション',
  block: 'ブロック',
  dig: 'ディグ',
  spike: 'スパイク',
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  success: '成功',
  ace: 'エース',
  miss: 'ミス',
  failure: '失敗',
  regular: '通常',
};

export const CATEGORY_OUTCOMES: Record<Category, readonly Outcome[]> = {
  serve: ['success', 'ace', 'miss'],
  reception: ['success', 'miss'],
  block: ['success', 'failure'],
  dig: ['success', 'miss'],
  spike: ['success', 'regular', 'miss'],
};

export const createInitialState = (): MatchState => ({
  counts: {
    serve: { total: 0, success: 0, ace: 0, miss: 0 },
    reception: { total: 0, success: 0, miss: 0 },
    block: { total: 0, success: 0, failure: 0 },
    dig: { total: 0, success: 0, miss: 0 },
    spike: { total: 0, success: 0, regular: 0, miss: 0 },
  },
  history: [],
});

export function isPlayInput(value: unknown): value is PlayInput {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { category?: unknown; outcome?: unknown };
  if (typeof candidate.category !== 'string' || typeof candidate.outcome !== 'string') {
    return false;
  }

  const outcomes = CATEGORY_OUTCOMES[candidate.category as Category];
  return Boolean(outcomes?.includes(candidate.outcome as Outcome));
}

const updateCount = (
  counts: MatchCounts,
  input: PlayInput,
  amount: 1 | -1,
): MatchCounts => {
  const current = counts[input.category];

  return {
    ...counts,
    [input.category]: {
      ...current,
      total: current.total + amount,
      [input.outcome]: current[input.outcome] + amount,
    },
  };
};

export function matchReducer(state: MatchState, action: MatchAction): MatchState {
  if (action.type === 'restore') {
    return createStateFromHistory(action.history);
  }

  if (action.type === 'record') {
    return {
      counts: updateCount(state.counts, action.input, 1),
      history: [...state.history, action.input],
    };
  }

  const lastInput = state.history[state.history.length - 1];
  if (!lastInput) {
    return state;
  }

  return {
    counts: updateCount(state.counts, lastInput, -1),
    history: state.history.slice(0, -1),
  };
}

export function createStateFromHistory(history: readonly PlayInput[]): MatchState {
  return history.reduce(
    (state, input) => matchReducer(state, { type: 'record', input }),
    createInitialState(),
  );
}

export function calculateRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : (numerator / denominator) * 100;
}

export function formatRate(numerator: number, denominator: number): string {
  return `${calculateRate(numerator, denominator).toFixed(1)}%`;
}

export function describeInput(input: PlayInput | undefined): string {
  if (!input) {
    return 'まだ入力はありません';
  }

  return `${CATEGORY_LABELS[input.category]}・${OUTCOME_LABELS[input.outcome]}`;
}
