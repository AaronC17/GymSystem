import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { ParsedRoutine } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type PositionedText = {
  text: string;
  x: number;
  top: number;
  width: number;
  height: number;
};

type VisualLine = {
  top: number;
  items: PositionedText[];
  text: string;
};

type RowAnchor = {
  top: number;
  sets: number;
  accordingToVideo: boolean;
};

const dayMatchers = [
  { index: 1, regex: /\b(lunes|monday)\b/i },
  { index: 2, regex: /\b(martes|tuesday)\b/i },
  { index: 3, regex: /\b(mi[eé]rcoles|wednesday)\b/i },
  { index: 4, regex: /\b(jueves|thursday)\b/i },
  { index: 5, regex: /\b(viernes|friday)\b/i },
  { index: 6, regex: /\b(s[aá]bado|saturday)\b/i },
  { index: 0, regex: /\b(domingo|sunday)\b/i },
];

const ordinalDay = /\bd[ií]a\s*([1-7])\b/i;
const ordinalWeekdays = [1, 2, 3, 4, 5, 6, 0];
const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const exerciseWords = /press|remo|sentadilla|curl|peso muerto|jal[oó]n|dominada|fondos|apertura|elevaci[oó]n|extensi[oó]n|prensa|zancada|hip thrust|abducci[oó]n|aducci[oó]n|plancha|crunch|gemelo|pantorrilla|b[ií]ceps|tr[ií]ceps|squat|deadlift|row|fly|pulldown|push.?up|lunge|rutina abs/i;
const ignoredWords = /calentamiento|^\s*(rutina|entrenamiento|descanso|series|repeticiones|observaciones|ejercicio|semana|nombre|cliente|fecha)\s*:?\s*$/i;
const tableStopWords = /^(calentamiento|observaciones|recomendaciones|indicaciones|notas)\b/i;

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceCase(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return clean;
  return clean.charAt(0).toLocaleUpperCase('es') + clean.slice(1);
}

function cleanExerciseName(value: string) {
  return sentenceCase(
    value
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/^[\d.)\s–—-]+/, '')
      .replace(/[|·:–—-]+$/, '')
      .replace(/\s+([/)])/g, '$1')
      .replace(/([(])\s+/g, '$1')
      .replace(/\s{2,}/g, ' '),
  );
}

function joinPositionedItems(items: PositionedText[]) {
  const sorted = items.slice().sort((a, b) => a.x - b.x);
  let result = '';
  let rightEdge = 0;

  for (const item of sorted) {
    const text = item.text.trim();
    if (!text) continue;
    const gap = item.x - rightEdge;
    const needsSpace = result && gap > Math.max(0.8, item.height * 0.08) && !/^[,.;:)]/.test(text);
    result += `${needsSpace ? ' ' : ''}${text}`;
    rightEdge = Math.max(rightEdge, item.x + item.width);
  }

  return result.replace(/\s+/g, ' ').trim();
}

function groupVisualLines(items: PositionedText[], tolerance = 2.5): VisualLine[] {
  const sorted = items.slice().sort((a, b) => a.top - b.top || a.x - b.x);
  const lines: Array<{ top: number; items: PositionedText[] }> = [];

  for (const item of sorted) {
    const latestLine = lines.at(-1);
    const line = latestLine && Math.abs(latestLine.top - item.top) <= tolerance ? latestLine : undefined;
    if (line) {
      line.items.push(item);
      line.top = line.items.reduce((sum, entry) => sum + entry.top, 0) / line.items.length;
    } else {
      lines.push({ top: item.top, items: [item] });
    }
  }

  return lines.map((line) => ({ ...line, text: joinPositionedItems(line.items) }));
}

function detectDayHeading(line: string) {
  const namedDay = dayMatchers.find((entry) => entry.regex.test(line));
  const numberedDay = line.match(ordinalDay);
  const dayOfWeek = namedDay?.index ?? (numberedDay ? ordinalWeekdays[Number(numberedDay[1]) - 1] : undefined);
  if (dayOfWeek === undefined) return null;
  const headingPattern = namedDay?.regex ?? ordinalDay;
  const title = line
    .replace(headingPattern, '')
    .replace(/^\s*[:|–—-]\s*/, '')
    .trim();
  return { dayOfWeek, title: title ? sentenceCase(title) : '' };
}

function findHeaderItem(items: PositionedText[], names: string[]) {
  return items.find((item) => names.some((name) => normalize(item.text).startsWith(name)));
}

