import assert from 'node:assert/strict';
import test from 'node:test';
import { InputHighlight } from '../lib/input-highlight.ts';
import { CATEGORY_OUTCOMES, createInitialState, matchReducer } from '../lib/volleyball-stats.ts';
import type { Category, PlayInput } from '../lib/volleyball-stats.ts';

function setup() {
  let now = 0;
  const tasks: { due: number; callback: () => void; cancelled: boolean }[] = [];
  const notifications: (string | null)[] = [];
  const controller = new InputHighlight(value => notifications.push(value), {
    schedule(callback, delay) {
      const task = { due: now + delay, callback, cancelled: false };
      tasks.push(task);
      return () => { task.cancelled = true; };
    },
  });
  const advance = (ms: number) => {
    now += ms;
    for (const task of tasks) {
      if (!task.cancelled && task.due <= now) {
        task.cancelled = true;
        task.callback();
      }
    }
  };
  return { controller, notifications, tasks, advance };
}
const jump: PlayInput = { category: 'block', outcome: 'jumped' };

test('全14入力で受付後だけ1ボタンを600ms強調する', () => {
  for (const category of Object.keys(CATEGORY_OUTCOMES) as Category[]) {
    for (const outcome of CATEGORY_OUTCOMES[category]) {
      const f = setup();
      assert.equal(f.controller.record({ category, outcome }, () => {
        assert.deepEqual(f.notifications, []);
        return true;
      }), true);
      assert.deepEqual(f.notifications, [`${category}:${outcome}`]);
      f.advance(599);
      assert.equal(f.notifications.length, 1);
      f.advance(1);
      assert.equal(f.notifications.at(-1), null);
      f.controller.dispose();
    }
  }
});

test('受付拒否・例外・無効入力は新しい強調やタイマーを作らない', () => {
  const f = setup();
  assert.equal(f.controller.record(jump, () => false), false);
  assert.throws(() => f.controller.record(jump, () => { throw new Error('rejected'); }));
  for (const input of [{ category: 'block', outcome: 'ace' }, { category: 'block', outcome: 'success' }, null]) {
    assert.equal(f.controller.record(input as PlayInput, () => { assert.fail('invalid input accepted'); }), false);
  }
  assert.deepEqual(f.notifications, []);
  assert.equal(f.tasks.length, 0);
});

test('同じボタンの連打をすべて記録し最後の受付から600msへ更新する', () => {
  const f = setup();
  let state = createInitialState();
  for (let i = 0; i < 30; i++) {
    f.controller.record(jump, input => {
      state = matchReducer(state, { type: 'record', input });
      return true;
    });
    if (i < 29) f.advance(10);
  }
  assert.equal(state.history.length, 30);
  assert.equal(state.counts.block.total, 30);
  // Deliberately invoke an already cancelled callback to simulate a queued old timer.
  f.tasks[0].callback();
  assert.equal(f.notifications.at(-1), 'block:jumped');
  f.advance(599);
  assert.equal(f.notifications.at(-1), 'block:jumped');
  f.advance(1);
  assert.equal(f.notifications.at(-1), null);
});

test('別ボタンへ強調を移し、拒否入力は直前の受付時刻を延長しない', () => {
  const f = setup();
  f.controller.record(jump, () => true);
  f.advance(100);
  f.controller.record({ category: 'block', outcome: 'touch' }, () => true);
  f.tasks[0].callback();
  f.advance(400);
  f.controller.record({ category: 'block', outcome: 'blockPoint' }, () => false);
  assert.equal(f.tasks.length, 2);
  assert.equal(f.notifications.at(-1), 'block:touch');
  f.advance(200);
  assert.equal(f.notifications.at(-1), null);
});

test('Undo・切替・離脱の破棄後は古いタイマーや入力で通知しない', () => {
  for (const reason of ['undo', 'match', 'set', 'leave', 'unmount']) {
    const f = setup();
    f.controller.record(jump, () => true);
    f.controller.dispose();
    const before = [...f.notifications];
    f.tasks[0].callback();
    f.advance(600);
    assert.equal(f.controller.record(jump, () => { assert.fail(reason); }), false);
    assert.deepEqual(f.notifications, before);
    const next = setup();
    assert.deepEqual(next.notifications, []);
    next.controller.dispose();
  }
});
