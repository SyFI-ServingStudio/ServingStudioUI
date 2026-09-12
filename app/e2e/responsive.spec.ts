import {
  WORKING_STYLES,
  expectKernelShareGeometry,
  expectNoHorizontalOverflow,
  openAgentStart,
} from './helpers';
import { expect, test } from './quality.fixture';

test('the three setup steps reveal and fold in order', { tag: '@desktop' }, async ({ page }) => {
  // Picking is the confirmation: each answer folds its own step and opens the
  // next, and the composer does not exist until both earlier steps are answered.
  await openAgentStart(page);
  const grid = page.getByRole('radiogroup', { name: 'Agent working style' });

  await grid.getByRole('radio', { name: WORKING_STYLES[3], exact: true }).click();
  await expect(page.getByRole('button', { name: /Change step 1/ })).toBeVisible();
  await expect(page.getByRole('listbox', { name: 'Workspace for new conversation' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask ServingStudio Agent' })).toHaveCount(0);

  await page.getByRole('option', { name: 'Create a new workspace' }).click();
  await expect(page.getByRole('button', { name: /Change step 2/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask ServingStudio Agent' })).toBeVisible();

  // Reopening an earlier step returns to the composer, not back through a
  // workspace choice already made.
  await page.getByRole('button', { name: /Change step 1/ }).click();
  await expect(grid.getByRole('radio', { checked: true })).toHaveCount(1);
  await grid.getByRole('radio', { name: WORKING_STYLES[0], exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Ask ServingStudio Agent' })).toBeVisible();
});

// A CostTree wide enough to show a 95/5 split is not something every run
// produces, and the property under test is the chart's geometry rather than
// any particular run's numbers. The harness page states the split outright.
test(
  'kernel shares remain proportional and tiny kernels can be selected',
  { tag: '@mobile' },
  async ({ page }) => {
    await page.goto('/e2e/harness/cost-tree.html');
    await expectKernelShareGeometry(page);
    await expectNoHorizontalOverflow(page);
  },
);
