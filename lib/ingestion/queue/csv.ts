/**
 * Lightweight RFC 4180-compliant CSV parser.
 *
 * Handles:
 *   - Quoted fields (including embedded commas, newlines, and escaped quotes "")
 *   - CR, LF, CRLF line endings
 *   - Empty fields
 *   - Optional header row → object output
 *   - Skipping blank lines and comment lines
 *
 * Does NOT handle:
 *   - Encodings other than UTF-8 (caller is responsible for decoding)
 *   - Multi-character delimiters
 */

export interface CsvParseOptions {
  delimiter?: string;    // default ","
  hasHeader?: boolean;   // default true — first row becomes field names
  comment?: string;      // lines starting with this prefix are skipped (e.g. "#")
  skipBlank?: boolean;   // default true — skip rows where every field is empty
  maxRows?: number;      // stop after this many data rows (not including header)
}

/** Parse CSV text into an array of string-keyed objects (when hasHeader=true). */
export function parseCsv(
  text: string,
  options: CsvParseOptions & { hasHeader: true }
): Array<Record<string, string>>;

/** Parse CSV text into an array of string arrays (when hasHeader=false). */
export function parseCsv(
  text: string,
  options: CsvParseOptions & { hasHeader: false }
): string[][];

/** Parse CSV text with default options (hasHeader=true). */
export function parseCsv(
  text: string,
  options?: CsvParseOptions
): Array<Record<string, string>>;

export function parseCsv(
  text: string,
  options: CsvParseOptions = {}
): Array<Record<string, string>> | string[][] {
  const {
    delimiter = ",",
    hasHeader = true,
    comment,
    skipBlank = true,
    maxRows,
  } = options;

  const rows = tokenize(text, delimiter, comment, skipBlank);

  if (rows.length === 0) {
    return hasHeader ? [] : [];
  }

  if (!hasHeader) {
    return maxRows != null ? rows.slice(0, maxRows) : rows;
  }

  const headers = rows[0];
  const dataRows = maxRows != null ? rows.slice(1, maxRows + 1) : rows.slice(1);

  return dataRows.map((row) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i].trim();
      obj[key] = row[i] ?? "";
    }
    return obj;
  });
}

function tokenize(
  text: string,
  delimiter: string,
  comment: string | undefined,
  skipBlank: boolean
): string[][] {
  const rows: string[][] = [];
  let pos = 0;
  const len = text.length;

  while (pos < len) {
    const row = parseRow(text, pos, delimiter);
    pos = row.nextPos;

    if (comment && row.fields[0]?.startsWith(comment)) continue;
    if (skipBlank && row.fields.every((f) => f === "")) continue;

    rows.push(row.fields);
  }

  return rows;
}

function parseRow(
  text: string,
  start: number,
  delimiter: string
): { fields: string[]; nextPos: number } {
  const fields: string[] = [];
  let pos = start;
  const len = text.length;

  while (pos <= len) {
    if (pos === len) {
      fields.push("");
      break;
    }

    if (text[pos] === '"') {
      // Quoted field
      pos++; // skip opening quote
      let value = "";
      while (pos < len) {
        if (text[pos] === '"') {
          if (pos + 1 < len && text[pos + 1] === '"') {
            // Escaped quote
            value += '"';
            pos += 2;
          } else {
            pos++; // skip closing quote
            break;
          }
        } else {
          value += text[pos];
          pos++;
        }
      }
      fields.push(value);
      // Skip delimiter or line ending
      if (pos < len && text[pos] === delimiter) {
        pos++;
        if (pos === len) fields.push(""); // trailing empty field
      } else if (pos < len) {
        pos = skipLineEnding(text, pos);
        break;
      } else {
        break;
      }
    } else {
      // Unquoted field — read until delimiter or line ending
      let value = "";
      while (pos < len && text[pos] !== delimiter) {
        if (text[pos] === "\r" || text[pos] === "\n") {
          break;
        }
        value += text[pos];
        pos++;
      }
      fields.push(value);
      if (pos < len && text[pos] === delimiter) {
        pos++;
        if (pos === len) fields.push(""); // trailing empty field
      } else if (pos < len) {
        pos = skipLineEnding(text, pos);
        break;
      } else {
        break;
      }
    }
  }

  return { fields, nextPos: pos };
}

function skipLineEnding(text: string, pos: number): number {
  if (text[pos] === "\r") {
    pos++;
    if (pos < text.length && text[pos] === "\n") pos++;
  } else if (text[pos] === "\n") {
    pos++;
  }
  return pos;
}
