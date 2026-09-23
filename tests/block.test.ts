import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateMatchStats, completeCurrentSet, completeMatch, createEmptyDatabase,
  deriveSet, getActiveMatch, getCurrentSet, recordStat, setScore, startMatch,
  startNextSet, undoCurrentSet,
} from '../lib/match-domain.ts';
import type { MatchDatabase } from '../lib/match-domain.ts';
import { LEGACY_MATCH_DATABASE_KEY, MATCH_DATABASE_KEY, MatchRepository, parseMatchDatabase } from '../lib/match-storage.ts';
import { SESSION_STORAGE_KEY, parseSession, serializeSession } from '../lib/session-storage.ts';
import { createInitialState, describeInput, formatRate, isPlayInput, matchReducer } from '../lib/volleyball-stats.ts';
import type { Outcome, PlayInput } from '../lib/volleyball-stats.ts';

const started = () => startMatch(createEmptyDatabase(),
  { date: '2026-09-14', homeTeam: 'テスト自チーム', awayTeam: 'テスト相手' },
  { id: 'block-test', now: '2026-09-14T00:00:00.000Z' });
const record = (db: MatchDatabase, outcome: Outcome) => recordStat(db, { category: 'block', outcome });
const current = (db: MatchDatabase) => deriveSet(getCurrentSet(getActiveMatch(db)!)!);
class Storage {
  values = new Map<string, string>();
  fail = false;
  writes = 0;
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) {
    this.writes++;
    if (this.fail) throw new Error('test write failure');
    this.values.set(key, value);
  }
}

test('3結果は排他的、指定の4入力とUndoで率を再計算する', () => {
  let db = started();
  for (const outcome of ['jumped', 'jumped', 'touch', 'blockPoint'] as const) db = record(db, outcome);
  let c = current(db).stats.counts.block;
  assert.deepEqual(c, { total: 4, jumped: 2, touch: 1, blockPoint: 1, legacyTotal: 0, success: 0, failure: 0 });
  assert.equal(formatRate(c.blockPoint, c.total), '25.0%');
  assert.equal(formatRate(c.touch, c.total), '25.0%');
  assert.equal(current(db).stats.history.length, 4);
  assert.equal(current(db).homeScore, null);
  db = undoCurrentSet(db);
  c = current(db).stats.counts.block;
  assert.equal(c.total, 3);
  assert.equal(formatRate(c.blockPoint, c.total), '0.0%');
  assert.equal(formatRate(c.touch, c.total), '33.3%');
  for (let i = 0; i < 3; i++) db = undoCurrentSet(db);
  c = current(db).stats.counts.block;
  assert.equal(formatRate(c.blockPoint, c.total), '0.0%');
  assert.equal(formatRate(c.touch, c.total), '0.0%');
});

test('連打300件を直列保存し再起動後も全イベントと点数Undo順序を保つ', async () => {
  const storage = new Storage();
  const repo = new MatchRepository(storage);
  let db = setScore(started(), 'home', 7);
  const saves: Promise<void>[] = [];
  for (let i = 0; i < 300; i++) {
    db = record(db, (['jumped', 'touch', 'blockPoint'] as const)[i % 3]);
    saves.push(repo.save(db));
  }
  db = setScore(db, 'away', 5);
  saves.push(repo.save(db));
  await Promise.all(saves);
  db = (await new MatchRepository(storage).load()).database!;
  assert.equal(db.version, 4);
  assert.equal(current(db).stats.counts.block.total, 300);
  assert.equal(current(db).stats.counts.block.touch, 100);
  assert.equal(current(db).homeScore, 7);
  db = undoCurrentSet(db);
  assert.equal(current(db).awayScore, null);
  for (let i = 0; i < 300; i++) db = undoCurrentSet(db);
  assert.equal(current(db).stats.counts.block.total, 0);
  assert.equal(current(db).homeScore, 7);
  db = undoCurrentSet(db);
  assert.equal(current(db).homeScore, null);
  await repo.save(db);
  assert.deepEqual((await repo.load()).database, db);
});

