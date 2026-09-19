import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateMatchStats,
  canDiscardCurrentNewSet,
  canRemoveCurrentEmptySet,
  clearActiveMatch,
  clearCurrentSet,
  completeCurrentSet,
  completeMatch,
  createEmptyDatabase,
  deriveCompletedMatchSummary,
  deriveSet,
  discardCurrentNewSet,
  editCompletedSetScore,
  getActiveMatch,
  getCompletedMatchesNewestFirst,
  getCurrentSet,
  recordStat,
  removeCurrentEmptySet,
  setResult,
  setScore,
  startMatch,
  startNextSet,
  undoCurrentSet,
} from '../lib/match-domain.ts';

const started = () =>
  startMatch(
    createEmptyDatabase(),
    { date: '2026-08-31', homeTeam: '自チーム', awayTeam: '相手' },
    { id: 'match-1', now: '2026-08-31T00:00:00.000Z' },
  );

test('試合開始で第1セットを作り、記録中の新規試合を拒否する', () => {
  const database = started();
  assert.equal(getCurrentSet(getActiveMatch(database)!)?.number, 1);
  assert.throws(() =>
    startMatch(
      database,
      { date: '2026-09-01', homeTeam: 'A', awayTeam: 'B' },
      { id: 'match-2', now: '2026-09-01T00:00:00.000Z' },
    ),
  );
});

test('点数操作とスタッツを操作順にUndoする', () => {
  let database = started();
  database = recordStat(database, { category: 'serve', outcome: 'ace' });
  database = setScore(database, 'home', 1);
  database = setScore(database, 'home', 7);
  let current = deriveSet(getCurrentSet(getActiveMatch(database)!)!);
  assert.equal(current.homeScore, 7);
  database = undoCurrentSet(database);
  current = deriveSet(getCurrentSet(getActiveMatch(database)!)!);
  assert.equal(current.homeScore, 1);
  database = undoCurrentSet(database);
  assert.equal(deriveSet(getCurrentSet(getActiveMatch(database)!)!).homeScore, null);
  database = undoCurrentSet(database);
  assert.equal(deriveSet(getCurrentSet(getActiveMatch(database)!)!).stats.counts.serve.total, 0);
});

test('1点減らす操作は0を記録し、Undoで直前の点数へ戻す', () => {
  let database = setScore(started(), 'home', 1);
  database = setScore(database, 'home', 0);
  assert.equal(deriveSet(getCurrentSet(getActiveMatch(database)!)!).homeScore, 0);
  database = undoCurrentSet(database);
  assert.equal(deriveSet(getCurrentSet(getActiveMatch(database)!)!).homeScore, 1);
});

test('次セットは0から始まり、Undoが終了セットをまたがない', () => {
  let database = recordStat(started(), { category: 'dig', outcome: 'success' });
  database = completeCurrentSet(database, { home: 25, away: 20 });
  database = startNextSet(database);
  database = undoCurrentSet(database);
  const match = getActiveMatch(database)!;
  assert.equal(match.sets[0].operations.length, 1);
  assert.equal(deriveSet(match.sets[1]).stats.counts.dig.total, 0);
});

test('勝敗、同点、未確定を点数から判定し、修正で再計算する', () => {
  let database = completeCurrentSet(started(), { home: 25, away: 20 });
  let match = getActiveMatch(database)!;
  assert.equal(setResult(match.sets[0]), 'home-win');
  database = editCompletedSetScore(database, match.id, match.sets[0].id, { home: 20, away: 25 });
  match = getActiveMatch(database)!;
  assert.equal(setResult(match.sets[0]), 'away-win');
  database = editCompletedSetScore(database, match.id, match.sets[0].id, { home: 20, away: 20 });
  assert.equal(setResult(getActiveMatch(database)!.sets[0]), 'tie');
  database = editCompletedSetScore(database, match.id, match.sets[0].id, { home: null, away: 20 });
  assert.equal(setResult(getActiveMatch(database)!.sets[0]), 'unconfirmed');
});

test('全セット合計はイベントを合算し率の元となる本数を保持する', () => {
  let database = started();
  database = recordStat(database, { category: 'serve', outcome: 'ace' });
  database = completeCurrentSet(database, { home: 25, away: 10 });
  database = startNextSet(database);
  database = recordStat(database, { category: 'serve', outcome: 'miss' });
  database = recordStat(database, { category: 'serve', outcome: 'success' });
  const counts = aggregateMatchStats(getActiveMatch(database)!);
  assert.deepEqual(counts.serve, { total: 3, success: 1, ace: 1, miss: 1 });
});

test('試合終了は同じ試合を重複作成しない', () => {
  const finalized = completeCurrentSet(started(), { home: 25, away: 20 });
  const once = completeMatch(finalized, '2026-08-31T01:00:00.000Z');
  const twice = completeMatch(once, '2026-08-31T02:00:00.000Z');
  assert.equal(twice.matches.length, 1);
  assert.strictEqual(twice, once);
});

