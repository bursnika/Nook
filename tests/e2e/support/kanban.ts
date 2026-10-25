import { expect, type Locator, type Page } from '@playwright/test';

export type ColumnName = 'To do' | 'In progress' | 'Done';

/** Helpers for the Kanban board (apps/web/src/screens/tasks). */
export class BoardScreen {
  constructor(readonly page: Page) {}

  column(name: ColumnName): Locator {
    return this.page.getByRole('region', { name, exact: true });
  }

  /** The card with this title, wherever it is. */
  card(title: string): Locator {
    return this.page
      .getByRole('listitem')
      .filter({ has: this.page.getByRole('button', { name: title, exact: true }) });
  }

  /** Waits for the board (and its live connection) to be ready. */
  async ready() {
    await expect(this.page.getByRole('heading', { name: 'Board' })).toBeVisible();
    await expect(this.page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible();
  }

  /** Drags a card onto a column with the mouse: dnd-kit starts after a few pixels and tracks real moves. */
  async dragCard(title: string, to: ColumnName) {
    const { page } = this;
    const from = await this.card(title).boundingBox();
    const target = await this.column(to).getByRole('list').boundingBox();
    if (!from || !target) throw new Error('the card or the column is not on screen');
    const startX = from.x + from.width / 2;
    const startY = from.y + from.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 12, startY + 12, { steps: 4 });
    await page.mouse.move(target.x + target.width / 2, target.y + Math.min(target.height / 2, 40), {
      steps: 20,
    });
    await page.mouse.up();
  }

  /**
   * Moves a card to the next column with the keyboard, from its grip: Space picks it up, an arrow key
   * carries it over (the card jumps into the column it hovers), Space drops it. dnd-kit may not listen yet
   * for the first key, so the key is pressed again only while the card has not changed column.
   */
  async moveCardWithKeys(title: string, key: 'ArrowRight' | 'ArrowLeft', to: ColumnName) {
    const { page } = this;
    const announcement = page.locator('[id^="DndLiveRegion"]');
    await this.card(title)
      .getByRole('button', { name: /^Reorder/ })
      .focus();
    await page.keyboard.press('Space');
    await expect(announcement).toContainText(`is over ${title}.`);
    const inTarget = this.column(to).getByText(title, { exact: true });
    await expect(async () => {
      if ((await inTarget.count()) === 0) await page.keyboard.press(key);
      await expect(inTarget).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press('Space');
    await expect(announcement).toContainText('Dropped');
  }
}
