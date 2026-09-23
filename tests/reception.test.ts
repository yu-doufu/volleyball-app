import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateMatchStats, completeCurrentSet, completeMatch, createEmptyDatabase, deriveSet, getActiveMatch, getCurrentSet, recordStat, setScore, startMatch, startNextSet, undoCurrentSet } from '../lib/match-domain.ts';
import type { MatchDatabase } from '../lib/match-domain.ts';
import { LEGACY_MATCH_DATABASE_KEY, MATCH_DATABASE_KEY, V3_MATCH_DATABASE_KEY, MatchRepository, parseMatchDatabase } from '../lib/match-storage.ts';
import { SESSION_STORAGE_KEY, parseSession, serializeSession } from '../lib/session-storage.ts';
import { describeInput, isPlayInput, receptionRates } from '../lib/volleyball-stats.ts';
import type { Outcome, PlayInput } from '../lib/volleyball-stats.ts';

const started = () => startMatch(createEmptyDatabase(), { date: '2026-09-14', homeTeam: '保持A', awayTeam: '保持B' }, { id: 'reception-test', now: '2026-09-14T00:00:00Z' });
const add = (db: MatchDatabase, outcome: Outcome) => recordStat(db, { category: 'reception', outcome });
const current = (db: MatchDatabase) => deriveSet(getCurrentSet(getActiveMatch(db)!)!);
const rates = (db: MatchDatabase) => receptionRates(current(db).stats.counts.reception).map(rate => rate.value);
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

test('A2/B1/ミス1は排他的な4操作、Undoで内訳と表示率を再計算する', () => {
  let db = started();
  assert.deepEqual(rates(db), ['0.0%', '0.0%', '0.0%']);
  for (const outcome of ['receptionA', 'receptionA', 'receptionB', 'receptionMiss'] as const) db = add(db, outcome);
  assert.deepEqual(current(db).stats.counts.reception, { total: 4, receptionA: 2, receptionB: 1, receptionMiss: 1, legacyTotal: 0, success: 0, miss: 0 });
  assert.equal(current(db).stats.history.length, 4);
  assert.deepEqual(rates(db), ['50.0%', '25.0%', '75.0%']);
  db = undoCurrentSet(db);
  assert.equal(current(db).stats.counts.reception.total, 3);
  assert.equal(current(db).stats.counts.reception.receptionMiss, 0);
  assert.deepEqual(rates(db), ['66.7%', '33.3%', '100.0%']);
});

test('旧成功・旧ミスは新本数や新率に混ぜず新旧ミスをUndoできる', () => {
  let db = add(add(started(), 'success'), 'miss');
  assert.deepEqual(rates(db), ['0.0%', '0.0%', '0.0%']);
  db = add(add(db, 'receptionA'), 'receptionMiss');
  let c = current(db).stats.counts.reception;
  assert.equal(c.legacyTotal, 2);
  assert.equal(c.total, 2);
  assert.equal(c.miss, 1);
  assert.equal(c.receptionMiss, 1);
  assert.deepEqual(rates(db), ['50.0%', '0.0%', '50.0%']);
  db = undoCurrentSet(undoCurrentSet(db));
  assert.equal(current(db).stats.counts.reception.miss, 1);
  db = undoCurrentSet(db);
  c = current(db).stats.counts.reception;
  assert.equal(c.legacyTotal, 1);
  assert.equal(c.success, 1);
  assert.equal(c.miss, 0);
  assert.equal(c.total, 0);
});

