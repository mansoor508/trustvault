import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AccessDenied } from './Feedback';

describe('AccessDenied component', () => {
  it('renders 403 status code and return to dashboard link', () => {
    const html = renderToString(
      <MemoryRouter>
        <AccessDenied
          title="Access restricted"
          message="You do not have the required permissions to view this section."
        />
      </MemoryRouter>,
    );

    expect(html).toContain('403');
    expect(html).toContain('Access restricted');
    expect(html).toContain('You do not have the required permissions to view this section.');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('Return to Dashboard');
  });

  it('supports custom dashboardLink parameter', () => {
    const html = renderToString(
      <MemoryRouter>
        <AccessDenied dashboardLink="/custom-destination" />
      </MemoryRouter>,
    );

    expect(html).toContain('href="/custom-destination"');
  });
});
