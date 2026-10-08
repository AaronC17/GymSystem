type DialogRegistration = {
  dialog: HTMLElement;
  returnFocus: HTMLElement | null;
  fallbackFocus: HTMLElement | null;
  backgroundElements: HTMLElement[];
  onEscape?: () => void;
};

type ElementSnapshot = {
  inert: string | null;
  ariaHidden: string | null;
};

type DialogManager = {
  stack: DialogRegistration[];
  snapshots: Map<HTMLElement, ElementSnapshot>;
  handleKeyDown: (event: KeyboardEvent) => void;
};

export type DialogFocusOptions = {
  /** Defaults to the first enabled focusable element in the dialog. */
  initialFocusSelector?: string;
  /** Used when the dialog replaces (and unmounts) the element that opened it. */
  returnFocus?: HTMLElement | null;
  /** Background regions that must not be reachable while this dialog is active. */
  backgroundElements?: Iterable<HTMLElement>;
  /** Receives focus if the original trigger has since been removed. */
  fallbackFocus?: HTMLElement | null;
  /** Omit for dialogs that must not be dismissed with Escape. */
  onEscape?: () => void;
};

const managers = new WeakMap<Document, DialogManager>();
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[tabindex]',
  '[contenteditable="true"]',
].join(',');

function isFocusable(element: HTMLElement) {
  if (element.hidden || element.tabIndex < 0 || element.matches(':disabled') || element.closest('[hidden], [inert], [aria-hidden="true"]')) {
    return false;
  }
  const view = element.ownerDocument.defaultView;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (!current.hidden && view) {
      const style = view.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
  }
  return true;
}

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isFocusable);
}

function focus(element: HTMLElement | null) {
  if (!element?.isConnected) return false;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
  return element.ownerDocument.activeElement === element;
}

function snapshotAndIsolate(manager: DialogManager, element: HTMLElement) {
  if (!manager.snapshots.has(element)) {
    manager.snapshots.set(element, {
      inert: element.getAttribute('inert'),
      ariaHidden: element.getAttribute('aria-hidden'),
    });
  }
  element.setAttribute('inert', '');
  element.setAttribute('aria-hidden', 'true');
}

function restoreIsolation(manager: DialogManager) {
  for (const [element, snapshot] of manager.snapshots) {
    if (snapshot.inert === null) element.removeAttribute('inert');
    else element.setAttribute('inert', snapshot.inert);
    if (snapshot.ariaHidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', snapshot.ariaHidden);
  }
  manager.snapshots.clear();
}

function isolateSiblingsBetween(ancestor: HTMLElement, descendant: HTMLElement, targets: Set<HTMLElement>) {
  let current: HTMLElement = descendant;
  while (current !== ancestor) {
    const parent = current.parentElement;
    if (!parent) return;
    for (const sibling of Array.from(parent.children)) {
      if (sibling !== current && sibling.nodeType === 1) targets.add(sibling as HTMLElement);
    }
    current = parent;
  }
}

function syncIsolation(manager: DialogManager) {
  restoreIsolation(manager);
  const active = manager.stack.at(-1);
  if (!active) return;

  const targets = new Set<HTMLElement>();
  for (const registration of manager.stack.slice(0, -1)) {
    if (registration.dialog.contains(active.dialog)) {
      // For physically nested dialogs, isolate the lower dialog's sibling content
      // without hiding an ancestor that also contains the active dialog.
      isolateSiblingsBetween(registration.dialog, active.dialog, targets);
    } else {
      targets.add(registration.dialog);
    }
  }
  for (const background of active.backgroundElements) {
    if (background === active.dialog) continue;
    if (background.contains(active.dialog)) isolateSiblingsBetween(background, active.dialog, targets);
    else targets.add(background);
  }
  targets.delete(active.dialog);
  for (const target of targets) {
    if (!target.contains(active.dialog)) snapshotAndIsolate(manager, target);
  }
}

function getManager(document: Document) {
  const existing = managers.get(document);
  if (existing) return existing;

  const manager: DialogManager = {
    stack: [],
    snapshots: new Map(),
    handleKeyDown: () => undefined,
  };
  manager.handleKeyDown = (event) => {
    const active = manager.stack.at(-1);
    if (!active) return;

    if (event.key === 'Escape') {
      if (!active.onEscape) return;
      event.preventDefault();
      event.stopPropagation();
      active.onEscape();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = focusableElements(active.dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      focus(active.dialog);
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const focused = active.dialog.ownerDocument.activeElement;
    const focusIsInside = focused !== null && active.dialog.contains(focused);
    if (event.shiftKey && (!focusIsInside || focused === first)) {
      event.preventDefault();
      focus(last);
    } else if (!event.shiftKey && (!focusIsInside || focused === last)) {
      event.preventDefault();
      focus(first);
    }
  };

  document.addEventListener('keydown', manager.handleKeyDown, true);
  managers.set(document, manager);
  return manager;
}

/** Installs modal focus behavior and returns a cleanup function for unmounting. */
export function activateDialogFocus(dialog: HTMLElement, options: DialogFocusOptions = {}) {
  const document = dialog.ownerDocument;
  const view = document.defaultView;
  const focused = document.activeElement;
  const returnFocus = options.returnFocus !== undefined
    ? options.returnFocus
    : focused && view && focused instanceof view.HTMLElement ? focused : null;
  const registration: DialogRegistration = {
    dialog,
    returnFocus,
    fallbackFocus: options.fallbackFocus ?? null,
    backgroundElements: Array.from(options.backgroundElements ?? []),
    onEscape: options.onEscape,
  };
  const manager = getManager(document);
  manager.stack.push(registration);

  const requestedInitialFocus = dialog.querySelector<HTMLElement>(options.initialFocusSelector ?? '[data-dialog-initial-focus]');
  const initial = requestedInitialFocus && isFocusable(requestedInitialFocus)
    ? requestedInitialFocus
    : focusableElements(dialog)[0] ?? dialog;
  focus(initial);
  syncIsolation(manager);

  return () => {
    const index = manager.stack.indexOf(registration);
    if (index < 0) return;
    const wasTop = index === manager.stack.length - 1;
    manager.stack.splice(index, 1);
    syncIsolation(manager);

    if (manager.stack.length === 0) {
      document.removeEventListener('keydown', manager.handleKeyDown, true);
      managers.delete(document);
    }
    if (!wasTop) return;

    if (!focus(registration.returnFocus)) {
      // A closed dialog may have replaced its trigger (for example, finishing a workout).
      // Focus its page region rather than leaving focus on the document body.
      if (!manager.stack.length) focus(registration.fallbackFocus);
      else focus(manager.stack.at(-1)?.dialog ?? null);
    }
  };
}
