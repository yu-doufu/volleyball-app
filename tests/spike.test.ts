import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateMatchStats,
  completeCurrentSet,
  completeMatch,
  createEmptyDatabase,
  deriveSet,
  getActiveMatch,
  getCurrentSet,
  recordStat,
  setScore,
  startMatch,
  startNextSet,
  undoCurrentSet,
} from '../lib/match-domain.ts';
import type { MatchDatabase } from '../lib/match-domain.ts';
import { MatchRepository } from '../lib/match-storage.ts';
import { InputHighlight, INPUT_HIGHLIGHT_MS } from '../lib/input-highlight.ts';
import { CATEGORY_OUTCOMES, describeInput, formatRate, OUTCOME_LABELS } from '../lib/volleyball-stats.ts';
import type { Outcome } from '../lib/volleyball-stats.ts';

class Storage {
  value: string | null = null;
  async getItem() { return this.value; }
  async setItem(_key: string, value: string) { this.value = value; }
}

const started = () => startMatch(
  createEmptyDatabase(),
  { date: '2026-09-18', homeTeam: '自チーム', awayTeam: '相手' },
  { id: 'spike-test', now: '2026-09-18T00:00:00Z' },
);
const add = (database: MatchDatabase, outcome: Outcome) =>
  recordStat(database, { category: 'spike', outcome });
const current = (database: MatchDatabase) =>
  deriveSet(getCurrentSet(getActiveMatch(database)!)!);

test('スパイクは成功／拾われた／ミスを各1件記録し成功率を計算する', () => {
  assert.deepEqual(CATEGORY_OUTCOMES.spike, ['success', 'regular', 'miss']);
  assert.deepEqual(CATEGORY_OUTCOMES.spike.map(outcome => OUTCOME_LABELS[outcome]), ['成功', '拾われた', 'ミス']);
  let database = started();
  for (const outcome of CATEGORY_OUTCOMES.spike) database = add(database, outcome);
  assert.deepEqual(current(database).stats.counts.spike, {
    total: 3,
    success: 1,
    regular: 1,
    miss: 1,
  });
  assert.equal(formatRate(current(database).stats.counts.spike.success, 3), '33.3%');
  assert.equal(current(database).homeScore, null);
  assert.equal(current(database).awayScore, null);
});

test('拾われたの直前ラベル・600ms強調・Undoが内部値regularのまま動作する', () => {
  assert.equal(describeInput({ category: 'spike', outcome: 'regular' }), 'スパイク・拾われた');
  const notifications: (string | null)[] = [];
  let scheduledDelay = 0;
  const highlight = new InputHighlight(value => notifications.push(value), {
    schedule(_callback, delay) {
      scheduledDelay = delay;
      return () => undefined;
    },
  });
  let database = started();
  assert.equal(highlight.record(
    { category: 'spike', outcome: 'regular' },
    input => { database = recordStat(database, input); return true; },
  ), true);
  assert.deepEqual(notifications, ['spike:regular']);
  assert.equal(scheduledDelay, INPUT_HIGHLIGHT_MS);
  database = undoCurrentSet(database);
  assert.deepEqual(current(database).stats.counts.spike, {
    total: 0,
    success: 0,
    regular: 0,
    miss: 0,
  });
  highlight.dispose();
});

test('旧「通常」regularは保存・復元後も拾われたとして集計しUndoできる', async () => {
  let database = setScore(add(started(), 'regular'), 'home', 4);
  database = add(database, 'regular');
  const storage = new Storage();
  await new MatchRepository(storage).save(database);
  database = (await new MatchRepository(storage).load()).database!;
  assert.equal(current(database).stats.counts.spike.regular, 2);
  assert.equal(describeInput(current(database).stats.history.at(-1)), 'スパイク・拾われた');
  database = undoCurrentSet(database);
  assert.equal(current(database).stats.counts.spike.regular, 1);
  assert.equal(current(database).homeScore, 4);
});

test('セット別と試合全体の集計を保持し終了試合の保存データから復元できる', async () => {
  let database = add(add(started(), 'success'), 'regular');
  database = startNextSet(completeCurrentSet(database, { home: 25, away: 20 }));
  database = add(add(database, 'regular'), 'miss');
  database = completeMatch(completeCurrentSet(database, { home: 23, away: 25 }), '2026-09-18T01:00:00Z');
  const match = database.matches[0];
  assert.deepEqual(match.sets.map(set => deriveSet(set).stats.counts.spike), [
    { total: 2, success: 1, regular: 1, miss: 0 },
    { total: 2, success: 0, regular: 1, miss: 1 },
  ]);
  assert.deepEqual(aggregateMatchStats(match).spike, {
    total: 4,
    success: 1,
    regular: 2,
    miss: 1,
  });
  const storage = new Storage();
  await new MatchRepository(storage).save(database);
  const restored = (await new MatchRepository(storage).load()).database!;
  assert.deepEqual(aggregateMatchStats(restored.matches[0]).spike, aggregateMatchStats(match).spike);
});