test('試合ごと・セットごとにイベントが混ざらない', () => {
  let database = recordStat(started(), { category: 'block', outcome: 'success' });
  database = completeCurrentSet(database, { home: 1, away: 0 });
  database = completeMatch(database, '2026-08-31T01:00:00.000Z');
  database = startMatch(
    database,
    { date: '2026-09-01', homeTeam: '自チーム', awayTeam: '別チーム' },
    { id: 'match-2', now: '2026-09-01T00:00:00.000Z' },
  );
  assert.equal(deriveSet(database.matches[0].sets[0]).stats.counts.block.success, 1);
  assert.equal(deriveSet(database.matches[1].sets[0]).stats.counts.block.success, 0);
});

test('現在セットのクリアはそのセットの点数・スタッツ・Undo履歴だけを空にする', () => {
  let database = recordStat(started(), { category: 'serve', outcome: 'ace' });
  database = setScore(database, 'home', 25);
  database = completeCurrentSet(database, { home: 25, away: 20 });
  database = startNextSet(database);
  database = recordStat(database, { category: 'dig', outcome: 'success' });
  database = setScore(database, 'home', 4);
  database = setScore(database, 'away', 2);
  const originalHomeTeam = getActiveMatch(database)!.homeTeam;
  database = clearCurrentSet(database);
  const match = getActiveMatch(database)!;
  const current = getCurrentSet(match)!;
  const derived = deriveSet(current);
  assert.equal(current.operations.length, 0);
  assert.equal(derived.homeScore, null);
  assert.equal(derived.awayScore, null);
  assert.equal(derived.lastOperation, undefined);
  assert.equal(derived.stats.counts.dig.total, 0);
  assert.equal(match.sets[0].finalHomeScore, 25);
  assert.equal(match.sets[0].operations.length, 2);
  assert.equal(match.homeTeam, originalHomeTeam);
});

test('記録中の試合のクリアはその試合だけを削除し、完了済み試合と既定チーム名を保持する', () => {
  let database = completeCurrentSet(started(), { home: 25, away: 20 });
  database = completeMatch(database, '2026-08-31T01:00:00.000Z');
  database = startMatch(database, { date: '2026-09-01', homeTeam: '別の自チーム', awayTeam: '相手' }, { id: 'match-2', now: '2026-09-01T00:00:00.000Z' });
  const cleared = clearActiveMatch(database);
  assert.equal(cleared.activeMatchId, null);
  assert.equal(cleared.matches.length, 1);
  assert.equal(cleared.matches[0].id, 'match-1');
  assert.equal(cleared.matches[0].status, 'completed');
  assert.equal(cleared.defaultHomeTeam, '別の自チーム');
});

test('completed history is newest first without changing stored match order', () => {
  const first = completeMatch(completeCurrentSet(started(), { home: 25, away: 20 }), '2026-08-31T01:00:00.000Z');
  let database = startMatch(first, { date: '2026-09-01', homeTeam: 'A', awayTeam: 'B' }, { id: 'match-2', now: '2026-09-01T00:00:00.000Z' });
  database = completeMatch(completeCurrentSet(database, { home: 25, away: 20 }), '2026-09-02T01:00:00.000Z');
  database = startMatch(database, { date: '2026-09-03', homeTeam: 'C', awayTeam: 'D' }, { id: 'match-3', now: '2026-09-03T00:00:00.000Z' });
  database = completeMatch(completeCurrentSet(database, { home: 25, away: 20 }), '2026-09-03T01:00:00.000Z');

  const original = database.matches.map((match) => match.id);
  const history = getCompletedMatchesNewestFirst(database.matches);

  assert.deepEqual(history.map((match) => match.id), ['match-3', 'match-2', 'match-1']);
  assert.deepEqual(database.matches.map((match) => match.id), original);
  assert.notStrictEqual(history, database.matches);
  assert.strictEqual(database.matches.find((match) => match.id === history[0].id), history[0]);
});

test('completed history keeps equal, missing, and invalid completion timestamps visible and stable', () => {
  const completed = (id: string, completedAt: string | null) => ({
    ...started().matches[0], id, status: 'completed' as const, completedAt,
  });
  const matches = [
    completed('missing-first', null),
    completed('older', '2026-08-31T01:00:00.000Z'),
    completed('equal-first', '2026-09-02T01:00:00.000Z'),
    completed('invalid', 'not-a-date'),
    completed('equal-second', '2026-09-02T01:00:00.000Z'),
    completed('missing-second', null),
  ];

  const history = getCompletedMatchesNewestFirst(matches);

  assert.deepEqual(history.map((match) => match.id), [
    'equal-first', 'equal-second', 'older', 'missing-first', 'invalid', 'missing-second',
  ]);
  assert.deepEqual(matches.map((match) => match.id), [
    'missing-first', 'older', 'equal-first', 'invalid', 'equal-second', 'missing-second',
  ]);
});