function assignToColumns(items: PositionedText[], starts: number[]) {
  const columns: PositionedText[][] = starts.map(() => []);
  const boundaries: number[] = [];
  for (let i = 0; i < starts.length - 1; i += 1) {
    boundaries.push((starts[i] + starts[i + 1]) / 2 + 12);
  }
  for (const item of items) {
    let nearest = 0;
    for (let i = 0; i < boundaries.length; i += 1) {
      if (item.x >= boundaries[i]) nearest = i + 1;
    }
    columns[nearest].push(item);
  }
  return columns;
}

function clusterSpecialAnchors(lines: VisualLine[]) {
  const clusters: VisualLine[][] = [];
  for (const line of lines) {
    const previous = clusters.at(-1);
    if (previous && line.top - previous.at(-1)!.top <= 18) previous.push(line);
    else clusters.push([line]);
  }
  return clusters.map((cluster) => ({
    top: cluster.reduce((sum, line) => sum + line.top, 0) / cluster.length,
    sets: 1,
    accordingToVideo: true,
  }));
}

function buildRowAnchors(seriesItems: PositionedText[], headerTop: number): RowAnchor[] {
  const lines = groupVisualLines(seriesItems)
    .filter((line) => line.top > headerTop + 5 && normalize(line.text) !== 'series');
  const numeric: RowAnchor[] = lines
    .filter((line) => /^[1-9]\d?$/.test(line.text.trim()))
    .map((line) => ({ top: line.top, sets: Math.min(10, Number(line.text.trim())), accordingToVideo: false }));
  const specialLines = lines.filter((line) => !/^\d+$/.test(line.text.trim()) && /seg[uú]n|video|lo que|dice en/i.test(line.text));
  return [...numeric, ...clusterSpecialAnchors(specialLines)].sort((a, b) => a.top - b.top);
}

function groupCost(lines: VisualLine[], anchor: RowAnchor) {
  const center = (lines[0].top + lines.at(-1)!.top) / 2;
  const distance = center - anchor.top;
  const startsAsContinuation = /^[a-záéíóúüñ(]/.test(lines[0].text.trim()) ? 900 : 0;
  const excessiveLength = Math.max(0, lines.length - 7) * 700;
  return distance * distance + startsAsContinuation + excessiveLength;
}

function partitionExerciseNames(lines: VisualLine[], anchors: RowAnchor[]) {
  if (!anchors.length || lines.length < anchors.length) return [];
  const rowCount = anchors.length;
  const lineCount = lines.length;
  const costs = Array.from({ length: rowCount + 1 }, () => Array(lineCount + 1).fill(Number.POSITIVE_INFINITY));
  const previous = Array.from({ length: rowCount + 1 }, () => Array(lineCount + 1).fill(-1));
  costs[0][0] = 0;

  for (let row = 1; row <= rowCount; row += 1) {
    for (let end = row; end <= lineCount; end += 1) {
      const maxStart = end - 1;
      const minStart = row - 1;
      for (let start = minStart; start <= maxStart; start += 1) {
        if (!Number.isFinite(costs[row - 1][start])) continue;
        const remainingLines = lineCount - end;
        const remainingRows = rowCount - row;
        if (remainingLines < remainingRows) continue;
        const candidate = costs[row - 1][start] + groupCost(lines.slice(start, end), anchors[row - 1]);
        if (candidate < costs[row][end]) {
          costs[row][end] = candidate;
          previous[row][end] = start;
        }
      }
    }
  }

  let bestEnd = rowCount;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let end = rowCount; end <= lineCount; end += 1) {
    const unassignedPenalty = (lineCount - end) * 1800;
    if (costs[rowCount][end] + unassignedPenalty < bestCost) {
      bestCost = costs[rowCount][end] + unassignedPenalty;
      bestEnd = end;
    }
  }

  const groups: VisualLine[][] = [];
  let end = bestEnd;
  for (let row = rowCount; row >= 1; row -= 1) {
    const start = previous[row][end];
    if (start < 0) return [];
    groups.unshift(lines.slice(start, end));
    end = start;
  }
  return groups;
}

function linesForRow(lines: VisualLine[], anchors: RowAnchor[], index: number) {
  const before = index === 0 ? Number.NEGATIVE_INFINITY : (anchors[index - 1].top + anchors[index].top) / 2;
  const after = index === anchors.length - 1 ? Number.POSITIVE_INFINITY : (anchors[index].top + anchors[index + 1].top) / 2;
  return lines.filter((line) => line.top > before && line.top <= after);
}

