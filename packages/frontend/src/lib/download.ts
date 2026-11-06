/** Saves a Blob as a file through a temporary link (the import templates, the payroll csv). */
export function saveBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Saves a csv text (the import templates). */
export function saveCsv(fileName: string, text: string): void {
  saveBlob(fileName, new Blob([text], { type: 'text/csv;charset=utf-8' }));
}
