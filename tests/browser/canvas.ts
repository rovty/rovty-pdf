import type { Page } from '@playwright/test';

export async function revealPdfArea(page: Page, from: number[], to = from) {
  const view = page.locator('.editor-viewport');
  await view.scrollIntoViewIfNeeded();
  const tooLarge = await view.evaluate(
    (element, { from, to }) => {
      const stage = element.querySelector('.page-stage')!.getBoundingClientRect();
      const [, , w, h] = element
        .querySelector('svg')!
        .getAttribute('viewBox')!
        .split(' ')
        .map(Number);
      return (
        (Math.abs(to[1] - from[1]) / h) * stage.height > element.clientHeight - 20 ||
        (Math.abs(to[0] - from[0]) / w) * stage.width > element.clientWidth - 20
      );
    },
    { from, to },
  );
  if (tooLarge)
    await page.getByRole('combobox', { name: 'Canvas zoom', exact: true }).selectOption('page');
  await view.evaluate(
    (element, { from, to }) => {
      const stage = element.querySelector('.page-stage')!.getBoundingClientRect(),
        rect = element.getBoundingClientRect();
      const [, , w, h] = element
        .querySelector('svg')!
        .getAttribute('viewBox')!
        .split(' ')
        .map(Number);
      element.scrollTop +=
        stage.top +
        ((from[1] + to[1]) / 2 / h) * stage.height -
        rect.top -
        element.clientHeight / 2;
      element.scrollLeft +=
        stage.left +
        ((from[0] + to[0]) / 2 / w) * stage.width -
        rect.left -
        element.clientWidth / 2;
    },
    { from, to },
  );
}
