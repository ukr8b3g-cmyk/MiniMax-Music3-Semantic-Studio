import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/ui/fixture.html');
});

test('maximize and restore preserve an operable editor shell', async ({ page }) => {
  const windowEl=page.locator('.m3shell-window');
  await expect(windowEl).toBeVisible();
  await page.getByRole('button',{name:'Maximize'}).click();
  await expect(windowEl).toHaveClass(/is-maximized/);
  await page.getByRole('button',{name:'Restore'}).click();
  await expect(windowEl).not.toHaveClass(/is-maximized/);
});

test('native resize handle changes the editor dimensions', async ({ page }) => {
  const windowEl=page.locator('.m3shell-window');
  const before=await windowEl.boundingBox();
  if(!before) throw new Error('window not measurable');
  await page.mouse.move(before.x+before.width-2,before.y+before.height-2);
  await page.mouse.down();
  await page.mouse.move(before.x+before.width+70,before.y+before.height+45,{steps:5});
  await page.mouse.up();
  const after=await windowEl.boundingBox();
  expect(after?.width).toBeGreaterThan(before.width+20);
  expect(after?.height).toBeGreaterThan(before.height+15);
});

test('focused duration number supports mouse-wheel stepping', async ({ page }) => {
  const duration=page.locator('#duration-input');
  await duration.focus();
  await page.mouse.wheel(0,-100);
  await expect(duration).toHaveValue('3.5');
});
