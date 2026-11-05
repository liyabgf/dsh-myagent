import sys,re,html,urllib.parse,subprocess,time,os
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
def search(q,fn,extra=""):
    url="https://news.google.com/rss/search?q="+urllib.parse.quote(q+extra)+"&hl=en-US&gl=US&ceid=US:en"
    r=subprocess.run(["curl","-sSL","-m","45","-A",UA,url],capture_output=True,text=True)
    x=r.stdout
    open(fn,'w',encoding='utf-8').write(x)
    items=re.findall(r'<item>(.*?)</item>',x,re.S)
    print(f"##### {q}  ({len(items)} items) -> {fn}")
    for it in items:
        t=re.search(r'<title>(.*?)</title>',it,re.S); d=re.search(r'<pubDate>(.*?)</pubDate>',it,re.S); s=re.search(r'<source[^>]*>(.*?)</source>',it,re.S)
        print('  -',(d.group(1)[:25] if d else '?'),'|',html.unescape(t.group(1))[:135] if t else '?','|',(s.group(1)[:28] if s else ''))
    print()
if __name__=='__main__':
    batch=sys.argv[1]
    Q=json=None
    import json
    qs=json.load(open(batch))
    for i,(q,fn) in enumerate(qs):
        try: search(q,fn)
        except Exception as e: print('ERR',q,e)
        time.sleep(1.0)
