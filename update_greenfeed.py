"""GREENFEED northern livestock price collector. No synthetic or guessed values."""
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

URL = 'https://www.greenfeed.com.vn/thuc-an-chan-nuoi-gia-suc-gia-cam/bang-gia-thi-truong/'
OUT = Path('data/greenfeed-north.json')
PRODUCTS = ['Heo hơi', 'Vịt thịt', 'Gà màu', 'Gà trắng', 'Trứng gà', 'Trứng vịt']
VN = timezone(timedelta(hours=7))
DATE_RE = re.compile(r'\b([0-3]?\d)[-/]([01]?\d)[-/](20\d{2})\b')
PRICE_RE = re.compile(r'(?<![\w])[-+]?\d{1,3}(?:[.,]\d{3})+|(?<![\w])[-+]?\d{4,6}(?!\d)')

def normalized(s):
    return re.sub(r'\s+', ' ', s).strip().upper()

def parse_date(s):
    m = DATE_RE.search(s)
    if not m:
        return None
    try:
        return datetime(int(m[3]), int(m[2]), int(m[1])).date().isoformat()
    except ValueError:
        return None

def price_values(s):
    return [int(m.group().replace(',', '').replace('.', '')) for m in PRICE_RE.finditer(s)]

def parse(html, expected=None):
    soup = BeautifulSoup(html, 'html.parser')
    # Only the livestock product table, never the separate breeding-stock table.
    for table in soup.select('table'):
        header = normalized(table.get_text(' ', strip=True))
        if not all(token in header for token in ('HEO HƠI', 'VỊT SIÊU THỊT', 'GÀ MÀU', 'GÀ TRẮNG', 'TRỨNG GÀ', 'TRỨNG VỊT')):
            continue
        # Date can be in the table heading or in a preceding section heading.
        date = parse_date(table.get_text(' ', strip=True))
        if not date:
            prev = table.find_previous(string=re.compile(r'Cập nhật ngày|Sản phẩm chăn nuôi', re.I))
            date = parse_date(str(prev)) if prev else None
        if not date:
            # The page contains two market tables; the heading is outside the table.
            headings = soup.get_text(' ', strip=True)
            match = re.search(r'Sản phẩm chăn nuôi\s*[-–]\s*Cập nhật ngày\s*([0-3]?\d[-/][01]?\d[-/]20\d{2})', headings, re.I)
            date = parse_date(match.group(1)) if match else None
        if not date or (expected and date != expected):
            continue
        for tr in table.select('tr'):
            cells = [c.get_text(' ', strip=True) for c in tr.select('td,th')]
            if not cells:
                continue
            # Some GREENFEED templates split the region and its prices across rows.
            row_text = ' '.join(cells)
            if 'MIỀN BẮC' not in normalized(row_text):
                continue
            pos = normalized(row_text).find('MIỀN BẮC')
            nums = []
            for cell in cells:
                if normalized(cell) == 'MIỀN BẮC':
                    continue
                for token in re.findall(r'(?<![\w])[-+]?\d[\d,.]*(?!\w)', cell):
                    nums.append(int(token.replace(',', '').replace('.', '')))
            # Layout: GREENFEED hog, market hog, delta, duck, delta, colored
            # chicken, delta, white chicken, delta, hen egg, delta, duck egg, delta.
            if len(nums) < 13:
                continue
            vals = [nums[i] for i in (1, 3, 5, 7, 9, 11)]
            limits = [(20000,150000),(10000,150000),(10000,150000),(10000,150000),(500,10000),(500,10000)]
            if not all(lo <= value <= hi for value,(lo,hi) in zip(vals,limits)):
                continue
            return date, [dict(date=date,product=p,region='Miền Bắc',price=v,source='GREENFEED') for p,v in zip(PRODUCTS,vals)]
    raise ValueError('Không tìm được bảng sản phẩm chăn nuôi MIỀN BẮC có ngày và đủ 6 giá hợp lệ')

def main():
    old = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {'records': []}
    existing = {(r['date'],r['product']):r for r in old.get('records',[]) if r.get('region') == 'Miền Bắc'}
    s = requests.Session()
    s.headers.update({'User-Agent':'Mozilla/5.0 (compatible; FarmCalcMarketTracker/1.1)'})
    response = s.get(URL, timeout=30)
    response.raise_for_status()
    try:
        date, records = parse(response.text)
    except ValueError as exc:
        # Fail visibly rather than writing inaccurate historical data.
        raise RuntimeError(f'{exc}. GREENFEED có thể đã đổi HTML hoặc bảng tải bằng JavaScript.') from exc
    for r in records:
        existing[(r['date'],r['product'])] = r
    result = {'source':'GREENFEED','region':'Miền Bắc',
              'checked_at':datetime.now(VN).isoformat(timespec='minutes'),
              'last_source_date':max((r['date'] for r in existing.values()),default=None),
              'records':sorted(existing.values(),key=lambda r:(r['date'],r['product']))}
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Đã lưu ngày {date}: {len(records)} giá. Tổng bản ghi: {len(result["records"])}')

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('GREENFEED extraction failed safely:',exc,file=sys.stderr)
        sys.exit(1)
