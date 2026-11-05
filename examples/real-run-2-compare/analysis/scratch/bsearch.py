#!/usr/bin/env python3
import sys, re, subprocess, urllib.parse, base64, html
q = sys.argv[1]
url = "https://www.bing.com/search?" + urllib.parse.urlencode({"q": q, "count": "20", "setlang":"en", "mkt":"en-US"})
ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
h = subprocess.run(["curl","-s","--max-time","30","-A",ua,"-H","Accept-Language: en-US,en;q=0.9",url],
                   capture_output=True, text=True).stdout
def dec(u):
    if u.startswith("https://www.bing.com/ck/a"):
        m = re.search(r'[?&]u=a1([^&]+)', u)
        if m:
            s = m.group(1)
            s += "=" * (-len(s) % 4)
            try: return base64.b64decode(s.replace("-","+").replace("_","/")).decode("utf-8","replace")
            except Exception: return u
    return u
out=[]
for m in re.finditer(r'<li class="b_algo".{0,6000}?</li>', h, re.S):
    blk=m.group(0)
    u=re.search(r'<h2><a[^>]*href="([^"]+)"', blk)
    t=re.search(r'<h2>(.*?)</h2>',blk,re.S)
    ttl=re.sub(r'<[^>]+>','',t.group(1)) if t else ''
    p=re.search(r'<p[^>]*>(.*?)</p>', blk, re.S)
    sn=re.sub(r'<[^>]+>','',p.group(1)) if p else ''
    out.append((html.unescape(ttl).strip(), dec(html.unescape(u.group(1))) if u else '?', re.sub(r'\s+',' ',html.unescape(sn)).strip()))
if not out:
    print("NO RESULTS parsed; len(html)=",len(h))
    # dump visible text
    txt=re.sub(r'<script.*?</script>','',h,flags=re.S)
    txt=re.sub(r'<[^>]+>',' ',txt)
    print(re.sub(r'\s+',' ',txt)[:1500])
for t,u,s in out:
    print("URL:",u); print("TTL:",t[:170]); print("SNP:",s[:400]); print("-"*70)
