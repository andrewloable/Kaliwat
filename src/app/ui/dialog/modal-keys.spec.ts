import { describe, it, expect, vi, afterEach } from 'vitest';
import { trapModal } from './modal-keys';

function setup() {
  document.body.innerHTML = `
    <button id="opener">open</button>
    <div id="panel">
      <button id="first">first</button>
      <details><summary id="sum">More</summary><button id="hidden-inside">x</button></details>
      <input id="file" type="file" hidden />
      <button id="last">last</button>
    </div>`;
  const opener = document.getElementById('opener')!;
  opener.focus();
  return { opener, panel: document.getElementById('panel')!, el: (id: string) => document.getElementById(id)! };
}
const key = (target: HTMLElement, key: string, shiftKey = false) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));

describe('trapModal', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('focuses the panel (not a field), Tab then reaches the first control, cleanup restores the opener', () => {
    const { opener, panel, el } = setup();
    const release = trapModal(panel, () => undefined);
    expect(document.activeElement).toBe(panel);
    expect(panel.getAttribute('tabindex')).toBe('-1');
    key(panel, 'Tab');
    expect(document.activeElement).toBe(el('first'));
    release();
    expect(document.activeElement).toBe(opener);
  });

  it('Escape calls onClose', () => {
    const { panel, el } = setup();
    const onClose = vi.fn();
    trapModal(panel, onClose);
    key(el('first'), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab wraps from last to first, Shift+Tab from first to last, skipping closed details content', () => {
    const { panel, el } = setup();
    trapModal(panel, () => undefined);
    el('last').focus();
    key(el('last'), 'Tab');
    expect(document.activeElement).toBe(el('first'));
    key(el('first'), 'Tab', true);
    expect(document.activeElement).toBe(el('last'));
  });

  it('stops listening after cleanup', () => {
    const { panel, el } = setup();
    const onClose = vi.fn();
    trapModal(panel, onClose)();
    key(el('first'), 'Escape');
    expect(onClose).not.toHaveBeenCalled();
  });
});
