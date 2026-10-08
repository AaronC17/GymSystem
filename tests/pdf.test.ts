/// <reference types="vite/client" />

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDF_LIMITS } from '../src/pdf-limits';
import type { PositionedText } from '../src/pdf-parser';

const pdfjsMock = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}));

// Never load the real PDF.js bundle or its worker in this synthetic test suite.
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => pdfjsMock);
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '/synthetic-pdf-worker.mjs' }));

import { parseRoutinePdf } from '../src/pdf';

function file(size = 16, byteLength = 16): File {
  return {
    name: 'synthetic_routine.pdf',
    size,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(byteLength)),
  } as unknown as File;
}

function positioned(text: string, x: number, top: number, width = 60): PositionedText {
  return { text, x, top, width, height: 10 };
}

function textContent(items: PositionedText[]) {
  return items.map((item) => ({
    str: item.text,
    transform: [1, 0, 0, item.height, item.x, 600 - item.top],
    width: item.width,
    height: item.height,
  }));
}

function structuredPage(repsHeader = 'Reps', sets = '3') {
  return textContent([
    positioned('Lunes', 10, 10),
    positioned('Ejercicio', 10, 40, 100),
    positioned('Series', 240, 40),
    positioned(repsHeader, 330, 40),
    positioned('Musculo', 410, 40),
    positioned('Link', 500, 40),
    positioned('Press banca', 10, 80, 100),
    positioned(sets, 240, 80, 10),
    positioned('8–12', 330, 80, 30),
    positioned('Pecho', 410, 80),
    positioned('https://example.invalid/press', 500, 80, 120),
  ]);
}

function mockDocument(pages: unknown[][], pageCount = pages.length) {
  const getPage = vi.fn(async (number: number) => ({
    getViewport: () => ({ height: 600 }),
    getTextContent: vi.fn(async () => ({ items: pages[number - 1] })),
  }));
  const document = { numPages: pageCount, getPage };
  const destroy = vi.fn(async () => undefined);
  pdfjsMock.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy });
  return { document, getPage, destroy };
}

beforeEach(() => {
  pdfjsMock.getDocument.mockReset();
});

