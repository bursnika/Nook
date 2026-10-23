import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramCard, WidgetCard } from './IntegrationCards';

const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe('WidgetCard', () => {
  it('shows the token once after it is created, and offers to revoke it', async () => {
    let exists = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/widget/token' && init?.method === 'POST') {
          exists = true;
          return reply({ token: 'nkw_secret123' });
        }
        if (url === '/api/widget/token' && init?.method === 'DELETE') {
          exists = false;
          return reply(null, 204);
        }
        return reply({ exists });
      }),
    );
    render(<WidgetCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Create token' }));
    expect(await screen.findByLabelText('Widget token')).toHaveValue('nkw_secret123');
    expect(await screen.findByText('Token active')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.queryByLabelText('Widget token')).not.toBeInTheDocument());
    expect(await screen.findByText('No token')).toBeInTheDocument();
  });
});

describe('TelegramCard', () => {
  it('explains when the bot is not configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply({ configured: false, linked: false, botUsername: null, digestHourUtc: 6 })),
    );
    render(<TelegramCard />);
    expect(await screen.findByText(/not set up on this server/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).not.toBeInTheDocument();
  });

  it('gives a link that opens the bot when connecting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        url === '/api/telegram/link' && init?.method === 'POST'
          ? reply({ code: 'abc', url: 'https://t.me/nook_bot?start=abc', expiresInSeconds: 600 })
          : reply({ configured: true, linked: false, botUsername: 'nook_bot', digestHourUtc: 6 }),
      ),
    );
    render(<TelegramCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    const link = await screen.findByRole('link', { name: /Open the bot in Telegram/ });
    expect(link).toHaveAttribute('href', 'https://t.me/nook_bot?start=abc');
  });
});
