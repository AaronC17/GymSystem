import { describe, expect, it } from 'vitest';
import {
  assertPdfDayHeadingCount,
  assertPdfExerciseCount,
  assertPdfFileSize,
  assertPdfPageCount,
  assertPdfSetCount,
  assertPdfTotalVisualLineCount,
  consumePdfPartitionBudget,
  consumePdfTextBudget,
  createPdfPartitionBudget,
  createPdfTextBudget,
  PDF_LIMITS,
} from '../src/pdf-limits';
import {
  groupVisualLines,
  joinPositionedItems,
  partitionExerciseNames,
  type PositionedText,
  type RowAnchor,
  type VisualLine,
} from '../src/pdf-parser';

function item(text: string, x: number, top: number, width = 20): PositionedText {
  return { text, x, top, width, height: 10 };
}

function lines(count: number): VisualLine[] {
  return Array.from({ length: count }, (_, index) => ({ top: index * 10, text: `Ejercicio ${index}`, items: [] }));
}

function anchors(count: number): RowAnchor[] {
  return Array.from({ length: count }, (_, index) => ({ top: index * 10, sets: 3, accordingToVideo: false }));
}

describe('PDF limits without loading PDF.js', () => {
  it.each([1, PDF_LIMITS.fileBytes])('accepts a file size of %i bytes', (bytes) => {
    expect(() => assertPdfFileSize(bytes)).not.toThrow();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.5])('rejects invalid file size %s', (bytes) => {
    expect(() => assertPdfFileSize(bytes)).toThrow(/vacío|válido/);
  });

  it('rejects a file above 15 MB', () => {
    expect(() => assertPdfFileSize(PDF_LIMITS.fileBytes + 1)).toThrow(/15 MB/);
  });

  it.each([1, PDF_LIMITS.pages])('accepts %i pages', (pages) => {
    expect(() => assertPdfPageCount(pages)).not.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid page count %s', (pages) => {
    expect(() => assertPdfPageCount(pages)).toThrow(/páginas/);
  });

  it('rejects more than 50 pages', () => {
    expect(() => assertPdfPageCount(PDF_LIMITS.pages + 1)).toThrow(/50 páginas/);
  });

  it.each([1, 3, PDF_LIMITS.sets])('keeps valid set count %i', (sets) => {
    expect(() => assertPdfSetCount(sets)).not.toThrow();
  });

  it.each([0, -1, 11, 99, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid set count %s instead of clamping', (sets) => {
    expect(() => assertPdfSetCount(sets)).toThrow(/1 a 10 series/);
  });

  it('accepts the per-page text limits and tracks document totals', () => {
    const budget = createPdfTextBudget();
    consumePdfTextBudget(PDF_LIMITS.textItemsPerPage, PDF_LIMITS.textCharactersPerPage, budget);
    expect(budget).toEqual({ items: PDF_LIMITS.textItemsPerPage, characters: PDF_LIMITS.textCharactersPerPage });
  });

  it('rejects excessive items on a page', () => {
    expect(() => consumePdfTextBudget(PDF_LIMITS.textItemsPerPage + 1, 0, createPdfTextBudget())).toThrow(/fragmentos/);
  });

  it('rejects excessive characters on a page', () => {
    expect(() => consumePdfTextBudget(1, PDF_LIMITS.textCharactersPerPage + 1, createPdfTextBudget())).toThrow(/caracteres/);
  });

  it('enforces the document text-item budget across individually valid pages', () => {
    const budget = createPdfTextBudget();
    for (let index = 0; index < PDF_LIMITS.textItemsTotal / PDF_LIMITS.textItemsPerPage; index += 1) {
      consumePdfTextBudget(PDF_LIMITS.textItemsPerPage, 1, budget);
    }
    expect(() => consumePdfTextBudget(1, 1, budget)).toThrow(/demasiado texto/);
    expect(budget.items).toBe(PDF_LIMITS.textItemsTotal);
  });

  it('enforces the document character budget across individually valid pages', () => {
    const budget = createPdfTextBudget();
    for (let index = 0; index < PDF_LIMITS.textCharactersTotal / PDF_LIMITS.textCharactersPerPage; index += 1) {
      consumePdfTextBudget(1, PDF_LIMITS.textCharactersPerPage, budget);
    }
    expect(() => consumePdfTextBudget(1, 1, budget)).toThrow(/caracteres/);
  });

  it('bounds the total number of visual lines across pages', () => {
    expect(() => assertPdfTotalVisualLineCount(PDF_LIMITS.visualLinesTotal)).not.toThrow();
    expect(() => assertPdfTotalVisualLineCount(PDF_LIMITS.visualLinesTotal + 1)).toThrow(/10000 líneas/);
  });

  it('bounds the number of exercises in both parser strategies', () => {
    expect(() => assertPdfExerciseCount(PDF_LIMITS.exercisesPerDay, PDF_LIMITS.exercisesTotal)).not.toThrow();
    expect(() => assertPdfExerciseCount(PDF_LIMITS.exercisesPerDay + 1, 101)).toThrow(/100 ejercicios por día/);
    expect(() => assertPdfExerciseCount(1, PDF_LIMITS.exercisesTotal + 1)).toThrow(/500 ejercicios en total/);
  });

  it('bounds heading scans even when there is no table to partition', () => {
    expect(() => assertPdfDayHeadingCount(PDF_LIMITS.dayHeadingsPerPage, PDF_LIMITS.dayHeadingsTotal)).not.toThrow();
    expect(() => assertPdfDayHeadingCount(PDF_LIMITS.dayHeadingsPerPage + 1, 21)).toThrow(/20 por página/);
    expect(() => assertPdfDayHeadingCount(1, PDF_LIMITS.dayHeadingsTotal + 1)).toThrow(/100 en total/);
  });
});

