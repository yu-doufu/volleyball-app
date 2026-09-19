import {
  createInitialState,
  createStateFromHistory,
  isPlayInput,
} from './volleyball-stats.ts';
import type { MatchCounts, PlayInput } from './volleyball-stats.ts';

export type TeamSide = 'home' | 'away';
export type MatchStatus = 'in-progress' | 'completed';
export type SetStatus = 'in-progress' | 'completed';

export type SetOperation =
  | Readonly<{ type: 'stat'; input: PlayInput }>
  | Readonly<{ type: 'score'; side: TeamSide; value: number }>;

export type VolleyballSet = Readonly<{
  id: string;
  number: number;
  status: SetStatus;
  operations: readonly SetOperation[];
  finalHomeScore: number | null;
  finalAwayScore: number | null;
}>;

export type VolleyballMatch = Readonly<{
  id: string;
  date: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  status: MatchStatus;
  migratedFromV1: boolean;
  sets: readonly VolleyballSet[];
  createdAt: string;
  completedAt: string | null;
}>;

export type MatchDatabase = Readonly<{
  version: 4;
  defaultHomeTeam: string;
  activeMatchId: string | null;
  matches: readonly VolleyballMatch[];
}>;

export type CompletedMatchSummary = Readonly<{
  homeSetWins: number;
  awaySetWins: number;
  sets: readonly Readonly<{
    number: number;
    homeScore: number | null;
    awayScore: number | null;
  }>[];
}>;

export const createEmptyDatabase = (): MatchDatabase => ({
  version: 4,
  defaultHomeTeam: '自チーム',
  activeMatchId: null,
  matches: [],
});

const newSet = (matchId: string, number: number): VolleyballSet => ({
  id: `${matchId}-set-${number}`,
  number,
  status: 'in-progress',
  operations: [],
  finalHomeScore: null,
  finalAwayScore: null,
});

const replaceMatch = (
  database: MatchDatabase,
  match: VolleyballMatch,
): MatchDatabase => ({
  ...database,
  matches: database.matches.map((candidate) =>
    candidate.id === match.id ? match : candidate,
  ),
});

export function getActiveMatch(database: MatchDatabase): VolleyballMatch | null {
  return (
    database.matches.find((match) => match.id === database.activeMatchId) ?? null
  );
}

/** Returns completed matches for presentation without changing stored match order. */
export function getCompletedMatchesNewestFirst(
  matches: readonly VolleyballMatch[],
): readonly VolleyballMatch[] {
  return matches
    .map((match, index) => ({
      match,
      index,
      completedAt: match.completedAt === null ? Number.NaN : Date.parse(match.completedAt),
    }))
    .filter(({ match }) => match.status === 'completed')
    .sort((left, right) => {
      const leftIsComparable = Number.isFinite(left.completedAt);
      const rightIsComparable = Number.isFinite(right.completedAt);
      if (leftIsComparable && rightIsComparable) {
        return right.completedAt - left.completedAt || left.index - right.index;
      }
      if (leftIsComparable) return -1;
      if (rightIsComparable) return 1;
      return left.index - right.index;
    })
    .map(({ match }) => match);
}

/** Derives completed-set results for history presentation without changing match data. */
export function deriveCompletedMatchSummary(match: VolleyballMatch): CompletedMatchSummary {
  const sets = match.sets
    .filter((set) => set.status === 'completed')
    .map((set, index) => ({ set, index }))
    .sort((left, right) => left.set.number - right.set.number || left.index - right.index)
    .map(({ set }) => ({
      number: set.number,
      homeScore: set.finalHomeScore,
      awayScore: set.finalAwayScore,
    }));
  const results = match.sets.map(setResult);

  return {
    homeSetWins: results.filter((result) => result === 'home-win').length,
    awaySetWins: results.filter((result) => result === 'away-win').length,
    sets,
  };
}

export function getCurrentSet(match: VolleyballMatch): VolleyballSet | null {
  return [...match.sets].reverse().find((set) => set.status === 'in-progress') ?? null;
}

/** True only when the active match can safely return from an untouched next set. */
export function canRemoveCurrentEmptySet(database: MatchDatabase): boolean {
  const match = getActiveMatch(database);
  if (!match || match.status !== 'in-progress') return false;
  const current = getCurrentSet(match);
  if (!current || match.sets[match.sets.length - 1]?.id !== current.id) return false;
  const currentIndex = match.sets.length - 1;
  return (
    match.sets.slice(0, currentIndex).some((set) => set.status === 'completed') &&
    current.operations.length === 0 &&
    current.finalHomeScore === null &&
    current.finalAwayScore === null
  );
}