test('複数セットの件数合算・終了試合復元・Undo境界を保つ', async () => {
  let db = record(started(), 'blockPoint');
  db = startNextSet(completeCurrentSet(db, { home: 25, away: 20 }));
  db = undoCurrentSet(db);
  assert.equal(db.matches[0].sets[0].operations.length, 1);
  for (const outcome of ['jumped', 'jumped', 'touch'] as const) db = record(db, outcome);
  const first = deriveSet(db.matches[0].sets[0]).stats.counts.block;
  const second = current(db).stats.counts.block;
  const sum = aggregateMatchStats(db.matches[0]).block;
  assert.equal(first.total + second.total, sum.total);
  assert.equal(formatRate(sum.blockPoint, sum.total), '25.0%');
  assert.equal(formatRate(sum.touch, sum.total), '25.0%');
  db = completeMatch(completeCurrentSet(db, { home: 21, away: 25 }), '2026-09-14T01:00:00.000Z');
  const repo = new MatchRepository(new Storage());
  await repo.save(db);
  const restored = (await repo.load()).database!;
  assert.deepEqual(restored, db);
  assert.deepEqual(aggregateMatchStats(restored.matches[0]).block, sum);
});

test('旧version 2は全履歴とメタデータを保持し、混在再開・新旧Undoできる', async () => {
  let old = record(record(started(), 'success'), 'failure');
  old = recordStat(old, { category: 'serve', outcome: 'ace' });
  old = setScore(old, 'home', 8);
  const raw = JSON.stringify({ ...old, version: 2 });
  const storage = new Storage();
  storage.values.set(LEGACY_MATCH_DATABASE_KEY, raw);
  let result = await new MatchRepository(storage).load();
  assert.equal(result.migrated, true);
  let db = result.database!;
  assert.deepEqual(db.matches, old.matches);
  assert.equal(storage.values.get(LEGACY_MATCH_DATABASE_KEY), raw);
  let c = current(db).stats.counts.block;
  assert.equal(c.total, 0);
  assert.equal(c.legacyTotal, 2);
  assert.equal(formatRate(c.success, c.legacyTotal), '50.0%');
  db = record(record(db, 'touch'), 'blockPoint');
  c = current(db).stats.counts.block;
  assert.equal(c.total, 2);
  assert.equal(c.success, 1);
  assert.equal(c.blockPoint, 1);
  assert.equal(c.failure, 1);
  assert.equal(c.jumped, 0);
  assert.equal(formatRate(c.blockPoint, c.total), '50.0%');
  assert.equal(current(db).homeScore, 8);
  await new MatchRepository(storage).save(db);
  result = await new MatchRepository(storage).load();
  assert.equal(result.migrated, false);
  db = result.database!;
  for (let i = 0; i < 4; i++) db = undoCurrentSet(db);
  assert.equal(current(db).stats.counts.block.legacyTotal, 2);
  db = undoCurrentSet(db);
  c = current(db).stats.counts.block;
  assert.equal(c.failure, 0);
  assert.equal(c.success, 1);
  db = undoCurrentSet(db);
  assert.equal(current(db).stats.counts.block.legacyTotal, 0);
});

test('version 1の旧成功・失敗を推測分類せず移行しUndoする', async () => {
  const raw = serializeSession([{ category: 'block', outcome: 'success' }, { category: 'block', outcome: 'failure' }]);
  const storage = new Storage();
  storage.values.set(SESSION_STORAGE_KEY, raw);
  const db = (await new MatchRepository(storage).load()).database!;
  assert.equal(db.version, 4);
  assert.equal(current(db).stats.counts.block.legacyTotal, 2);
  assert.equal(current(db).stats.counts.block.total, 0);
  assert.equal(current(undoCurrentSet(db)).stats.counts.block.failure, 0);
  assert.equal(storage.values.get(SESSION_STORAGE_KEY), raw);
});

