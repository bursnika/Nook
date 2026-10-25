import { expect, test } from '../support/fixtures';
import { unique } from '../support/api';
import { EditorScreen } from '../support/editor';

test.describe('block editor', () => {
  test('opens the seeded page with its blocks', async ({ ann, seed }) => {
    await ann.page.goto(`/app/w/${seed.workspace.id}/pages/${seed.welcomePage.id}`);
    const editor = new EditorScreen(ann.page);
    await editor.ready();
    await expect(ann.page.getByLabel('Page title')).toHaveValue('Welcome');
    await expect(editor.field('heading 1')).toHaveValue('Welcome to Nook');
    await expect(editor.field('paragraph')).toHaveValue('This is the first paragraph.');
    await expect(editor.field('todo')).toHaveValue('Try the block editor');
    await expect(ann.page.getByRole('checkbox', { name: 'Done' })).not.toBeChecked();
    await expect(ann.page.getByRole('link', { name: 'Welcome' })).toBeVisible();
  });

  test('typing a paragraph is saved on the server and survives a reload', async ({ ann }) => {
    const page = await ann.api.createPage(unique('Typing'));
    await ann.open(`/pages/${page.id}`);
    const editor = new EditorScreen(ann.page);
    await editor.ready();

    await ann.page.getByRole('button', { name: 'Add a block at the end' }).click();
    await ann.page.keyboard.type('Hello from the end-to-end test');
    await editor.saved();
    await expect
      .poll(() => ann.api.blockTexts(page.id))
      .toEqual(['Hello from the end-to-end test']);

    await ann.page.reload();
    await editor.ready();
    await expect(editor.field('paragraph')).toHaveValue('Hello from the end-to-end test');
    await ann.api.deletePage(page.id);
  });

  test('renaming the page updates the title and the sidebar', async ({ ann }) => {
    const page = await ann.api.createPage(unique('Rename me'));
    await ann.open(`/pages/${page.id}`);
    const editor = new EditorScreen(ann.page);
    await editor.ready();
    const title = unique('Renamed');
    await ann.page.getByLabel('Page title').fill(title);
    await expect(
      ann.page.getByRole('navigation', { name: 'Pages' }).getByText(title),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await ann.api.get<{ title: string }>(
              `/workspaces/${ann.api.workspaceId}/pages/${page.id}`,
            )
          ).title,
      )
      .toBe(title);
    await ann.api.deletePage(page.id);
  });

  test('the markdown shortcut "# " turns a paragraph into a heading', async ({ ann }) => {
    const page = await ann.api.createPage(unique('Markdown'), [{ text: '' }]);
    await ann.open(`/pages/${page.id}`);
    const editor = new EditorScreen(ann.page);
    await editor.ready();

    await editor.field('paragraph').click();
    await ann.page.keyboard.type('# Big title');
    await expect(editor.field('heading 1')).toHaveValue('Big title');
    await ann.page.keyboard.press('Enter');
    await ann.page.keyboard.type('- first item');
    await expect(editor.field('bulleted list')).toHaveValue('first item');

    await editor.saved();
    await expect
      .poll(async () => (await ann.api.blocks(page.id)).map((block) => block.type))
      .toEqual(['HEADING_1', 'BULLETED_LIST']);
    await ann.api.deletePage(page.id);
  });

  test('the slash menu inserts a to-do that can be ticked', async ({ ann }) => {
    const page = await ann.api.createPage(unique('Slash'), [{ text: '' }]);
    await ann.open(`/pages/${page.id}`);
    const editor = new EditorScreen(ann.page);
    await editor.ready();

    await editor.field('paragraph').click();
    await ann.page.keyboard.type('/');
    const menu = ann.page.getByRole('listbox', { name: 'Block types' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option')).toHaveCount(10);
    await ann.page.keyboard.type('to-d');
    await expect(menu.getByRole('option')).toHaveCount(1);
    await menu.getByRole('option', { name: /To-do/ }).click();
    await expect(menu).toBeHidden();

    await ann.page.keyboard.type('Write the tests');
    await expect(editor.field('todo')).toHaveValue('Write the tests');
    await ann.page.getByRole('checkbox', { name: 'Done' }).check();
    await editor.saved();
    await expect
      .poll(async () =>
        (await ann.api.blocks(page.id)).map((b) => [b.type, b.content.text, b.content.checked]),
      )
      .toEqual([['TODO', 'Write the tests', true]]);

    await ann.page.reload();
    await editor.ready();
    await expect(ann.page.getByRole('checkbox', { name: 'Done' })).toBeChecked();
    await ann.api.deletePage(page.id);
  });

  test('Escape closes the slash menu and keeps the typed text', async ({ ann }) => {
    const page = await ann.api.createPage(unique('Slash escape'), [{ text: '' }]);
    await ann.open(`/pages/${page.id}`);
    const editor = new EditorScreen(ann.page);
    await editor.ready();
    await editor.field('paragraph').click();
    await ann.page.keyboard.type('/qu');
    const menu = ann.page.getByRole('listbox', { name: 'Block types' });
    await expect(menu.getByRole('option', { name: /Quote/ })).toBeVisible();
    await ann.page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(editor.field('paragraph')).toHaveValue('/qu');
    await ann.api.deletePage(page.id);
  });

  test('an edit made offline is sent when the connection comes back', async ({ ann }) => {
    const page = await ann.api.createPage(unique('Offline'), [{ text: 'before' }]);
    await ann.open(`/pages/${page.id}`);
    const editor = new EditorScreen(ann.page);
    await editor.ready();
    await expect(editor.connection).toContainText('online');

    await ann.context.setOffline(true);
    await expect(editor.saveIndicator).toContainText('Offline');
    await editor.field('paragraph').click();
    await ann.page.keyboard.press('End');
    await ann.page.keyboard.type(' and while offline');
    await expect(editor.saveIndicator).toContainText(/Offline - \d+ changes? waiting/);
    expect(await ann.api.blockTexts(page.id)).toEqual(['before']);

    await ann.context.setOffline(false);
    await expect(editor.saveIndicator).toHaveText('Saved', { timeout: 30_000 });
    await expect
      .poll(() => ann.api.blockTexts(page.id), { timeout: 30_000 })
      .toEqual(['before and while offline']);
    await ann.api.deletePage(page.id);
  });

  test('Alt+Arrow moves a block and the order is kept after a reload', async ({ ann }) => {
    const page = await ann.api.createPage(unique('Keys'), [
      { text: 'one' },
      { text: 'two' },
      { text: 'three' },
    ]);
    await ann.open(`/pages/${page.id}`);
    const editor = new EditorScreen(ann.page);
    await editor.ready();

    await editor.fields.nth(2).click();
    await ann.page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => editor.texts()).toEqual(['one', 'three', 'two']);
    await editor.saved();
    await expect.poll(() => ann.api.blockTexts(page.id)).toEqual(['one', 'three', 'two']);

    await ann.page.reload();
    await editor.ready();
    expect(await editor.texts()).toEqual(['one', 'three', 'two']);
    await ann.api.deletePage(page.id);
  });

  test('the drag handle reorders with the keyboard', async ({ ann }) => {
    const page = await ann.api.createPage(unique('Grip keys'), [
      { text: 'alpha' },
      { text: 'beta' },
      { text: 'gamma' },
    ]);
    await ann.open(`/pages/${page.id}`);
    const editor = new EditorScreen(ann.page);
    await editor.ready();

    const ids = (await ann.api.blocks(page.id)).map((block) => block.id);
    await editor.moveBlockWithKeys(ids, 0, 2);
    await expect.poll(() => editor.texts()).toEqual(['beta', 'gamma', 'alpha']);
    await editor.saved();
    await expect.poll(() => ann.api.blockTexts(page.id)).toEqual(['beta', 'gamma', 'alpha']);
    await ann.api.deletePage(page.id);
  });

  test('dragging a block with the mouse reorders it and persists', async ({ ann }) => {
    const page = await ann.api.createPage(unique('Grip mouse'), [
      { text: 'red' },
      { text: 'green' },
      { text: 'blue' },
    ]);
    await ann.open(`/pages/${page.id}`);
    const editor = new EditorScreen(ann.page);
    await editor.ready();

    await editor.dragBlock(2, 0);
    await expect.poll(() => editor.texts()).toEqual(['blue', 'red', 'green']);
    await editor.saved();
    await expect.poll(() => ann.api.blockTexts(page.id)).toEqual(['blue', 'red', 'green']);

    await ann.page.reload();
    await editor.ready();
    expect(await editor.texts()).toEqual(['blue', 'red', 'green']);
    await ann.api.deletePage(page.id);
  });

  test('the slash menu is driven with the arrow keys and Enter', async ({ ann }) => {
    const page = await ann.api.createPage(unique('Slash keys'), [{ text: '' }]);
    await ann.open(`/pages/${page.id}`);
    const editor = new EditorScreen(ann.page);
    await editor.ready();

    await editor.field('paragraph').click();
    await ann.page.keyboard.type('/head');
    const menu = ann.page.getByRole('listbox', { name: 'Block types' });
    await expect(menu.getByRole('option')).toHaveCount(3);
    await expect(menu.getByRole('option', { name: /Heading 1/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await ann.page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('option', { name: /Heading 2/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await ann.page.keyboard.press('ArrowUp');
    await ann.page.keyboard.press('ArrowUp');
    await expect(menu.getByRole('option', { name: /Heading 3/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await ann.page.keyboard.press('ArrowUp');
    await ann.page.keyboard.press('Enter');
    await expect(editor.field('heading 2')).toBeVisible();
    await ann.page.keyboard.type('Chosen with the keyboard');
    await editor.saved();
    await expect
      .poll(async () => (await ann.api.blocks(page.id)).map((b) => [b.type, b.content.text]))
      .toEqual([['HEADING_2', 'Chosen with the keyboard']]);

    // nothing matches: the menu says so and Escape leaves the text alone
    await ann.page.keyboard.press('Enter');
    await ann.page.keyboard.type('/zzzz');
    await expect(menu).toContainText('No block type matches');
    await ann.page.keyboard.press('Escape');
    await ann.api.deletePage(page.id);
  });

  test('shortcuts, Enter, Backspace and the arrow keys shape lists, quotes, dividers and code', async ({
    ann,
  }) => {
    const page = await ann.api.createPage(unique('Structure'), [{ text: '' }]);
    await ann.open(`/pages/${page.id}`);
    const editor = new EditorScreen(ann.page);
    await editor.ready();
    const { keyboard } = ann.page;
    const state = async () =>
      (await ann.api.blocks(page.id)).map((block) => [block.type, block.content.text ?? '']);

    await editor.field('paragraph').click();
    await keyboard.type('1. first');
    await keyboard.press('Enter');
    await keyboard.type('second');
    await keyboard.press('Enter');
    await keyboard.type('third');
    await expect(ann.page.getByText('3.', { exact: true })).toBeVisible();
    // Enter on an empty list item ends the list
    await keyboard.press('Enter');
    await keyboard.press('Enter');
    await keyboard.type('> a quote');
    await expect(editor.field('quote')).toHaveValue('a quote');
    await keyboard.press('Enter');
    await keyboard.type('---');
    await keyboard.type('```');
    await expect(editor.field('code')).toBeVisible();
    // inside code Enter makes a new line, a second Enter on an empty line leaves the block
    await keyboard.type('let a = 1;');
    await keyboard.press('Enter');
    await keyboard.press('Enter');
    await keyboard.type('the end');
    await editor.saved();
    await expect.poll(state).toEqual([
      ['NUMBERED_LIST', 'first'],
      ['NUMBERED_LIST', 'second'],
      ['NUMBERED_LIST', 'third'],
      ['QUOTE', 'a quote'],
      ['DIVIDER', ''],
      ['CODE', 'let a = 1;'],
      ['PARAGRAPH', 'the end'],
    ]);

    // Backspace at the start of a paragraph joins it to the block above
    await keyboard.press('Home');
    await keyboard.press('Backspace');
    await expect.poll(async () => (await state()).at(-1)).toEqual(['CODE', 'let a = 1;the end']);

    // ArrowUp from the first line of the code block lands on the divider, which Backspace removes
    await keyboard.press('Control+Home');
    await keyboard.press('ArrowUp');
    await expect(ann.page.getByRole('separator', { name: /^Divider/ })).toBeFocused();
    await keyboard.press('Backspace');
    await expect(ann.page.getByRole('separator', { name: /^Divider/ })).toHaveCount(0);
    await editor.saved();
    await expect
      .poll(async () => (await state()).map(([type]) => type))
      .toEqual(['NUMBERED_LIST', 'NUMBERED_LIST', 'NUMBERED_LIST', 'QUOTE', 'CODE']);

    // focus moved to the block above; ArrowDown/ArrowUp walk through the blocks
    await expect(editor.field('quote')).toBeFocused();
    await keyboard.press('ArrowDown');
    await expect(editor.field('code')).toBeFocused();
    await keyboard.press('ArrowUp');
    await expect(editor.field('quote')).toBeFocused();
    await ann.api.deletePage(page.id);
  });
});
