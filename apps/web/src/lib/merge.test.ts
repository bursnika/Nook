import { applyEventChange, applyTaskChange } from './merge';
import { makeEvent, makeTask } from './testing';

describe('applyTaskChange', () => {
  it('adds a created task', () => {
    const existing = makeTask();
    const created = makeTask();
    const next = applyTaskChange([existing], {
      kind: 'created',
      taskId: created.id,
      task: created,
    });
    expect(next).toEqual([existing, created]);
  });

  it('replaces an updated task', () => {
    const task = makeTask({ status: 'TODO' });
    const moved = { ...task, status: 'DONE' as const, position: 9 };
    expect(applyTaskChange([task], { kind: 'updated', taskId: task.id, task: moved })).toEqual([
      moved,
    ]);
  });

  it('adds an updated task it has not seen yet', () => {
    const task = makeTask();
    expect(applyTaskChange([], { kind: 'updated', taskId: task.id, task })).toEqual([task]);
  });

  it('removes a deleted task', () => {
    const a = makeTask();
    const b = makeTask();
    expect(applyTaskChange([a, b], { kind: 'deleted', taskId: a.id, task: null })).toEqual([b]);
  });

  it('returns the very same list for an echo of what it already has, so nothing re-renders', () => {
    const task = makeTask();
    const list = [task, makeTask()];
    expect(applyTaskChange(list, { kind: 'updated', taskId: task.id, task: { ...task } })).toBe(
      list,
    );
    expect(applyTaskChange(list, { kind: 'created', taskId: task.id, task: { ...task } })).toBe(
      list,
    );
  });

  it('is idempotent when the same deletion arrives twice', () => {
    const task = makeTask();
    const once = applyTaskChange([task], { kind: 'deleted', taskId: task.id, task: null });
    expect(applyTaskChange(once, { kind: 'deleted', taskId: task.id, task: null })).toBe(once);
  });

  it('ignores a change that carries no task', () => {
    const list = [makeTask()];
    expect(applyTaskChange(list, { kind: 'updated', taskId: 'x', task: null })).toBe(list);
  });
});

describe('applyEventChange', () => {
  it('keeps the Google fields the live event does not carry', () => {
    const event = makeEvent({ imported: true, mine: true, editable: true, calendarName: 'Work' });
    const renamed = { ...makeEvent(), id: event.id, title: 'Renamed' };
    const [merged] = applyEventChange([event], {
      kind: 'updated',
      eventId: event.id,
      event: renamed,
    });
    expect(merged).toMatchObject({
      title: 'Renamed',
      imported: true,
      mine: true,
      calendarName: 'Work',
    });
  });

  it('removes a deleted event', () => {
    const a = makeEvent();
    const b = makeEvent();
    expect(applyEventChange([a, b], { kind: 'deleted', eventId: a.id, event: null })).toEqual([b]);
  });

  it('adds an unknown event', () => {
    const event = makeEvent();
    expect(applyEventChange([], { kind: 'created', eventId: event.id, event })).toEqual([event]);
  });
});
