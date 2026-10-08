import {
  assertPdfTextItemCount,
  assertPdfVisualLineCount,
  consumePdfPartitionBudget,
  createPdfPartitionBudget,
  type PdfPartitionBudget,
} from './pdf-limits';

export type PositionedText = {
  text: string;
  x: number;
  top: number;
  width: number;
  height: number;
};

export type VisualLine = {
  top: number;
  items: PositionedText[];
  text: string;
};

export type RowAnchor = {
  top: number;
  sets: number;
  accordingToVideo: boolean;
};

export function joinPositionedItems(items: PositionedText[]) {
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

export function groupVisualLines(items: PositionedText[], tolerance = 2.5): VisualLine[] {
  assertPdfTextItemCount(items.length);
  const sorted = items.slice().sort((a, b) => a.top - b.top || a.x - b.x);
  const lines: Array<{ top: number; topSum: number; items: PositionedText[] }> = [];

  for (const item of sorted) {
    const latestLine = lines.at(-1);
    const line = latestLine && Math.abs(latestLine.top - item.top) <= tolerance ? latestLine : undefined;
    if (line) {
      line.items.push(item);
      // The same average as before, without re-summing the entire line per item.
      line.topSum += item.top;
      line.top = line.topSum / line.items.length;
    } else {
      assertPdfVisualLineCount(lines.length + 1);
      lines.push({ top: item.top, topSum: item.top, items: [item] });
    }
  }

  return lines.map(({ top, items: lineItems }) => ({ top, items: lineItems, text: joinPositionedItems(lineItems) }));
}

function groupCost(lines: VisualLine[], start: number, end: number, anchor: RowAnchor) {
  const center = (lines[start].top + lines[end - 1].top) / 2;
  const distance = center - anchor.top;
  const startsAsContinuation = /^[a-záéíóúüñ(]/.test(lines[start].text.trim()) ? 900 : 0;
  const excessiveLength = Math.max(0, end - start - 7) * 700;
  return distance * distance + startsAsContinuation + excessiveLength;
}

export function partitionExerciseNames(
  lines: VisualLine[],
  anchors: RowAnchor[],
  budget: PdfPartitionBudget = createPdfPartitionBudget(),
) {
  if (!anchors.length || lines.length < anchors.length) return [];
  const rowCount = anchors.length;
  const lineCount = lines.length;
  consumePdfPartitionBudget(lineCount, rowCount, budget);
  const costs = Array.from({ length: rowCount + 1 }, () => Array<number>(lineCount + 1).fill(Number.POSITIVE_INFINITY));
  const previous = Array.from({ length: rowCount + 1 }, () => Array<number>(lineCount + 1).fill(-1));
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
        // No slice in this hot loop: candidate scoring is O(1).
        const candidate = costs[row - 1][start] + groupCost(lines, start, end, anchors[row - 1]);
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
