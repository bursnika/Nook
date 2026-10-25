import { expect, type Locator, type Page } from '@playwright/test';

/** Helpers for the block editor screen (apps/web/src/editor). */
export class EditorScreen {
  constructor(readonly page: Page) {}

  /** The text areas of all text blocks, top to bottom. */
  get fields(): Locator {
    return this.page.getByRole('group', { name: 'Page content' }).getByRole('textbox');
  }

  /** The text of the block with this aria-label, e.g. `paragraph block`. */
  field(kind: string, index = 0): Locator {
    return this.page.getByLabel(`${kind} block`).nth(index);
  }

  get saveIndicator(): Locator {
    return this.page.getByTestId('save-indicator');
  }

  get connection(): Locator {
    return this.page.getByTestId('connection-badge');
  }

  get handles(): Locator {
    return this.page.getByRole('button', { name: /^Drag to reorder/ });
  }

  /** Waits until the editor shows the page and the server has confirmed everything (no unsent edits). */
  async ready() {
    await expect(this.page.getByLabel('Page title')).toBeVisible();
    await this.saved();
  }

  async saved() {
    await expect(this.saveIndicator).toHaveText('Saved');
  }

  async texts(): Promise<string[]> {
    return this.fields.evaluateAll((areas) =>
      areas.map((area) => (area as HTMLTextAreaElement).value),
    );
  }

  /** Picks a transport in the status bar and waits until the page is connected through it. */
  async useTransport(kind: 'websocket' | 'longpoll' | 'polling', label: string) {
    await this.page.getByLabel('Connection type').selectOption(kind);
    await expect(this.connection).toContainText(`${label} · online`, { timeout: 20_000 });
  }

  /**
   * Drags the grip of block `from` onto block `to` with the mouse (dnd-kit needs a few real pointer moves
   * before it starts a drag, and more while it is over the target).
   */
  async dragBlock(from: number, to: number) {
    const source = await this.handles.nth(from).boundingBox();
    const target = await this.handles.nth(to).boundingBox();
    if (!source || !target) throw new Error('the grips are not on screen');
    const { page } = this;
    const startX = source.x + source.width / 2;
    const startY = source.y + source.height / 2;
    const endY = target.y + target.height / 2 + (to > from ? 8 : -8);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + (to > from ? 10 : -10), { steps: 5 });
    await page.mouse.move(startX, endY, { steps: 15 });
    await page.mouse.up();
  }

  /**
   * Moves a block with the keyboard through its grip (Space picks up, arrows move, Space drops). dnd-kit
   * measures the list after every key, so each step waits for its screen-reader announcement.
   * `ids` are the block ids in their current order.
   */
  async moveBlockWithKeys(ids: string[], from: number, to: number) {
    const { page } = this;
    const announcement = page.locator('[id^="DndLiveRegion"]');
    const key = to > from ? 'ArrowDown' : 'ArrowUp';
    await this.handles.nth(from).focus();
    await page.keyboard.press('Space');
    await expect(announcement).toContainText(`over droppable area ${ids[from]}`);
    const step = to > from ? 1 : -1;
    for (let index = from + step; index !== to + step; index += step) {
      const arrived = `over droppable area ${ids[index]}`;
      // the first key can arrive before dnd-kit listens for it: press again only while nothing moved
      await expect(async () => {
        if (!(await announcement.innerText()).includes(arrived)) await page.keyboard.press(key);
        await expect(announcement).toContainText(arrived, { timeout: 1500 });
      }).toPass({ timeout: 10_000 });
    }
    await page.keyboard.press('Space');
    await expect(announcement).toContainText('was dropped');
  }
}
