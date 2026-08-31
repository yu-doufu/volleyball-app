import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createEmptyDatabase } from '@/lib/match-domain';
import type { MatchDatabase } from '@/lib/match-domain';
import { MatchRepository } from '@/lib/match-storage';
import { SessionStorageError } from '@/lib/session-storage';

export type DatabaseStatus =
  | Readonly<{ phase: 'loading' }>
  | Readonly<{ phase: 'saved'; migrated?: boolean }>
  | Readonly<{ phase: 'saving' }>
  | Readonly<{ phase: 'load-error'; message: string }>
  | Readonly<{ phase: 'save-error'; message: string }>;

const repository = new MatchRepository(AsyncStorage);

const messageFor = (error: unknown, fallback: string) =>
  error instanceof SessionStorageError ? error.message : fallback;

export function useMatchDatabase() {
  const [database, setDatabase] = useState<MatchDatabase | null>(null);
  const [status, setStatus] = useState<DatabaseStatus>({ phase: 'loading' });
  const databaseRef = useRef<MatchDatabase | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    databaseRef.current = null;
    setDatabase(null);
    setStatus({ phase: 'loading' });
    try {
      const result = await repository.load();
      const loaded = result.database ?? createEmptyDatabase();
      databaseRef.current = loaded;
      setDatabase(loaded);
      setStatus({ phase: 'saved', migrated: result.migrated });
    } catch (error) {
      setStatus({
        phase: 'load-error',
        message: messageFor(error, '試合記録を復元できませんでした。'),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(async (snapshot: MatchDatabase) => {
    const request = ++requestRef.current;
    setStatus({ phase: 'saving' });
    try {
      await repository.save(snapshot);
      if (request === requestRef.current) setStatus({ phase: 'saved' });
      return true;
    } catch (error) {
      if (request === requestRef.current) {
        setStatus({
          phase: 'save-error',
          message: messageFor(error, '試合記録を保存できませんでした。'),
        });
      }
      return false;
    }
  }, []);

  const update = useCallback(
    (change: (current: MatchDatabase) => MatchDatabase) => {
      const current = databaseRef.current;
      if (!current) return false;
      const next = change(current);
      if (next === current) return true;
      databaseRef.current = next;
      setDatabase(next);
      void persist(next);
      return true;
    },
    [persist],
  );

  const updateAndWait = useCallback(
    async (change: (current: MatchDatabase) => MatchDatabase) => {
      const current = databaseRef.current;
      if (!current) return false;
      const next = change(current);
      if (next === current) return persist(current);
      const saved = await persist(next);
      if (saved) {
        databaseRef.current = next;
        setDatabase(next);
      }
      return saved;
    },
    [persist],
  );

  const retry = useCallback(() => {
    if (status.phase === 'load-error') return load();
    const current = databaseRef.current;
    return current ? persist(current) : load();
  }, [load, persist, status.phase]);

  return {
    database,
    status,
    canOperate: database !== null && status.phase !== 'loading' && status.phase !== 'load-error',
    update,
    updateAndWait,
    retry,
  };
}