/** True only when the active, last in-progress set was created after a completed set. */
export function canDiscardCurrentNewSet(database: MatchDatabase): boolean {
  const match = getActiveMatch(database);
  if (!match || match.status !== 'in-progress') return false;
  const current = getCurrentSet(match);
  if (!current || match.sets[match.sets.length - 1]?.id !== current.id) return false;
  return (
    match.sets.slice(0, -1).some((set) => set.status === 'completed') &&
    current.finalHomeScore === null &&
    current.finalAwayScore === null
  );
}

/** Removes only an untouched, active next set; all completed-set data is retained. */
export function removeCurrentEmptySet(database: MatchDatabase): MatchDatabase {
  if (!canRemoveCurrentEmptySet(database)) {
    throw new Error('空の新規セットだけを前のセットへ戻せます。');
  }
  const match = getActiveMatch(database)!;
  return replaceMatch(database, { ...match, sets: match.sets.slice(0, -1) });
}

/** Discards only the active, last new set after explicit user confirmation. */
export function discardCurrentNewSet(database: MatchDatabase): MatchDatabase {
  if (!canDiscardCurrentNewSet(database)) {
    throw new Error('新規セットを破棄できる状態ではありません。');
  }
  const match = getActiveMatch(database)!;
  return replaceMatch(database, { ...match, sets: match.sets.slice(0, -1) });
}

export function startMatch(
  database: MatchDatabase,
  input: Readonly<{ date: string; homeTeam: string; awayTeam: string }>,
  identity: Readonly<{ id: string; now: string }>,
): MatchDatabase {
  if (getActiveMatch(database)) throw new Error('記録中の試合があります。');
  const homeTeam = input.homeTeam.trim();
  const awayTeam = input.awayTeam.trim();
  if (!input.date || !homeTeam || !awayTeam) throw new Error('試合情報を入力してください。');
  if (database.matches.some((match) => match.id === identity.id)) {
    throw new Error('試合IDが重複しています。');
  }

  const match: VolleyballMatch = {
    id: identity.id,
    date: input.date,
    homeTeam,
    awayTeam,
    status: 'in-progress',
    migratedFromV1: false,
    sets: [newSet(identity.id, 1)],
    createdAt: identity.now,
    completedAt: null,
  };
  return {
    ...database,
    defaultHomeTeam: homeTeam,
    activeMatchId: match.id,
    matches: [...database.matches, match],
  };
}

export function updateMatchInfo(
  database: MatchDatabase,
  matchId: string,
  input: Readonly<{ date: string; homeTeam: string; awayTeam: string }>,
): MatchDatabase {
  const match = database.matches.find((candidate) => candidate.id === matchId);
  if (!match) throw new Error('試合が見つかりません。');
  const homeTeam = input.homeTeam.trim();
  const awayTeam = input.awayTeam.trim();
  if (!input.date || !homeTeam || !awayTeam) throw new Error('試合情報を入力してください。');
  return {
    ...replaceMatch(database, { ...match, date: input.date, homeTeam, awayTeam }),
    defaultHomeTeam: homeTeam,
  };
}

function updateCurrentSet(
  database: MatchDatabase,
  update: (set: VolleyballSet) => VolleyballSet,
): MatchDatabase {
  const match = getActiveMatch(database);
  if (!match) throw new Error('記録中の試合がありません。');
  const current = getCurrentSet(match);
  if (!current) throw new Error('記録中のセットがありません。');
  return replaceMatch(database, {
    ...match,
    sets: match.sets.map((set) => (set.id === current.id ? update(set) : set)),
  });
}

export function recordStat(database: MatchDatabase, input: PlayInput): MatchDatabase {
  if (!isPlayInput(input)) throw new Error('不正なスタッツ入力です。');
  return updateCurrentSet(database, (set) => ({
    ...set,
    operations: [...set.operations, { type: 'stat', input }],
  }));
}

export function setScore(
  database: MatchDatabase,
  side: TeamSide,
  value: number,
): MatchDatabase {
  if (!Number.isInteger(value) || value < 0) throw new Error('点数は0以上の整数です。');
  return updateCurrentSet(database, (set) => ({
    ...set,
    operations: [...set.operations, { type: 'score', side, value }],
  }));
}

export function undoCurrentSet(database: MatchDatabase): MatchDatabase {
  return updateCurrentSet(database, (set) =>
    set.operations.length === 0
      ? set
      : { ...set, operations: set.operations.slice(0, -1) },
  );
}

/** Restores only the in-progress set to its empty, before-recording state. */
export function clearCurrentSet(database: MatchDatabase): MatchDatabase {
  return updateCurrentSet(database, (set) => ({
    ...set,
    operations: [],
    finalHomeScore: null,
    finalAwayScore: null,
  }));
}

/** Removes the in-progress match while retaining completed match history and defaults. */
export function clearActiveMatch(database: MatchDatabase): MatchDatabase {
  const active = getActiveMatch(database);
  if (!active) return database;
  return {
    ...database,
    activeMatchId: null,
    matches: database.matches.filter((match) => match.id !== active.id),
  };
}

