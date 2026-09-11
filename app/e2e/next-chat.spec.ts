import type { Page, Route } from '@playwright/test';

import { serveRunPage } from './fixtures/run';
import { expect, test } from './quality.fixture';

/**
 * Conversations, addressed.
 *
 * Every case here is about the address rather than about the agent: a
 * conversation opens from a URL with nothing in session storage, a draft
 * becomes a real conversation without adding a history entry, two conversations
 * are distinct places the back button moves between, and closing a docked chat
 * stops listening without stopping the turn.
 */

const A = '8f5b0659dfd0';
const B = 'aa11bb22cc33';
const RUN = '20260907_0_llama3_h200_throughput';

interface Agent {
  readonly calls: { method: string; path: string; body: unknown }[];
  /**
   * Let a pending turn answer.
   *
   * `outcome` is the turn's own verdict on how it ended — `'cancelled'` for a
   * turn the backend stopped, `null` for one that ran to the end. It is a
   * separate argument from the text because a stopped turn still emits the
   * words it had already produced, and the panel has to say both.
   */
  finish: (text?: string, outcome?: string | null) => void;
}

function conversation(id: string, messages: unknown[]) {
  return {
    id,
    messages,
    // The envelope the store actually writes: `total_messages`, and an
    // `end_index` alongside the start.
    message_page: {
      start_index: 0,
      end_index: messages.length,
      total_messages: messages.length,
      has_more: false,
    },
  };
}

