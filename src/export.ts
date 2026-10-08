import { isStoredState } from './stateSchema';
import type { AppState } from './types';

type ExportFile = {
  filename: string;
  type: string;
  content: string;
};

function assertExportableState(state: AppState) {
  if (!isStoredState(state)) throw new Error('No fue posible exportar: los datos no tienen un formato válido.');
}

function csvCell(value: string | number) {
  let text = String(value);
  // Quoting alone does not stop spreadsheet formulas in user-entered names.
  if (typeof value === 'string' && (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function createJsonExport(state: AppState, now = new Date()): ExportFile {
  assertExportableState(state);
  return {
    filename: `kyon-respaldo-${now.toISOString().slice(0, 10)}.json`,
    type: 'application/json;charset=utf-8',
    content: JSON.stringify({
      format: 'kyon-training-journal',
      version: 1,
      exportedAt: now.toISOString(),
      state,
    }, null, 2),
  };
}

export function createCsvExport(state: AppState, now = new Date()): ExportFile {
  assertExportableState(state);
  const rows: Array<Array<string | number>> = [[
    'fecha', 'entrenamiento_id', 'dia_rutina_id', 'entrenamiento', 'duracion_minutos',
    'entrenamiento_completado', 'ejercicio_id', 'ejercicio', 'serie', 'peso',
    'unidad', 'repeticiones', 'serie_completada',
  ]];
  const baseRow = (log: AppState['logs'][number]) => [
    log.date, log.id, log.routineDayId, log.title, log.duration, log.completed ? 'sí' : 'no',
  ];

  for (const log of state.logs) {
    if (log.exercises.length === 0) rows.push([...baseRow(log), '', '', '', '', '', '', '']);
    for (const exercise of log.exercises) {
      if (exercise.sets.length === 0) rows.push([...baseRow(log), exercise.exerciseId, exercise.exerciseName, '', '', '', '', '']);
      exercise.sets.forEach((set, index) => {
        rows.push([
          ...baseRow(log), exercise.exerciseId, exercise.exerciseName, index + 1,
          set.weight, set.unit, set.reps, set.done ? 'sí' : 'no',
        ]);
      });
    }
  }

  return {
    filename: `kyon-entrenamientos-${now.toISOString().slice(0, 10)}.csv`,
    type: 'text/csv;charset=utf-8',
    // UTF-8 BOM preserves Spanish accents in common spreadsheet applications.
    content: '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n',
  };
}

export function downloadExport(file: ExportFile) {
  const blob = new Blob([file.content], { type: file.type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Keep the URL alive until the browser has accepted the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
