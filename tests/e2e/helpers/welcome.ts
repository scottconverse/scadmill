import { expect, type Page } from "@playwright/test";

export async function dismissWelcome(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Welcome to ScadMill" });

  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: "Close welcome" }).click();
    await expect(dialog).toBeHidden();
  }
}
