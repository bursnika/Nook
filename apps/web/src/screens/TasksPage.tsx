import { useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../components/ui';
import { endOf } from '../lib/kanban';
import type { Task, TaskStatus } from '../lib/types';
import { useWorkspace } from '../lib/workspace';
import { Board } from './tasks/Board';
import { PeopleContext, useMembers } from './tasks/members';
import { TaskDialog } from './tasks/TaskDialog';
import { useTasks } from './tasks/useTasks';
import '../styles/kanban.css';

export default function TasksPage() {
  const { workspace, role } = useWorkspace();
  const board = useTasks(workspace.id);
  const { members, people } = useMembers(workspace.id);
  const [editing, setEditing] = useState<Task | 'new' | undefined>();
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState<string>();

  if (board.loading) return <LoadingState label="Loading the board" />;
  if (board.error) return <ErrorState error={board.error} onRetry={() => void board.reload()} />;

  const fail = (error: unknown) =>
    setProblem(error instanceof Error ? error.message : 'Could not save that change');

  const open =
    editing && editing !== 'new'
      ? (board.tasks.find((task) => task.id === editing.id) ?? editing)
      : undefined;

  return (
    <PeopleContext.Provider value={people}>
      <div className="tasks">
        <div className="page-head">
          <h2>Board</h2>
          <span className={`live live--${board.live}`} role="status">
            {board.live === 'live'
              ? 'Live'
              : board.live === 'connecting'
                ? 'Connecting'
                : 'Offline'}
          </span>
          <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
            New task
          </button>
        </div>
        {problem && (
          <p className="form-error" role="alert">
            {problem}{' '}
            <button type="button" className="btn btn--small" onClick={() => setProblem(undefined)}>
              Dismiss
            </button>
          </p>
        )}
        {board.tasks.length === 0 && (
          <EmptyState title="The board is empty" icon="tasks">
            Add the first card with “+ Add card” under any column.
          </EmptyState>
        )}
        <Board
          tasks={board.tasks}
          announce={setMessage}
          onOpen={setEditing}
          onPlace={(changes) => {
            setProblem(undefined);
            void board.place(changes).catch(fail);
          }}
          onCreate={async (status: TaskStatus, title: string) => {
            await board.create({ title, status });
          }}
        />
        <p className="sr-only" role="status" aria-live="assertive">
          {message}
        </p>
        {editing && (
          <TaskDialog
            key={editing === 'new' ? 'new' : editing.id}
            task={open}
            workspaceId={workspace.id}
            members={members}
            canModerate={role === 'OWNER' || role === 'ADMIN'}
            onClose={() => setEditing(undefined)}
            onChanged={() => {
              if (editing !== 'new') void board.refresh(editing.id).catch(fail);
            }}
            onSave={async (values) => {
              if (editing === 'new') {
                await board.create({ ...values, position: endOf(board.tasks, values.status) });
                return;
              }
              const moved = values.status !== (open ?? editing).status;
              await board.patch(editing.id, {
                ...values,
                ...(moved ? { position: endOf(board.tasks, values.status, editing.id) } : {}),
              });
            }}
            onDelete={editing === 'new' ? undefined : () => board.remove(editing.id)}
          />
        )}
      </div>
    </PeopleContext.Provider>
  );
}
