import { expect, test } from '../support/fixtures';
import { unique } from '../support/api';
import { EditorScreen } from '../support/editor';

const TRANSPORTS = [
  { kind: 'websocket', label: 'WebSocket' },
  { kind: 'longpoll', label: 'Long poll' },
  { kind: 'polling', label: 'Polling' },
] as const;

test.describe('live sync between two people', () => {
  for (const transport of TRANSPORTS) {
    test(`edits, cursor and highlight reach the other person over ${transport.label}`, async ({
      ann,
      bob,
      signIn,
    }) => {
      const root = await signIn('root');
      await root.api.remove('/sync-metrics');
      const page = await ann.api.createPage(unique(`Sync ${transport.kind}`), [
        { text: 'shared line' },
      ]);
      await Promise.all([ann.open(`/pages/${page.id}`), bob.open(`/pages/${page.id}`)]);
      const annEditor = new EditorScreen(ann.page);
      const bobEditor = new EditorScreen(bob.page);
      await Promise.all([annEditor.ready(), bobEditor.ready()]);
      await annEditor.useTransport(transport.kind, transport.label);
      await bobEditor.useTransport(transport.kind, transport.label);

      await expect(ann.page.getByLabel('Bob Baker is here')).toBeVisible();
      await expect(bob.page.getByLabel('Ann Archer is here')).toBeVisible();

      // ann -> bob
      await annEditor.field('paragraph').click();
      await ann.page.keyboard.press('End');
      await ann.page.keyboard.type(' + from Ann');
      await expect(bobEditor.field('paragraph')).toHaveValue('shared line + from Ann');
      await expect(
        bob.page.locator('.remote-caret__flag', { hasText: 'Ann Archer' }),
      ).toBeVisible();
      await expect(bob.page.locator('.row__flash-tag', { hasText: 'Ann Archer' })).toBeVisible();

      // bob -> ann
      await bobEditor.field('paragraph').click();
      await bob.page.keyboard.press('End');
      await bob.page.keyboard.type(' + from Bob');
      await expect(annEditor.field('paragraph')).toHaveValue('shared line + from Ann + from Bob');
      await expect(ann.page.locator('.row__flash-tag', { hasText: 'Bob Baker' })).toBeVisible();

      await expect
        .poll(() => ann.api.blockTexts(page.id))
        .toEqual(['shared line + from Ann + from Bob']);

      const { transports } = await root.api.get<{
        transports: Record<string, { requests: number }>;
      }>('/sync-metrics');
      expect(transports[transport.kind]?.requests).toBeGreaterThan(0);
      await ann.api.deletePage(page.id);
    });
  }

  test('new blocks, a type change and a merge reach the other person', async ({ ann, bob }) => {
    const page = await ann.api.createPage(unique('Sync blocks'), [{ text: 'first' }]);
    await Promise.all([ann.open(`/pages/${page.id}`), bob.open(`/pages/${page.id}`)]);
    const annEditor = new EditorScreen(ann.page);
    const bobEditor = new EditorScreen(bob.page);
    await Promise.all([annEditor.ready(), bobEditor.ready()]);

    await annEditor.field('paragraph').click();
    await ann.page.keyboard.press('End');
    await ann.page.keyboard.press('Enter');
    await ann.page.keyboard.type('second');
    await expect.poll(() => bobEditor.texts()).toEqual(['first', 'second']);

    await bobEditor.field('paragraph', 1).click();
    await bob.page.keyboard.press('Home');
    await bob.page.keyboard.type('## ');
    await expect(annEditor.field('heading 2')).toHaveValue('second');

    await bob.page.keyboard.press('Home');
    await bob.page.keyboard.press('Backspace');
    await expect(annEditor.field('paragraph', 1)).toHaveValue('second');
    await bob.page.keyboard.press('Backspace');
    await expect.poll(() => annEditor.texts()).toEqual(['firstsecond']);
    await expect.poll(() => ann.api.blockTexts(page.id)).toEqual(['firstsecond']);
    await ann.api.deletePage(page.id);
  });
});
