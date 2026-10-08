// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkoutSession } from '../src/App';
import type { RoutineDay, WorkoutLog } from '../src/types';

const email = 'units-test@example.invalid';
const key = `kyon-active-workout-v1:${email}`;
const day: RoutineDay = { id: 'test-day', title: 'Mixed weights', dayOfWeek: 4, focus: '', color: '#abc', duration: 30, exercises: [
  { id: 'press', name: 'Press', sets: 1, reps: '10', rest: 60 },
  { id: 'row', name: 'Row', sets: 1, reps: '10', rest: 60 },
] };
const original: WorkoutLog = { id: 'test-log', date: '2026-10-08', routineDayId: day.id, title: day.title, duration: 30, completed: true, exercises: [
  { exerciseId: 'press', exerciseName: 'Press', sets: [{ weight: 10, reps: 10, done: true, unit: 'kg' }] },
  { exerciseId: 'row', exerciseName: 'Row', sets: [{ weight: 40, reps: 10, done: true, unit: 'lb' }] },
] };
let host: HTMLDivElement;
let root: Root;
let finish: ReturnType<typeof vi.fn<(log: WorkoutLog, returnFocus?: HTMLElement | null) => boolean>>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Network forbidden'); }));
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  finish = vi.fn<(log: WorkoutLog, returnFocus?: HTMLElement | null) => boolean>(() => true);
});
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals(); });
function render(logs = [structuredClone(original)]) {
  act(() => root.render(createElement(WorkoutSession, { active: { day, date: original.date }, logs, unit: 'kg', userEmail: email, onClose: vi.fn(), onFinish: finish })));
}
function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  if (!button) throw Error(`Missing ${text}`);
  act(() => button.click());
}
const draft = () => JSON.parse(localStorage.getItem(key)!);
describe('independent exercise weight units', () => {
  it('keeps a compact two-button selector beside the series with accessible exercise context', () => {
    render();
    const toolbar = host.querySelector('.exercise-set-toolbar');
    const controls = toolbar?.querySelector('[role="group"]');
    expect(toolbar?.nextElementSibling?.classList.contains('set-table')).toBe(true);
    expect(controls?.getAttribute('aria-label')).toBe('Unidad de peso para Press');
    expect(controls?.getAttribute('aria-description')).toContain('Solo cambia este ejercicio');
    expect([...controls!.querySelectorAll('button')].map(button => button.textContent)).toEqual(['KG', 'LB']);
    expect(controls?.querySelector('button[aria-pressed="true"]')?.textContent).toBe('KG');
    expect(controls?.querySelector('span, small')).toBeNull();
    expect(controls?.querySelector('button')?.title).toBe('Kilogramos · solo este ejercicio');
    click('Siguiente ejercicio');
    expect(controls?.getAttribute('aria-label')).toBe('Unidad de peso para Row');
    expect(controls?.querySelector('button[aria-pressed="true"]')?.textContent).toBe('LB');
  });
  it('changes only the current exercise, preserving physical load and completed state', () => {
    render(); click('LB');
    expect(draft().exerciseLogs[0].sets[0]).toMatchObject({ unit: 'lb', reps: 10, done: true });
    expect(draft().exerciseLogs[0].sets[0].weight).toBeCloseTo(22.046226, 4);
    expect(draft().exerciseLogs[1]).toEqual(original.exercises[1]);
    click('Siguiente ejercicio');
    expect(host.querySelector('.exercise-unit-controls button[aria-pressed="true"]')?.textContent).toBe('LB');
    click('KG');
    expect(draft().exerciseLogs[1].sets[0].weight).toBeCloseTo(18.14369, 4);
    expect(draft().exerciseLogs[0].sets[0].unit).toBe('lb');
    click('Anterior');
    expect(host.querySelector('.exercise-unit-controls button[aria-pressed="true"]')?.textContent).toBe('LB');
    click('KG');
    expect(draft().exerciseLogs[0].sets[0].weight).toBeCloseTo(10, 10);
  });
  it('restores mixed-unit drafts without converting all exercises to the general preference', () => {
    localStorage.setItem(key, JSON.stringify({ routineDayId: day.id, date: original.date, seconds: 12, exerciseLogs: original.exercises, savedAt: new Date().toISOString() }));
    render([]);
    expect(draft().exerciseLogs).toEqual(original.exercises);
    click('Siguiente ejercicio');
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Peso de la serie 1"]')?.value).toBe('40');
    expect(host.querySelector('.set-table-head')?.textContent).toContain('PESO (LB)');
  });
  it('adds sets in the chosen exercise unit and finishes with mixed units intact', () => {
    render(); click('LB'); click('Añadir serie');
    expect(draft().exerciseLogs[0].sets[1].unit).toBe('lb');
    const checks = host.querySelectorAll<HTMLButtonElement>('.set-check');
    act(() => checks[1].click());
    click('Siguiente ejercicio'); click('KG'); click('Finalizar entrenamiento');
    expect(finish).toHaveBeenCalledOnce();
    const saved = finish.mock.calls[0][0] as WorkoutLog;
    expect(saved.exercises[0].sets.every(s => s.unit === 'lb')).toBe(true);
    expect(saved.exercises[1].sets[0].unit).toBe('kg');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses each exercise’s previous unit rather than one session-wide unit', () => {
    render([{ ...structuredClone(original), date: '2026-10-01' }]);
    expect(draft().exerciseLogs[0].sets[0].unit).toBe('kg');
    expect(draft().exerciseLogs[1].sets[0].unit).toBe('lb');
    expect(draft().exerciseLogs[1].sets[0].done).toBe(false);
  });
});
