// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileView, { validateProfilePassword, type ProfileProps } from '../src/components/ProfileView';

let host: HTMLDivElement;
let root: Root;
let props: ProfileProps;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = {
    user: { name: 'Persona sintética', email: 'profile-test@example.invalid' },
    access: { status: 'trial', trialEndsAt: '2026-10-15T12:00:00Z', trialDaysRemaining: 7, isAdmin: false },
    unit: 'kg', onSetUnit: vi.fn(), onCheckAccess: vi.fn(async () => false),
    onChangePassword: vi.fn(async () => undefined), onNotify: vi.fn(),
  };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render() { act(() => root.render(createElement(ProfileView, props))); }
function button(text: string) {
  const found = [...host.querySelectorAll('button')].find((node) => node.textContent?.includes(text));
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
function fill(name: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}
function validFields() {
  fill('currentPassword', 'Current123');
  fill('newPassword', 'Nextpass123');
  fill('confirmPassword', 'Nextpass123');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('ProfileView', () => {
  it('renders readonly identity, trial dates and an explicit manual purchase link', () => {
    render();
    expect(host.textContent).toContain(props.user.name);
    expect(host.textContent).toContain(props.user.email);
    expect(host.querySelector('input[name="email"]')).toBeNull();
    expect(host.textContent).toContain('7 días restantes');
    expect(host.querySelector('time')?.dateTime).toBe(props.access.trialEndsAt);
    const link = host.querySelector<HTMLAnchorElement>('a')!;
    const url = new URL(link.href);
    expect(url.pathname).toBe('/50661555619');
    const message = url.searchParams.get('text')!;
    for (const text of [props.user.email, '₡5.000', 'SINPE', 'pago único', 'MANUAL desde Admin']) expect(message).toContain(text);
    expect(link.rel).toContain('noopener');
  });

  it('shows permanent active access with no purchase and delegates unit changes', () => {
    props.access = { ...props.access, status: 'active' };
    render();
    expect(host.textContent).toContain('Acceso permanente');
    expect(host.querySelector('a')).toBeNull();
    expect(button('Kilogramos').getAttribute('aria-pressed')).toBe('true');
    act(() => button('Libras').click());
    expect(props.onSetUnit).toHaveBeenCalledWith('lb');
    expect(button('Libras').getAttribute('aria-pressed')).toBe('false');
    props.unit = 'lb'; render();
    expect(button('Libras').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps workout settings disabled after expiration without disabling account security', () => {
    props.access = { ...props.access, status: 'expired' };
    render();
    expect(button('Kilogramos').disabled).toBe(true);
    expect(button('Libras').disabled).toBe(true);
    expect(button('Actualizar contraseña').disabled).toBe(false);
    expect(host.querySelector<HTMLAnchorElement>('a')?.href).toContain('wa.me');
  });

  it('checks access once while pending and never activates the user locally', async () => {
    const pending = deferred<boolean>();
    props.onCheckAccess = vi.fn(() => pending.promise);
    render();
    act(() => button('Comprobar').click());
    expect(button('Comprobando').disabled).toBe(true);
    act(() => button('Comprobando').click());
    expect(props.onCheckAccess).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(true));
    expect(host.textContent).toContain('El servidor confirmó');
    expect(host.querySelector('a')).not.toBeNull();
    expect(props.access.status).toBe('trial');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports unconfirmed or failed access checks without leaking exception details', async () => {
    props.access = { ...props.access, status: 'expired' };
    render();
    expect(host.textContent).toContain('Tu período de prueba ha terminado');
    await act(async () => button('Comprobar').click());
    expect(host.textContent).toContain('Tu acceso aún no está activo');
    props.onCheckAccess = vi.fn(async () => { throw new Error('SECRET_ACCESS'); }); render();
    await act(async () => button('Comprobar').click());
    expect(host.textContent).toContain('No fue posible comprobar');
    expect(host.textContent).not.toContain('SECRET_ACCESS');
  });

  it('labels password inputs and toggles visibility accessibly', () => {
    render();
    const inputs = [...host.querySelectorAll('input')];
    expect(inputs.map((input) => input.autocomplete)).toEqual(['current-password', 'new-password', 'new-password']);
    expect(inputs.map((input) => input.maxLength)).toEqual([256, 128, 128]);
    for (const input of inputs) {
      expect(host.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
      expect(input.getAttribute('aria-describedby')).toBeTruthy();
    }
    act(() => button('Mostrar contraseñas').click());
    expect(inputs.every((input) => input.type === 'text')).toBe(true);
    expect(button('Ocultar contraseñas').getAttribute('aria-pressed')).toBe('true');
    act(() => button('Ocultar contraseñas').click());
    expect(inputs.every((input) => input.type === 'password')).toBe(true);
  });

  it('blocks invalid passwords and mismatched confirmation before calling parent', async () => {
    render();
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('actual');
    validFields(); fill('newPassword', 'short1');
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('entre 8 y 128');
    fill('newPassword', 'Nextpass123'); fill('confirmPassword', 'Other123');
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('no coinciden');
    expect(props.onChangePassword).not.toHaveBeenCalled();
  });

  it('waits for password callback before announcing success and clearing secrets', async () => {
    const pending = deferred<void>();
    props.onChangePassword = vi.fn(() => pending.promise);
    render(); validFields(); await submit();
    expect(props.onChangePassword).toHaveBeenCalledWith('Current123', 'Nextpass123');
    expect(button('Actualizando').disabled).toBe(true);
    expect([...host.querySelectorAll('input')].every((input) => input.disabled)).toBe(true);
    expect(host.textContent).not.toContain('Contraseña actualizada');
    expect(props.onNotify).not.toHaveBeenCalled();
    await submit();
    expect(props.onChangePassword).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    expect(host.textContent).toContain('Contraseña actualizada. Inicia sesión de nuevo.');
    expect([...host.querySelectorAll('input')].every((input) => input.value === '')).toBe(true);
    expect(props.onNotify).toHaveBeenCalledOnce();
  });

  it('does not expose callback errors or announce success on rejection', async () => {
    props.onChangePassword = vi.fn(async () => { throw new Error('SECRET_PASSWORD backend stack'); });
    render(); validFields(); await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No fue posible cambiar');
    expect(host.textContent).not.toContain('SECRET_PASSWORD');
    expect(host.textContent).not.toContain('Contraseña actualizada');
    expect(props.onNotify).not.toHaveBeenCalled();
    expect(button('Actualizar').disabled).toBe(false);
  });
});

describe('profile password validation mirrors server bounds and Unicode letters', () => {
  it('accepts Unicode letters and the maximum supported lengths', () => {
    expect(validateProfilePassword('x'.repeat(256), `${'ñ'.repeat(127)}1`, `${'ñ'.repeat(127)}1`)).toBeNull();
    expect(validateProfilePassword('old', 'ñññññññ1', 'ñññññññ1')).toBeNull();
  });
  it.each(['12345678', 'abcdefgh', 'abc1234', `${'a'.repeat(128)}1`])('rejects invalid new password %s', (password) => {
    expect(validateProfilePassword('old', password, password)).not.toBeNull();
  });
  it('rejects an oversized current password', () => {
    expect(validateProfilePassword('x'.repeat(257), 'Password123', 'Password123')).not.toBeNull();
  });
});
