import assert from 'node:assert/strict';
import test from 'node:test';

import { createStateFromHistory, matchReducer } from '../lib/volleyball-stats.ts';
import type { PlayInput } from '../lib/volleyball-stats.ts';
import {
  SESSION_STORAGE_KEY,
  SessionRepository,
  SessionStorageError,
} from '../lib/session-storage.ts';
import type { KeyValueStorage } from '../lib/session-storage.ts';

class MemoryStorage implements KeyValueStorage {
  value: string | null = null;
  getError: Error | null = null;
  setError: Error | null = null;
  setCalls = 0;

  async getItem(key: string): Promise<string | null> {
    assert.equal(key, SESSION_STORAGE_KEY);
    if (this.getError) throw this.getError;
    return this.value;
  }

  async setItem(key: string, value: string): Promise<void> {
    assert.equal(key, SESSION_STORAGE_KEY);
    this.setCalls += 1;
    if (this.setError) throw this.setError;
    this.value = value;
  }
}

const history: PlayInput[] = [
  { category: 'serve', outcome: 'ace' },
  { category: 'spike', outcome: 'regular' },
  { category: 'dig', outcome: 'success' },
];

test('イベント履歴を保存して復元する', async () => {
  const storage = new MemoryStorage();
  const repository = new SessionRepository(storage, () => new Date('2026-08-31T00:00:00Z'));
  await repository.save(history);
  assert.deepEqual(await repository.load(), history);
  assert.match(storage.value ?? '', /"version":1/);
});

test('復元履歴から集計し、復元後のUndoが直前イベントを戻す', () => {
  const restored = createStateFromHistory(history);
  assert.equal(restored.counts.serve.ace, 1);
  assert.equal(restored.counts.spike.regular, 1);
  const undone = matchReducer(restored, { type: 'undo' });
  assert.equal(undone.counts.dig.total, 0);
  assert.equal(undone.history.length, 2);
});

test('連続保存を直列化し、最後の記録が必ず残る', async () => {
  let releaseFirst: (() => void) | undefined;
  const writes: string[] = [];
  const storage: KeyValueStorage = {
    async getItem() {
      return null;
    },
    async setItem(_key, value) {
      writes.push(value);
      if (writes.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
    },
  };
  const repository = new SessionRepository(storage);
  const first = repository.save(history.slice(0, 1));
  const second = repository.save(history);
  await Promise.resolve();
  assert.equal(writes.length, 1);
  releaseFirst?.();
  await Promise.all([first, second]);
  assert.equal(writes.length, 2);
  assert.deepEqual(JSON.parse(writes[1]).activeSession.history, history);
});

test('読込失敗を通知する', async () => {
  const storage = new MemoryStorage();
  storage.getError = new Error('read failed');
  await assert.rejects(
    new SessionRepository(storage).load(),
    (error: unknown) => error instanceof SessionStorageError && error.kind === 'read',
  );
});

test('書込失敗後も未保存履歴を再試行できる', async () => {
  const storage = new MemoryStorage();
  const repository = new SessionRepository(storage);
  storage.setError = new Error('write failed');
  await assert.rejects(
    repository.save(history),
    (error: unknown) => error instanceof SessionStorageError && error.kind === 'write',
  );
  storage.setError = null;
  await repository.save(history);
  assert.deepEqual(await repository.load(), history);
});

test('壊れたJSONを削除・上書きせず復元失敗にする', async () => {
  const storage = new MemoryStorage();
  storage.value = '{broken';
  const original = storage.value;
  await assert.rejects(
    new SessionRepository(storage).load(),
    (error: unknown) => error instanceof SessionStorageError && error.kind === 'invalid-data',
  );
  assert.equal(storage.value, original);
  assert.equal(storage.setCalls, 0);
});

test('不正イベントと未対応versionを削除・上書きしない', async () => {
  const invalidValues = [
    JSON.stringify({
      version: 1,
      activeSession: {
        history: [{ category: 'serve', outcome: 'unknown' }],
        updatedAt: '2026-08-31T00:00:00.000Z',
      },
    }),
    JSON.stringify({ version: 999, activeSession: { history: [], updatedAt: '' } }),
  ];

  for (const value of invalidValues) {
    const storage = new MemoryStorage();
    storage.value = value;
    await assert.rejects(new SessionRepository(storage).load(), SessionStorageError);
    assert.equal(storage.value, value);
    assert.equal(storage.setCalls, 0);
  }
});
