import { expect, type Locator, type Page } from '@playwright/test';

/** A Select2 field of the classic admin: a select that loads its options from the server as you type. */
export class Select2 {
  constructor(
    private readonly page: Page,
    /** The id of the underlying <select>, for example `f-userId`. */
    private readonly id: string,
  ) {}

  get container(): Locator {
    return this.page.locator(`#select2-${this.id}-container`);
  }

  get options(): Locator {
    return this.page.getByRole('option');
  }

  /** Opens the dropdown and types into its search box. The server is asked after a pause in typing. */
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

/** Waits for the "flash" banner an admin form redirects with. */
export async function expectFlash(page: Page, text: string) {
  await expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();
}
