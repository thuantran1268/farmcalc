"""FarmCalc: collect dated GREENFEED daily market reports for Northern Vietnam.

Requires: requests, beautifulsoup4. Never synthesizes missing observations.
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup

BASE = 'https://www.greenfeed.com.vn'
LISTING = BASE + '/thuc-an-chan-nuoi-gia-suc-gia-cam/'
OUT = Path('data/greenfeed-north.json')
VN = timezone(timedelta(hours=7))
UA = {'User-Agent': 'Mozilla/5.0 (compatible; FarmCalcMarketTracker/2.0)'}
SLUG = re.compile(r'/ngay-(\d{2})-(\d{2})-(20\d{2})-[^/]+/?$')
AMOUNT = r'(\d{2,3}(?:[.,]\d{3})+|\d{4,6})'
RANGE = re.compile(AMOUNT + r'\s*[–—-]\s*' + AMOUNT + r'\s*(?:VNĐ|VND|đ)?\s*/\s*[Kk][Gg]', re.I)
AVG = re.compile(r'(?:bình\s*quân\s*đạt|bình\s*quân\s*ở\s*mức|bình\s*quân\s*là)\s*' + AMOUNT + r'\s*(?:VNĐ|VND|đ)?\s*/\s*[Kk][Gg]', re.I)
PRODUCTS = ('Heo hơi', 'Gà Ri', 'Gà Mía', 'Vịt thịt')


def number(s):
    return int(re.sub(r'[.,]', '', s))


def fetch(session, url):
    response = session.get(url, timeout=30)
    response.raise_for_status()
    return BeautifulSoup(response.text, 'html.parser')


def discover(soup):
    found = {}
    for a in soup.select('a[href]'):
        url = urljoin(LISTING, a['href']).split('?')[0].split('#')[0]
        if urlparse(url).netloc not in ('www.greenfeed.com.vn', 'greenfeed.com.vn'):
            continue
        m = SLUG.search(urlparse(url).path)
        if not m:
            continue
        date = f'{m[3]}-{m[2]}-{m[1]}'
        try:
            datetime.strptime(date, '%Y-%m-%d')
        except ValueError:
            continue
        if date > datetime.now(VN).date().isoformat():
            continue
        # Prefer combined livestock articles when several reports share a date.
        score = int('gia-heo-hoi' in url) + int('gia-ga' in url or 'gia-cam' in url)
        if date not in found or score > found[date][0]:
            found[date] = (score, url)
    return {d: item[1] for d, item in found.items()}


def blocks(soup):
    for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
        tag.decompose()
    article = soup.select_one('article .entry-content, article .post-content, .entry-content, .post-content, article, main') or soup
    return [re.sub(r'\s+', ' ', t.get_text(' ', strip=True)) for t in article.select('li, p') if len(t.get_text(' ', strip=True)) > 15]


def identify(text):
    t = text.casefold()
    if 'giá heo hơi' in t and ('miền bắc' in t or 'khu vực miền bắc' in t):
        return 'Heo hơi'
    if ('gà ri' in t or 'gà ri:' in t) and 'miền bắc' in t:
        return 'Gà Ri'
    if 'gà mía' in t and 'miền bắc' in t:
        return 'Gà Mía'
    if 'vịt thịt' in t and 'miền bắc' in t:
        return 'Vịt thịt'
    return None


def parse_article(soup, date, url):
    records = []
    for paragraph in blocks(soup):
        name = identify(paragraph)
        if not name or any(r['product'] == name for r in records):
            continue
        # A sentence can contain several regional prices; isolate Northern segment.
        region = re.search(r'(?:khu vực\s*)?miền bắc\s*[:;,]?\s*', paragraph, re.I)
        if not region:
            continue
        tail = paragraph[region.end():]
        tail = re.split(r'\b(?:miền trung|miền nam|đông nam bộ|tây nam bộ)\b', tail, maxsplit=1, flags=re.I)[0]
        avg = AVG.search(tail) if name == 'Heo hơi' else None
        rng = RANGE.search(tail)
        if name == 'Heo hơi' and not avg:
            # For hogs only use an explicitly reported Northern average.
            continue
        if name != 'Heo hơi' and not rng:
            continue
        low = high = None
        if rng:
            low, high = number(rng[1]), number(rng[2])
            if not (20000 <= low <= high <= 150000):
                continue
        price = number(avg[1]) if avg else (low + high) / 2
        if not 20000 <= price <= 150000:
            continue
        record = {'date': date, 'product': name, 'region': 'Miền Bắc',
                  'price': int(price) if price == int(price) else price,
                  'source': 'GREENFEED', 'source_url': url,
                  'price_type': 'reported_average' if avg else 'range_midpoint'}
        if low is not None:
            record.update(price_min=low, price_max=high)
        records.append(record)
    return records


def main():
    session = requests.Session()
    session.headers.update(UA)
    articles = discover(fetch(session, LISTING))
    if not articles:
        raise RuntimeError('Không tìm thấy liên kết bản tin GREENFEED theo ngày')
    old = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {'records': []}
    history = {}
    for r in old.get('records', []):
        if r.get('region') == 'Miền Bắc' and r.get('product') and r.get('date'):
            history[(r['date'], r['product'])] = r
    fresh = 0
    errors = []
    # Listing typically contains recent days; keep all available reports.
    for date, url in sorted(articles.items()):
        try:
            new = parse_article(fetch(session, url), date, url)
            for r in new:
                history[(r['date'], r['product'])] = r
                fresh += 1
            print(f'{date}: {len(new)} sản phẩm miền Bắc ({url})')
        except requests.RequestException as exc:
            errors.append(f'{date}: {exc}')
    if fresh == 0:
        raise RuntimeError('Không đọc được giá từ bản tin ngày; không ghi đè dữ liệu cũ. ' + '; '.join(errors[:2]))
    records = sorted(history.values(), key=lambda r: (r['date'], r['product']))
    result = {'source': 'GREENFEED', 'region': 'Miền Bắc',
              'checked_at': datetime.now(VN).isoformat(timespec='minutes'),
              'last_source_date': max((r['date'] for r in records), default=None),
              'records': records}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Thành công: {fresh} bản ghi từ bản tin ngày; tổng {len(records)} bản ghi.')
    if errors:
        print('Cảnh báo một số trang lỗi: ' + '; '.join(errors[:3]), file=sys.stderr)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'GREENFEED extraction failed safely: {exc}', file=sys.stderr)
        sys.exit(1)
