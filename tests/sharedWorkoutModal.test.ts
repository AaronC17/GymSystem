// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkoutHistoryModal } from '../src/App';
import type { WorkoutLog } from '../src/types';

afterEach(() => vi.unstubAllGlobals());
it('uses the calendar record dialog for a shared workout with mixed units and safe prose', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Network disabled'); }));
  const host = document.createElement('div'); document.body.append(host);
  const trigger = document.createElement('button'); trigger.textContent = 'Abrir publicación'; document.body.append(trigger); trigger.focus();
  const root = createRoot(host);
  const close = vi.fn();
  const log: WorkoutLog = { id: 'shared-log', routineDayId: 'shared-day', date: '2026-10-08', title: 'Fuerza compartida', duration: 30, completed: true, exercises: [
    { exerciseId: 'press', exerciseName: 'Press', sets: [{ weight: 20, reps: 8, done: true, unit: 'kg' }] },
    { exerciseId: 'row', exerciseName: 'Remo', sets: [{ weight: 40, reps: 10, done: true, unit: 'lb' }, { weight: 0, reps: 12, done: false, unit: 'kg' }] },
  ] };
  try {
    act(() => root.render(createElement(WorkoutHistoryModal, { date: log.date, logs: [log], ownerName: 'Amiga de prueba', description: 'Buen entreno\n<script>NO EJECUTAR</script>', returnFocus: trigger, onClose: close })));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.classList.contains('history-modal')).toBe(true);
    expect(dialog.textContent).toContain('COMPARTIDO POR Amiga de prueba');
    expect(dialog.textContent).toContain('20 kg'); expect(dialog.textContent).toContain('40 lb'); expect(dialog.textContent).toContain('0 kg');
    expect(dialog.textContent).toContain('Pendiente');
    expect(dialog.querySelector('.history-shared-description')?.textContent).toBe('Buen entreno\n<script>NO EJECUTAR</script>');
    expect(dialog.querySelector('script')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Cerrar registro');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(close).toHaveBeenCalledOnce();
  } finally { act(() => root.unmount()); expect(document.activeElement).toBe(trigger); host.remove(); trigger.remove(); }
});
