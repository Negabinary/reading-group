import { expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';

test('text view shows descriptions and retains identity and votes in the visual view', async () => {
  const user = userEvent.setup();
  const page = render(<App alternative />);
  const title = 'The Next 700 Programming Languages';
  const row = await screen.findByRole('article', { name: title });
  expect(within(row).getByRole('link', { name: title })).toBeTruthy();
  expect(row.querySelector('.alt-description')?.textContent).toBeTruthy();
  expect(
    (screen.getByRole('combobox', { name: 'Sort papers' }) as HTMLSelectElement)
      .value,
  ).toBe('newest');
  await user.click(
    within(row).getByRole('button', { name: `Vote for ${title}` }),
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Your name' }),
    'Text Reader',
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign in' }),
  );
  await screen.findByRole('button', { name: `Withdraw vote from ${title}` });
  await user.type(
    screen.getByRole('textbox', { name: 'Search the paper pool' }),
    'does not exist',
  );
  expect(screen.queryByRole('article', { name: title })).toBeNull();
  page.unmount();
  render(<App />);
  await screen.findByRole('button', { name: /Text Reader/ });
  await screen.findByRole('button', { name: `Withdraw vote from ${title}` });
});