function sse(events: [string, unknown][]): string {
  return events.map(([kind, data]) => `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

/**
 * A conversation backend that answers only what the test needs.
 *
 * A turn's POST is held open until `finish` is called: Playwright fulfils a
 * whole response at once, so an unresolved handler is how a turn stays "still
 * running" long enough to be interrupted.
 */
async function stubAgent(
  page: Page,
  options: { deleted?: string; holdCreate?: Promise<void>; streamFails?: boolean } = {},
): Promise<Agent> {
  const calls: Agent['calls'] = [];
  let release: ((ending: { text: string; outcome: string | null }) => void) | null = null;
  // What the store would hold for the turn once it has ended. The controller
  // refetches the conversation as the stream closes and the live row is
  // replaced by the stored one, so a test about how an ending is rendered has
  // to say what was stored, not only what came down the wire.
  let stored: unknown = null;
  // The result page behind the dock reads its own documents. They are not what
  // these tests are about, but an unanswered read is a console error, and a
  // console error fails every test in this file for the wrong reason.
  await serveRunPage(page);

  const record = (route: Route) => {
    const request = route.request();
    calls.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postData() === null ? null : JSON.parse(request.postData() ?? '{}'),
    });
  };

  await page.route('**/api/agent/v1/codex-backends', (route) =>
    route.fulfill({
      json: {
        models: [
          {
            id: 'gpt-6',
            label: 'GPT-6',
            family: 'gpt',
            familyLabel: 'GPT',
            efforts: ['high'],
            defaultEffort: 'high',
            serviceTiers: ['default'],
            defaultServiceTier: 'default',
            available: true,
          },
        ],
        defaults: {
          orchestrator: { model: 'gpt-6', effort: 'high', serviceTier: 'default' },
          implementer: { model: 'gpt-6', effort: 'high', serviceTier: 'default' },
          assistant: { model: 'gpt-6', effort: 'high', serviceTier: 'default' },
        },
      },
    }),
  );
  await page.route('**/api/agent/v1/workspaces/w_main', (route) =>
    route.fulfill({ json: { workspace_id: 'w_main', display_name: 'Main', state: 'active' } }),
  );

  await page.route('**/api/agent/v1/workspaces/w_main/conversations', async (route) => {
    record(route);
    if (route.request().method() === 'GET') {
      return route.fulfill({
        json: {
          conversations: [
            { id: A, title: 'Conversation A', updated_at: 2 },
            { id: B, title: 'Conversation B', updated_at: 1 },
          ],
        },
      });
    }
    if (options.holdCreate !== undefined) await options.holdCreate;
    return route.fulfill({ json: { id: B, title: 'New conversation' } });
  });

  await page.route('**/api/agent/v1/workspaces/w_main/conversations/*', (route) => {
    record(route);
    const id = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (id === options.deleted) {
      return route.fulfill({ status: 404, json: { detail: 'conversation not found' } });
    }
    return route
      .fulfill({
        json: conversation(id, [
          { id: 1, role: 'user', content: `question in ${id}` },
          {
            id: 2,
            role: 'assistant',
            content: `answer in ${id}`,
            // As the backend stores it: the answer is appended to the activity
            // list and saved as the message content.
            activity: [
              { kind: 'role_start', role: 'planner' },
              { kind: 'decision', action: 'inspect', task: 'the run' },
              { kind: 'final', text: `answer in ${id}` },
            ],
          },
          ...(stored === null ? [] : [stored]),
        ]),
      })
      .catch(() => undefined);
  });

  await page.route('**/api/agent/v1/workspaces/w_main/conversations/*/stream', (route) => {
    record(route);
    if (options.streamFails === true) {
      return route.fulfill({ status: 500, json: { detail: 'stream unavailable' } });
    }
    return route.fulfill({ status: 204, body: '' });
  });

  await page.route('**/api/agent/v1/workspaces/w_main/conversations/*/messages', async (route) => {
    record(route);
    const { text, outcome } = await new Promise<{ text: string; outcome: string | null }>(
      (resolve) => {
        release = resolve;
      },
    );
    // The browser may have let go of this request by now — that is what
    // closing a panel mid-turn does — and fulfilling an abandoned route
    // rejects. The turn is the server's either way.
    return route.fulfill({
      contentType: 'text/event-stream',
      // The `done` frame carries the backend's real nulls — `outcome` is null
      // on a failed turn, and on any ending this frontend is older than — and a
      // schema that rejected them would leave the session waiting forever for
      // an end that already came. Tests that care which ending it was name it.
      body: sse([
        ['role_start', { role: 'planner' }],
        ['done', { text, outcome, citations: null, failure: null, interrupted_role: '' }],
      ]),
    });
  });

  await page.route('**/api/agent/v1/workspaces/w_main/conversations/*/cancel', (route) => {
    record(route);
    return route.fulfill({ json: { cancelled: true, interrupted_role: 'planner' } });
  });

  return {
    calls,
    finish: (text = 'answered', outcome: string | null = null) => {
      if (outcome !== null) {
        stored = {
          id: 3,
          role: 'assistant',
          content: text,
          activity: [{ kind: 'final', text, outcome }],
        };
      }
      release?.({ text, outcome });
    },
  };
}

async function open(page: Page, hash: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/${hash}`);
}

test('opens a conversation from its address with nothing stored', async ({ page }) => {
  const agent = await stubAgent(page);
  await open(page, `#/chat/${A}?w=w_main`);

  await expect(
    page.getByTestId('agent-message-column').getByText(`question in ${A}`, { exact: true }),
  ).toBeVisible();
  // The steps a turn took are shown with the answer, not behind a toggle.
  await expect(page.getByRole('region', { name: 'Delegated task' })).toContainText('the run');
  // Once, not twice: the answer is stored both as a step and as the message.
  expect(await page.getByTestId('agent-message-column').getByText(`answer in ${A}`).count()).toBe(
    1,
  );
  // Nothing was read from storage to get here; the hash was the whole input.
  expect(await page.evaluate(() => window.sessionStorage.length)).toBe(0);
  expect(agent.calls.filter((call) => call.path.endsWith(`/conversations/${A}`))).toHaveLength(1);
});

