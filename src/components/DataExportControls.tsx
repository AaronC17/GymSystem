import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useRef } from 'react';
import { createCsvExport, createJsonExport, downloadExport } from '../export';
import type { AppState } from '../types';
import './DataExportControls.css';

export function DataExportControls({
  state,
  onError,
}: {
  state: AppState;
  onError: (message: string) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  function exportData(format: 'json' | 'csv') {
    try {
      downloadExport(format === 'json' ? createJsonExport(state) : createCsvExport(state));
      if (detailsRef.current) detailsRef.current.open = false;
      summaryRef.current?.focus();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'No fue posible descargar tus datos.');
    }
  }

  return (
    <details
      ref={detailsRef}
      className="data-export-controls"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (detailsRef.current) detailsRef.current.open = false;
        summaryRef.current?.focus();
      }}
    >
      <summary ref={summaryRef} className="button button-light" aria-label="Exportar mis datos de entrenamiento">
        <Download size={16} aria-hidden="true" /> Exportar <ChevronDown size={13} aria-hidden="true" />
      </summary>
      <div className="data-export-options">
        <strong>Descarga tus datos</strong>
        <p>Incluye el estado de este dispositivo, incluso cambios aún no sincronizados. No altera tu cuenta.</p>
        <button type="button" onClick={() => exportData('json')}><FileText size={17} aria-hidden="true" /><span><b>Respaldo JSON</b><small>Rutina e historial completos</small></span></button>
        <button type="button" onClick={() => exportData('csv')}><FileSpreadsheet size={17} aria-hidden="true" /><span><b>Historial CSV</b><small>Una fila por serie, con su unidad</small></span></button>
        <small>Los archivos contienen datos personales. Guárdalos en un lugar seguro.</small>
      </div>
    </details>
  );
}
