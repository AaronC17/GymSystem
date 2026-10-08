// These are work limits for routine imports, not general-purpose PDF rendering.
export const PDF_LIMITS = {
  fileBytes: 15 * 1024 * 1024,
  pages: 50,
  textItemsPerPage: 10_000,
  textItemsTotal: 100_000,
  textCharactersPerPage: 200_000,
  textCharactersTotal: 1_000_000,
  visualLines: 2_000,
  visualLinesTotal: 10_000,
  dayHeadingsPerPage: 20,
  dayHeadingsTotal: 100,
  tableRows: 100,
  tableNameLines: 400,
  partitionWorkPerTable: 2_000_000,
  partitionWorkTotal: 4_000_000,
  exercisesPerDay: 100,
  exercisesTotal: 500,
  sets: 10,
} as const;

export type PdfTextBudget = { items: number; characters: number };
export type PdfPartitionBudget = { work: number };

export function createPdfTextBudget(): PdfTextBudget {
  return { items: 0, characters: 0 };
}

export function createPdfPartitionBudget(): PdfPartitionBudget {
  return { work: 0 };
}

export function assertPdfFileSize(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error('El PDF está vacío o su tamaño no es válido. Selecciona otro archivo.');
  }
  if (bytes > PDF_LIMITS.fileBytes) {
    throw new Error('El PDF supera el límite de 15 MB. Divide el documento o selecciona un archivo más pequeño.');
  }
}

export function assertPdfPageCount(pages: number) {
  if (!Number.isSafeInteger(pages) || pages < 1) {
    throw new Error('El PDF no contiene un número válido de páginas. Selecciona otro archivo.');
  }
  if (pages > PDF_LIMITS.pages) {
    throw new Error(`El PDF supera el límite de ${PDF_LIMITS.pages} páginas. Divide la rutina en documentos más cortos.`);
  }
}

export function assertPdfTextItemCount(items: number) {
  if (items > PDF_LIMITS.textItemsPerPage) {
    throw new Error(`Una página del PDF contiene demasiado texto (máximo ${PDF_LIMITS.textItemsPerPage} fragmentos). Divide el documento o simplifica la tabla.`);
  }
}

export function consumePdfTextBudget(items: number, characters: number, budget: PdfTextBudget) {
  assertPdfTextItemCount(items);
  if (characters > PDF_LIMITS.textCharactersPerPage) {
    throw new Error(`Una página del PDF contiene demasiado texto (máximo ${PDF_LIMITS.textCharactersPerPage} caracteres). Divide el documento.`);
  }
  const nextItems = budget.items + items;
  const nextCharacters = budget.characters + characters;
  if (nextItems > PDF_LIMITS.textItemsTotal || nextCharacters > PDF_LIMITS.textCharactersTotal) {
    throw new Error(`El PDF contiene demasiado texto para procesarlo de forma segura (máximo ${PDF_LIMITS.textItemsTotal} fragmentos y ${PDF_LIMITS.textCharactersTotal} caracteres). Divide la rutina.`);
  }
  budget.items = nextItems;
  budget.characters = nextCharacters;
}

export function assertPdfVisualLineCount(lines: number) {
  if (lines > PDF_LIMITS.visualLines) {
    throw new Error(`Una página del PDF tiene demasiadas líneas (máximo ${PDF_LIMITS.visualLines}). Divide el documento o simplifica su diseño.`);
  }
}

export function assertPdfTotalVisualLineCount(lines: number) {
  if (lines > PDF_LIMITS.visualLinesTotal) {
    throw new Error(`El PDF supera el límite de ${PDF_LIMITS.visualLinesTotal} líneas de texto. Divide la rutina en documentos más cortos.`);
  }
}

export function assertPdfExerciseCount(dayExercises: number, totalExercises: number) {
  if (dayExercises > PDF_LIMITS.exercisesPerDay || totalExercises > PDF_LIMITS.exercisesTotal) {
    throw new Error(`La rutina supera el límite de ${PDF_LIMITS.exercisesPerDay} ejercicios por día o ${PDF_LIMITS.exercisesTotal} ejercicios en total. Divide la rutina en planes más cortos.`);
  }
}

export function assertPdfDayHeadingCount(pageHeadings: number, totalHeadings: number) {
  if (pageHeadings > PDF_LIMITS.dayHeadingsPerPage || totalHeadings > PDF_LIMITS.dayHeadingsTotal) {
    throw new Error(`El PDF contiene demasiados encabezados de entrenamiento (máximo ${PDF_LIMITS.dayHeadingsPerPage} por página y ${PDF_LIMITS.dayHeadingsTotal} en total). Divide el documento o simplifica sus tablas.`);
  }
}

export function consumePdfPartitionBudget(lines: number, rows: number, budget: PdfPartitionBudget) {
  if (rows > PDF_LIMITS.tableRows || lines > PDF_LIMITS.tableNameLines) {
    throw new Error(`La tabla supera el límite de ${PDF_LIMITS.tableRows} ejercicios o ${PDF_LIMITS.tableNameLines} líneas de nombres. Divide la rutina en tablas más cortas.`);
  }
  // Upper bound on candidate partitions; checked before allocating the DP grids.
  const work = rows * lines * (lines + 1) / 2;
  if (work > PDF_LIMITS.partitionWorkPerTable || budget.work + work > PDF_LIMITS.partitionWorkTotal) {
    throw new Error('La distribución de las tablas es demasiado compleja para leerla de forma segura. Usa tablas más cortas, con menos líneas por ejercicio, o divide el PDF.');
  }
  budget.work += work;
}

export function assertPdfSetCount(sets: number) {
  if (!Number.isInteger(sets) || sets < 1 || sets > PDF_LIMITS.sets) {
    throw new Error(`La rutina contiene una cantidad de series no válida. Usa números enteros de 1 a ${PDF_LIMITS.sets} series por ejercicio.`);
  }
}
