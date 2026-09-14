import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyDatabase, deriveSet, getActiveMatch } from '../lib/match-domain.ts';
import { MATCH_DATABASE_KEY, MatchRepository } from '../lib/match-storage.ts';
import { serializeSession, SESSION_STORAGE_KEY, SessionStorageError } from '../lib/session-storage.ts';
import type { KeyValueStorage } from '../lib/session-storage.ts';

class Storage implements KeyValueStorage {
  values = new Map<string, string>();
  failCurrentWrites = 0;
  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    if (key === MATCH_DATABASE_KEY && this.failCurrentWrites-- > 0) throw new Error('write failed');
    this.values.set(key, value);
  }
}

test('version 4を保存し途中再起動相当で復元する', async () => {
  const storage = new Storage();
  const repository = new MatchRepository(storage);
  const database = { ...createEmptyDatabase(), defaultHomeTeam: '引継チーム' };
  await repository.save(database);
  assert.deepEqual((await new MatchRepository(storage).load()).database, database);
});

test('version 1を未完了試合の第1セットへ移行しUndo履歴を保つ', async () => {
  const storage = new Storage();
  const legacy = serializeSession(
    [{ category: 'serve', outcome: 'ace' }],
    () => new Date('2026-08-31T00:00:00Z'),
  );
  storage.values.set(SESSION_STORAGE_KEY, legacy);
  const result = await new MatchRepository(storage).load();
  assert.equal(result.migrated, true);
  const match = getActiveMatch(result.database!)!;
  assert.equal(match.migratedFromV1, true);
  assert.equal(match.homeTeam, null);
  assert.equal(match.awayTeam, null);
  assert.equal(match.date, null);
  assert.equal(deriveSet(match.sets[0]).stats.counts.serve.ace, 1);
  assert.equal(match.sets[0].operations.length, 1);
  assert.equal(storage.values.get(SESSION_STORAGE_KEY), legacy);
});

test('移行保存失敗時は旧データを維持し、再起動で安全に再試行する', async () => {
  const storage = new Storage();
  const legacy = serializeSession([], () => new Date('2026-08-31T00:00:00Z'));
  storage.values.set(SESSION_STORAGE_KEY, legacy);
  storage.failCurrentWrites = 1;
  await assert.rejects(new MatchRepository(storage).load(), SessionStorageError);
  assert.equal(storage.values.get(SESSION_STORAGE_KEY), legacy);
  assert.equal(storage.values.has(MATCH_DATABASE_KEY), false);
  const retry = await new MatchRepository(storage).load();
  assert.equal(retry.migrated, true);
  assert.equal(retry.database?.matches.length, 1);
});

test('壊れたversion 4を旧データで上書きしない', async () => {
  const storage = new Storage();
  storage.values.set(MATCH_DATABASE_KEY, '{broken');
  storage.values.set(SESSION_STORAGE_KEY, serializeSession([]));
  await assert.rejects(new MatchRepository(storage).load(), SessionStorageError);
  assert.equal(storage.values.get(MATCH_DATABASE_KEY), '{broken');
});

test('version 4の連続書込を直列化して最後の状態を残す', async () => {
  let release: (() => void) | undefined;
  const writes: string[] = [];
  const storage: KeyValueStorage = {
    async getItem() { return null; },
    async setItem(_key, value) {
      writes.push(value);
      if (writes.length === 1) await new Promise<void>((resolve) => { release = resolve; });
    },
  };
  const repository = new MatchRepository(storage);
  const first = repository.save(createEmptyDatabase());
  const latest = { ...createEmptyDatabase(), defaultHomeTeam: '最新チーム' };
  const second = repository.save(latest);
  await Promise.resolve();
  assert.equal(writes.length, 1);
  release?.();
  await Promise.all([first, second]);
  assert.equal(writes.length, 2);
  assert.equal(JSON.parse(writes[1]).defaultHomeTeam, '最新チーム');
});

test('version 4保存失敗で渡した記録を変更せず再試行できる', async () => {
  const storage = new Storage();
  const database = { ...createEmptyDatabase(), defaultHomeTeam: 'メモリ上の記録' };
  storage.failCurrentWrites = 1;
  const repository = new MatchRepository(storage);
  await assert.rejects(repository.save(database), SessionStorageError);
  assert.equal(database.defaultHomeTeam, 'メモリ上の記録');
  assert.equal(storage.values.has(MATCH_DATABASE_KEY), false);
  await repository.save(database);
  assert.deepEqual((await repository.load()).database, database);
});