test('連打300件を直列保存し、復元後も得点との操作順Undoと他項目を保持する', async () => {
  let db = setScore(started(), 'home', 8);
  for (const category of ['spike', 'dig', 'serve'] as const) db = recordStat(db, { category, outcome: 'success' });
  db = recordStat(db, { category: 'block', outcome: 'touch' });
  const before = db;
  const storage = new Storage();
  const repo = new MatchRepository(storage);
  const pending: Promise<void>[] = [];
  for (let i = 0; i < 300; i++) {
    db = add(db, (['receptionA', 'receptionB', 'receptionMiss'] as const)[i % 3]);
    pending.push(repo.save(db));
  }
  assert.equal(current(db).homeScore, 8);
  assert.equal(current(db).awayScore, null);
  db = setScore(db, 'away', 9);
  pending.push(repo.save(db));
  await Promise.all(pending);
  assert.deepEqual((await new MatchRepository(storage).load()).database, db);
  db = undoCurrentSet(db);
  assert.equal(current(db).stats.counts.reception.total, 300);
  for (let i = 0; i < 300; i++) db = undoCurrentSet(db);
  assert.deepEqual(db, before);
});

test('セット率の平均ではなく件数で試合合計を計算し履歴復元とセット境界を保つ', async () => {
  let db = add(started(), 'receptionA');
  db = startNextSet(completeCurrentSet(db, { home: 25, away: 20 }));
  db = undoCurrentSet(db);
  assert.equal(db.matches[0].sets[0].operations.length, 1);
  db = add(add(add(db, 'receptionB'), 'receptionMiss'), 'receptionMiss');
  const c = aggregateMatchStats(db.matches[0]).reception;
  assert.deepEqual(receptionRates(c).map(rate => rate.value), ['25.0%', '25.0%', '50.0%']);
  assert.equal(c.total, db.matches[0].sets.reduce((sum, set) => sum + deriveSet(set).stats.counts.reception.total, 0));
  db = completeMatch(completeCurrentSet(db, { home: 20, away: 25 }), '2026-09-14T02:00:00Z');
  const repo = new MatchRepository(new Storage());
  await repo.save(db);
  assert.deepEqual(aggregateMatchStats((await repo.load()).database!.matches[0]).reception, c);
});

test('v1/v2/v3からv4へ移行し新操作追記・保存・復元・Undo・再保存でも全記録と旧キーを保持する', async () => {
  for (const version of [1, 2, 3] as const) {
    let old = add(add(started(), 'success'), 'miss');
    for (const category of ['spike', 'dig', 'serve'] as const) old = recordStat(old, { category, outcome: 'success' });
    old = recordStat(old, { category: 'block', outcome: version === 3 ? 'blockPoint' : 'success' });
    old = startNextSet(completeCurrentSet(old, { home: 25, away: 18 }));
    old = add(old, 'miss');
    old = completeMatch(completeCurrentSet(old, { home: 25, away: 22 }), '2026-09-14T01:00:00Z');
    old = startMatch(old, { date: '2026-09-15', homeTeam: '次A', awayTeam: '次B' }, { id: 'second', now: '2026-09-15T00:00:00Z' });
    old = setScore(add(old, 'miss'), 'home', 6);
    const key = version === 1 ? SESSION_STORAGE_KEY : version === 2 ? LEGACY_MATCH_DATABASE_KEY : V3_MATCH_DATABASE_KEY;
    const raw = version === 1 ? serializeSession([{ category: 'reception', outcome: 'success' }, { category: 'reception', outcome: 'miss' }]) : JSON.stringify({ ...old, version });
    const storage = new Storage();
    storage.values.set(key, raw);
    const migrated = (await new MatchRepository(storage).load()).database!;
    assert.equal(migrated.version, 4);
    if (version !== 1) assert.deepEqual(migrated, old);
    else {
      assert.equal(current(migrated).stats.counts.reception.legacyTotal, 2);
      assert.equal(migrated.matches[0].date, null);
    }
    let db = migrated;
    for (const outcome of ['receptionA', 'receptionB', 'receptionMiss'] as const) db = add(db, outcome);
    await new MatchRepository(storage).save(db);
    db = (await new MatchRepository(storage).load()).database!;
    assert.equal(current(db).stats.counts.reception.total, 3);
    db = undoCurrentSet(db);
    await new MatchRepository(storage).save(db);
    assert.deepEqual((await new MatchRepository(storage).load()).database, db);
    db = undoCurrentSet(undoCurrentSet(db));
    assert.deepEqual(db, migrated);
    await new MatchRepository(storage).save(db);
    assert.deepEqual((await new MatchRepository(storage).load()).database, migrated);
    assert.equal(storage.values.get(key), raw);
  }
});

