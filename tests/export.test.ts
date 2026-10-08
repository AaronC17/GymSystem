import { describe, expect, it } from 'vitest';
import { createCsvExport, createJsonExport } from '../src/export';
import type { AppState } from '../src/types';

const now = new Date('2026-10-08T12:00:00.000Z');

function fixture(): AppState {
  return {
    routine: { id: 'routine-empty', name: '', days: [] },
    logs: [{
      id: 'workout-1', date: '2026-10-08', routineDayId: 'day-1',
      title: 'Día de prueba', duration: 42, completed: true,
      exercises: [{
        exerciseId: 'exercise-1', exerciseName: 'Press, "inclinado"',
        sets: [
          { weight: 20.5, reps: 10, unit: 'kg', done: true },
          { weight: 45, reps: 8, unit: 'lb', done: false },
        ],
      }],
    }],
    unit: 'lb',
  };
}

describe('local data export', () => {
  it('exports a versioned JSON snapshot without changing the state', () => {
    const state = fixture();
    const before = structuredClone(state);
    const file = createJsonExport(state, now);
    const content = JSON.parse(file.content);
    expect(file.filename).toBe('kyon-respaldo-2026-10-08.json');
    expect(content.version).toBe(1);
    expect(content.exportedAt).toBe(now.toISOString());
    expect(content.state).toEqual(before);
    expect(state).toEqual(before);
  });

  it('preserves weights, original units, repetitions and incomplete sets in CSV', () => {
    const file = createCsvExport(fixture(), now);
    expect(file.content.startsWith('\uFEFF')).toBe(true);
    expect(file.content).toContain('"Press, ""inclinado"""');
    expect(file.content).toContain('"1","20.5","kg","10","sí"');
    expect(file.content).toContain('"2","45","lb","8","no"');
    expect(file.content.trim().split('\r\n')).toHaveLength(3);
  });

  it.each(['=SUM(1,2)', '+formula', '-formula', '@formula', '  =formula', '\tformula'])('neutralizes spreadsheet formulas: %s', (name) => {
    const state = fixture();
    state.logs[0].exercises[0].exerciseName = name;
    expect(createCsvExport(state, now).content).toContain(`"'${name}"`);
    // JSON retains the exact user data; only spreadsheet cells are escaped.
    expect(JSON.parse(createJsonExport(state, now).content).state.logs[0].exercises[0].exerciseName).toBe(name);
  });

  it('keeps sessions even if they have no exercise or set rows', () => {
    const state = fixture();
    state.logs.push({ ...state.logs[0], id: 'workout-empty', exercises: [] });
    state.logs.push({ ...state.logs[0], id: 'workout-no-sets', exercises: [{ exerciseId: 'exercise-2', exerciseName: 'Sin series', sets: [] }] });
    const content = createCsvExport(state, now).content;
    expect(content).toContain('"workout-empty"');
    expect(content).toContain('"workout-no-sets"');
  });

  it('exports an empty account with CSV headers and a valid JSON snapshot', () => {
    const state: AppState = { routine: { id: 'routine-empty', name: '', days: [] }, logs: [], unit: 'kg' };
    expect(createCsvExport(state, now).content.trim().split('\r\n')).toHaveLength(1);
    expect(JSON.parse(createJsonExport(state, now).content).state).toEqual(state);
  });

  it('rejects malformed state instead of creating a misleading backup', () => {
    const state = { ...fixture(), unit: 'invalid' } as unknown as AppState;
    expect(() => createJsonExport(state, now)).toThrow('formato válido');
    expect(() => createCsvExport(state, now)).toThrow('formato válido');
  });
});