test('a draft becomes a conversation without adding a history entry', async ({ page }) => {
  const agent = await stubAgent(page);
  await open(page, '#/chat/new?w=w_main');
  const start = page.url();

  await expect(page.getByRole('complementary', { name: 'VibeSim Agent' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Continue the conversation' }).fill('why is attn slow?');
  await page.getByRole('textbox', { name: 'Continue the conversation' }).press('Enter');

  await expect(page).toHaveURL(new RegExp(`#/chat/${B}`));
  agent.finish('because of decode');
  await expect(
    page.getByTestId('agent-message-column').getByText('because of decode', { exact: true }),
  ).toBeVisible();

  // Back leaves the chat entirely: the draft and the conversation it became are
  // one step, so there is no used composer to return to.
  await page.goBack();
  expect(page.url()).not.toBe(start);

  const posted = agent.calls.find(
    (call) => call.method === 'POST' && call.path.endsWith('/messages'),
  );
  expect(posted?.body).toMatchObject({ text: 'why is attn slow?' });
});

test('two conversations are two places the back button moves between', async ({ page }) => {
  await stubAgent(page);
  await open(page, `#/chat/${A}?w=w_main`);
  await expect(
    page.getByTestId('agent-message-column').getByText(`question in ${A}`, { exact: true }),
  ).toBeVisible();

  await page.evaluate((id) => {
    window.location.hash = `#/chat/${id}?w=w_main`;
  }, B);
  await expect(
    page.getByTestId('agent-message-column').getByText(`question in ${B}`, { exact: true }),
  ).toBeVisible();

  await page.goBack();
  await expect(
    page.getByTestId('agent-message-column').getByText(`question in ${A}`, { exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByTestId('agent-message-column').getByText(`question in ${B}`, { exact: true }),
  ).toBeVisible();
});

test.describe('a conversation that has been deleted', () => {
  test.use({ expectedConsoleErrors: [/Failed to load resource.*conversations\/8f5b0659dfd0/] });

  test('says so instead of showing an empty conversation', async ({ page }) => {
    await stubAgent(page, { deleted: A });
    await open(page, `#/chat/${A}?w=w_main`);

    // The exact Agent surface reports the failed read and offers the explicit
    // recovery action instead of presenting an empty conversation.
    await expect(page.getByRole('alert')).toContainText('404');
    await expect(page.getByRole('button', { name: 'Retry conversation' })).toBeVisible();
  });
});

test('stopping a turn asks the server; closing the chat does not', async ({ page }) => {
  const agent = await stubAgent(page);
  await open(page, `#/result/run/${RUN}?w=w_main&chat=${A}`);

  const dock = page.getByTestId('chat-dock');
  await expect(dock).toBeVisible();
  await page.getByRole('textbox', { name: 'Continue the conversation' }).fill('keep going');
  await page.getByRole('textbox', { name: 'Continue the conversation' }).press('Enter');

  // The turn is in flight, so the composer offers Stop rather than Send.
  await expect(page.getByRole('button', { name: 'Interrupt turn' })).toBeVisible();
  await page.getByRole('button', { name: 'Interrupt turn' }).click();
  await expect(page.getByRole('button', { name: 'Interrupting turn' })).toBeDisabled();
  // And nothing has gone out yet. This stub answers the POST only as the turn
  // ends — `route.fulfill` cannot open a response head and stream a body after
  // it, which is what the backend does — so the browser is still in the window
  // where it has no turn to name. `/cancel` addresses the conversation, so an
  // unnamed request here would stop whatever else the conversation was running,
  // which is by definition not the turn this reader is waiting for.
  expect(agent.calls.some((call) => call.path.endsWith('/cancel'))).toBe(false);

  agent.finish('Stopped while the planner was working.', 'cancelled');
  // Polled rather than asserted outright: the Stop goes out as soon as the turn
  // is named, and that is a round trip after the one that named it.
  await expect.poll(() => agent.calls.some((call) => call.path.endsWith('/cancel'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Send follow-up' })).toBeVisible();
  // The turn broke off mid-thought, and the text it did produce sits where an
  // answer would. Unlabelled, that reads as the agent's reply.
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible();

  // Closing the dock keeps the result and cancels nothing further.
  const cancels = agent.calls.filter((call) => call.path.endsWith('/cancel')).length;
  await page.getByRole('button', { name: 'Return to workspace home' }).click();
  await expect(dock).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#/result/run/${RUN}`));
  expect(page.url()).not.toContain(`chat=${A}`);
  expect(agent.calls.filter((call) => call.path.endsWith('/cancel'))).toHaveLength(cancels);
});

test('a chat docked beside a result keeps the result when it is created', async ({ page }) => {
  await stubAgent(page);
  await open(page, `#/result/run/${RUN}?w=w_main&chat=new`);

  await page.getByRole('textbox', { name: 'Continue the conversation' }).fill('what is this?');
  await page.getByRole('textbox', { name: 'Continue the conversation' }).press('Enter');

  // The user asked a question about a result; they did not ask to leave it.
  await expect(page).toHaveURL(new RegExp(`#/result/run/${RUN}.*chat=${B}`));
});

test('a draft that is closed while it is being created does not drag the user back', async ({
  page,
}) => {
  // Creating a conversation is a round trip. If the user closes the dock while
  // it is in flight, the turn is still theirs — it keeps running and can be
  // reopened — but they have said where they want to be, and the late response
  // must not overrule that.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await stubAgent(page, { holdCreate: held });
  await open(page, `#/result/run/${RUN}?w=w_main&chat=new`);

  await page.getByRole('textbox', { name: 'Continue the conversation' }).fill('what is this?');
  await page.getByRole('textbox', { name: 'Continue the conversation' }).press('Enter');
  await page.getByRole('button', { name: 'Return to workspace home' }).click();
  await expect(page.getByTestId('chat-dock')).toBeHidden();

  release();
  await page.waitForTimeout(200);
  expect(page.url()).not.toContain('chat=');
});

test('closing the chat while a turn is running lets go without stopping it', async ({ page }) => {
  // The failure a Stop button exists to prevent is a turn that keeps running
  // unheard. The failure a Close button exists to prevent is losing one. So
  // closing mid-turn must release the subscription and touch nothing else.
  const agent = await stubAgent(page);
  await open(page, `#/result/run/${RUN}?w=w_main&chat=${A}`);

  await page.getByRole('textbox', { name: 'Continue the conversation' }).fill('keep going');
  await page.getByRole('textbox', { name: 'Continue the conversation' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Interrupt turn' })).toBeVisible();

  await page.getByRole('button', { name: 'Return to workspace home' }).click();
  await expect(page.getByTestId('chat-dock')).toBeHidden();
  expect(agent.calls.some((call) => call.path.endsWith('/cancel'))).toBe(false);

  // Reopening asks the server what is running rather than assuming it ended.
  const before = agent.calls.filter((call) => call.path.endsWith('/stream')).length;
  await page.goBack();
  await expect(page.getByTestId('chat-dock')).toBeVisible();
  await expect
    .poll(() => agent.calls.filter((call) => call.path.endsWith('/stream')).length)
    .toBeGreaterThan(before);
  agent.finish('answered');
});

test.describe('a conversation whose live stream cannot be reached', () => {
  test.use({ expectedConsoleErrors: [/Failed to load resource.*\/stream/] });

  test('shows what is stored and preserves a draft without allowing it to send', async ({
    page,
  }) => {
    // What failed is the question "is a turn running?", and not knowing the
    // answer is not the same as knowing there is none. Reading it as idle would
    // re-enable the composer, and the message would land on a conversation
    // that is already working — a 409 arriving by a route the reader had no way
    // to anticipate. So: everything stored is on screen, the failure is said
    // plainly. The exact surface keeps the draft editable so recovery cannot
    // erase it, while disabling Send until Retry establishes the session.
    await stubAgent(page, { streamFails: true });
    await open(page, `#/chat/${A}?w=w_main`);

    await expect(page.getByRole('alert')).toContainText('500');
    await expect(
      page.getByTestId('agent-message-column').getByText(`question in ${A}`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry conversation' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Continue the conversation' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Send follow-up' })).toBeDisabled();
  });
});