test('v1/v2/v3移行保存失敗時は旧キーを保持し、成功した再試行後だけv4を採用する', async () => {
  for (const version of [1, 2, 3] as const) {
    const storage = new Storage();
    const key = version === 1 ? SESSION_STORAGE_KEY : version === 2 ? LEGACY_MATCH_DATABASE_KEY : V3_MATCH_DATABASE_KEY;
    const raw = version === 1 ? serializeSession([{ category: 'reception', outcome: 'miss' }]) : JSON.stringify({ ...add(started(), 'miss'), version });
    storage.values.set(key, raw);
    storage.fail = true;
    await assert.rejects(new MatchRepository(storage).load());
    assert.equal(storage.values.has(MATCH_DATABASE_KEY), false);
    assert.equal(storage.values.get(key), raw);
    storage.fail = false;
    assert.equal((await new MatchRepository(storage).load()).database!.version, 4);
    assert.equal(storage.values.get(key), raw);
  }
});

test('旧versionは新A/B/ミスを受理・保存せず、破損した優先キーをフォールバックで上書きしない', async () => {
  for (const outcome of ['receptionA', 'receptionB', 'receptionMiss'] as const) {
    const input: PlayInput = { category: 'reception', outcome };
    assert.throws(() => serializeSession([input]));
    assert.throws(() => parseSession(JSON.stringify({ version: 1, activeSession: { history: [input], updatedAt: '2026-09-14T00:00:00Z' } })));
    for (const version of [2, 3] as const) {
      const data = { ...add(started(), outcome), version };
      assert.throws(() => parseMatchDatabase(JSON.stringify(data), version));
      assert.throws(() => new MatchRepository(new Storage()).save(data as unknown as MatchDatabase));
    }
  }
  for (const key of [MATCH_DATABASE_KEY, V3_MATCH_DATABASE_KEY, LEGACY_MATCH_DATABASE_KEY, SESSION_STORAGE_KEY]) {
    for (const raw of ['{broken', '{"version":999}']) {
      const storage = new Storage();
      storage.values.set(SESSION_STORAGE_KEY, serializeSession([]));
      storage.values.set(key, raw);
      await assert.rejects(new MatchRepository(storage).load());
      assert.equal(storage.values.get(key), raw);
      assert.equal(storage.writes, 0);
    }
  }
});

test('v3読込失敗は空保存せず、v4が存在すれば旧v3へ戻らない', async () => {
  let writes = 0;
  await assert.rejects(new MatchRepository({
    async getItem(key) { if (key === V3_MATCH_DATABASE_KEY) throw new Error('test read failure'); return null; },
    async setItem() { writes++; },
  }).load());
  assert.equal(writes, 0);
  const storage = new Storage();
  const db = add(started(), 'receptionB');
  await new MatchRepository(storage).save(db);
  storage.values.set(V3_MATCH_DATABASE_KEY, '{broken');
  assert.deepEqual((await new MatchRepository(storage).load()).database, db);
});

test('直前ラベルは新A/B/ミスと旧成功/ミスを区別し無効カテゴリを拒否する', () => {
  for (const [outcome, label] of [['receptionA', 'Aパス'], ['receptionB', 'Bパス'], ['receptionMiss', 'ミス']] as const) {
    assert.equal(describeInput({ category: 'reception', outcome }), `レセプション・${label}`);
    for (const category of ['serve', 'block', 'dig', 'spike'] as const) assert.equal(isPlayInput({ category, outcome }), false);
  }
  assert.equal(describeInput({ category: 'reception', outcome: 'miss' }), 'レセプション（旧記録）・ミス');
  assert.equal(describeInput({ category: 'reception', outcome: 'success' }), 'レセプション（旧記録）・成功');
});
