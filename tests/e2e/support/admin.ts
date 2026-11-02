import { expect, type Locator, type Page } from '@playwright/test';

export class Select2 {
  constructor(
    private readonly page: Page,
    // id of the <select>, e.g. f-userId
    private readonly id: string,
  ) {}

  get container(): Locator {
    return this.page.locator(`#select2-${this.id}-container`);
  }

  get options(): Locator {
    return this.page.getByRole('option');
  }

  async search(text: string) {
    await this.container.click();
    await this.page.getByRole('searchbox').fill('');
    await this.page.getByRole('searchbox').pressSequentially(text);
  }

  async pick(search: string, option: string | RegExp) {
    await this.search(search);
    await this.page.getByRole('option', { name: option }).click();
    await expect(this.container).toContainText(typeof option === 'string' ? option : /./);
  }
}

export async function expectFlash(page: Page, text: string) {
  await expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();
}