describe('positioned text grouping', () => {
  it('joins spaced fragments and punctuation in visual order', () => {
    expect(joinPositionedItems([item('banca', 35, 10, 30), item('Press', 0, 10, 30), item(',', 66, 10, 3)]))
      .toBe('Press banca,');
  });

  it('preserves line grouping and average baseline without mutating the input', () => {
    const input = [item('Remo', 0, 40), item('banca', 35, 11), item('Press', 0, 10)];
    const original = input.slice();
    const grouped = groupVisualLines(input);
    expect(grouped.map((line) => ({ text: line.text, top: line.top }))).toEqual([
      { text: 'Press banca', top: 10.5 },
      { text: 'Remo', top: 40 },
    ]);
    expect(input).toEqual(original);
  });

  it('rejects excessive fragments before sorting', () => {
    const input = Array.from({ length: PDF_LIMITS.textItemsPerPage + 1 }, () => item('Press', 0, 10));
    expect(() => groupVisualLines(input)).toThrow(/fragmentos/);
  });

  it('rejects excessive visual lines', () => {
    const input = Array.from({ length: PDF_LIMITS.visualLines + 1 }, (_, index) => item('Press', 0, index * 10));
    expect(() => groupVisualLines(input)).toThrow(/líneas/);
  });
});

describe('bounded exercise-name partitioning', () => {
  it('keeps multiline names associated with their original series anchors', () => {
    const input: VisualLine[] = [
      { top: 10, text: 'Press', items: [] },
      { top: 22, text: 'banca', items: [] },
      { top: 60, text: 'Remo', items: [] },
      { top: 70, text: 'sentado', items: [] },
    ];
    const rows: RowAnchor[] = [
      { top: 16, sets: 3, accordingToVideo: false },
      { top: 65, sets: 4, accordingToVideo: false },
    ];
    const budget = createPdfPartitionBudget();
    expect(partitionExerciseNames(input, rows, budget).map((group) => group.map((line) => line.text)))
      .toEqual([['Press', 'banca'], ['Remo', 'sentado']]);
    expect(budget.work).toBe(20);
  });

  it('returns no partition when anchors are missing or cannot be matched', () => {
    expect(partitionExerciseNames(lines(2), [])).toEqual([]);
    expect(partitionExerciseNames(lines(1), anchors(2))).toEqual([]);
  });

  it('rejects excessive table rows before allocating DP grids', () => {
    expect(() => partitionExerciseNames(lines(PDF_LIMITS.tableRows + 1), anchors(PDF_LIMITS.tableRows + 1)))
      .toThrow(/100 ejercicios/);
  });

  it('rejects excessive name lines before allocating DP grids', () => {
    expect(() => partitionExerciseNames(lines(PDF_LIMITS.tableNameLines + 1), anchors(1)))
      .toThrow(/400 líneas/);
  });

  it('rejects expensive combinations even when both dimensions are within their limits', () => {
    expect(() => partitionExerciseNames(lines(400), anchors(25))).toThrow(/demasiado compleja/);
  });

  it('shares a work budget across tables in the same document', () => {
    const budget = { work: PDF_LIMITS.partitionWorkTotal - 1 };
    expect(() => consumePdfPartitionBudget(2, 1, budget)).toThrow(/demasiado compleja/);
    expect(budget.work).toBe(PDF_LIMITS.partitionWorkTotal - 1);
  });
});
