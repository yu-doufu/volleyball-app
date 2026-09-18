import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateMatchStats,
  clearActiveMatch,
  clearCurrentSet,
  completeCurrentSet,
  completeMatch,
  createEmptyDatabase,
  deriveSet,
  editCompletedSetScore,
  getActiveMatch,
  getCurrentSet,
  recordStat,
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
