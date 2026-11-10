import sys, json
exec(open('/tmp/e2e/ui.py').read().split('    # ---------- guest ----------')[0].replace("def page(sess=None, w=1440, h=900, mode=None):","def page(sess=None, w=1440, h=900, mode=None, scheme='light'):").replace("ctx=br.new_context(viewport={'width':w,'height':h})","ctx=br.new_context(viewport={'width':w,'height':h}, color_scheme=scheme, permissions=['clipboard-read','clipboard-write'], accept_downloads=True)"))
AXE=open('/tmp/e2e/node_modules/axe-core/axe.min.js').read()
RULES={'runOnly':{'type':'tag','values':['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}}
total=[]
def audit(pg, name):
    pg.evaluate(AXE)
    res=pg.evaluate("axe.run(document, %s).then(r=>r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,count:v.nodes.length,nodes:v.nodes.slice(0,3).map(n=>({t:n.target.join(' '),s:(n.failureSummary||'').split('\\n').slice(1,3).join(' | ').slice(0,170)}))})))" % json.dumps(RULES))
    print(f"== {name}: {len(res)} rule(s) violated")
    for v in res:
        print(f"  [{v['impact']}] {v['id']} x{v['count']}: {v['help']}")
        for n in v['nodes'][:2]: print(f"       {n['t']}  ->  {n['s']}")
        total.append((name,v['id'],v['impact'],v['count']))
    return res
with sync_playwright() as pw:
    br=pw.chromium.launch()
    for scheme in ('light','dark'):
        pg,errs=page(scheme=scheme); audit(pg,f'compiler guest ({scheme})')
        pg.fill('#editor','name = input("Name: ")\nprint(name)\n'); pg.click('#run-button'); pg.wait_for_selector('#console-output .term-input:not([hidden])',timeout=20000); pg.wait_for_timeout(600); audit(pg,f'terminal waiting ({scheme})')
        pg.click('#menu-button'); pg.wait_for_timeout(400); audit(pg,f'menu open ({scheme})'); pg.keyboard.press('Escape')
        pg.click('#signin-button'); pg.wait_for_selector('#auth-dialog:not([hidden])'); pg.wait_for_timeout(300); audit(pg,f'sign-in dialog ({scheme})'); pg.keyboard.press('Escape')
        pg.keyboard.press('Control+k'); pg.wait_for_selector('.fx-palette'); audit(pg,f'palette ({scheme})'); pg.keyboard.press('Escape')
        pg.click('#menu-button'); pg.click('#menu-settings'); pg.wait_for_selector('.fx-modal'); audit(pg,f'settings ({scheme})'); pg.keyboard.press('Escape')
        pg.click('#menu-button'); pg.click('#menu-examples'); pg.wait_for_selector('.fx-cards'); audit(pg,f'examples ({scheme})'); pg.keyboard.press('Escape')
        pg2,e2=page(session(UA,'alice@example.com'),scheme=scheme)
        pg2.click('#signin-button'); pg2.wait_for_selector('#account-panel.open'); pg2.wait_for_timeout(500); audit(pg2,f'account panel ({scheme})'); pg2.keyboard.press('Escape')
        pg2.click('#menu-button'); pg2.click('#menu-project'); pg2.wait_for_timeout(900)
        pg2.click('#act-projects'); pg2.click('#project-new'); pg2.fill('#ide-f-name','demo'); pg2.click('.ide-modal .panel-primary'); pg2.wait_for_timeout(1300)
        pg2.click('#ide-run'); pg2.wait_for_function("document.querySelector('#panel-output .term-pre')?.textContent.includes('Process finished')", timeout=20000)
        audit(pg2,f'project mode ({scheme})')
        pg2.keyboard.press('Control+Shift+F'); pg2.keyboard.type('greet'); pg2.wait_for_timeout(500); audit(pg2,f'project search ({scheme})')
    br.close()
print('\nTOTAL violated rule instances:', len(total))
from collections import Counter
c=Counter((t[1],t[2]) for t in total); print('by rule:', dict(c))
