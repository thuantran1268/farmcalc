"""Collect published northern market prices. Fail closed on ambiguous page structure."""
import json, re, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
import requests
from bs4 import BeautifulSoup

URL = 'https://www.greenfeed.com.vn/thuc-an-chan-nuoi-gia-suc-gia-cam/'
OUT = Path('data/greenfeed-north.json')
PRODUCTS = ['Heo hơi', 'Vịt thịt', 'Gà màu', 'Gà trắng', 'Trứng gà', 'Trứng vịt']

def num(s):
    s = re.sub(r'[^\d,.]', '', s.strip())
    if not s: return None
    return int(s.replace(',', '').replace('.', ''))

def parse(html):
    soup = BeautifulSoup(html, 'html.parser')
    for table in soup.select('table'):
        text = table.get_text(' ', strip=True)
        if 'MIỀN BẮC' not in text.upper() or 'HEO HƠI' not in text.upper() or 'TRỨNG VỊT' not in text.upper():
            continue
        date_match = re.search(r'\b(\d{2})[-/](\d{2})[-/](20\d{2})\b', text)
        if not date_match: continue
        dd, mm, yyyy = date_match.groups()
        try: day = datetime(int(yyyy), int(mm), int(dd)).date().isoformat()
        except ValueError: continue
        for tr in table.select('tr'):
            cells = [c.get_text(' ', strip=True) for c in tr.select('td,th')]
            if not cells or cells[0].strip().upper() != 'MIỀN BẮC': continue
            # Typical table: HEO GREENFEED, HEO HOI, then 5 product prices;
            # each price after heo hoi may be followed by change since prior period.
            numbers = [num(x) for x in cells[1:]]
            numbers = [x for x in numbers if x is not None]
            # 1 greenfeed hog, 1 market hog, 5 (price, delta) pairs
            if len(numbers) < 12: continue
            vals = [numbers[1], numbers[2], numbers[4], numbers[6], numbers[8], numbers[10]]
            if not (20000 <= vals[0] <= 150000 and 10000 <= vals[1] <= 150000 and 10000 <= vals[2] <= 150000 and 10000 <= vals[3] <= 150000 and 500 <= vals[4] <= 10000 and 500 <= vals[5] <= 10000):
                continue
            return day, [dict(date=day, product=name, region='Miền Bắc', price=price, source='GREENFEED') for name,price in zip(PRODUCTS, vals)]
    raise ValueError('Cannot reliably identify GREENFEED market table and MIỀN BẮC row')

def main():
    old = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {'records': []}
    existing = {(r['date'],r['product']):r for r in old.get('records',[]) if r.get('region')=='Miền Bắc'}
    session = requests.Session(); session.headers.update({'User-Agent':'Mozilla/5.0 (compatible; FarmCalcMarketTracker/1.0)'})
    # Fetch canonical latest page first. If layout changes, do not corrupt history.
    response = session.get(URL, timeout=25); response.raise_for_status()
    latest, rows = parse(response.text)
    for r in rows: existing[(r['date'],r['product'])] = r
    # Try dated historical pages. Only accept a response when its actual table date
    # matches the requested date. No guessed prices, no forward filling.
    today = datetime.now(timezone(timedelta(hours=7))).date()
    candidates = [today-timedelta(days=i) for i in range(0,14)]
    candidates += [today-timedelta(days=7*i) for i in range(2,54)]
    for day in dict.fromkeys(candidates):
        if all((day.isoformat(),p) in existing for p in PRODUCTS): continue
        try:
            resp = session.get(URL, params={'date':day.isoformat(),'type':'san-pham-chan-nuoi-price'},timeout=20)
            resp.raise_for_status(); parsed_date, data = parse(resp.text)
            if parsed_date == day.isoformat():
                for r in data: existing[(r['date'],r['product'])]=r
        except (requests.RequestException, ValueError): pass
        time.sleep(.15)
    result={'source':'GREENFEED','region':'Miền Bắc','checked_at':datetime.now(timezone(timedelta(hours=7))).isoformat(timespec='minutes'), 'last_source_date':max((r['date'] for r in existing.values()),default=None),'records':sorted(existing.values(),key=lambda r:(r['date'],r['product']))}
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f"Latest published: {latest}; total records: {len(result['records'])}")

if __name__ == '__main__':
    try: main()
    except Exception as exc:
        print('GREENFEED extraction failed safely:',exc,file=sys.stderr);sys.exit(1)
