/* FarmCalc · Tải bảng giá ra file Excel (.xlsx).
 * Tự tạo file ngay trong trình duyệt, không cần thư viện ngoài, không gửi dữ liệu đi đâu.
 * window.FarmExcel.download(opts, button, status) — opts giống FarmPdf:
 *   { products, priceNote, brand, search, data, money, decimal }
 */
(function (root) {
  'use strict';

  /* ---------- Nén ZIP (kiểu "store", không nén) ---------- */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(f => {
      const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------- Nội dung bảng tính ---------- */
  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  // Kiểu ô: 1 tiêu đề, 2 ghi chú, 3 đầu cột, 4 chữ, 5 số nguyên có dấu phẩy, 6 số thập phân, 7 dòng nhóm
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts>' +
    '<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="15"/><color rgb="FFC72234"/><name val="Calibri"/></font>' +
    '<font><i/><sz val="10"/><color rgb="FF606060"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFC72234"/><name val="Calibri"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFC72234"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF6D4D8"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FFD0D0D0"/></left><right style="thin"><color rgb="FFD0D0D0"/></right><top style="thin"><color rgb="FFD0D0D0"/></top><bottom style="thin"><color rgb="FFD0D0D0"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  const isNum = v => typeof v === 'number' && isFinite(v);

  function build(opts) {
    const products = opts.products || [], data = opts.data || {};
    const money = opts.money || (n => String(Math.round(n)));
    const brandLabel = opts.brand && !/^Tất cả/i.test(opts.brand) ? opts.brand : 'Tất cả thương hiệu';
    const priceNote = opts.priceNote || ('Giá gốc ' + (data.effectiveDate || '') + (data.priceAdjustmentKg ? ' · Đã tăng ' + money(data.priceAdjustmentKg) + ' đ/kg' : ''));
    const invTitle = opts.priceNote ? 'Giá net (đ/bao)' : 'Giá hóa đơn (đ/bao)';
    const head = ['Thương hiệu', 'Nhóm', 'Mã', 'Mô tả sản phẩm', 'Đạm thô (%)', 'Quy cách (kg/bao)', 'Giá (đ/kg)', invTitle];
    const widths = [16, 18, 12, 46, 11, 12, 13, 17];
    const N = head.length, last = colName(N - 1);

    const rows = []; let r = 0, converted = false;
    const cell = (c, v, s) => {
      const ref = colName(c) + r;
      if (isNum(v)) return '<c r="' + ref + '" s="' + s + '"><v>' + v + '</v></c>';
      if (v === '' || v === null || v === undefined) return '<c r="' + ref + '" s="' + s + '"/>';
      return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
    };
    const row = (cells, ht) => { r++; rows.push('<row r="' + r + '"' + (ht ? ' ht="' + ht + '" customHeight="1"' : '') + '>' + cells.map((c, i) => cell(i, c[0], c[1])).join('') + '</row>'); };

    row([['BẢNG GIÁ THỨC ĂN CHĂN NUÔI', 1]], 24);
    const info = ['Thương hiệu: ' + brandLabel, products.length + ' sản phẩm'];
    if (opts.search && String(opts.search).trim()) info.push('Từ khóa: "' + String(opts.search).trim() + '"');
    row([[info.join(' · '), 2]]);
    row([[priceNote, 2]]);
    r++; // dòng trống
    row(head.map(h => [h, 3]), 32);
    const headRow = r;
    products.forEach(p => {
      const noInv = p.invoiceBag === null || p.invoiceBag === undefined;
      if (noInv) converted = true;
      const inv = noInv ? (isNum(p.priceKg) && isNum(p.bag) ? Math.round(p.priceKg * p.bag) : '') : p.invoiceBag;
      row([[p.brand || '', 4], [p.category || '', 4], [p.code === undefined ? '' : String(p.code), 4], [p.description || '', 4],
        [isNum(p.protein) ? p.protein : '', 6], [isNum(p.bag) ? p.bag : (p.bag || ''), 5],
        [isNum(p.priceKg) ? Math.round(p.priceKg) : '', 5], [inv, 5]]);
    });
    const lastData = r;
    r++;
    if (converted) row([['Giá/bao của sản phẩm không có giá hóa đơn = giá/kg × quy cách bao.', 2]]);
    row([['Tạo bằng Jfeed FarmCalc ngày ' + new Date().toLocaleDateString('vi-VN') + '. Giá có thể thay đổi, vui lòng xác nhận trước khi đặt hàng.', 2]]);

    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"><pane ySplit="' + headRow + '" topLeftCell="A' + (headRow + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      '<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' +
      '<sheetData>' + rows.join('') + '</sheetData>' +
      (lastData > headRow ? '<autoFilter ref="A' + headRow + ':' + last + lastData + '"/>' : '') +
      '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
      '</worksheet>';
    const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Bảng giá" sheetId="1" r:id="rId1"/></sheets>' +
      (lastData > headRow ? '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'Bảng giá\'!$A$' + headRow + ':$' + last + '$' + lastData + '</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">\'Bảng giá\'!$' + headRow + ':$' + headRow + '</definedName></definedNames>' : '') +
      '</workbook>';
    return zip([
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: wb },
      { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', text: STYLES },
      { name: 'xl/worksheets/sheet1.xml', text: sheet }
    ]);
  }

  /* ---------- Tải về máy ---------- */
  function fileName(opts) {
    const n = root.FarmPdf && root.FarmPdf.fileName ? root.FarmPdf.fileName(opts) : 'bang-gia-thuc-an.pdf';
    return n.replace(/\.pdf$/, '') + '.xlsx';
  }

  async function save(blob, name) {
    if (root.navigator && root.navigator.standalone === true && typeof File === 'function') {
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function download(opts, button, status) {
    const say = t => { if (status) status.textContent = t; };
    const label = button ? button.textContent : '';
    try {
      if (!opts || !opts.products || !opts.products.length) { say('Không có sản phẩm nào để tải. Hãy xóa ô tìm kiếm hoặc chọn lại thương hiệu.'); return; }
      if (button) { button.disabled = true; button.textContent = 'Đang tạo Excel…'; }
      say('');
      const name = fileName(opts);
      await save(build(opts), name);
      say('Đã tạo ' + name + '. Nếu chưa thấy file, hãy mở mục Tải xuống của máy.');
    } catch (e) {
      console.error(e);
      say('Không tạo được file Excel: ' + ((e && e.message) || e));
    } finally {
      if (button) { button.disabled = false; button.textContent = label; }
    }
  }

  root.FarmExcel = { build, download, fileName };
})(window);
