"""Read published GREENFEED northern market prices without guessing values."""
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

def norm(text):
    return re.sub(r'\s+', ' ', text).strip().upper()

def parse_date(text):
    m = DATE_RE.search(text)
    if not m:
        return None
    try:
        return datetime(int(m[3]), int(m[2]), int(m[1])).date().isoformat()
    except ValueError:
        return None

def parse_price(text):
    token = text.strip().replace(',', '').replace('.', '').replace(' ', '')
    if not re.fullmatch(r'\d{3,6}', token):
        return None
    return int(token)

def parse(html):
    soup = BeautifulSoup(html, 'html.parser')
    for table in soup.select('table'):
        rows = table.select('tr')
        if len(rows) < 4:
            continue
        heading = norm(rows[0].get_text(' ', strip=True))
        if not all(x in heading for x in ['HEO HƠI','VỊT SIÊU THỊT','GÀ MÀU','GÀ TRẮNG','TRỨNG GÀ','TRỨNG VỊT']):
            continue
        # GREENFEED table: row 1 has grouped product names; row 2 has
        # dates and previous-period change columns; region headings are
        # separate rows with colspan=13 and MUST NOT be treated as prices.
        date = parse_date(rows[1].get_text(' ', strip=True))
        if not date:
            raise ValueError('Bảng GREENFEED không có ngày công bố hợp lệ')
        for tr in rows[2:]:
            cells = tr.find_all(['td','th'], recursive=False)
            if len(cells) != 14 or norm(cells[0].get_text(' ',strip=True)) != 'MIỀN BẮC':
                continue
            if any(c.has_attr('colspan') for c in cells):
                continue
            nums = [parse_price(c.get_text(' ',strip=True)) for c in cells[1:]]
            if nums[0] is None or any(nums[i] is None for i in (1,3,5,7,9,11)):
                continue
            # After region: Greenfeed hog, market hog, delta, duck, delta,
            # colored chicken, delta, white chicken, delta, egg, delta, egg, delta.
            vals = [nums[i] for i in (1,3,5,7,9,11)]
            limits = [(20000,150000)]*4 + [(500,10000)]*2
            if not all(lo <= val <= hi for val,(lo,hi) in zip(vals,limits)):
                continue
            return date, [dict(date=date,product=product,region='Miền Bắc',price=price,source='GREENFEED') for product,price in zip(PRODUCTS,vals)]
    raise ValueError('Không tìm thấy dòng MIỀN BẮC gồm đủ sáu giá hợp lệ')

def main():
    old = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {'records': []}
    existing = {(r['date'],r['product']):r for r in old.get('records',[]) if r.get('region')=='Miền Bắc'}
    session = requests.Session()
    session.headers.update({'User-Agent':'Mozilla/5.0 (compatible; FarmCalcMarketTracker/1.2)'})
    response = session.get(URL,timeout=30)
    response.raise_for_status()
    date,records = parse(response.text)
    for r in records:
        existing[(r['date'],r['product'])] = r
    result = {'source':'GREENFEED','region':'Miền Bắc',
              'checked_at':datetime.now(VN).isoformat(timespec='minutes'),
              'last_source_date':max((r['date'] for r in existing.values()),default=None),
              'records':sorted(existing.values(),key=lambda r:(r['date'],r['product']))}
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Đã lưu dữ liệu nguồn ngày {date}: {len(records)} giá. Tổng: {len(result["records"])}')

if __name__=='__main__':
    try:
        main()
    except Exception as exc:
        print(f'GREENFEED extraction failed safely: {exc}',file=sys.stderr)
        sys.exit(1)