test('version 2移行書込失敗は元データを維持し再試行できる', async () => {
  const storage = new Storage();
  const raw = JSON.stringify({ ...record(started(), 'failure'), version: 2 });
  storage.values.set(LEGACY_MATCH_DATABASE_KEY, raw);
  storage.fail = true;
  await assert.rejects(new MatchRepository(storage).load());
  assert.equal(storage.values.get(LEGACY_MATCH_DATABASE_KEY), raw);
  assert.equal(storage.values.has(MATCH_DATABASE_KEY), false);
  storage.fail = false;
  const result = await new MatchRepository(storage).load();
  assert.equal(result.migrated, true);
  assert.equal(result.database!.matches.length, 1);
});

test('終了した旧試合の結果と他項目を保持し、移行後も閲覧集計できる', async () => {
  let old = record(record(started(), 'success'), 'failure');
  for (const category of ['serve', 'reception', 'dig', 'spike'] as const) {
    old = recordStat(old, { category, outcome: 'success' });
  }
  old = completeMatch(completeCurrentSet(old, { home: 25, away: 18 }), '2026-09-14T01:00:00.000Z');
  const storage = new Storage();
  storage.values.set(LEGACY_MATCH_DATABASE_KEY, JSON.stringify({ ...old, version: 2 }));
  const db = (await new MatchRepository(storage).load()).database!;
  assert.deepEqual(db, old);
  const counts = aggregateMatchStats(db.matches[0]);
  assert.equal(counts.block.legacyTotal, 2);
  assert.equal(counts.block.total, 0);
  assert.equal(formatRate(counts.block.success, counts.block.legacyTotal), '50.0%');
  for (const category of ['serve', 'reception', 'dig', 'spike'] as const) assert.equal(counts[category].success, 1);
});

test('各保存キーの読込失敗時は移行保存や空データ書込を行わない', async () => {
  for (const failureKey of [MATCH_DATABASE_KEY, LEGACY_MATCH_DATABASE_KEY, SESSION_STORAGE_KEY]) {
    let writes = 0;
    const repo = new MatchRepository({
      async getItem(key: string) {
        if (key === failureKey) throw new Error('test read failure');
        return null;
      },
      async setItem() { writes++; },
    });
    await assert.rejects(repo.load());
    assert.equal(writes, 0);
  }
});

test('破損・未対応version・旧versionの新イベントはフォールバックや上書きをしない', async () => {
  for (const key of [MATCH_DATABASE_KEY, LEGACY_MATCH_DATABASE_KEY]) {
    for (const raw of ['{broken', JSON.stringify({ ...started(), version: 999 }),
      JSON.stringify({ ...record(started(), 'touch'), version: 2 })]) {
      const storage = new Storage();
      storage.values.set(key, raw);
      storage.values.set(SESSION_STORAGE_KEY, serializeSession([]));
      await assert.rejects(new MatchRepository(storage).load());
      assert.equal(storage.values.get(key), raw);
      assert.equal(storage.writes, 0);
    }
  }
});

test('旧形式の読込・書込で新イベントを拒否し、新形式の不正イベントも拒否する', () => {
  const input: PlayInput = { category: 'block', outcome: 'blockPoint' };
  assert.throws(() => serializeSession([input]));
  assert.throws(() => parseSession(JSON.stringify({ version: 1, activeSession: { history: [input], updatedAt: '2026-09-14T00:00:00Z' } })));
  const db = record(started(), 'touch');
  assert.throws(() => new MatchRepository(new Storage()).save({ ...db, version: 2 } as unknown as MatchDatabase));
  const invalid = JSON.parse(JSON.stringify(db));
  invalid.matches[0].sets[0].operations[0].input.outcome = 'ace';
  assert.throws(() => parseMatchDatabase(JSON.stringify(invalid)));
});

