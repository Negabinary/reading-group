import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { api } from '../src/api';
import { createDemo } from '../src/demo';

vi.mock('../src/api', () => ({
  api: { getState: vi.fn() },
  IDENTITY_KEY: 'calendar-test-member',
  isDemo: false,
}));

beforeEach(() => {
  vi.mocked(api.getState).mockResolvedValue(createDemo());
});

test('subscription offers the hosted feed URL and Google instructions without requiring sign-in', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Subscribe' }));
  const modal = screen.getByRole('dialog', {
    name: 'Subscribe to the calendar',
  });
  const input = within(modal).getByRole('textbox', {
    name: 'Calendar URL',
  }) as HTMLInputElement;
  const url = new URL('/calendar.ics', window.location.origin).href;
  expect(input.value).toBe(url);
  expect(input.readOnly).toBe(true);
  expect(within(modal).getByText('From URL')).toBeTruthy();
  expect(
    within(modal)
      .getByRole('link', { name: 'Google Calendar' })
      .getAttribute('href'),
  ).toBe('https://calendar.google.com/');
  await user.click(
    within(modal).getByRole('button', { name: 'Copy calendar URL' }),
  );
  expect(await navigator.clipboard.readText()).toBe(url);
  expect(within(modal).getByRole('status').textContent).toBe(
    'Calendar URL copied.',
  );
  await user.click(within(modal).getByRole('button', { name: 'Close dialog' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('blocked clipboard offers a selected URL for manual copying', async () => {
  const user = userEvent.setup();
  const copy = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValue(new Error('Denied'));
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Subscribe' }));
  await user.click(screen.getByRole('button', { name: 'Copy calendar URL' }));
  const input = screen.getByRole('textbox', {
    name: 'Calendar URL',
  }) as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  expect(input.selectionEnd).toBe(input.value.length);
  expect(screen.getByRole('status').textContent).toContain('Select and copy');
  copy.mockRestore();
});

test('next session and paper details share time and room from another paper on that date', async () => {
  const data = createDemo();
  data.today = '2026-09-15';
  data.papers = [
    {
      ...data.papers[0],
      id: 'first',
      title: 'First paper',
      date: '2026-09-21',
      time: '',
      location: '',
    },
    {
      ...data.papers[1],
      id: 'second',
      title: 'Second paper',
      date: '2026-09-21',
      time: '14:30',
      location: 'Beyster 3725',
    },
  ];
  vi.mocked(api.getState).mockResolvedValue(data);
  const user = userEvent.setup();
  render(<App />);
  const scene = screen.getByRole('region', { name: 'Next session' });
  await within(scene).findByText('Beyster 3725');
  expect(within(scene).getByText('2:30 PM')).toBeTruthy();
  expect(within(scene).getByText('America/Detroit')).toBeTruthy();
  expect(
    within(scene)
      .getByRole('link', { name: 'Join on Zoom' })
      .getAttribute('href'),
  ).toBe('https://umich.zoom.us/j/93467587435');
  await user.click(within(scene).getByRole('button', { name: 'First paper' }));
  const modal = screen.getByRole('dialog', { name: 'First paper' });
  expect(within(modal).getByText(/2:30 PM/)).toBeTruthy();
  expect(within(modal).getByText('Beyster 3725')).toBeTruthy();
});
