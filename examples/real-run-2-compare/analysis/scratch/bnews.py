#!/usr/bin/env python3
import sys, re, subprocess, urllib.parse
q=sys.argv[1]; n=int(sys.argv[2]) if len(sys.argv)>2 else 25
url="https://www.bing.com/news/search?"+urllib.parse.urlencode({"q":q,"format":"rss","count":str(n)})
ua="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
t=subprocess.run(["curl","-s","--max-time","35","-A",ua,url],capture_output=True,text=True).stdout
items=re.findall(r'<item>(.*?)</item>',t,re.S)
if not items: print("NO ITEMS; bytes=",len(t))
for b in items:
    def g(tag):
        m=re.search(r'<%s>(.*?)</%s>'%(tag,tag),b,re.S)
        if not m: return ''
        s=re.sub(r'<!\[CDATA\[|\]\]>','',m.group(1))
        return re.sub(r'<[^>]+>','',s).strip()
    l=g('link')
    m=re.search(r'[?&]url=([^&]+)',l)
    real=urllib.parse.unquote(m.group(1)) if m else l
    print("D:",g('pubDate'))
    print("T:",g('title')[:150])
    print("U:",real[:400])
    print("S:",g('description')[:500])
    print("-"*72)
