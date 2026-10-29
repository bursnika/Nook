import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeTask } from '../../lib/testing';
import type { Attachment, Member, TaskComment } from '../../lib/types';
import { rejectReason } from './TaskFiles';
import { TaskDialog } from './TaskDialog';

vi.mock('../../lib/session', () => ({
  useMe: () => ({ id: 'u-me', name: 'Ann Lee', email: 'ann@example.com', avatarUrl: null }),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const member = (id: string, name: string, role: Member['role'] = 'MEMBER'): Member => ({
  id: `m-${id}`,
  role,
  user: { id, name, email: `${id}@example.com`, avatarUrl: null },
});
const MEMBERS = [member('u-me', 'Ann Lee', 'OWNER'), member('u-bob', 'Bob Stone')];

const comment = (id: string, author: Member['user'], body: string): TaskComment => ({
  id,
  body,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  author: { id: author.id, name: author.name, avatarUrl: null },
});

const file = (id: string, filename: string, mimeType = 'text/plain'): Attachment => ({
  id,
  filename,
  mimeType,
  url: `/uploads/${id}.txt`,
  size: 2048,
  createdAt: '2026-11-01T10:00:00.000Z',
});

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function server(initial: { comments?: TaskComment[]; files?: Attachment[] } = {}) {
  const calls: Call[] = [];
  let comments = [...(initial.comments ?? [])];
  const files = [...(initial.files ?? [])];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body =
        init?.body instanceof FormData
          ? Object.fromEntries(init.body.entries())
          : init?.body
            ? JSON.parse(String(init.body))
            : undefined;
      calls.push({ method, url, body });
      if (url.includes('/comments')) {
        if (method === 'POST') {
          const made = comment(`c${comments.length + 1}`, MEMBERS[0]!.user, body.body);
          comments.push(made);
          return json(made, 201);
        }
        if (method === 'DELETE') {
          comments = comments.filter((c) => !url.endsWith(c.id));
          return new Response(null, { status: 204 });
        }
        return json(comments);
      }
      if (url.includes('/attachments')) {
        if (method === 'POST') {
          const upload = body.file as File;
          return json(file('f-new', upload.name), 201);
        }
        return json({ items: files, total: files.length, skip: 0, limit: 100, nextLink: null });
      }
      return json({});
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

function open(
  overrides: Parameters<typeof makeTask>[0] = {},
  props: { canModerate?: boolean } = {},
) {
  const task = makeTask({ id: 't1', title: 'Write report', ...overrides });
  const onSave = vi.fn(async () => {});
  const onChanged = vi.fn();
  render(
    <TaskDialog
      task={task}
      workspaceId="ws-1"
      members={MEMBERS}
      canModerate={props.canModerate}
      onClose={() => {}}
      onSave={onSave}
      onChanged={onChanged}
    />,
  );
  return { onSave, onChanged, dialog: screen.getByRole('dialog', { name: 'Edit card' }) };
}

describe('Task dialog', () => {
  it('assigns the card and saves the details from the side panel', async () => {
    server();
    const { onSave, dialog } = open({ status: 'IN_PROGRESS' });
    const user = userEvent.setup();

    expect(within(dialog).getByLabelText('Status')).toHaveValue('IN_PROGRESS');
    await user.click(within(dialog).getByRole('button', { name: 'Assign to me' }));
    expect(within(dialog).getByLabelText('Assignee')).toHaveValue('u-me');
    expect(within(dialog).queryByRole('button', { name: 'Assign to me' })).toBeNull();
    await user.selectOptions(within(dialog).getByLabelText('Status'), 'ON_HOLD');
    await user.type(within(dialog).getByLabelText('Description'), 'Waiting for data');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Write report',
        status: 'ON_HOLD',
        assigneeId: 'u-me',
        description: 'Waiting for data',
      }),
    );
  });

  it('posts a comment, newest first, and reports the new count', async () => {
    const calls = server({ comments: [comment('c1', MEMBERS[1]!.user, 'First!')] });
    const { onChanged, dialog } = open();
    const user = userEvent.setup();

    expect(await within(dialog).findByText('First!')).toBeInTheDocument();
    await user.type(
      within(dialog).getByLabelText('Add a comment'),
      'Draft is ready{Control>}{Enter}{/Control}',
    );

    expect(await within(dialog).findByText('Draft is ready')).toBeInTheDocument();
    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/workspaces/ws-1/tasks/t1/comments',
      body: { body: 'Draft is ready' },
    });
    const bodies = within(dialog)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.comment__body')?.textContent)
      .filter(Boolean);
    expect(bodies).toEqual(['Draft is ready', 'First!']);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByLabelText('Add a comment')).toHaveValue('');
  });

  it('lets people edit only their own comments and admins delete any', async () => {
    server({
      comments: [comment('c1', MEMBERS[0]!.user, 'mine'), comment('c2', MEMBERS[1]!.user, "Bob's")],
    });
    const { dialog } = open({}, { canModerate: false });
    await within(dialog).findByText("Bob's");
    const bobs = within(dialog).getByText("Bob's").closest('li')!;
    expect(within(bobs).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(bobs).queryByRole('button', { name: 'Delete' })).toBeNull();
    const mine = within(dialog).getByText('mine').closest('li')!;
    expect(within(mine).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('deletes a comment after asking', async () => {
    const calls = server({ comments: [comment('c2', MEMBERS[1]!.user, "Bob's")] });
    const { onChanged, dialog } = open({}, { canModerate: true });
    const user = userEvent.setup();
    const bobs = (await within(dialog).findByText("Bob's")).closest('li')!;

    await user.click(within(bobs).getByRole('button', { name: 'Delete' }));
    await user.click(within(bobs).getByRole('button', { name: 'Yes, delete' }));

    await waitFor(() => expect(within(dialog).queryByText("Bob's")).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/comments/c2'))).toBe(true);
    expect(onChanged).toHaveBeenCalled();
  });

  it('attaches a chosen file to the card', async () => {
    const calls = server({ files: [file('f1', 'brief.pdf', 'application/pdf')] });
    const { onChanged, dialog } = open();
    const user = userEvent.setup();
    expect(await within(dialog).findByRole('link', { name: 'brief.pdf' })).toBeInTheDocument();

    await user.upload(
      within(dialog).getByLabelText('Choose files to attach'),
      new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    );

    expect(await within(dialog).findByRole('link', { name: 'notes.txt' })).toBeInTheDocument();
    const upload = calls.find((c) => c.method === 'POST')!;
    expect(upload.url).toBe('/api/workspaces/ws-1/attachments');
    expect(upload.body).toMatchObject({ taskId: 't1' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('has no comments or files for a card that does not exist yet', () => {
    server();
    render(<TaskDialog workspaceId="ws-1" members={MEMBERS} onClose={() => {}} onSave={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'New card' });
    expect(within(dialog).queryByLabelText('Add a comment')).toBeNull();
    expect(within(dialog).getByText(/once the card is created/)).toBeInTheDocument();
  });
});

describe('rejectReason', () => {
  it('refuses scripts-capable and oversized files before uploading', () => {
    expect(rejectReason(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }))).toMatch(
      /only images, PDF/,
    );
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    expect(rejectReason(big)).toMatch(/larger than 10 MB/);
    expect(rejectReason(new File(['# hi'], 'readme.md', { type: '' }))).toBeUndefined();
  });
});