function cleanReps(value: string, accordingToVideo: boolean) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const range = normalized.match(/\d{1,2}\s*[–—-]\s*\d{1,2}/)?.[0];
  const single = normalized.match(/^\d{1,2}$/)?.[0];
  if (range) {
    const cleanRange = range.replace(/\s/g, '').replace(/[—-]/g, '–');
    return /por\s*pierna/i.test(normalized) ? `${cleanRange} por pierna` : cleanRange;
  }
  if (single) return single;
  return accordingToVideo ? 'Según video' : '8–12';
}

function parseStructuredTables(pages: PositionedText[][], fallbackName: string): ParsedRoutine | null {
  const parsedDays: ParsedRoutine['days'] = [];

  for (const pageItems of pages) {
    const pageLines = groupVisualLines(pageItems);
    const headings = pageLines
      .map((line) => ({ line, day: detectDayHeading(line.text) }))
      .filter((entry): entry is { line: VisualLine; day: NonNullable<ReturnType<typeof detectDayHeading>> } => Boolean(entry.day));

    headings.forEach((heading, headingIndex) => {
      const nextHeadingTop = headings[headingIndex + 1]?.line.top ?? Number.POSITIVE_INFINITY;
      const stopLine = pageLines.find((line) => line.top > heading.line.top && line.top < nextHeadingTop && tableStopWords.test(line.text.trim()));
      const sectionEnd = Math.min(nextHeadingTop, stopLine?.top ?? Number.POSITIVE_INFINITY);
      const headerLine = pageLines.find((line) => {
        const text = normalize(line.text);
        return line.top > heading.line.top && line.top < sectionEnd && text.includes('ejercicio') && text.includes('series') && text.includes('reps');
      });
      if (!headerLine) return;

      const headerAreaItems = pageItems.filter((item) => item.top >= headerLine.top - 3 && item.top <= headerLine.top + 22);
      const exerciseHeader = findHeaderItem(headerAreaItems, ['ejercicio', 'exercise']);
      const seriesHeader = findHeaderItem(headerAreaItems, ['series', 'sets']);
      const repsHeader = findHeaderItem(headerAreaItems, ['reps', 'repeticiones']);
      const muscleHeader = findHeaderItem(headerAreaItems, ['musculo', 'músculo', 'grupo muscular']);
      const linkHeader = findHeaderItem(headerAreaItems, ['link', 'enlace', 'video']);
      if (!exerciseHeader || !seriesHeader || !repsHeader) return;

      const descriptors = [
        { type: 'exercise', x: exerciseHeader.x },
        { type: 'series', x: seriesHeader.x },
        { type: 'reps', x: repsHeader.x },
        ...(muscleHeader ? [{ type: 'muscle', x: muscleHeader.x }] : []),
        ...(linkHeader ? [{ type: 'link', x: linkHeader.x }] : []),
      ].sort((a, b) => a.x - b.x);
      const starts = descriptors.map((descriptor) => descriptor.x);

      const contentItems = pageItems.filter((item) => item.top > headerLine.top + 5 && item.top < sectionEnd);
      const columns = assignToColumns(contentItems, starts);
      const column = (type: string) => columns[descriptors.findIndex((descriptor) => descriptor.type === type)] ?? [];
      const anchors = buildRowAnchors(column('series'), headerLine.top);
      if (!anchors.length) return;

      const exerciseLines = groupVisualLines(column('exercise'))
        .filter((line) => line.top > headerLine.top + 5 && !/^(ejercicio|exercise)$/i.test(line.text.trim()));
      const nameGroups = partitionExerciseNames(exerciseLines, anchors);
      if (nameGroups.length !== anchors.length) return;

      const repsLines = groupVisualLines(column('reps'));
      const muscleLines = groupVisualLines(column('muscle'));
      const linkLines = groupVisualLines(column('link'));
      const exercises = anchors.flatMap((anchor, index) => {
        const name = cleanExerciseName(nameGroups[index].map((line) => line.text).join(' '));
        if (!name || ignoredWords.test(name) || /^https?:/i.test(name)) return [];
        const repsText = linesForRow(repsLines, anchors, index).map((line) => line.text).join(' ');
        const muscle = linesForRow(muscleLines, anchors, index).map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim();
        const linkText = linesForRow(linkLines, anchors, index).map((line) => line.text).join(' ');
        const link = linkText.match(/https?:\/\/\S+/i)?.[0]?.replace(/[),.;]+$/, '');
        return [{
          name,
          sets: anchor.sets,
          reps: cleanReps(repsText, anchor.accordingToVideo),
          rest: 180,
          muscle: muscle || undefined,
          link,
        }];
      });

      if (!exercises.length) return;
      const existingDay = parsedDays.find((day) => day.dayOfWeek === heading.day.dayOfWeek);
      if (existingDay) {
        for (const exercise of exercises) {
          if (!existingDay.exercises.some((item) => normalize(item.name) === normalize(exercise.name))) existingDay.exercises.push(exercise);
        }
        if (heading.day.title && /^Entrenamiento \d+$/.test(existingDay.title)) existingDay.title = heading.day.title;
      } else {
        const fallbackTitle = heading.day.title || dayNames[heading.day.dayOfWeek] || `Entrenamiento ${parsedDays.length + 1}`;
        parsedDays.push({
          dayOfWeek: heading.day.dayOfWeek,
          title: fallbackTitle,
          exercises,
        });
      }
    });
  }

  if (!parsedDays.length) return null;
  return {
    name: fallbackName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '),
    days: parsedDays,
  };
}

