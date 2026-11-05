import sys,re,html,urllib.parse,subprocess,time,json
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
def s(q,fn,limit=10):
    url="https://www.bing.com/news/search?q="+urllib.parse.quote(q)+"&format=rss&count=30"
    r=subprocess.run(["curl","-sSL","-m","45","-A",UA,url],capture_output=True,text=True)
    open(fn,'w',encoding='utf-8').write(r.stdout)
    items=re.findall(r'<item>(.*?)</item>',r.stdout,re.S)
    print(f"##### {q} ({len(items)})")
    for it in items[:limit]:
        t=re.search(r'<title>(.*?)</title>',it,re.S); d=re.search(r'<pubDate>(.*?)</pubDate>',it,re.S); l=re.search(r'<link>(.*?)</link>',it,re.S)
        print('  -',(d.group(1)[:25] if d else '?'),'|',html.unescape(t.group(1))[:110] if t else '?')
        print('     ',(l.group(1)[:190] if l else ''))
    print()
qs=json.load(open(sys.argv[1]))
for q,fn in qs:
    try: s(q,fn)
    except Exception as e: print('ERR',q,e)
    time.sleep(1)
