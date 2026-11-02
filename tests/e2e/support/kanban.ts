import { expect, type Locator, type Page } from '@playwright/test';

export type ColumnName = 'Backlog' | 'In progress' | 'On hold' | 'Complete';

export class BoardScreen {
  constructor(readonly page: Page) {}

  column(name: ColumnName): Locator {
    return this.page.getByRole('region', { name, exact: true });
  }

  card(title: string): Locator {
    return this.page
      .getByRole('listitem')
      .filter({ has: this.page.getByRole('button', { name: title, exact: true }) });
  }

  async ready() {
    await expect(this.page.getByRole('heading', { name: 'Board' })).toBeVisible();
    await expect(this.page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible();
  }

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

  // first key press can get lost, so retry until the card moves
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
