import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WidgetCard } from './IntegrationCards';

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