function parseExerciseLine(line: string) {
  const clean = line.replace(/[•●▪]/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length < 4 || clean.length > 140 || ignoredWords.test(clean) || /https?:\/\//i.test(clean)) return null;
  const patterns = [
    /^(.{3,}?)\s*(?:[|:–—-]\s*)?(\d{1,2})\s*(?:series?\s*)?(?:x|×|de)\s*(\d{1,2}(?:\s*[–-]\s*\d{1,2})?)(?:\s*(?:reps?|repeticiones?))?/i,
    /^(.{3,}?)\s*[|]\s*(\d{1,2})\s*[|]\s*(\d{1,2}(?:\s*[–-]\s*\d{1,2})?)/i,
    /^(.{3,}?)\s+(\d{1,2})\s+(\d{1,2}(?:\s*[–-]\s*\d{1,2})?)(?:\s+\d{1,3}\s*s?)?$/i,
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (!match) continue;
    const name = cleanExerciseName(match[1]);
    if (name.length < 3) continue;
    return { name, sets: Math.min(10, Number(match[2])), reps: match[3].replace(/\s/g, '').replace('-', '–'), rest: 180 };
  }
  if (exerciseWords.test(clean) && !/\d{3,}/.test(clean)) return { name: cleanExerciseName(clean), sets: 3, reps: '8–12', rest: 180 };
  return null;
}

function parseLinearText(lines: string[], fallbackName: string): ParsedRoutine {
  const days: ParsedRoutine['days'] = [];
  let currentDay: ParsedRoutine['days'][number] | null = null;
  let fallbackDay = 1;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const heading = detectDayHeading(line);
    if (heading && line.length < 100) {
      currentDay = days.find((day) => day.dayOfWeek === heading.dayOfWeek) ?? null;
      if (!currentDay) {
        currentDay = { dayOfWeek: heading.dayOfWeek, title: heading.title || `Entrenamiento ${days.length + 1}`, exercises: [] };
        days.push(currentDay);
      }
      continue;
    }
    const exercise = parseExerciseLine(line);
    if (!exercise) continue;
    if (!currentDay) {
      currentDay = { dayOfWeek: fallbackDay, title: `Entrenamiento ${days.length + 1}`, exercises: [] };
      days.push(currentDay);
      fallbackDay = fallbackDay === 6 ? 1 : fallbackDay + 1;
    }
    if (!currentDay.exercises.some((item) => normalize(item.name) === normalize(exercise.name))) currentDay.exercises.push(exercise);
  }

  const populatedDays = days.filter((day) => day.exercises.length > 0);
  if (!populatedDays.length) {
    throw new Error('No encontramos ejercicios reconocibles. Comprueba que el PDF contenga texto seleccionable y no sea solo una imagen escaneada.');
  }
  return { name: fallbackName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '), days: populatedDays };
}

export async function parseRoutinePdf(file: File): Promise<ParsedRoutine> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const document = await loadingTask.promise;
  const pages: PositionedText[][] = [];
  const fallbackLines: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PositionedText[] = [];

      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        items.push({
          text: item.str,
          x: item.transform[4],
          top: viewport.height - item.transform[5],
          width: item.width,
          height: Math.abs(item.height || item.transform[3] || 10),
        });
      }
      pages.push(items);
      fallbackLines.push(...groupVisualLines(items).map((line) => line.text));
    }

    return parseStructuredTables(pages, file.name) ?? parseLinearText(fallbackLines, file.name);
  } finally {
    await document.destroy();
  }
}