describe('PDF resource limits and cleanup', () => {
  it('rejects an oversized file before reading its bytes or starting a worker', async () => {
    const input = file(PDF_LIMITS.fileBytes + 1);
    await expect(parseRoutinePdf(input)).rejects.toThrow(/15 MB/);
    expect(input.arrayBuffer).not.toHaveBeenCalled();
    expect(pdfjsMock.getDocument).not.toHaveBeenCalled();
  });

  it('rejects empty files before starting a worker', async () => {
    await expect(parseRoutinePdf(file(0, 0))).rejects.toThrow(/vacío/);
    expect(pdfjsMock.getDocument).not.toHaveBeenCalled();
  });

  it('also validates the byte-buffer size', async () => {
    await expect(parseRoutinePdf(file(16, PDF_LIMITS.fileBytes + 1))).rejects.toThrow(/15 MB/);
    expect(pdfjsMock.getDocument).not.toHaveBeenCalled();
  });

  it('destroys the loading task even when its promise rejects', async () => {
    const reason = new Error('Synthetic loading failure');
    const destroy = vi.fn(async () => undefined);
    pdfjsMock.getDocument.mockReturnValue({ promise: Promise.reject(reason), destroy });
    await expect(parseRoutinePdf(file())).rejects.toBe(reason);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects excessive page counts before requesting pages and releases the worker', async () => {
    const { getPage, destroy } = mockDocument([], PDF_LIMITS.pages + 1);
    await expect(parseRoutinePdf(file())).rejects.toThrow(/50 páginas/);
    expect(getPage).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('accepts exactly the page limit when the remaining pages are empty', async () => {
    const pages = [structuredPage(), ...Array.from({ length: PDF_LIMITS.pages - 1 }, () => [])];
    const { getPage, destroy } = mockDocument(pages);
    await expect(parseRoutinePdf(file())).resolves.toMatchObject({ days: [{ dayOfWeek: 1 }] });
    expect(getPage).toHaveBeenCalledTimes(PDF_LIMITS.pages);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('cleans up if a page cannot be loaded', async () => {
    const { getPage, destroy } = mockDocument([[]]);
    getPage.mockRejectedValue(new Error('Synthetic page failure'));
    await expect(parseRoutinePdf(file())).rejects.toThrow('Synthetic page failure');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects excessive fragments before iterating over them', async () => {
    const { destroy } = mockDocument([new Array(PDF_LIMITS.textItemsPerPage + 1)]);
    await expect(parseRoutinePdf(file())).rejects.toThrow(/fragmentos/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('counts oversized text even when it consists only of whitespace', async () => {
    const page = textContent([positioned(' '.repeat(PDF_LIMITS.textCharactersPerPage + 1), 0, 10)]);
    const { destroy } = mockDocument([page]);
    await expect(parseRoutinePdf(file())).rejects.toThrow(/caracteres/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('enforces a total text-item budget across pages', async () => {
    const page = Array.from({ length: PDF_LIMITS.textItemsPerPage }, () => ({ type: 'artifact' }));
    const { destroy } = mockDocument(Array.from({ length: 11 }, () => page));
    await expect(parseRoutinePdf(file())).rejects.toThrow(/demasiado texto/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('enforces a total character budget across pages', async () => {
    const page = textContent([positioned(' '.repeat(PDF_LIMITS.textCharactersPerPage), 0, 10)]);
    const { destroy } = mockDocument(Array.from({ length: 6 }, () => page));
    await expect(parseRoutinePdf(file())).rejects.toThrow(/demasiado texto/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('bounds visual lines across individually valid pages and releases the worker', async () => {
    const page = textContent(Array.from({ length: PDF_LIMITS.visualLines }, (_, index) => positioned('Nota', 0, index * 10)));
    const { destroy } = mockDocument(Array.from({ length: 6 }, () => page));
    await expect(parseRoutinePdf(file())).rejects.toThrow(/10000 líneas/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('bounds heading scans before repeatedly searching a dense page for table headers', async () => {
    const page = textContent(Array.from({ length: PDF_LIMITS.dayHeadingsPerPage + 1 }, (_, index) => positioned('Lunes', 10, index * 10)));
    const { destroy } = mockDocument([page]);
    await expect(parseRoutinePdf(file())).rejects.toThrow(/encabezados.*20 por página/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('bounds heading scans across pages even when each page is within its limit', async () => {
    const page = textContent(Array.from({ length: PDF_LIMITS.dayHeadingsPerPage }, (_, index) => positioned('Lunes', 10, index * 10)));
    const { destroy } = mockDocument(Array.from({ length: 6 }, () => page));
    await expect(parseRoutinePdf(file())).rejects.toThrow(/100 en total/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('releases the worker and gives the existing selectable-text guidance for scans', async () => {
    const { destroy } = mockDocument([[]]);
    await expect(parseRoutinePdf(file())).rejects.toThrow(/texto seleccionable.*imagen escaneada/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('routine format compatibility with synthetic positioned text', () => {
  it.each(['Reps', 'Repeticiones'])('keeps structured tables with a %s header', async (header) => {
    const { destroy } = mockDocument([structuredPage(header)]);
    const result = await parseRoutinePdf(file());
    expect(result).toEqual({
      name: 'synthetic routine',
      days: [{
        dayOfWeek: 1,
        title: 'Lunes',
        exercises: [{
          name: 'Press banca',
          sets: 3,
          reps: '8–12',
          rest: 180,
          muscle: 'Pecho',
          link: 'https://example.invalid/press',
        }],
      }],
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps day headings and exercise content in linear PDFs', async () => {
    mockDocument([textContent([
      positioned('Lunes', 10, 10),
      positioned('Press banca 3 x 8-12', 10, 40, 180),
      positioned('Viernes', 10, 80),
      positioned('Remo sentado | 4 | 10', 10, 110, 180),
    ])]);
    const result = await parseRoutinePdf(file());
    expect(result.days.map((day) => ({ day: day.dayOfWeek, exercises: day.exercises }))).toEqual([
      { day: 1, exercises: [{ name: 'Press banca', sets: 3, reps: '8–12', rest: 180 }] },
      { day: 5, exercises: [{ name: 'Remo sentado', sets: 4, reps: '10', rest: 180 }] },
    ]);
  });

  it.each(['8-12', '8–12', '8—12'])('preserves a linear %s repetition range', async (reps) => {
    mockDocument([textContent([positioned(`Press banca 3 x ${reps}`, 10, 40, 180)])]);
    const result = await parseRoutinePdf(file());
    expect(result.days[0].exercises[0].reps).toBe('8–12');
  });

  it.each(['0', '-1', '1.5', '11', '99', '101'])('rejects structured set count %s rather than silently changing it', async (sets) => {
    const { destroy } = mockDocument([structuredPage('Reps', sets)]);
    await expect(parseRoutinePdf(file())).rejects.toThrow(/1 a 10 series/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it.each(['0', '-1', '1.5', '11', '99', '101'])('rejects linear set count %s rather than silently changing it', async (sets) => {
    const { destroy } = mockDocument([textContent([positioned(`Press banca ${sets} x 10`, 10, 40, 180)])]);
    await expect(parseRoutinePdf(file())).rejects.toThrow(/1 a 10 series/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('bounds linear exercises per day instead of allowing an unbounded deduplication scan', async () => {
    const page = textContent(Array.from({ length: PDF_LIMITS.exercisesPerDay + 1 }, (_, index) =>
      positioned(`Press movimiento ${index} 3 x 10`, 10, index * 10, 180),
    ));
    const { destroy } = mockDocument([page]);
    await expect(parseRoutinePdf(file())).rejects.toThrow(/100 ejercicios por día/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('bounds total exercises even when every day is within its limit', async () => {
    const items: PositionedText[] = [];
    for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']) {
      items.push(positioned(day, 10, items.length * 10));
      for (let index = 0; index < 84; index += 1) {
        items.push(positioned(`Press movimiento ${index} 3 x 10`, 10, items.length * 10, 180));
      }
    }
    const { destroy } = mockDocument([textContent(items)]);
    await expect(parseRoutinePdf(file())).rejects.toThrow(/500 ejercicios en total/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
