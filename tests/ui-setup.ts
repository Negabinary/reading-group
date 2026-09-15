import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// UI fixtures stay local even when a developer has configured the live API.
vi.stubEnv('VITE_APPS_SCRIPT_URL', '');

HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
HTMLElement.prototype.scrollIntoView = function () {};
afterEach(() => {
  cleanup();
  localStorage.clear();
});
