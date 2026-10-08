import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateDialogFocus } from '../src/dialogFocus';

const windows: Window[] = [];

function createDocument(markup: string) {
  const window = new Window();
  windows.push(window);
  window.document.body.innerHTML = markup;
  return window;
}

function select<T>(document: Window['document'], selector: string) {
  return document.querySelector(selector) as unknown as T;
}

function press(window: Window, key: string, shiftKey = false) {
  const event = new window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  window.document.dispatchEvent(event);
  return event;
}

afterEach(() => {
  for (const window of windows.splice(0)) window.close();
});

describe('activateDialogFocus', () => {
  it('moves focus into a dialog, traps both Tab directions, and restores focus and background state', () => {
    const window = createDocument(`
      <button id="trigger">Abrir</button>
      <main id="background" aria-hidden="false" inert="custom">
        <button id="outside">Fondo</button>
      </main>
      <section id="dialog" role="dialog" tabindex="-1">
        <button id="first">Primero</button>
        <button id="last">Último</button>
      </section>
    `);
    const document = window.document;
    const trigger = select<HTMLButtonElement>(document, '#trigger');
    const background = select<HTMLElement>(document, '#background');
    const dialog = select<HTMLElement>(document, '#dialog');
    const first = select<HTMLButtonElement>(document, '#first');
    const last = select<HTMLButtonElement>(document, '#last');
    trigger.focus();

    const cleanup = activateDialogFocus(dialog, { backgroundElements: [background] });

    expect(document.activeElement).toBe(first);
    expect(background.inert).toBe(true);
    expect(background.getAttribute('aria-hidden')).toBe('true');

    last.focus();
    const forward = press(window, 'Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    const backward = press(window, 'Tab', true);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    cleanup();
    expect(document.activeElement).toBe(trigger);
    expect(background.getAttribute('inert')).toBe('custom');
    expect(background.getAttribute('aria-hidden')).toBe('false');
  });

  it('honors the initial-focus target and traps focus returned from outside the dialog', () => {
    const window = createDocument(`
      <button id="trigger">Abrir</button>
      <button id="outside">Fondo</button>
      <section id="dialog" role="dialog" tabindex="-1">
        <button id="first">Primero</button>
        <button id="preferred" data-dialog-initial-focus>Preferido</button>
        <button id="last">Último</button>
      </section>
    `);
    const document = window.document;
    const dialog = select<HTMLElement>(document, '#dialog');
    const preferred = select<HTMLButtonElement>(document, '#preferred');
    const first = select<HTMLButtonElement>(document, '#first');
    const outside = select<HTMLButtonElement>(document, '#outside');

    const cleanup = activateDialogFocus(dialog);
    expect(document.activeElement).toBe(preferred);

    outside.focus();
    const tab = press(window, 'Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    cleanup();
  });

  it('handles Escape only for a dismissible top dialog and restores nested dialog focus', () => {
    const window = createDocument(`
      <button id="trigger">Abrir</button>
      <main id="background"><button>Fondo</button></main>
      <section id="outer" role="dialog" tabindex="-1">
        <button id="nested-trigger">Abrir anidado</button>
      </section>
      <section id="inner" role="dialog" tabindex="-1">
        <button id="inner-action">Cerrar</button>
      </section>
    `);
    const document = window.document;
    const trigger = select<HTMLButtonElement>(document, '#trigger');
    const nestedTrigger = select<HTMLButtonElement>(document, '#nested-trigger');
    const background = select<HTMLElement>(document, '#background');
    const outer = select<HTMLElement>(document, '#outer');
    const inner = select<HTMLElement>(document, '#inner');
    const dismissedOuter = vi.fn();
    const dismissedInner = vi.fn();
    trigger.focus();

    const closeOuter = activateDialogFocus(outer, {
      backgroundElements: [background],
      onEscape: dismissedOuter,
    });
    nestedTrigger.focus();
    const closeInner = activateDialogFocus(inner, {
      backgroundElements: [background],
      onEscape: dismissedInner,
    });

    expect(outer.inert).toBe(true);
    expect(background.inert).toBe(true);
    press(window, 'Escape');
    expect(dismissedInner).toHaveBeenCalledOnce();
    expect(dismissedOuter).not.toHaveBeenCalled();

    closeInner();
    expect(document.activeElement).toBe(nestedTrigger);
    expect(outer.hasAttribute('inert')).toBe(false);
    expect(background.inert).toBe(true);
    closeOuter();
    expect(document.activeElement).toBe(trigger);
    expect(background.hasAttribute('inert')).toBe(false);
  });

  it('keeps Escape from dismissing a non-dismissible dialog and uses a fallback if its trigger disappears', () => {
    const window = createDocument(`
      <main id="fallback" tabindex="-1"><button id="trigger">Abrir</button></main>
      <section id="dialog" role="dialog" tabindex="-1"><button>Acción</button></section>
    `);
    const document = window.document;
    const trigger = select<HTMLButtonElement>(document, '#trigger');
    const fallback = select<HTMLElement>(document, '#fallback');
    const dialog = select<HTMLElement>(document, '#dialog');
    const dismiss = vi.fn();
    trigger.focus();

    const cleanup = activateDialogFocus(dialog, { fallbackFocus: fallback });
    const escape = press(window, 'Escape');
    expect(escape.defaultPrevented).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
    trigger.remove();
    cleanup();
    expect(document.activeElement).toBe(fallback);
  });

  it('focuses the dialog itself when it has no focusable controls', () => {
    const window = createDocument('<section id="dialog" role="dialog" tabindex="-1"><p>Sin controles</p></section>');
    const dialog = select<HTMLElement>(window.document, '#dialog');
    const cleanup = activateDialogFocus(dialog);
    expect(window.document.activeElement).toBe(dialog);
    const tab = press(window, 'Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(window.document.activeElement).toBe(dialog);
    cleanup();
  });

  it('skips disabled and CSS-hidden controls when choosing the initial target and trapping Tab', () => {
    const window = createDocument(`
      <button id="trigger">Abrir</button>
      <section id="dialog" role="dialog" tabindex="-1">
        <button disabled>Desactivado</button>
        <button style="display: none">Oculto</button>
        <button id="first">Primero visible</button>
        <button id="last">Último visible</button>
      </section>
    `);
    const document = window.document;
    const dialog = select<HTMLElement>(document, '#dialog');
    const first = select<HTMLButtonElement>(document, '#first');
    const last = select<HTMLButtonElement>(document, '#last');

    const cleanup = activateDialogFocus(dialog);
    expect(document.activeElement).toBe(first);
    last.focus();
    press(window, 'Tab');
    expect(document.activeElement).toBe(first);
    cleanup();
  });
});
