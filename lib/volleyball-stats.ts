export type Category = 'serve' | 'reception' | 'block' | 'dig' | 'spike';

export type Outcome =
  | 'success'
  | 'ace'
  | 'miss'
  | 'failure'
  | 'regular'
  | 'jumped'
  | 'touch'
  | 'blockPoint'
  | 'receptionA'
  | 'receptionB'
  | 'receptionMiss';

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
  jumped: '飛んだ',
  touch: 'ワンタッチ',
  blockPoint: '成功',
  receptionA: 'A',
  receptionB: 'B',
  receptionMiss: 'ミス',
};

export const CATEGORY_OUTCOMES: Record<Category, readonly Outcome[]> = {
  serve: ['success', 'ace', 'miss'],
  reception: ['receptionA', 'receptionB', 'receptionMiss'],
  block: ['jumped', 'touch', 'blockPoint'],
  dig: ['success', 'miss'],
  spike: ['success', 'regular', 'miss'],
};

export const createInitialState = (): MatchState => ({
  counts: {
    serve: { total: 0, success: 0, ace: 0, miss: 0 },
    reception: { total: 0, receptionA: 0, receptionB: 0, receptionMiss: 0, legacyTotal: 0, success: 0, miss: 0 },
    block: { total: 0, jumped: 0, touch: 0, blockPoint: 0, legacyTotal: 0, success: 0, failure: 0 },
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

  if (!Object.prototype.hasOwnProperty.call(CATEGORY_OUTCOMES, candidate.category)) return false;
  if (candidate.category === 'block' && ['success', 'failure'].includes(candidate.outcome)) return true;
  if (candidate.category === 'reception' && ['success', 'miss'].includes(candidate.outcome)) return true;
  const outcomes = CATEGORY_OUTCOMES[candidate.category as Category];
  return Boolean(outcomes?.includes(candidate.outcome as Outcome));
}

// Legacy success/failure remain distinct from all three new outcomes.
export function isLegacyPlayInput(value: unknown): value is PlayInput {
  return isPlayInputV3(value) && (value.category !== 'block' ||
    value.outcome === 'success' || value.outcome === 'failure');
}

// Version 3 includes new block results, but only legacy reception results.
export function isPlayInputV3(value: unknown): value is PlayInput {
  return isPlayInput(value) && (value.category !== 'reception' ||
    value.outcome === 'success' || value.outcome === 'miss');
}

export function isLegacyResult(input: PlayInput): boolean {
  return (input.category === 'block' && isLegacyPlayInput(input)) ||
    (input.category === 'reception' && isPlayInputV3(input));
}

export function receptionRates(counts: CategoryCounts) {
  return [
    { label: 'A率', value: formatRate(counts.receptionA, counts.total) },
    { label: 'B率', value: formatRate(counts.receptionB, counts.total) },
    { label: '成功率', value: formatRate(counts.receptionA + counts.receptionB, counts.total) },
  ];
}

const updateCount = (
  counts: MatchCounts,
  input: PlayInput,
  amount: 1 | -1,
): MatchCounts => {
  const current = counts[input.category];
  const totalKey = isLegacyResult(input) ? 'legacyTotal' : 'total';

  return {
    ...counts,
    [input.category]: {
      ...current,
      [totalKey]: current[totalKey] + amount,
      [input.outcome]: current[input.outcome] + amount,
    },
  };
};

export function matchReducer(state: MatchState, action: MatchAction): MatchState {
  if (action.type === 'restore') {
    return createStateFromHistory(action.history);
  }

  if (action.type === 'record') {
    if (!isPlayInput(action.input)) throw new Error('不正なスタッツ入力です。');
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

  const legacy = isLegacyResult(input) ? '（旧記録）' : '';
  return `${CATEGORY_LABELS[input.category]}${legacy}・${OUTCOME_LABELS[input.outcome]}`;
}
