/*
 * Tạo và tải file PDF "Bảng giá thức ăn" ngay trên trình duyệt (điện thoại hoặc máy tính).
 * Không dùng thư viện ngoài. Font tiếng Việt nằm trong pdf-fonts.js và chỉ được tải khi bấm nút lần đầu.
 * Giá và danh sách sản phẩm lấy đúng từ danh sách đang hiển thị trong tab "Bảng giá cám".
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;

  const PAGE_W = 595.28, PAGE_H = 841.89;   // khổ A4 dọc, đơn vị point
  const MX = 34, MT = 42, MB = 46;          // lề trái/phải, lề trên, lề dưới
  const FS = 8.5, LH = 11, PAD = 3.5;       // cỡ chữ bảng, cao mỗi dòng, đệm trên/dưới ô
  const RED = [0.78, 0.13, 0.20], DARK = [0.13, 0.13, 0.13], GRAY = [0.38, 0.38, 0.38];
  const COLS = [
    { key: 'code',    title: 'Mã',                  w: 64,  align: 'l' },
    { key: 'desc',    title: 'Mô tả sản phẩm',      w: 203, align: 'l' },
    { key: 'protein', title: 'Đạm thô (%)',         w: 46,  align: 'r' },
    { key: 'bag',     title: 'Quy cách (kg/bao)',   w: 50,  align: 'r' },
    { key: 'priceKg', title: 'Giá (đ/kg)',          w: 68,  align: 'r' },
    { key: 'invoice', title: 'Giá hóa đơn (đ/bao)', w: 92,  align: 'r' }
  ];
  const TABLE_W = COLS.reduce((s, c) => s + c.w, 0);

  /* ---------- Nạp font ---------- */
  function loadFonts() {
    if (root.FARM_PDF_FONTS) return Promise.resolve(root.FARM_PDF_FONTS);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'pdf-fonts.js?v=1';
      s.onload = () => root.FARM_PDF_FONTS ? resolve(root.FARM_PDF_FONTS) : reject(new Error('Không đọc được font PDF'));
      s.onerror = () => reject(new Error('Không tải được font PDF. Hãy kiểm tra mạng rồi thử lại.'));
      document.head.appendChild(s);
    });
  }

  function makeFont(d) {
    const bytes = new Uint8Array(Array.from(atob(d.ttf), c => c.charCodeAt(0)));
    const cmap = d.cmap, widths = d.widths, used = new Set();
    const fallback = cmap[63] !== undefined ? cmap[63] : 0; // dấu ? cho ký tự lạ
    const glyph = cp => cmap[cp] !== undefined ? cmap[cp] : (cp === 0xA0 ? cmap[32] : fallback);
    return {
      d, bytes, used,
      hex(str) {
        let out = '';
        for (const ch of String(str).normalize('NFC')) {
          const g = glyph(ch.codePointAt(0));
          used.add(g);
          out += g.toString(16).padStart(4, '0');
        }
        return '<' + out + '>';
      },
      width(str, size) {
        let w = 0;
        for (const ch of String(str).normalize('NFC')) w += widths[glyph(ch.codePointAt(0))] || 0;
        return w * size / 1000;
      }
    };
  }

  /* ---------- Bố cục ---------- */
  function wrap(font, text, maxW, size) {
    const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (!cur || font.width(t, size) <= maxW) cur = t;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  const num = n => (Math.round(n * 100) / 100).toString();
  const rg = c => c.map(num).join(' ');

  function buildPages(opts, F) {
    const { data, products } = opts;
    const money = opts.money || (n => String(Math.round(n)));
    const decimal = opts.decimal || (n => String(n));
    const brandLabel = opts.brand && !/^Tất cả/i.test(opts.brand) ? opts.brand : 'Tất cả thương hiệu';
    const title = 'Bảng giá thức ăn chăn nuôi';
    const priceNote = 'Giá gốc ' + data.effectiveDate + (data.priceAdjustmentKg ? ' · Đã tăng ' + money(data.priceAdjustmentKg) + ' đ/kg' : '');
    const pages = [];
    let page = null, y = 0, converted = false;
    const ctx = { brand: null, cat: null };

    const newPage = () => { page = { ops: [] }; pages.push(page); y = MT; };
    const text = (str, x, base, size, fk, color) => {
      if (str === '') return;
      page.ops.push('BT ' + rg(color || DARK) + ' rg /' + (fk === 'R' ? 'F1' : 'F2') + ' ' + num(size) + ' Tf ' + num(x) + ' ' + num(PAGE_H - base) + ' Td ' + F[fk].hex(str) + ' Tj ET');
    };
    const rect = (x, top, w, h, color) => page.ops.push(rg(color) + ' rg ' + num(x) + ' ' + num(PAGE_H - top - h) + ' ' + num(w) + ' ' + num(h) + ' re f');
    const hline = (x1, x2, top, color, w) => page.ops.push(num(w || 0.5) + ' w ' + rg(color) + ' RG ' + num(x1) + ' ' + num(PAGE_H - top) + ' m ' + num(x2) + ' ' + num(PAGE_H - top) + ' l S');
    const place = (str, col, x0, base, size, fk, color) => {
      const x = col.align === 'r' ? x0 + col.w - 4 - F[fk].width(str, size) : x0 + 4;
      text(str, x, base, size, fk, color);
    };

    function pageHeader(first) {
      if (first) {
        text(title.toUpperCase(), MX, y + 14, 16, 'B', RED); y += 22;
        const parts = ['Thương hiệu: ' + brandLabel, products.length + ' sản phẩm'];
        if (opts.search && String(opts.search).trim()) parts.push('Từ khóa: "' + String(opts.search).trim() + '"');
        text(parts.join(' · '), MX, y + 9, 9.5, 'R', GRAY); y += 14;
        text(priceNote, MX, y + 9, 9.5, 'R', GRAY); y += 20;
      } else {
        text(title + ' · ' + priceNote, MX, y + 8, 8, 'R', GRAY); y += 16;
      }
      tableHeader();
    }

    function tableHeader() {
      const size = 8, lines = COLS.map(c => wrap(F.B, c.title, c.w - 8, size));
      const h = Math.max.apply(null, lines.map(l => l.length)) * 10 + 8;
      rect(MX, y, TABLE_W, h, RED);
      let x = MX;
      COLS.forEach((c, i) => {
        lines[i].forEach((ln, k) => place(ln, c, x, y + 4 + 8 + k * 10, size, 'B', [1, 1, 1]));
        x += c.w;
      });
      y += h;
    }

    function band(label, kind, cont) {
      const h = kind === 'brand' ? 17 : 14;
      rect(MX, y, TABLE_W, h, kind === 'brand' ? [0.96, 0.83, 0.85] : [0.94, 0.94, 0.94]);
      text(label + (cont ? ' (tiếp)' : ''), MX + 4, y + (kind === 'brand' ? 12 : 10), kind === 'brand' ? 10 : 8.5, 'B', kind === 'brand' ? RED : DARK);
      y += h;
    }

    function rowCells(p) {
      const inv = p.invoiceBag === null || p.invoiceBag === undefined;
      if (inv) converted = true;
      return {
        code: String(p.code),
        desc: String(p.description),
        protein: p.protein === null || p.protein === undefined ? '—' : decimal(p.protein),
        bag: String(p.bag),
        priceKg: money(p.priceKg),
        invoice: (inv ? '* ' : '') + money(inv ? p.priceKg * p.bag : p.invoiceBag)
      };
    }

    function rowHeight(cells) {
      const n = Math.max(wrap(F.R, cells.desc, COLS[1].w - 8, FS).length, wrap(F.B, cells.code, COLS[0].w - 8, FS).length);
      return n * LH + PAD * 2;
    }

    function breakIfNeeded(h) {
      if (y + h <= PAGE_H - MB) return false;
      newPage(); pageHeader(false);
      if (ctx.brand) band(ctx.brand, 'brand', true);
      if (ctx.cat) band(ctx.cat, 'cat', true);
      return true;
    }

    newPage(); pageHeader(true);

    // Gom theo thương hiệu rồi theo nhóm, giữ nguyên thứ tự trong danh sách
    const brands = new Map();
    for (const p of products) {
      if (!brands.has(p.brand)) brands.set(p.brand, new Map());
      const cats = brands.get(p.brand);
      if (!cats.has(p.category)) cats.set(p.category, []);
      cats.get(p.category).push(p);
    }

    for (const [brand, cats] of brands) {
      ctx.brand = null; ctx.cat = null;
      const firstCat = cats.values().next().value;
      if (y + 17 + 14 + rowHeight(rowCells(firstCat[0])) > PAGE_H - MB) { newPage(); pageHeader(false); }
      band(brand, 'brand'); ctx.brand = brand;
      for (const [cat, list] of cats) {
        ctx.cat = null;
        if (y + 14 + rowHeight(rowCells(list[0])) > PAGE_H - MB) { breakIfNeeded(PAGE_H); }
        band(cat, 'cat'); ctx.cat = cat;
        for (const p of list) {
          const cells = rowCells(p);
          const h = rowHeight(cells);
          breakIfNeeded(h);
          let x = MX;
          COLS.forEach(c => {
            if (c.key === 'desc') {
              wrap(F.R, cells.desc, c.w - 8, FS).forEach((ln, k) => text(ln, x + 4, y + PAD + 8 + k * LH, FS, 'R'));
            } else if (c.key === 'code') {
              wrap(F.B, cells.code, c.w - 8, FS).forEach((ln, k) => place(ln, c, x, y + PAD + 8 + k * LH, FS, 'B'));
            } else {
              place(cells[c.key], c, x, y + PAD + 8, FS, c.key === 'invoice' ? 'B' : 'R');
            }
            x += c.w;
          });
          y += h;
          hline(MX, MX + TABLE_W, y, [0.85, 0.85, 0.85]);
        }
      }
    }

    if (converted) {
      if (y + 20 > PAGE_H - MB) { newPage(); pageHeader(false); }
      text('* Giá/bao quy đổi từ giá/kg nhân với quy cách (không có giá hóa đơn gốc).', MX, y + 16, 8, 'R', GRAY);
    }

    // Chân trang
    const d = new Date();
    const stamp = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
    pages.forEach((pg, i) => {
      page = pg;
      text('Japfa FarmCalc · tạo ngày ' + stamp, MX, PAGE_H - 26, 8, 'R', GRAY);
      const t = 'Trang ' + (i + 1) + '/' + pages.length;
      text(t, PAGE_W - MX - F.R.width(t, 8), PAGE_H - 26, 8, 'R', GRAY);
    });
    return { pages, title };
  }

  /* ---------- Ghi file PDF ---------- */
  function utf16hex(s) {
    let h = 'FEFF';
    for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0');
    return '<' + h + '>';
  }

  function toUnicodeCMap(font) {
    const inv = new Map();
    for (const cp of Object.keys(font.d.cmap).map(Number).sort((a, b) => a - b)) {
      const g = font.d.cmap[cp];
      if (!inv.has(g)) inv.set(g, cp);
    }
    const entries = [...font.used].filter(g => g > 0 && inv.has(g)).sort((a, b) => a - b)
      .map(g => '<' + g.toString(16).padStart(4, '0') + '> <' + inv.get(g).toString(16).padStart(4, '0') + '>');
    let s = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for (let i = 0; i < entries.length; i += 100) {
      const chunk = entries.slice(i, i + 100);
      s += chunk.length + ' beginbfchar\n' + chunk.join('\n') + '\nendbfchar\n';
    }
    return s + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  }

  function assemble(pages, title, F) {
    const enc = new TextEncoder();
    const objs = []; // objs[id] = mảng các đoạn (chuỗi hoặc Uint8Array)
    const set = (id, ...parts) => { objs[id] = parts; };
    const stream = (dict, data) => {
      const bin = typeof data === 'string' ? enc.encode(data) : data;
      return ['<< ' + dict + ' /Length ' + bin.length + ' >>\nstream\n', bin, '\nendstream'];
    };
    const kids = [];
    const FIRST_PAGE_ID = 14;
    const fontIds = { R: 4, B: 9 };
    const names = { R: 'AAAAAA+LiberationSans', B: 'AAAAAB+LiberationSans-Bold' };

    for (const fk of ['R', 'B']) {
      const f = F[fk], base = fontIds[fk], name = names[fk];
      set(base, '<< /Type /Font /Subtype /Type0 /BaseFont /' + name + ' /Encoding /Identity-H /DescendantFonts [' + (base + 1) + ' 0 R] /ToUnicode ' + (base + 4) + ' 0 R >>');
      set(base + 1, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + name + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' + (base + 2) + ' 0 R /CIDToGIDMap /Identity /DW 1000 /W [0 [' + f.d.widths.join(' ') + ']] >>');
      set(base + 2, '<< /Type /FontDescriptor /FontName /' + name + ' /Flags 32 /FontBBox [' + f.d.bbox.join(' ') + '] /ItalicAngle 0 /Ascent ' + f.d.ascent + ' /Descent ' + f.d.descent + ' /CapHeight ' + f.d.capHeight + ' /StemV 80 /FontFile2 ' + (base + 3) + ' 0 R >>');
      set(base + 3, ...stream('/Length1 ' + f.bytes.length, f.bytes));
      set(base + 4, ...stream('', toUnicodeCMap(f)));
    }
    pages.forEach((pg, i) => {
      const pid = FIRST_PAGE_ID + i * 2, cid = pid + 1;
      kids.push(pid + ' 0 R');
      set(pid, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] /Resources << /Font << /F1 4 0 R /F2 9 0 R >> >> /Contents ' + cid + ' 0 R >>');
      const content = pg.ops.join('\n');
      set(cid, ...stream('', content));
    });
    set(1, '<< /Type /Catalog /Pages 2 0 R >>');
    set(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>');
    set(3, '<< /Title ' + utf16hex(title) + ' /Creator ' + utf16hex('Japfa FarmCalc') + ' /Producer ' + utf16hex('Japfa FarmCalc') + ' >>');

    const out = [];
    let pos = 0;
    const push = p => { const b = typeof p === 'string' ? enc.encode(p) : p; out.push(b); pos += b.length; };
    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])); // %PDF-1.4 + dòng nhị phân
    const offsets = [];
    for (let id = 1; id < objs.length; id++) {
      if (!objs[id]) { // id trống (không dùng) -> đối tượng rỗng để xref liền mạch
        offsets[id] = pos; push(id + ' 0 obj\nnull\nendobj\n'); continue;
      }
      offsets[id] = pos;
      push(id + ' 0 obj\n');
      objs[id].forEach(push);
      push('\nendobj\n');
    }
    const xrefPos = pos, size = objs.length;
    let x = 'xref\n0 ' + size + '\n0000000000 65535 f \n';
    for (let id = 1; id < size; id++) x += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
    push(x + 'trailer\n<< /Size ' + size + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

    const all = new Uint8Array(pos);
    let o = 0;
    out.forEach(b => { all.set(b, o); o += b.length; });
    return all;
  }

  function build(opts) {
    const fonts = root.FARM_PDF_FONTS;
    if (!fonts) throw new Error('Chưa nạp font PDF');
    const F = { R: makeFont(fonts.regular), B: makeFont(fonts.bold) };
    const { pages, title } = buildPages(opts, F);
    return assemble(pages, title, F);
  }

  /* ---------- Tải về máy ---------- */
  function slug(s) {
    return String(s).replace(/\$/g, 's').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function fileName(opts) {
    const parts = ['bang-gia-thuc-an'];
    if (opts.brand && !/^Tất cả/i.test(opts.brand)) parts.push(slug(opts.brand));
    if (opts.data && opts.data.effectiveDate) parts.push(slug(opts.data.effectiveDate));
    return parts.filter(Boolean).join('-') + '.pdf';
  }

  async function save(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    // Ứng dụng cài trên iPhone (chế độ độc lập) không tải thẳng được -> dùng bảng chia sẻ
    if (root.navigator && root.navigator.standalone === true && typeof File === 'function') {
      const file = new File([blob], name, { type: 'application/pdf' });
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
      if (!opts || !opts.products || !opts.products.length) {
        say('Không có sản phẩm nào để tải. Hãy xóa ô tìm kiếm hoặc chọn lại thương hiệu.');
        return;
      }
      if (button) { button.disabled = true; button.textContent = 'Đang tạo PDF…'; }
      say('');
      await loadFonts();
      const bytes = build(opts), name = fileName(opts);
      await save(bytes, name);
      say('Đã tạo ' + name + '. Nếu chưa thấy file, hãy mở mục Tải xuống của máy.');
    } catch (e) {
      console.error(e);
      say('Không tạo được PDF: ' + ((e && e.message) || e));
    } finally {
      if (button) { button.disabled = false; button.textContent = label; }
    }
  }

  root.FarmPdf = { build, download, fileName };
})();