test('completed-match history summary counts only clear winners and keeps completed sets in set-number order', () => {
  const match = {
    ...started().matches[0],
    status: 'completed' as const,
    sets: [
      { ...started().matches[0].sets[0], id: 'set-3', number: 3, status: 'completed' as const, finalHomeScore: 15, finalAwayScore: 12 },
      { ...started().matches[0].sets[0], id: 'set-1', number: 1, status: 'completed' as const, finalHomeScore: 25, finalAwayScore: 20 },
      { ...started().matches[0].sets[0], id: 'set-2', number: 2, status: 'completed' as const, finalHomeScore: 22, finalAwayScore: 25 },
      { ...started().matches[0].sets[0], id: 'set-4', number: 4, status: 'completed' as const, finalHomeScore: 20, finalAwayScore: 20 },
      { ...started().matches[0].sets[0], id: 'set-5', number: 5, status: 'completed' as const, finalHomeScore: null, finalAwayScore: 8 },
    ],
  };
  const before = JSON.stringify(match);

  const summary = deriveCompletedMatchSummary(match);

  assert.deepEqual(summary, {
    homeSetWins: 2,
    awaySetWins: 1,
    sets: [
      { number: 1, homeScore: 25, awayScore: 20 },
      { number: 2, homeScore: 22, awayScore: 25 },
      { number: 3, homeScore: 15, awayScore: 12 },
      { number: 4, homeScore: 20, awayScore: 20 },
      { number: 5, homeScore: null, awayScore: 8 },
    ],
  });
  assert.equal(JSON.stringify(match), before);
});

test('completed-match history summary permits a match without completed sets', () => {
  const match = { ...started().matches[0], status: 'completed' as const };

  assert.deepEqual(deriveCompletedMatchSummary(match), {
    homeSetWins: 0,
    awaySetWins: 0,
    sets: [],
  });
});

test('空の次セットだけを削除して前の確定済みセットを完全に保持する', () => {
  let database = recordStat(started(), { category: 'serve', outcome: 'ace' });
  database = setScore(database, 'home', 25);
  database = completeCurrentSet(database, { home: 25, away: 20 });
  database = startNextSet(database);
  const before = getActiveMatch(database)!;
  const completed = before.sets[0];

  assert.equal(canRemoveCurrentEmptySet(database), true);
  const returned = removeCurrentEmptySet(database);
  const match = getActiveMatch(returned)!;

  assert.deepEqual(match.sets, [completed]);
  assert.equal(match.id, before.id);
  assert.equal(match.homeTeam, before.homeTeam);
  assert.equal(match.awayTeam, before.awayTeam);
  assert.equal(match.createdAt, before.createdAt);
  assert.equal(returned.defaultHomeTeam, database.defaultHomeTeam);
});

test('入力済みの次セットは確認用の破棄操作だけで削除でき、空セット用操作は拒否する', () => {
  let database = completeCurrentSet(started(), { home: 25, away: 20 });
  database = startNextSet(database);
  database = recordStat(database, { category: 'dig', outcome: 'success' });
  const unchanged = JSON.stringify(database);

  assert.equal(canRemoveCurrentEmptySet(database), false);
  assert.equal(canDiscardCurrentNewSet(database), true);
  assert.throws(() => removeCurrentEmptySet(database));
  assert.equal(JSON.stringify(database), unchanged);
  const returned = discardCurrentNewSet(database);
  assert.equal(getActiveMatch(returned)!.sets.length, 1);
  assert.equal(getActiveMatch(returned)!.sets[0].status, 'completed');
});

test('新規セット破棄は最終・進行中・前の確定済みセットの条件を満たさなければ拒否する', () => {
  assert.equal(canDiscardCurrentNewSet(started()), false);
  assert.throws(() => discardCurrentNewSet(started()));

  let completedOnly = completeCurrentSet(started(), { home: 25, away: 20 });
  assert.equal(canDiscardCurrentNewSet(completedOnly), false);
  assert.throws(() => discardCurrentNewSet(completedOnly));

  completedOnly = startNextSet(completedOnly);
  const active = getActiveMatch(completedOnly)!;
  const invalid = {
    ...completedOnly,
    matches: [{ ...active, sets: [...active.sets, { ...active.sets[1], id: 'not-last', status: 'completed' as const, finalHomeScore: 25, finalAwayScore: 20 }] }],
  };
  assert.equal(canDiscardCurrentNewSet(invalid), false);
  assert.throws(() => discardCurrentNewSet(invalid));
});
