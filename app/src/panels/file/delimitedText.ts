/**
 * Parse delimiter-separated text the way a spreadsheet does.
 *
 * Written out rather than split on the delimiter because run artifacts really
 * do contain quoted fields with embedded commas and newlines (a preset path, a
 * kernel signature), and a naive split silently misaligns every later column.
 */

export interface DelimitedTable {
  header: readonly string[];
  rows: readonly (readonly string[])[];
  /** Total data rows in the file, before `maxRows` truncation. */
  totalRows: number;
}

export function delimiterFor(path: string): ',' | '\t' {
  return path.toLowerCase().endsWith('.tsv') ? '\t' : ',';
}

/** Split one document into records of fields, honouring RFC 4180 quoting. */
function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (character === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === delimiter) {
      fields.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (character === '\n' || character === '\r') {
      fields.push(field);
      records.push(fields);
      fields = [];
      field = '';
      index += text[index] === '\r' && text[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += character;
    index += 1;
  }
  if (field !== '' || fields.length > 0) {
    fields.push(field);
    records.push(fields);
  }
  return records;
}

export function parseDelimitedText(
  text: string,
  delimiter: string,
  maxRows: number,
): DelimitedTable | null {
  const records = parseRecords(text, delimiter).filter(
    (record) => record.length > 1 || record[0] !== '',
  );
  const [header, ...rows] = records;
  if (!header) return null;
  return { header, rows: rows.slice(0, maxRows), totalRows: rows.length };
}
