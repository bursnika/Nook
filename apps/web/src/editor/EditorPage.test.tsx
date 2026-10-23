import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FakeTransport } from '../sync/fakeTransport';
import type { KeyValueStore } from '../sync/storage';
import { SyncClient } from '../sync/syncClient';
import type { Snapshot } from '../sync/types';
import { EditorEnvProvider } from './env';
import EditorPage from './EditorPage';

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const snapshot: Snapshot = {
  page: { id: 'p1', title: 'Plan', icon: null },
  seq: 3,
  blocks: [
    { id: 'b1', type: 'HEADING_1', content: { text: 'Hello' }, position: 1024 },
    { id: 'b2', type: 'PARAGRAPH', content: { text: 'World' }, position: 2048 },
  ],
};

function mount(options: { store?: KeyValueStore; load?: () => Promise<Snapshot> } = {}) {
  const transport = new FakeTransport();
  const store = options.store ?? new MemoryStore();
  let n = 0;
  const client = new SyncClient({
    pageId: 'p1',
    clientId: 'me',
    transportKind: 'websocket',
    loadSnapshot: options.load ?? (async () => snapshot),
    createTransport: () => transport,
    saveTitle: vi.fn(async () => undefined),
    store,
    uuid: () => `new-${++n}`,
  });
  const view = render(
    <EditorEnvProvider value={{ createClient: () => client }}>
      <MemoryRouter initialEntries={['/w/ws1/pages/p1']}>
        <Routes>
          <Route path="/w/:workspaceId/pages/:pageId" element={<EditorPage />} />
        </Routes>
      </MemoryRouter>
    </EditorEnvProvider>,
  );
  return { transport, client, store, ...view };
}

const goOnline = async (transport: FakeTransport) => {
  await waitFor(() => expect(transport.handlers).toBeDefined());
  act(() => transport.status('online'));
};

describe('EditorPage', () => {
  it('shows the title, the blocks and the saved status', async () => {
    const { transport } = mount();
    expect(await screen.findByDisplayValue('Hello')).toBeInTheDocument();
    expect(screen.getByDisplayValue('World')).toBeInTheDocument();
    expect(screen.getByLabelText('Page title')).toHaveValue('Plan');
    await goOnline(transport);
    expect(screen.getByTestId('save-indicator')).toHaveTextContent('Saved');
    expect(screen.getByTestId('connection-badge')).toHaveTextContent('WebSocket · online');
  });

  it('sends typing as an update and shows "Saving…" until it is accepted', async () => {
    const user = userEvent.setup();
    const { transport } = mount();
    await goOnline(transport);
    const world = await screen.findByDisplayValue('World');
    await user.type(world, '!');
    expect(screen.getByTestId('save-indicator')).toHaveTextContent('Saving');
    await waitFor(() => expect(transport.sent).toHaveLength(1));
    expect(transport.sent[0]).toEqual([{ type: 'update', id: 'b2', content: { text: 'World!' } }]);
    await waitFor(() => expect(screen.getByTestId('save-indicator')).toHaveTextContent('Saved'));
  });

  it('turns markdown shortcuts into blocks', async () => {
    const user = userEvent.setup();
    const { client } = mount();
    const world = await screen.findByDisplayValue('World');
    await user.clear(world);
    await user.click(world);
    await user.paste('[] ');
    expect(client.getState().blocks[1]).toMatchObject({
      type: 'TODO',
      content: { text: '', checked: false },
    });
    expect(screen.getByRole('checkbox', { name: 'Done' })).toBeInTheDocument();
  });

  it('Enter splits a block at the caret and Backspace at the start merges it back', async () => {
    const user = userEvent.setup();
    const { client } = mount();
    const world = await screen.findByDisplayValue('World');
    await user.click(world);
    await user.keyboard('{Home}{ArrowRight}{ArrowRight}{Enter}');
    expect(client.getState().blocks.map((b) => b.content.text)).toEqual(['Hello', 'Wo', 'rld']);
    await user.keyboard('{Backspace}');
    expect(client.getState().blocks.map((b) => b.content.text)).toEqual(['Hello', 'World']);
  });

  it('opens an accessible slash menu, filters it and applies the chosen type', async () => {
    const user = userEvent.setup();
    const { client } = mount();
    const world = await screen.findByDisplayValue('World');
    await user.clear(world);
    await user.type(world, '/head');
    const box = screen.getByRole('combobox', { name: /block/ });
    expect(box).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('listbox', { name: 'Block types' });
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Heading 1'),
      expect.stringContaining('Heading 2'),
      expect.stringContaining('Heading 3'),
    ]);
    expect(box).toHaveAttribute('aria-activedescendant', options[0]!.id);
    await user.keyboard('{ArrowDown}');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(client.getState().blocks[1]).toMatchObject({ type: 'HEADING_2', content: { text: '' } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes the slash menu with Escape', async () => {
    const user = userEvent.setup();
    mount();
    const world = await screen.findByDisplayValue('World');
    await user.clear(world);
    await user.type(world, '/');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows other people (avatars, name flags) and a changed block without crashing on a remote delete', async () => {
    const user = userEvent.setup();
    const { transport, client } = mount();
    await goOnline(transport);
    const world = await screen.findByDisplayValue('World');
    act(() =>
      transport.presence({
        clientId: 'c2',
        userId: 'u2',
        name: 'Ann Lee',
        blockId: 'b2',
        caret: 2,
      }),
    );
    expect(screen.getByLabelText('Ann Lee is here')).toHaveTextContent('AL');
    expect(screen.getAllByText('Ann Lee').length).toBeGreaterThan(0);

    act(() =>
      transport.ops({
        seq: 4,
        clientId: 'c2',
        authorId: 'u2',
        ops: [{ type: 'update', id: 'b1', content: { text: 'Hi there' } }],
      }),
    );
    expect(await screen.findByDisplayValue('Hi there')).toBeInTheDocument();
    expect(screen.getByTitle(/Changed by Ann Lee/)).toBeInTheDocument();

    await user.click(world);
    await user.keyboard('x');
    act(() =>
      transport.ops({
        seq: 5,
        clientId: 'c2',
        authorId: 'u2',
        ops: [{ type: 'delete', id: 'b2' }],
      }),
    );
    await waitFor(() => expect(screen.queryByDisplayValue('Worldx')).not.toBeInTheDocument());
    expect(screen.getByText(/deleted a block you were editing/)).toBeInTheDocument();
    expect(client.getState().notice).toMatch(/deleted a block you were editing/);
  });

  it('restores unsent edits from localStorage after a reload while offline', async () => {
    const store = new MemoryStore();
    const user = userEvent.setup();
    const first = mount({ store });
    const world = await screen.findByDisplayValue('World');
    await user.type(world, '?');
    expect(first.client.getState().pending).toBe(1);
    first.unmount();

    const offline = mount({
      store,
      load: async () => {
        throw new Error('network down');
      },
    });
    expect(await screen.findByDisplayValue('World?')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('save-indicator')).toHaveTextContent('Offline - 1 change waiting'),
    );
    offline.unmount();
  });

  it('renames the page', async () => {
    const user = userEvent.setup();
    const { client } = mount();
    const title = await screen.findByLabelText('Page title');
    await user.type(title, ' B');
    expect(client.getState().title).toBe('Plan B');
  });
});
