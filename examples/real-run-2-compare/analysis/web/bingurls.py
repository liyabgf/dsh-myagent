import sys,re,html,urllib.parse,subprocess,json,time
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
def q(query,limit=8):
    url="https://www.bing.com/news/search?q="+urllib.parse.quote(query)+"&format=rss&count=30"
    r=subprocess.run(["curl","-sSL","-m","45","-A",UA,url],capture_output=True,text=True)
    items=re.findall(r'<item>(.*?)</item>',r.stdout,re.S)
    print(f"##### {query} ({len(items)})")
    n=0
    for it in items:
        t=re.search(r'<title>(.*?)</title>',it,re.S); d=re.search(r'<pubDate>(.*?)</pubDate>',it,re.S); l=re.search(r'<link>(.*?)</link>',it,re.S)
        if not(t and l): continue
        link=html.unescape(l.group(1)); m=re.search(r'url=([^&]+)',link)
        real=urllib.parse.unquote(m.group(1)) if m else link
        print('  -',(d.group(1)[:25] if d else '?'),'|',html.unescape(t.group(1))[:105])
        print('     ',real)
        n+=1
        if n>=limit: break
    print()
for query in json.load(open(sys.argv[1])):
    try: q(query)
    except Exception as e: print('ERR',query,e)
    time.sleep(1)
