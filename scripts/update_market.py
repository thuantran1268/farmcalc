"""FarmCalc: thu giá thị trường chăn nuôi từ Green Vet (đủ mặt hàng) và Công Thương (heo hơi theo vùng).

Chạy hằng ngày bằng GitHub Actions. Chỉ lưu SỐ và nguồn (kèm đường dẫn), không lưu nội dung bài viết.
Không tự bịa số: dòng nào không đọc được thì bỏ qua và ghi vào 'warnings'.
Cần: requests, beautifulsoup4.
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

OUT = Path('data/market.json')
VN = timezone(timedelta(hours=7))
UA = {'User-Agent': 'Mozilla/5.0 (compatible; FarmCalcMarketTracker/3.0)'}
PARSER = 2  # tăng số này khi đổi cách đọc để tự đọc lại toàn bộ lịch sử
KEEP_DAYS = 3650
MAX_NEW_PER_RUN = 10

GV_LIST = 'https://greenvet.com.vn/gia-ca-thi-truong/'
CT_LIST = 'https://congthuong.vn/tag/gia-heo-hoi-hom-nay-56462.tag'
GV_SLUG = re.compile(r'cap-nhat-gia-chan-nuoi-ngay-(\d{2})-(\d{2})-(20\d{2})', re.I)
GV_TITLE = re.compile(r'NG[ÀA]Y\s*(\d{1,2})/(\d{1,2})/(20\d{2})', re.I)
CT_SLUG = re.compile(r'/gia-heo-hoi-hom-nay-(\d{1,2})-(\d{1,2})-(20\d{2})-[^/\s"]*?\d+\.html', re.I)

BIG = r'\d{1,3}(?:[.,]\d{3})+|\d{4,}'
RANGE_BIG = re.compile(r'(' + BIG + r')\s*(?:[-–—]|đến)\s*(' + BIG + r')')
ONE_BIG = re.compile(r'(?<![\d.,/])(' + BIG + r')(?![\d]|[.,]\d)')
RANGE_SHORT = re.compile(r'(?<![\d.,/])(\d{2,3})\s*[-–—]\s*(\d{2,3})(?![\d.,]|\s*(?:ng[àa]y|kg|ngày))', re.I)
REGIONS = (('Bắc', r'mi[eề]n\s*b[aắ]c|^b[aắ]c\b|\bb[aắ]c\b'), ('Trung', r'mi[eề]n\s*trung|^trung\b|t[aâ]y\s*nguy[eê]n|\btrung\b'), ('Nam', r'mi[eề]n\s*nam|^nam\b|\bnam\b'))


def num(s):
    return int(re.sub(r'[.,]', '', s))


def fix_unit_value(v, group):
    """Giá rút gọn kiểu '57-62' (nghìn đồng) đổi thành đồng."""
    return v * 1000 if v < 1000 else v


def unit_for(group, line):
    m = re.search(r'(?:đ|đồng|vnđ|vnd)\s*/\s*(kg|con|quả|trứng|quả)', line, re.I)
    if m:
        u = m.group(1).lower()
        return 'đ/quả' if u in ('quả', 'trứng') else 'đ/' + u
    g = group.lower()
    if 'trứng' in g:
        return 'đ/quả'
    if 'giống' in g or 'heo dân' in g or 'xách tai' in g:
        return 'đ/con'
    return 'đ/kg'


def region_of(text):
    t = text.lower().strip()
    if re.search(r'trung\s*quốc|china', t):
        return 'Trung Quốc'
    if re.search(r'thái\s*lan|thailand', t):
        return 'Thái Lan'
    for name, pat in REGIONS:
        if re.search(pat, t):
            return name
    return ''


def clean_label(prefix):
    s = re.sub(r'[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F•▪●►*]+', ' ', prefix)
    s = re.sub(r'\b(mi[eề]n)?\s*(b[aắ]c|trung|nam)\b(?!\s*quốc)\s*:?', ' ', s, flags=re.I)
    s = re.sub(r'\s*\((?:đ|đồng|vnđ)\s*/\s*\w+\)', '', s, flags=re.I)
    return re.sub(r'\s+', ' ', s).strip(' :-–—')


def html_lines(html, selectors):
    soup = BeautifulSoup(html, 'html.parser')
    for t in soup(['script', 'style', 'nav', 'footer', 'header', 'form', 'noscript']):
        t.decompose()
    node = None
    for sel in selectors:
        node = soup.select_one(sel)
        if node and len(node.get_text(' ', strip=True)) > 200:
            break
        node = None
    node = node or soup.body or soup
    text = node.get_text('\n')
    return [re.sub(r'\s+', ' ', l).strip() for l in text.split('\n') if l.strip()]


def regroup(recs):
    """Gom các nhóm theo ý nghĩa: nước ngoài, gà thịt, trứng, con giống; tách đơn vị khác nhau."""
    for r in recs:
        g, it, reg, u = r['group'], r['item'], r['region'], r['unit']
        gl = re.sub(r'^giá\s+', '', g, flags=re.I).strip()
        low = gl.lower()
        if reg in ('Trung Quốc', 'Thái Lan'):
            r['group'], r['item'], r['region'] = 'Heo hơi nước ngoài', '', reg
            continue
        if u == 'đ/con' and 'heo' not in low:
            if re.match(r'vịt', it, re.I):
                r['group'], r['item'] = 'Vịt giống', it
            else:
                r['group'], r['item'] = 'Con giống gia cầm', ((gl + ' ' + it).strip() if low != 'con giống gia cầm' else it)
        elif u == 'đ/con':
            r['group'] = gl + ' (tính theo con)'
        elif 'trứng' in low:
            r['group'], r['item'] = 'Trứng', (gl + ' ' + it).strip()
        elif 'gà' in low and u == 'đ/kg':
            r['group'], r['item'] = 'Gà thịt', ('' if low == 'gà thịt' else gl) + (' ' + it if it else '') if low != 'gà thịt' else it
            r['item'] = r['item'].strip()
        elif re.match(r'vịt', it, re.I) and 'gà' in low:
            r['group'] = 'Vịt giống'
    return recs


def parse_greenvet(lines):
    """Trả về (records, warnings). Mỗi dòng có giá → một bản ghi; dòng không có giá → tiêu đề nhóm."""
    recs, warns, group, last_label = [], [], '', ''
    skip_words = ('liên quan', 'tin tức', 'bình luận', 'chia sẻ', 'đọc thêm')
    for line in lines:
        low = line.lower()
        if any(w in low for w in skip_words) and not RANGE_BIG.search(line):
            continue
        m = RANGE_BIG.search(line)
        lo = hi = None
        if m:
            lo, hi = num(m[1]), num(m[2])
        else:
            m2 = RANGE_SHORT.search(line)
            if m2 and not ONE_BIG.search(line) and 'ngày' not in low[m2.end():m2.end() + 8]:
                lo, hi = fix_unit_value(int(m2[1]), group), fix_unit_value(int(m2[2]), group)
                m = m2
            else:
                one = ONE_BIG.search(line)
                if one:
                    lo = hi = num(one[1])
                    m = one
        if lo is None:
            head = clean_label(line)
            if 3 <= len(head) <= 90:
                group = head
                last_label = ''
            continue
        if lo > hi:
            lo, hi = hi, lo
        prefix = line[:m.start()]
        reg = region_of(prefix) or region_of(line[:30])
        label = clean_label(prefix)
        if label and re.fullmatch(r'(?i)(mi[eề]n\s*)?(b[aắ]c|trung|nam)', label):
            label = ''
        item = label or last_label
        if label:
            last_label = label
        if reg in ('Trung Quốc', 'Thái Lan'):
            item = item or reg
        if not group:
            warns.append('Dòng có giá nhưng chưa có nhóm: ' + line[:60])
            continue
        if not (500 <= lo <= 50_000_000) or not (500 <= hi <= 50_000_000):
            warns.append('Giá ngoài khoảng hợp lý: ' + line[:60])
            continue
        recs.append({'group': group, 'item': item, 'region': reg, 'min': lo, 'max': hi, 'unit': unit_for(group, line)})
    return regroup(recs), warns


CT_RANGE = re.compile(r'(' + BIG + r')\s*[-–—]\s*(' + BIG + r')\s*đồng\s*/\s*kg', re.I)
CT_AMOUNT = re.compile(r'(' + BIG + r')\s*đồng\s*/\s*kg', re.I)
CT_REGION_KW = re.compile(r'mi[eề]n\s*b[aắ]c|mi[eề]n\s*trung|t[aâ]y\s*nguy[eê]n|mi[eề]n\s*nam', re.I)
PROVINCES = ['Hà Nội', 'Hải Phòng', 'Quảng Ninh', 'Bắc Ninh', 'Hưng Yên', 'Ninh Bình', 'Phú Thọ', 'Thái Nguyên', 'Tuyên Quang', 'Lào Cai', 'Lai Châu', 'Điện Biên', 'Sơn La', 'Lạng Sơn', 'Cao Bằng', 'Thanh Hóa', 'Nghệ An', 'Hà Tĩnh', 'Quảng Trị', 'Huế', 'Đà Nẵng', 'Quảng Ngãi', 'Gia Lai', 'Đắk Lắk', 'Khánh Hòa', 'Lâm Đồng', 'Đồng Nai', 'Tây Ninh', 'Hồ Chí Minh', 'Đồng Tháp', 'An Giang', 'Vĩnh Long', 'Cần Thơ', 'Cà Mau', 'Bắc Giang', 'Vĩnh Phúc', 'Hà Nam', 'Nam Định', 'Thái Bình', 'Hải Dương', 'Hòa Bình', 'Yên Bái', 'Bắc Kạn', 'Hà Giang', 'Quảng Bình', 'Quảng Nam', 'Bình Định', 'Phú Yên', 'Bình Thuận', 'Kon Tum', 'Đắk Nông', 'Long An', 'Tiền Giang', 'Bến Tre', 'Trà Vinh', 'Sóc Trăng', 'Bạc Liêu', 'Kiên Giang', 'Hậu Giang', 'Bà Rịa - Vũng Tàu', 'Bình Phước', 'Bình Dương']
CT_PROV = re.compile(r'(?<![\wÀ-ỹ])(' + '|'.join(re.escape(x) for x in sorted(PROVINCES, key=len, reverse=True)) + r')(?![\wÀ-ỹ])', re.I)


def parse_congthuong(lines):
    """Khoảng giá heo hơi theo vùng (Bắc/Trung/Nam) và giá một số tỉnh nêu trong bài."""
    recs, warns, seen, prov_seen, cur = [], [], set(), set(), ''
    for line in lines:
        for sent in re.split(r'(?<=[a-zà-ỹ0-9])\.\s+(?=[A-ZĐ])', line):
            kw = CT_REGION_KW.search(sent)
            here = region_of(kw.group(0)) if kw else ''
            r = CT_RANGE.search(sent)
            if r:
                reg = here or cur
                lo, hi = sorted((num(r[1]), num(r[2])))
                if reg and reg not in seen and 20_000 <= lo <= 200_000 and 20_000 <= hi <= 200_000:
                    seen.add(reg)
                    recs.append({'group': 'Heo hơi', 'item': 'Heo hơi', 'region': reg, 'min': lo, 'max': hi, 'unit': 'đ/kg', 'level': 'vung'})
            names = []
            for pm in CT_PROV.finditer(sent):
                canon = next(x for x in PROVINCES if x.lower() == pm.group(1).lower())
                if canon not in names:
                    names.append(canon)
            if names and not r:
                big = [x for x in (num(v) for v in CT_AMOUNT.findall(sent)) if 20_000 <= x <= 200_000]
                if len(set(big)) == 1:
                    for name in names:
                        if name not in prov_seen:
                            prov_seen.add(name)
                            recs.append({'group': 'Heo hơi', 'item': 'Heo hơi', 'region': name, 'min': big[0], 'max': big[0], 'unit': 'đ/kg', 'level': 'tinh'})
            if here:
                cur = here
    if not seen:
        warns.append('Không đọc được khoảng giá theo vùng')
    return recs, warns


def get(session, url):
    r = session.get(url, timeout=30)
    r.raise_for_status()
    return r.text


def discover(html, base, rx, title_rx=None):
    found = {}
    soup = BeautifulSoup(html, 'html.parser')
    for a in soup.select('a[href]'):
        url = urljoin(base, a['href']).split('#')[0]
        m = rx.search(url)
        if not m and title_rx:
            m = title_rx.search(a.get_text(' ', strip=True))
        if not m:
            continue
        try:
            d = datetime(int(m[3]), int(m[2]), int(m[1])).date().isoformat()
        except ValueError:
            continue
        if d > datetime.now(VN).date().isoformat():
            continue
        found.setdefault(d, url)
    return found


def run_source(session, name, list_url, rx, title_rx, selectors, parser, store, status):
    st = status[name] = {'checked_at': datetime.now(VN).isoformat(timespec='minutes'), 'ok': False, 'warnings': []}
    try:
        found = discover(get(session, list_url), list_url, rx, title_rx)
        if not found:
            raise RuntimeError('Không tìm thấy bài nào trên trang danh sách')
        have = {r['date'] for r in store if r['source'] == name}
        recent = sorted(found, reverse=True)[:2]
        todo = [d for d in sorted(found, reverse=True) if d not in have or d in recent][:MAX_NEW_PER_RUN]
        added = 0
        for d in todo:
            url = found[d]
            try:
                recs, warns = parser(html_lines(get(session, url), selectors))
            except Exception as e:  # một bài lỗi không làm hỏng cả lần chạy
                st['warnings'].append(f'{d}: {e}')
                continue
            st['warnings'] += [f'{d}: {w}' for w in warns][:5]
            if not recs:
                st['warnings'].append(f'{d}: không đọc được giá nào')
                continue
            store[:] = [r for r in store if not (r['source'] == name and r['date'] == d)]
            for r in recs:
                store.append({'date': d, 'source': name, 'url': url, **r})
            added += 1
        st['ok'] = added > 0 or bool(have)
        st['last_date'] = max([r['date'] for r in store if r['source'] == name] or [''])
        print(f'{name}: tìm thấy {len(found)} bài, cập nhật {added} ngày, cảnh báo {len(st["warnings"])}')
    except Exception as e:
        st['error'] = str(e)[:200]
        print(f'{name}: LỖI {e}', file=sys.stderr)


def main():
    old = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    store = [r for r in old.get('records', []) if isinstance(r, dict)] if old.get('parser') == PARSER else []
    status = {}
    s = requests.Session()
    s.headers.update(UA)
    run_source(s, 'greenvet', GV_LIST, GV_SLUG, GV_TITLE, ['div.elementor-widget-theme-post-content', 'div.entry-content', 'article'], parse_greenvet, store, status)
    run_source(s, 'congthuong', CT_LIST, CT_SLUG, None, ['div.detail-content', 'div.detail__content', 'article', 'div.content-detail'], parse_congthuong, store, status)
    cutoff = (datetime.now(VN) - timedelta(days=KEEP_DAYS)).date().isoformat()
    store = sorted((r for r in store if r['date'] >= cutoff), key=lambda r: (r['date'], r['source'], r['group'], r['item'], r['region']))
    out = {'updated_at': datetime.now(VN).isoformat(timespec='minutes'), 'parser': PARSER, 'sources': status, 'records': store}
    if all('error' in v for v in status.values()):
        print('Tất cả nguồn đều lỗi, giữ nguyên dữ liệu cũ.', file=sys.stderr)
        sys.exit(1)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