test('無効入力は状態を増やさず他の4項目にブロック結果を許可しない', () => {
  const db = started();
  for (const input of [null, { category: 'block', outcome: 'ace' }, { category: 'toString', outcome: 'touch' },
    ...(['serve', 'reception', 'dig', 'spike'].map(category => ({ category, outcome: 'touch' })))]) {
    assert.equal(isPlayInput(input), false);
    assert.throws(() => recordStat(db, input as PlayInput));
    assert.throws(() => matchReducer(createInitialState(), { type: 'record', input: input as PlayInput }));
  }
  const before = current(db);
  const after = current(record(db, 'blockPoint'));
  for (const category of ['serve', 'reception', 'dig', 'spike'] as const) assert.deepEqual(after.stats.counts[category], before.stats.counts[category]);
  assert.equal(after.homeScore, before.homeScore);
  assert.equal(after.awayScore, before.awayScore);
  assert.equal(current(db).stats.history.length, 0);
});

test('直前ラベルは新成功と旧成功を区別する', () => {
  assert.equal(describeInput({ category: 'block', outcome: 'success' }), 'ブロック（旧記録）・成功');
  assert.equal(describeInput({ category: 'block', outcome: 'blockPoint' }), 'ブロック・成功');
  assert.equal(describeInput({ category: 'block', outcome: 'jumped' }), 'ブロック・ジャンプのみ');
  assert.equal(describeInput({ category: 'block', outcome: 'touch' }), 'ブロック・ワンタッチ');
});

test('v1/v2移行から新操作追加・再起動・Undo・再保存・再復元まで旧記録を保持する', async () => {
  for (const version of [1, 2]) {
    let source = record(record(started(), 'success'), 'failure');
    for (const category of ['serve', 'reception', 'dig', 'spike'] as const) {
      source = recordStat(source, { category, outcome: 'success' });
    }
    // v2 fixture includes completed matches and multiple sets, not just an active set.
    source = startNextSet(completeCurrentSet(source, { home: 25, away: 18 }));
    source = record(source, 'failure');
    source = completeMatch(completeCurrentSet(source, { home: 25, away: 21 }), '2026-09-14T02:00:00Z');
    source = startMatch(source, { date: '2026-09-15', homeTeam: '保持A', awayTeam: '保持B' },
      { id: 'second-match', now: '2026-09-15T00:00:00Z' });
    source = setScore(record(source, 'success'), 'home', 9);
    const key = version === 1 ? SESSION_STORAGE_KEY : LEGACY_MATCH_DATABASE_KEY;
    const raw = version === 1 ? serializeSession([
      { category: 'block', outcome: 'success' }, { category: 'block', outcome: 'failure' },
      ...(['serve', 'reception', 'dig', 'spike'] as const).map(category => ({ category, outcome: 'success' as const })),
    ]) : JSON.stringify({ ...source, version: 2 });
    const storage = new Storage();
    storage.values.set(key, raw);
    const migrated = (await new MatchRepository(storage).load()).database!;
    if (version === 2) assert.deepEqual(migrated, source);
    let db = migrated;
    for (const outcome of ['jumped', 'touch', 'blockPoint'] as const) db = record(db, outcome);
    db = setScore(db, 'away', 7);
    await new MatchRepository(storage).save(db);
    const restored = (await new MatchRepository(storage).load()).database!;
    assert.deepEqual(restored, db);
    db = undoCurrentSet(restored);
    assert.equal(current(db).awayScore, current(migrated).awayScore);
    db = undoCurrentSet(db);
    assert.equal(current(db).stats.counts.block.blockPoint, 0);
    assert.equal(current(db).stats.counts.block.total, 2);
    await new MatchRepository(storage).save(db);
    db = (await new MatchRepository(storage).load()).database!;
    assert.deepEqual(db, undoCurrentSet(undoCurrentSet(restored)));
    db = undoCurrentSet(undoCurrentSet(db));
    assert.deepEqual(db, migrated);
    await new MatchRepository(storage).save(db);
    assert.deepEqual((await new MatchRepository(storage).load()).database, migrated);
    assert.equal(storage.values.get(key), raw);
  }
});
