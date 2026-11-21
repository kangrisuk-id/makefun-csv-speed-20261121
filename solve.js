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
// Speed design: every search in this reader is bounded by the segment it
// scans. A record that lives on one line is sliced out whole and tested on
// the slice, so a quote-free file never triggers a scan past its own line;
// a field is read by finding its nearest comma or LF and then handling any
// CRs inside that one sliced segment. No search ever runs to the end of
// the text looking for a character the current field does not contain, so
// the whole read stays linear in the size of the input.

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

  // Appends seg (a slice of one field, holding no comma and no LF) onto
  // value, dropping stray CRs. A CR in the last place counts as stray too,
  // unless ended is BREAK and it is the CR of the closing CRLF. Returns
  // [value, added].
  function appendSegment(value, seg, ended) {
    let added = 0;
    let start = 0;
    let k = seg.indexOf('\r');
    if (k === -1) {
      if (seg.length > 0) { value += seg; added = seg.length; }
      return [value, added];
    }
    while (k !== -1) {
      if (k > start) { value += seg.slice(start, k); added += k - start; }
      if (k === seg.length - 1 && ended === BREAK) {
        start = k + 1; // the CR of the CRLF: part of the break, no error
        break;
      }
      error('stray_cr');
      start = k + 1;
      k = seg.indexOf('\r', start);
    }
    if (start < seg.length) {
      value += seg.slice(start);
      added += seg.length - start;
    }
    return [value, added];
  }

  // Reads one unquoted field onto value: the field runs to the nearest
  // comma or LF (or the end of the text). Sets fValue, fEnded and fAdded.
  function readUnquoted(value) {
    const iComma = text.indexOf(',', pos);
    const iLf = text.indexOf('\n', pos);
    let end;
    let ended;
    if (iComma === -1 && iLf === -1) { end = n; ended = END; }
    else if (iLf === -1 || (iComma !== -1 && iComma < iLf)) { end = iComma; ended = COMMA; }
    else { end = iLf; ended = BREAK; }
    let added = 0;
    if (end > pos) {
      const seg = text.slice(pos, end);
      [value, added] = appendSegment(value, seg, ended);
    }
    pos = end;
    if (ended === COMMA) {
      pos += 1;
    } else if (ended === BREAK) {
      pos += 1;
      line += 1;
    }
    fValue = value;
    fEnded = ended;
    fAdded = added;
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
      const iLf = text.indexOf('\n', pos);
      let stop;
      let isQuote;
      if (iQuote === -1 && iLf === -1) break; // the text ends: never closed
      if (iQuote === -1) { stop = iLf; isQuote = false; }
      else if (iLf === -1 || iQuote < iLf) { stop = iQuote; isQuote = true; }
      else { stop = iLf; isQuote = false; }
      // The stretch [pos, stop) holds no quote and no LF; any CR in it is
      // read as one LF (a CRLF whose LF sits at stop counts once).
      let skipLf = false;
      if (stop > pos) {
        const seg = text.slice(pos, stop);
        let start = 0;
        let k = seg.indexOf('\r');
        while (k !== -1) {
          if (k > start) value += seg.slice(start, k);
          value += '\n';
          line += 1;
          start = k + 1;
          if (k === seg.length - 1 && !isQuote) skipLf = true;
          k = seg.indexOf('\r', start);
        }
        if (start < seg.length) value += seg.slice(start);
      }
      pos = stop;
      if (isQuote) {
        if (text.charCodeAt(pos + 1) === 34) {
          value += '"';
          pos += 2;
          continue;
        }
        pos += 1;
        closed = true;
        break;
      }
      // stop is an LF inside the quotes: it stays an LF and counts a line,
      // unless the CR just read already accounted for it (a CRLF pair).
      if (!skipLf) {
        value += '\n';
        line += 1;
      }
      pos += 1;
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
    // CR but a possible closing CRLF splits in one native call. The line
    // is sliced first and the tests run on the slice, so the checks cost
    // the length of this line and never scan the rest of the text.
    const iLf = text.indexOf('\n', pos);
    const lineEnd = iLf === -1 ? n : iLf;
    let contentEnd = lineEnd;
    // Only an LF makes the CR before it a CRLF ending; a CR at the very
    // end of the text is a stray CR and sends the record to the general
    // reader below.
    if (iLf !== -1 && contentEnd > pos && text.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;
    const lineText = text.slice(pos, contentEnd);
    if (lineText.indexOf('"') === -1 && lineText.indexOf('\r') === -1) {
      const fields = lineText.split(',');
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