export function deriveSet(set: VolleyballSet) {
  const statHistory = set.operations
    .filter((operation): operation is Extract<SetOperation, { type: 'stat' }> =>
      operation.type === 'stat',
    )
    .map((operation) => operation.input);
  let homeScore: number | null = null;
  let awayScore: number | null = null;
  for (const operation of set.operations) {
    if (operation.type === 'score') {
      if (operation.side === 'home') homeScore = operation.value;
      else awayScore = operation.value;
    }
  }
  return {
    stats: createStateFromHistory(statHistory),
    homeScore: set.status === 'completed' ? set.finalHomeScore : homeScore,
    awayScore: set.status === 'completed' ? set.finalAwayScore : awayScore,
    lastOperation: set.operations[set.operations.length - 1],
  };
}

export function completeCurrentSet(
  database: MatchDatabase,
  scores: Readonly<{ home: number | null; away: number | null }>,
): MatchDatabase {
  for (const score of [scores.home, scores.away]) {
    if (score !== null && (!Number.isInteger(score) || score < 0)) {
      throw new Error('点数は未確定または0以上の整数です。');
    }
  }
  return updateCurrentSet(database, (set) => ({
    ...set,
    status: 'completed',
    finalHomeScore: scores.home,
    finalAwayScore: scores.away,
  }));
}

export function startNextSet(database: MatchDatabase): MatchDatabase {
  const match = getActiveMatch(database);
  if (!match) throw new Error('記録中の試合がありません。');
  if (getCurrentSet(match)) throw new Error('現在のセットを先に確定してください。');
  const number = Math.max(...match.sets.map((set) => set.number), 0) + 1;
  return replaceMatch(database, { ...match, sets: [...match.sets, newSet(match.id, number)] });
}

export function completeMatch(database: MatchDatabase, now: string): MatchDatabase {
  const match = getActiveMatch(database);
  if (!match) return database;
  if (getCurrentSet(match)) throw new Error('現在のセットを先に確定してください。');
  return {
    ...replaceMatch(database, { ...match, status: 'completed', completedAt: now }),
    activeMatchId: null,
  };
}

export function editCompletedSetScore(
  database: MatchDatabase,
  matchId: string,
  setId: string,
  scores: Readonly<{ home: number | null; away: number | null }>,
): MatchDatabase {
  for (const score of [scores.home, scores.away]) {
    if (score !== null && (!Number.isInteger(score) || score < 0)) {
      throw new Error('点数は未確定または0以上の整数です。');
    }
  }
  const match = database.matches.find((candidate) => candidate.id === matchId);
  if (!match) throw new Error('試合が見つかりません。');
  const target = match.sets.find((set) => set.id === setId);
  if (!target || target.status !== 'completed') throw new Error('終了セットが見つかりません。');
  return replaceMatch(database, {
    ...match,
    sets: match.sets.map((set) =>
      set.id === setId
        ? { ...set, finalHomeScore: scores.home, finalAwayScore: scores.away }
        : set,
    ),
  });
}

export function setResult(set: VolleyballSet): 'home-win' | 'away-win' | 'tie' | 'unconfirmed' | 'in-progress' {
  if (set.status === 'in-progress') return 'in-progress';
  if (set.finalHomeScore === null || set.finalAwayScore === null) return 'unconfirmed';
  if (set.finalHomeScore === set.finalAwayScore) return 'tie';
  return set.finalHomeScore > set.finalAwayScore ? 'home-win' : 'away-win';
}

export function aggregateMatchStats(match: VolleyballMatch): MatchCounts {
  const history = match.sets.flatMap((set) =>
    set.operations
      .filter((operation): operation is Extract<SetOperation, { type: 'stat' }> =>
        operation.type === 'stat',
      )
      .map((operation) => operation.input),
  );
  return createStateFromHistory(history).counts;
}

export function isSetOperation(value: unknown): value is SetOperation {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const candidate = value as { type?: unknown; input?: unknown; side?: unknown; value?: unknown };
  return candidate.type === 'stat'
    ? isPlayInput(candidate.input)
    : candidate.type === 'score' &&
        (candidate.side === 'home' || candidate.side === 'away') &&
        Number.isInteger(candidate.value) &&
        Number(candidate.value) >= 0;
}

export function createMigratedDatabase(
  history: readonly PlayInput[],
  createdAt: string,
): MatchDatabase {
  const id = 'migrated-v1-active-match';
  return {
    version: 4,
    defaultHomeTeam: '自チーム',
    activeMatchId: id,
    matches: [
      {
        id,
        date: null,
        homeTeam: null,
        awayTeam: null,
        status: 'in-progress',
        migratedFromV1: true,
        createdAt,
        completedAt: null,
        sets: [
          {
            ...newSet(id, 1),
            operations: history.map((input) => ({ type: 'stat' as const, input })),
          },
        ],
      },
    ],
  };
}

export { createInitialState };
