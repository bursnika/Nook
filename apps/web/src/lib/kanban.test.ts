import {
  applyPlacements,
  columnsOf,
  dragEnd,
  dragOver,
  endOf,
  findColumn,
  moveToColumn,
  placements,
} from './kanban';
import { STEP } from './position';
import { makeTask } from './testing';

const board = () => {
  const a = makeTask({ id: 'a', status: 'TODO', position: 1024 });
  const b = makeTask({ id: 'b', status: 'TODO', position: 2048 });
  const c = makeTask({ id: 'c', status: 'TODO', position: 3072 });
  const d = makeTask({ id: 'd', status: 'IN_PROGRESS', position: 1024 });
  return [c, a, d, b];
};

describe('columnsOf', () => {
  it('groups by status and orders by position', () => {
    expect(columnsOf(board())).toEqual({
      TODO: ['a', 'b', 'c'],
      IN_PROGRESS: ['d'],
      ON_HOLD: [],
      DONE: [],
    });
  });

  it('breaks position ties by id so the order is stable', () => {
    const tasks = [makeTask({ id: 'y', position: 1 }), makeTask({ id: 'x', position: 1 })];
    expect(columnsOf(tasks).TODO).toEqual(['x', 'y']);
  });
});

describe('findColumn', () => {
  it('finds a card, and a column by its own id', () => {
    const columns = columnsOf(board());
    expect(findColumn(columns, 'd')).toBe('IN_PROGRESS');
    expect(findColumn(columns, 'DONE')).toBe('DONE');
    expect(findColumn(columns, 'nope')).toBeUndefined();
  });
});

describe('dragOver / dragEnd', () => {
  it('moves a card into another column next to the card it hovers', () => {
    const next = dragOver(columnsOf(board()), 'a', 'd', false);
    expect(next.TODO).toEqual(['b', 'c']);
    expect(next.IN_PROGRESS).toEqual(['a', 'd']);
  });

  it('puts it after the hovered card when the pointer is below its middle', () => {
    expect(dragOver(columnsOf(board()), 'a', 'd', true).IN_PROGRESS).toEqual(['d', 'a']);
  });

  it('appends to an empty column when hovering the column itself', () => {
    expect(dragOver(columnsOf(board()), 'a', 'DONE', false).DONE).toEqual(['a']);
  });

  it('ignores hovering inside the same column', () => {
    const columns = columnsOf(board());
    expect(dragOver(columns, 'a', 'c', false)).toBe(columns);
  });

  it('reorders inside a column on drop', () => {
    expect(dragEnd(columnsOf(board()), 'a', 'c').TODO).toEqual(['b', 'c', 'a']);
  });
});

describe('placements', () => {
  it('gives a card dropped between two others a position between them', () => {
    const tasks = board();
    const last = { ...columnsOf(tasks), TODO: ['a', 'c', 'b'] };
    expect(placements(last, tasks, 'b')).toEqual([
      { id: 'b', status: 'TODO', position: 3072 + STEP },
    ]);
    const middle = { ...columnsOf(tasks), TODO: ['a', 'c', 'b'] };
    expect(placements(middle, tasks, 'c')).toEqual([{ id: 'c', status: 'TODO', position: 1536 }]);
  });

  it('takes the position from the new column when a card changes column', () => {
    const tasks = board();
    const columns = dragOver(columnsOf(tasks), 'a', 'd', false);
    const [change] = placements(columns, tasks, 'a');
    expect(change?.status).toBe('IN_PROGRESS');
    expect(change?.position).toBe(1024 - STEP);
  });

  it('renumbers the whole column when two neighbours have no room between them', () => {
    const tasks = [
      makeTask({ id: 'p', position: 1 }),
      makeTask({ id: 'q', position: 1 }),
      makeTask({ id: 'r', position: 1 }),
    ];
    const columns = { TODO: ['p', 'r', 'q'], IN_PROGRESS: [], ON_HOLD: [], DONE: [] };
    const result = placements(columns, tasks, 'r');
    expect(result.map((change) => change.id)).toEqual(['p', 'r', 'q']);
    expect(result.map((change) => change.position)).toEqual([STEP, 2 * STEP, 3 * STEP]);
  });
});

describe('moveToColumn', () => {
  it('puts the card at the bottom of the target column', () => {
    const tasks = board();
    expect(moveToColumn(tasks, 'a', 'IN_PROGRESS')).toEqual([
      { id: 'a', status: 'IN_PROGRESS', position: 2048 },
    ]);
  });

  it('starts an empty column at one step', () => {
    expect(moveToColumn(board(), 'd', 'DONE')).toEqual([
      { id: 'd', status: 'DONE', position: STEP },
    ]);
  });

  it('does nothing for the column the card is already in', () => {
    expect(moveToColumn(board(), 'a', 'TODO')).toEqual([]);
  });
});

describe('applyPlacements / endOf', () => {
  it('updates status and position of the placed cards only', () => {
    const tasks = board();
    const next = applyPlacements(tasks, [{ id: 'a', status: 'DONE', position: 5 }]);
    expect(next.find((task) => task.id === 'a')).toMatchObject({ status: 'DONE', position: 5 });
    expect(next.find((task) => task.id === 'b')).toBe(tasks.find((task) => task.id === 'b'));
  });

  it('finds the position below a column', () => {
    expect(endOf(board(), 'TODO')).toBe(3072 + STEP);
    expect(endOf(board(), 'DONE')).toBe(STEP);
    expect(endOf(board(), 'TODO', 'c')).toBe(2048 + STEP);
  });
});
