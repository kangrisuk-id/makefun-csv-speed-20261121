// A fast drop-in replacement for csv-reader 1.0.0 (make.fun's reference CSV
// reader). run(input) returns exactly csv-reader's answer {columns, rows,
// errors} for an input {text, header}, under csv-reader's broken-row policy:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled ("" inside it is one quote; each CRLF or lone CR inside it is
//     read as LF); what follows the closing quote, up to the next comma or
//     line break, is appended as it stands (quote_junk when the field ends);
//     a quote that never closes is a literal character and the text after it
//     is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows are
//     padded with "" (short_row) or cut (long_row) to the first record's
//     width;
//   - each error is {code, line, row}: line the 1-based line its record
//     starts on, row its record's index in rows (null for the header).
//
// Where the reference walks one character at a time and builds every field
// character by character, this reader scans with indexOf and slices whole
// runs of ordinary characters at once, so the common well-formed field costs
// a few native searches and one slice. The broken-row paths follow the
// reference step for step, so the answers are identical.

const COMMA = 0; // the field ended at a comma: the record goes on
const BREAK = 1; // the field ended at a line break: the record ends
const END = 2; // the field ended at the end of the text: the record ends

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null while it would be the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read.
  let fValue = '';
  let fEnded = END;
  let fAdded = 0; // characters kept by an unquoted read (for quote_junk)

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line
  // break; a CR not followed by LF is dropped (stray_cr). Sets fValue,
  // fEnded and fAdded.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      const iComma = text.indexOf(',', pos);
      const iLf = text.indexOf('\n', pos);
      const iCr = text.indexOf('\r', pos);
      let next = -1;
      let kind = -1; // 44 comma, 10 LF, 13 CR
      if (iComma !== -1) { next = iComma; kind = 44; }
      if (iLf !== -1 && (next === -1 || iLf < next)) { next = iLf; kind = 10; }
      if (iCr !== -1 && (next === -1 || iCr < next)) { next = iCr; kind = 13; }
      if (next === -1) {
        if (pos < n) { value += text.slice(pos); added += n - pos; pos = n; }
        fValue = value; fEnded = END; fAdded = added;
        return;
      }
      if (kind === 44) {
        if (next > pos) { value += text.slice(pos, next); added += next - pos; }
        pos = next + 1;
        fValue = value; fEnded = COMMA; fAdded = added;
        return;
      }
      if (kind === 10) {
        if (next > pos) { value += text.slice(pos, next); added += next - pos; }
        pos = next + 1;
        line += 1;
        fValue = value; fEnded = BREAK; fAdded = added;
        return;
      }
      // kind === 13: a CR.
      if (text.charCodeAt(next + 1) === 10) {
        if (next > pos) { value += text.slice(pos, next); added += next - pos; }
        pos = next + 2;
        line += 1;
        fValue = value; fEnded = BREAK; fAdded = added;
        return;
      }
      // A stray CR: keep what stands before it, drop it, read on.
      if (next > pos) { value += text.slice(pos, next); added += next - pos; }
      error('stray_cr');
      pos = next + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue/fEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    for (;;) {
      const iQuote = text.indexOf('"', pos);
      const iCr = text.indexOf('\r', pos);
      const iLf = text.indexOf('\n', pos);
      let next = -1;
      let kind = -1; // 34 quote, 13 CR, 10 LF
      if (iQuote !== -1) { next = iQuote; kind = 34; }
      if (iCr !== -1 && (next === -1 || iCr < next)) { next = iCr; kind = 13; }
      if (iLf !== -1 && (next === -1 || iLf < next)) { next = iLf; kind = 10; }
      if (next === -1) break; // the text ends inside the field: never closed
      if (kind === 10) {
        // An LF inside quotes stays an LF and still counts as a line.
        value += text.slice(pos, next + 1);
        line += 1;
        pos = next + 1;
        continue;
      }
      if (kind === 13) {
        // CRLF and a lone CR inside quotes are each read as one LF.
        value += text.slice(pos, next) + '\n';
        line += 1;
        pos = text.charCodeAt(next + 1) === 10 ? next + 2 : next + 1;
        continue;
      }
      // kind === 34: a quote.
      value += text.slice(pos, next);
      if (text.charCodeAt(next + 1) === 34) {
        value += '"';
        pos = next + 2;
        continue;
      }
      pos = next + 1;
      closed = true;
      break;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      readUnquoted('"');
      return;
    }
    if (pos >= n) { fValue = value; fEnded = END; return; }
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; fValue = value; fEnded = COMMA; return; }
    if (c === 10) { pos += 1; line += 1; fValue = value; fEnded = BREAK; return; }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2; line += 1; fValue = value; fEnded = BREAK; return;
    }
    // What follows the closing quote is appended as it stands.
    readUnquoted(value);
    if (fAdded > 0) error('quote_junk');
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record that lives on one line holding no quote and no
    // CR but a possible closing CRLF splits in one native call. Any quote
    // or stray CR sends the record to the general reader below.
    const iLf = text.indexOf('\n', pos);
    const lineEnd = iLf === -1 ? n : iLf;
    const iQuote = text.indexOf('"', pos);
    const iCr = text.indexOf('\r', pos);
    if ((iQuote === -1 || iQuote >= lineEnd) &&
        (iCr === -1 || iCr >= lineEnd || (iLf !== -1 && iCr === iLf - 1))) {
      const contentEnd = iLf !== -1 && iCr === iLf - 1 ? iLf - 1 : lineEnd;
      const fields = text.slice(pos, contentEnd).split(',');
      pos = iLf === -1 ? n : iLf + 1;
      line += 1;
      if (width < 0) width = fields.length;
      if (header && columns === null) {
        columns = fields;
        continue;
      }
      if (fields.length < width) {
        errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
        while (fields.length < width) fields.push('');
      } else if (fields.length > width) {
        errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
      }
      rows.push(fields);
      continue;
    }

    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted(); else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
