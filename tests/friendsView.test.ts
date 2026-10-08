// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FriendsView, type FriendsViewProps } from '../src/components/FriendsView';
import type { SocialDashboard, SocialPost, SocialWorkoutDetail } from '../src/socialTypes';
import { ApiError } from '../src/api';
import { SOCIAL_REQUEST_TIMEOUT_MS } from '../src/socialRequest';

let host: HTMLDivElement;
let root: Root;
let props: FriendsViewProps;
let dashboard: SocialDashboard;
let unmounted: boolean;
const me = { name: 'Persona de prueba', email: 'me@example.invalid' };
const other = { name: 'Amiga de prueba', email: 'friend@example.invalid' };
const sharedPost = (): SocialPost => ({ id: 'shared-post', owner: other, kind: 'workout', title: 'Entrenamiento compartido', detail: '30 minutos', description: 'Un paso más.\nA mi ritmo.', hasWorkoutDetails: true, createdAt: '2026-10-01', cheers: 0, cheered: false });
const sharedDetail = (): SocialWorkoutDetail => ({ userEmail: me.email, post: sharedPost(), workout: { id: 'shared-log', date: '2026-10-01', title: 'Fuerza', duration: 30, routineDayId: 'shared-day', completed: true, exercises: [{ exerciseId: 'press', exerciseName: 'Press', sets: [{ weight: 40, reps: 10, done: true, unit: 'lb' }] }] } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host); unmounted = false;
  dashboard = {
    userEmail: me.email,
    me: { ...me, sharing: false, stats: { completedWorkouts: 2, currentWeeklyStreak: 1, bestWeeklyStreak: 1, personalBests: 0, badges: [
      { id: 'first-workout', title: 'Primer paso', description: 'Completa un entrenamiento.', earned: true, progress: 1, target: 1 },
      { id: 'workouts-10', title: 'Diez pasos', description: 'Completa diez entrenamientos.', earned: false, progress: 2, target: 10 },
    ] } }, friends: [], goals: [], posts: [], invitations: [],
  };
  props = { user: me, logs: [], load: vi.fn(async () => dashboard), act: vi.fn(async () => dashboard), search: vi.fn(async email => email === other.email ? [other] : []), detail: vi.fn(async () => { throw new Error('No fixture detail configured'); }), onViewWorkout: vi.fn() };
});
afterEach(() => {
  if (!unmounted) act(() => root.unmount());
  host.remove(); vi.unstubAllGlobals(); vi.useRealTimers();
});
async function render() { await act(async () => { root.render(createElement(FriendsView, props)); }); }
function button(text: string) {
  const node = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(text));
  if (!node) throw new Error(`Missing button: ${text}`);
  return node;
}
async function click(text: string) { await act(async () => button(text).click()); }
function fill(name: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
async function selectFriend(email = other.email) {
  fill('inviteEmail', email);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
  await act(async () => { host.querySelector<HTMLButtonElement>('[role="option"]')!.click(); });
}
function caption(name: string, value: string) {
  const node = host.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`)!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('FriendsView server-confirmed social UI', () => {
  it('exits loading and allows retry when the initial request never settles', async () => {
    vi.useFakeTimers();
    const stale = deferred<SocialDashboard>();
    props.load = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(dashboard);
    await render();
    expect(button('Actualizando').disabled).toBe(true);
    const signal = vi.mocked(props.load).mock.calls[0][0]!;
    await act(async () => { await vi.advanceTimersByTimeAsync(SOCIAL_REQUEST_TIMEOUT_MS); });
    expect(signal.aborted).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('tardó demasiado');
    expect(button('Actualizar').disabled).toBe(false);
    await click('Reintentar carga');
    expect(host.textContent).toContain('Entrenamientos completados');
    await act(async () => stale.resolve({ ...dashboard, me: { ...dashboard.me, stats: { ...dashboard.me.stats!, completedWorkouts: 98765 } } }));
    expect(host.textContent).not.toContain('98765');
  });
  it('unlocks actions after an unconfirmed stalled mutation without claiming success', async () => {
    vi.useFakeTimers();
    dashboard.posts = [sharedPost()];
    props.act = vi.fn(() => new Promise<SocialDashboard>(() => {}));
    await render(); await click('Ánimo');
    await act(async () => { await vi.advanceTimersByTimeAsync(SOCIAL_REQUEST_TIMEOUT_MS); });
    expect(button('Actualizar').disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('tardó demasiado');
    expect(host.textContent).not.toContain('Ánimo confirmado');
    expect(button('Ánimo').textContent).toContain('0');
  });
  it('publishes a description with explicit workout-detail disclosure and keeps it until acknowledgement', async () => {
    props.logs = [sharedDetail().workout];
    const pending = deferred<SocialDashboard>(); props.act = vi.fn(() => pending.promise);
    await render();
    act(() => { const select = host.querySelector('select')!; select.value = 'shared-log'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    caption('workoutDescription', '  Mi progreso\n<script>no ejecutar</script>  ');
    expect(host.textContent).toContain('ejercicios, series, pesos y repeticiones');
    await click('Compartir entrenamiento');
    expect(props.act).toHaveBeenCalledWith({ type: 'shareWorkout', workoutId: 'shared-log', description: 'Mi progreso\n<script>no ejecutar</script>' }, expect.any(AbortSignal));
    expect(host.querySelector<HTMLTextAreaElement>('textarea[name="workoutDescription"]')?.value).toContain('Mi progreso');
    const post = { ...sharedPost(), description: 'Mi progreso\n<script>no ejecutar</script>' };
    await act(async () => pending.resolve({ ...dashboard, posts: [post] }));
    expect(host.querySelector<HTMLTextAreaElement>('textarea[name="workoutDescription"]')?.value).toBe('');
    expect(host.querySelector('.friends-view__post-description')?.textContent).toBe(post.description);
    expect(host.querySelector('script')).toBeNull();
  });
  it('adds optional descriptions to badge posts', async () => {
    await render(); await click('Insignias'); caption('badgeDescription', ' Mi primer logro ');
    await click('Compartir insignia: Primer paso');
    expect(props.act).toHaveBeenCalledWith({ type: 'shareBadge', badgeId: 'first-workout', description: 'Mi primer logro' }, expect.any(AbortSignal));
    expect(host.querySelector<HTMLTextAreaElement>('textarea[name="badgeDescription"]')?.value).toBe('');
  });
  it('opens a post only after receiving its authorized snapshot, not from local logs', async () => {
    dashboard.posts = [sharedPost()];
    const pending = deferred<SocialWorkoutDetail>(); props.detail = vi.fn(() => pending.promise);
    await render(); const trigger = host.querySelector<HTMLButtonElement>('.friends-view__post-open')!;
    await act(async () => trigger.click());
    expect(props.detail).toHaveBeenCalledWith('shared-post', expect.any(AbortSignal));
    expect(props.onViewWorkout).not.toHaveBeenCalled();
    expect(trigger.disabled).toBe(true);
    const result = sharedDetail(); await act(async () => pending.resolve(result));
    expect(props.onViewWorkout).toHaveBeenCalledWith(result, trigger);
    expect(props.act).not.toHaveBeenCalled();
  });
  it('keeps cheers separate from opening details and does not enrich old posts', async () => {
    dashboard.posts = [{ ...sharedPost(), hasWorkoutDetails: false }];
    await render();
    expect(host.querySelector('.friends-view__post-open')).toBeNull();
    expect(host.textContent).toContain('publicación antigua no incluye el detalle');
    await click('Ánimo');
    expect(props.detail).not.toHaveBeenCalled();
    expect(props.act).toHaveBeenCalledWith({ type: 'cheer', postId: 'shared-post' }, expect.any(AbortSignal));
  });
  it('does not open an obsolete detail after unmount or an authorization failure', async () => {
    dashboard.posts = [sharedPost()];
    const pending = deferred<SocialWorkoutDetail>(); props.detail = vi.fn().mockRejectedValueOnce(new ApiError('Publicación no disponible.', 404)).mockReturnValueOnce(pending.promise);
    await render(); await act(async () => host.querySelector<HTMLButtonElement>('.friends-view__post-open')!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Publicación no disponible');
    await act(async () => host.querySelector<HTMLButtonElement>('.friends-view__post-open')!.click());
    const signal = vi.mocked(props.detail).mock.calls[1][1]!;
    act(() => root.unmount()); unmounted = true;
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(sharedDetail()));
    expect(props.onViewWorkout).not.toHaveBeenCalled();
  });
  it('supports keyboard selection and invalidates the choice when the email is edited', async () => {
    await render(); await click('Amigos');
    fill('inviteEmail', other.email);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    expect(input.getAttribute('aria-expanded')).toBe('true');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(button('Enviar solicitud').disabled).toBe(false);
    expect(props.act).not.toHaveBeenCalled();
    fill('inviteEmail', 'missing@example.invalid');
    expect(button('Enviar solicitud').disabled).toBe(true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
    expect(host.textContent).toContain('No encontramos una cuenta');
    await submit(); expect(props.act).not.toHaveBeenCalled();
  });
  it('ignores late lookup results for the previous email', async () => {
    const stale = deferred<typeof other[]>();
    props.search = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue([]);
    await render(); await click('Amigos'); fill('inviteEmail', other.email);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
    const oldSignal = vi.mocked(props.search).mock.calls[0][1]!;
    fill('inviteEmail', 'other@example.invalid');
    expect(oldSignal.aborted).toBe(true);
    await act(async () => stale.resolve([other]));
    expect(host.querySelector('[role="option"]')).toBeNull();
    expect(button('Enviar solicitud').disabled).toBe(true);
  });
  it('offers the next real milestone without inventing an earned badge', async () => {
    await render();
    expect(host.querySelector('[aria-label="Tu próximo hito"]')?.textContent).toContain('2 de 10');
    await click('Ver mis insignias');
    expect(host.querySelector('[aria-label="Tus insignias"]')).not.toBeNull();
    expect(button('Compartir insignia: Diez pasos').disabled).toBe(true);
  });

  it('shows earned friend badges only when statistics are shared', async () => {
    dashboard.friends = [{ ...other, sharing: true, stats: dashboard.me.stats }];
    await render(); await click('Amigos');
    const badges = host.querySelector('[aria-label="Insignias de Amiga de prueba"]');
    expect(badges?.textContent).toContain('Primer paso');
    expect(badges?.textContent).not.toContain('Diez pasos');
  });

  it('explains server rate limits rather than suggesting an immediate retry', async () => {
    props.act = vi.fn(async () => { throw new ApiError('Espera 24 horas antes de volver a invitar.', 429); });
    await render(); await click('Amigos');
    await selectFriend(); await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Espera 24 horas');
  });
  it('loads with an abort signal and renders in-app invitations without mail configuration', async () => {
    await render();
    expect(props.load).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(host.textContent).toContain('Entrena mejor,');
    expect(host.textContent).not.toContain('correo no está configurado');
    expect(host.textContent).toContain('No tienes solicitudes pendientes');
    expect(host.textContent).toContain('Aún no hay actividad compartida');
    expect(host.textContent).toContain('Se comparte solo si ya está sincronizado');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retries failed loads without exposing internal errors', async () => {
    props.load = vi.fn().mockRejectedValueOnce(new Error('SECRET_BACKEND')).mockResolvedValue(dashboard);
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No pudimos cargar');
    expect(host.textContent).not.toContain('SECRET_BACKEND');
    await click('Reintentar carga');
    expect(props.load).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('Comunidad actualizada');
  });

  it('requires selecting the found account and sends its normalized identity inside the app', async () => {
    await render(); await click('Amigos');
    fill('inviteEmail', 'invalid'); await submit();
    expect(props.act).not.toHaveBeenCalled();
    fill('inviteEmail', '  Friend@Example.Invalid  '); await submit();
    expect(props.act).not.toHaveBeenCalled();
    await selectFriend('  Friend@Example.Invalid  '); await submit();
    expect(props.act).toHaveBeenCalledWith({ type: 'invite', email: other.email }, expect.any(AbortSignal));
    expect(host.querySelector<HTMLInputElement>('input[name="inviteEmail"]')?.value).toBe('');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Solicitud enviada dentro de Kyon');
    expect(host.textContent).not.toContain('Correo enviado');
  });

  it('keeps incoming requests discoverable and cannot grant a friendship while acceptance is pending', async () => {
    dashboard.invitations = [{ id: 'request-1', from: other, toEmail: me.email, createdAt: '2026-10-01', direction: 'incoming' }];
    const pending = deferred<SocialDashboard>(); props.act = vi.fn(() => pending.promise);
    await render(); await click('Metas');
    expect(host.querySelector('[aria-label="1 solicitudes pendientes"]')).not.toBeNull();
    await click('Aceptar');
    expect(button('Aceptar').disabled).toBe(true);
    await click('Aceptar');
    expect(props.act).toHaveBeenCalledTimes(1);
    expect(props.act).toHaveBeenCalledWith({ type: 'accept', invitationId: 'request-1' }, expect.any(AbortSignal));
    await click('Amigos');
    expect(host.textContent).toContain('Amigos · 0');
    expect(host.textContent).not.toContain('Solicitud aceptada por el servidor');
    await act(async () => pending.resolve({ ...dashboard, invitations: [], friends: [{ ...other, sharing: false, stats: null }] }));
    expect(host.textContent).toContain('Amigos · 1');
    expect(host.textContent).toContain('Estadísticas privadas');
  });

  it('changes privacy only after acknowledgement and never exposes hidden friend statistics', async () => {
    dashboard.friends = [{ ...other, sharing: false, stats: { ...dashboard.me.stats!, completedWorkouts: 98765 } }];
    const pending = deferred<SocialDashboard>(); props.act = vi.fn(() => pending.promise);
    await render(); await click('Amigos');
    expect(host.textContent).toContain('Tus estadísticas son privadas');
    expect(host.textContent).toContain('Tu historial no se publica automáticamente');
    expect(host.textContent).not.toContain('98765');
    await click('Compartir estadísticas con amigos');
    expect(props.act).toHaveBeenCalledWith({ type: 'setSharing', sharing: true }, expect.any(AbortSignal));
    expect(button('Compartir estadísticas con amigos').getAttribute('aria-pressed')).toBe('false');
    await act(async () => pending.resolve({ ...dashboard, me: { ...dashboard.me, sharing: true } }));
    expect(button('Dejar de compartir').getAttribute('aria-pressed')).toBe('true');
  });

  it('disables unearned badge sharing and sends exact earned badge payload', async () => {
    await render(); await click('Insignias');
    expect(button('Compartir insignia: Diez pasos').disabled).toBe(true);
    await click('Compartir insignia: Diez pasos');
    expect(props.act).not.toHaveBeenCalled();
    await click('Compartir insignia: Primer paso');
    expect(props.act).toHaveBeenCalledWith({ type: 'shareBadge', badgeId: 'first-workout' }, expect.any(AbortSignal));
    expect(host.textContent).toContain('Próximo objetivo: 10');
    expect(host.textContent).toContain('descansar');
  });

  it('validates goal bounds and dates and defaults to a private exact payload', async () => {
    await render(); await click('Metas');
    expect(host.querySelector<HTMLInputElement>('input[name="goalShared"]')?.checked).toBe(false);
    fill('goalTitle', '  Mi ritmo  '); fill('goalTarget', '101'); fill('goalStart', '2026-10-01'); fill('goalEnd', '2026-10-31');
    await submit(); expect(props.act).not.toHaveBeenCalled();
    fill('goalTarget', '4'); fill('goalEnd', '2026-09-30');
    await submit(); expect(props.act).not.toHaveBeenCalled();
    fill('goalEnd', '2026-10-31'); await submit();
    expect(props.act).toHaveBeenCalledWith({ type: 'createGoal', title: 'Mi ritmo', target: 4, startDate: '2026-10-01', endDate: '2026-10-31', shared: false }, expect.any(AbortSignal));
  });

  it('acknowledges cheers from the backend without optimistic counters or repeated cheers', async () => {
    const post = { id: 'post-1', owner: other, kind: 'workout' as const, title: 'Sesión compartida', detail: '30 minutos', description: '', hasWorkoutDetails: true, createdAt: '2026-10-01', cheers: 2, cheered: false };
    dashboard.posts = [post];
    const pending = deferred<SocialDashboard>(); props.act = vi.fn(() => pending.promise);
    await render(); await click('Ánimo');
    expect(props.act).toHaveBeenCalledWith({ type: 'cheer', postId: 'post-1' }, expect.any(AbortSignal));
    expect(button('Ánimo').textContent).toContain('2');
    expect(host.textContent).not.toContain('Ánimo enviado');
    await act(async () => pending.resolve({ ...dashboard, posts: [{ ...post, cheered: true, cheers: 3 }] }));
    expect(button('Ánimo enviado').disabled).toBe(true);
    expect(button('Ánimo enviado').textContent).toContain('3');
    await click('Ánimo enviado'); expect(props.act).toHaveBeenCalledTimes(1);
  });

  it('keeps friendship state on rejected actions and allows refreshing the server state', async () => {
    dashboard.invitations = [{ id: 'request-1', from: other, toEmail: me.email, createdAt: '2026-10-01', direction: 'incoming' }];
    props.act = vi.fn(async () => { throw new Error('SECRET_ACTION'); });
    await render(); await click('Aceptar');
    expect(host.textContent).toContain('No pudimos confirmar la operación');
    expect(host.textContent).not.toContain('SECRET_ACTION');
    expect(host.textContent).toContain('No se envían correos');
    expect(button('Aceptar').disabled).toBe(false);
    await click('Amigos'); expect(host.textContent).toContain('Amigos · 0');
    await click('Reintentar carga');
    expect(props.load).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('supports outgoing cancellation without treating a pending invitation as a friend', async () => {
    dashboard.invitations = [{ id: 'outgoing-1', from: me, toEmail: other.email, createdAt: '2026-10-01', direction: 'outgoing' }];
    await render(); await click('Insignias');
    expect(host.textContent).toContain('pendiente de aceptación');
    await click('Cancelar solicitud');
    expect(props.act).toHaveBeenCalledWith({ type: 'cancel', invitationId: 'outgoing-1' }, expect.any(AbortSignal));
  });

  it('rejects oversized date spans and submits sharing only after an explicit checkbox choice', async () => {
    await render(); await click('Metas');
    fill('goalTitle', 'Mi meta'); fill('goalTarget', '1'); fill('goalStart', '2026-10-01'); fill('goalEnd', '2027-02-01');
    await submit(); expect(props.act).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('hasta 90 días');
    fill('goalEnd', '2026-10-31');
    act(() => host.querySelector<HTMLInputElement>('input[name="goalShared"]')!.click());
    await submit();
    expect(props.act).toHaveBeenCalledWith({ type: 'createGoal', title: 'Mi meta', target: 1, startDate: '2026-10-01', endDate: '2026-10-31', shared: true }, expect.any(AbortSignal));
  });

  it('shares only valid completed workouts and delegates synchronization checks', async () => {
    props.logs = [
      { id: 'done-1', title: 'Sesión lista', date: '2026-10-01', completed: true, duration: 30, routineDayId: 'day-1', exercises: [] },
      { id: 'unfinished', title: 'Sin terminar', date: '2026-10-01', completed: false, duration: 0, routineDayId: 'day-1', exercises: [] },
    ];
    await render();
    expect(host.querySelector('select')?.textContent).not.toContain('Sin terminar');
    expect(button('Compartir entrenamiento').disabled).toBe(true);
    act(() => {
      const select = host.querySelector('select')!; select.value = 'done-1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click('Compartir entrenamiento');
    expect(props.act).toHaveBeenCalledWith({ type: 'shareWorkout', workoutId: 'done-1' }, expect.any(AbortSignal));
  });

  it('requires inline confirmation before removing a friend and leaves friends goals read-only', async () => {
    dashboard.friends = [{ ...other, sharing: false, stats: null }];
    dashboard.goals = [{ id: 'friend-goal', owner: other, title: 'Su meta', target: 4, startDate: '2026-10-01', endDate: '2026-10-31', shared: true, progress: 2 }];
    await render(); await click('Amigos'); await click('Quitar amistad');
    expect(props.act).not.toHaveBeenCalled();
    await click('Sí, quitar amistad');
    expect(props.act).toHaveBeenCalledWith({ type: 'removeFriend', email: other.email }, expect.any(AbortSignal));
    await click('Metas');
    expect(host.querySelector('progress')?.value).toBe(2);
    expect([...host.querySelectorAll('button')].some(item => item.textContent?.includes('Eliminar meta'))).toBe(false);
  });

  it.each(['load', 'action'] as const)('aborts %s and ignores late completion after unmount', async kind => {
    const pending = deferred<SocialDashboard>();
    if (kind === 'load') props.load = vi.fn(() => pending.promise);
    else props.act = vi.fn(() => pending.promise);
    await render();
    if (kind === 'action') { await click('Amigos'); await click('Compartir estadísticas con amigos'); }
    const callback = kind === 'load' ? props.load : props.act;
    const args = vi.mocked(callback).mock.calls[0];
    const signal = args[args.length - 1] as AbortSignal;
    act(() => root.unmount()); unmounted = true;
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(dashboard));
    expect(host.textContent).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores a stale load when the active identity changes', async () => {
    const stale = deferred<SocialDashboard>();
    props.load = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue({ ...dashboard, userEmail: other.email, me: { ...other, sharing: false, stats: null } });
    await render();
    const signal = vi.mocked(props.load).mock.calls[0][0]!;
    props = { ...props, user: other }; await render();
    expect(signal.aborted).toBe(true);
    await act(async () => stale.resolve({ ...dashboard, invitations: [{ id: 'stale', from: me, toEmail: other.email, direction: 'incoming', createdAt: '2026-10-01' }] }));
    expect(host.textContent).toContain('No tienes solicitudes pendientes');
  });
});
