import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateRate,
  CATEGORY_OUTCOMES,
  createInitialState,
  formatRate,
  matchReducer,
} from '../lib/volleyball-stats.ts';
import type { Category, PlayInput } from '../lib/volleyball-stats.ts';

const categories = Object.keys(CATEGORY_OUTCOMES) as Category[];

test('全14ボタンが合計と対応する内訳を1ずつ増やす', () => {
  const inputs: PlayInput[] = categories.flatMap((category) =>
    CATEGORY_OUTCOMES[category].map((outcome) => ({ category, outcome })),
  );
  assert.equal(inputs.length, 14);

  for (const input of inputs) {
    const initial = createInitialState();
    const next = matchReducer(initial, { type: 'record', input });
    assert.equal(next.counts[input.category].total, 1);
    assert.equal(next.counts[input.category][input.outcome], 1);
    assert.equal(next.history.length, 1);
  }
});

test('サーブ成功にエースを重複して含めない', () => {
  let state = createInitialState();
  state = matchReducer(state, {
    type: 'record',
    input: { category: 'serve', outcome: 'ace' },
  });
  assert.deepEqual(state.counts.serve, { total: 1, success: 0, ace: 1, miss: 0 });
});

test('Undoは直前の合計と内訳をまとめて戻し、順に何回でも戻せる', () => {
  let state = createInitialState();
  state = matchReducer(state, {
    type: 'record',
    input: { category: 'spike', outcome: 'success' },
  });
  state = matchReducer(state, {
    type: 'record',
    input: { category: 'spike', outcome: 'regular' },
  });
  state = matchReducer(state, { type: 'undo' });
  assert.deepEqual(state.counts.spike, { total: 1, success: 1, regular: 0, miss: 0 });
  state = matchReducer(state, { type: 'undo' });
  assert.deepEqual(state.counts.spike, { total: 0, success: 0, regular: 0, miss: 0 });
});

test('履歴0件のUndoは状態を変更しない', () => {
  const state = createInitialState();
  assert.strictEqual(matchReducer(state, { type: 'undo' }), state);
});

test('分母0の率は0で、計算値は表示丸め前の数値を保つ', () => {
  assert.equal(calculateRate(0, 0), 0);
  assert.ok(Math.abs(calculateRate(1, 3) - 100 / 3) < 1e-12);
  assert.equal(formatRate(0, 0), '0.0%');
  assert.equal(formatRate(1, 3), '33.3%');
});

test('各項目で内訳の合計が本数と一致する', () => {
  let state = createInitialState();
  for (const category of categories) {
    for (const outcome of CATEGORY_OUTCOMES[category]) {
      state = matchReducer(state, { type: 'record', input: { category, outcome } });
    }
  }

  for (const category of categories) {
    const counts = state.counts[category];
    const detailTotal = CATEGORY_OUTCOMES[category].reduce(
      (sum, outcome) => sum + counts[outcome],
      0,
    );
    assert.equal(detailTotal, counts.total);
  }
});
