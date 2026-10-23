import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

describe('routing', () => {
  it('shows a friendly 404 for an unknown address', async () => {
    render(
      <MemoryRouter initialEntries={['/definitely/not/here']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/404: this page is not here/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the desktop' })).toHaveAttribute('href', '/');
  });
});
