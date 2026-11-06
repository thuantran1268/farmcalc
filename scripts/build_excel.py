"""FarmCalc: tạo file Excel lưu trữ giá thị trường theo ngày từ data/market.json và data/greenfeed-north.json.

Chạy sau update_market.py. Cần: openpyxl. Kết quả: data/gia-thi-truong.xlsx
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

VN = timezone(timedelta(hours=7))
OUT = Path('data/gia-thi-truong.xlsx')
SRC = {'greenvet': 'Green Vet', 'congthuong': 'Công Thương', 'greenfeed': 'GREENFEED'}
HEAD_FILL = PatternFill('solid', fgColor='C72234')
HEAD_FONT = Font(bold=True, color='FFFFFF')
THIN = Alignment(wrap_text=True, vertical='center')


def load(path):
    p = Path(path)
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else {}


def norm_group(g):
    g = (g or '').strip()
    if g.lower().startswith('giá '):
        g = g[4:]
    return g[:1].upper() + g[1:]


def collect():
    rows = []
    for r in load('data/market.json').get('records', []):
        rows.append({'date': r['date'], 'source': SRC.get(r['source'], r['source']), 'group': norm_group(r.get('group')),
                     'item': r.get('item') or '', 'region': r.get('region') or '', 'min': r['min'], 'max': r['max'],
                     'unit': r['unit'], 'level': r.get('level', ''), 'url': r.get('url', '')})
    for r in load('data/greenfeed-north.json').get('records', []):
        try:
            price = float(r['price'])
        except (KeyError, TypeError, ValueError):
            continue
        lo = r.get('price_min') if r.get('price_min') is not None else price
        hi = r.get('price_max') if r.get('price_max') is not None else price
        rows.append({'date': r['date'], 'source': 'GREENFEED', 'group': 'GREENFEED (miền Bắc)', 'item': r['product'], 'region': 'Miền Bắc',
                     'min': lo, 'max': hi, 'unit': 'đ/quả' if str(r['product']).startswith('Trứng') else 'đ/kg', 'level': 'vung',
                     'url': r.get('source_url', '')})
    rows.sort(key=lambda x: (x['date'], x['source'], x['group'], x['item'], x['region']))
    return rows


def style_header(ws, row=1):
    for c in ws[row]:
        c.fill, c.font, c.alignment = HEAD_FILL, HEAD_FONT, Alignment(wrap_text=True, vertical='center', horizontal='center')


def build():
    rows = collect()
    wb = Workbook()

    # Sheet 1: theo ngày (giá giữa, chỉ mức vùng, không gồm từng tỉnh)
    ws = wb.active
    ws.title = 'Theo ngày'
    cols = {}
    for r in rows:
        if r['level'] == 'tinh':
            continue
        key = (r['source'], r['group'], r['item'], r['region'], r['unit'])
        cols.setdefault(key, None)
    keys = sorted(cols, key=lambda k: (k[1] != 'Heo hơi', k[1], k[2], k[3], k[0]))
    ws.append(['Ngày'] + [' · '.join(x for x in (k[1], k[2], k[3]) if x) + '\n' + k[0] + ' (' + k[4] + ')' for k in keys])
    style_header(ws)
    ws.row_dimensions[1].height = 62
    by_date = {}
    for r in rows:
        if r['level'] == 'tinh':
            continue
        key = (r['source'], r['group'], r['item'], r['region'], r['unit'])
        by_date.setdefault(r['date'], {})[key] = (r['min'] + r['max']) / 2
    for d in sorted(by_date, reverse=True):
        dt = datetime.strptime(d, '%Y-%m-%d')
        ws.append([dt] + [by_date[d].get(k) for k in keys])
        ws.cell(ws.max_row, 1).number_format = 'dd/mm/yyyy'
        for i in range(2, len(keys) + 2):
            ws.cell(ws.max_row, i).number_format = '#,##0'
    ws.freeze_panes = 'B2'
    ws.column_dimensions['A'].width = 12
    for i in range(2, len(keys) + 2):
        ws.column_dimensions[get_column_letter(i)].width = 17

    # Sheet 2: chi tiết đầy đủ (khoảng giá thấp - cao, từng tỉnh)
    wd = wb.create_sheet('Chi tiết')
    wd.append(['Ngày', 'Nguồn', 'Nhóm', 'Mặt hàng', 'Khu vực / tỉnh', 'Giá thấp', 'Giá cao', 'Giá giữa', 'Đơn vị', 'Đường dẫn nguồn'])
    style_header(wd)
    for r in reversed(rows):
        wd.append([datetime.strptime(r['date'], '%Y-%m-%d'), r['source'], r['group'], r['item'], r['region'], r['min'], r['max'], (r['min'] + r['max']) / 2, r['unit'], r['url']])
        n = wd.max_row
        wd.cell(n, 1).number_format = 'dd/mm/yyyy'
        for c in (6, 7, 8):
            wd.cell(n, c).number_format = '#,##0'
    wd.freeze_panes = 'A2'
    wd.auto_filter.ref = f'A1:J{max(wd.max_row, 2)}'
    for letter, w in zip('ABCDEFGHIJ', (12, 13, 26, 28, 18, 12, 12, 12, 9, 50)):
        wd.column_dimensions[letter].width = w

    # Sheet 3: ghi chú
    wi = wb.create_sheet('Ghi chú')
    market = load('data/market.json')
    dates = sorted({r['date'] for r in rows})
    for line in (
        ['FarmCalc - Lưu trữ giá thị trường chăn nuôi'],
        ['Cập nhật file lần cuối', datetime.now(VN).strftime('%d/%m/%Y %H:%M')],
        ['Dữ liệu từ ngày', datetime.strptime(dates[0], '%Y-%m-%d').strftime('%d/%m/%Y') if dates else ''],
        ['Đến ngày', datetime.strptime(dates[-1], '%Y-%m-%d').strftime('%d/%m/%Y') if dates else ''],
        ['Số dòng chi tiết', len(rows)],
        [],
        ['Nguồn', 'GREENFEED (miền Bắc), Green Vet, Công Thương (báo giá heo hơi theo vùng)'],
        ['Ghi chú', 'Sheet "Theo ngày": mỗi cột là một mặt hàng và khu vực, giá là TRUNG ĐIỂM của khoảng giá nguồn công bố; ngày không có số liệu để trống.'],
        ['', 'Sheet "Chi tiết": giá thấp, giá cao đúng như nguồn công bố, gồm cả giá từng tỉnh (Công Thương). Dùng bộ lọc ở hàng đầu để lọc theo ngày, nguồn, mặt hàng.'],
        ['', 'Giá một số nguồn là khoảng giá nên trung điểm không phải giá bình quân chính thức. Số liệu chỉ để tham khảo.'],
    ):
        wi.append(line)
    wi['A1'].font = Font(bold=True, size=14)
    wi.column_dimensions['A'].width = 24
    wi.column_dimensions['B'].width = 100
    for row in wi.iter_rows():
        for c in row:
            c.alignment = THIN
    OUT.parent.mkdir(exist_ok=True)
    wb.save(OUT)
    print(f'Đã ghi {OUT}: {len(rows)} dòng, {len(by_date)} ngày, {len(keys)} cột.')


if __name__ == '__main__':
    build()
