import os, sys
exec(open('/tmp/e2e/ui.py').read().split('    # ---------- guest ----------')[0].replace("def page(sess=None, w=1440, h=900, mode=None):","def page(sess=None, w=1440, h=900, mode=None, scheme='light'):").replace("ctx=br.new_context(viewport={'width':w,'height':h})","ctx=br.new_context(viewport={'width':w,'height':h}, color_scheme=scheme)"))
AXE=open('/tmp/e2e/node_modules/axe-core/axe.min.js').read()
for f in ('NO_CONFIG',):
    try: os.remove('/tmp/e2e/'+f)
    except FileNotFoundError: pass
open('/tmp/e2e/NO_CONFIG','w').write('1')
def tx(pg): return pg.evaluate("document.querySelector('#console-output .term-pre')?.textContent || ''")
with sync_playwright() as pw:
    br=pw.chromium.launch()
    pg,errs=page(); pg.wait_for_timeout(800)
    check('the badge says "Needs setup" and a "How to fix" button appears', 'Needs setup' in pg.inner_text('#connection-label') and pg.is_visible('#backend-help-button'), (pg.inner_text('#connection-label'), pg.is_visible('#backend-help-button')))
    pg.click('#run-button'); pg.wait_for_function("document.querySelector('#console-output .term-pre')?.textContent.includes('Site owner')", timeout=20000)
    t=tx(pg); check('Python run explains it in plain language and names the missing setting', 'not configured' in t and 'CODE_BACKEND_SHARED_SECRET' in t and 'How to fix' in t, repr(t))
    check('status pill says the server is not set up', 'Server not set up' in pg.inner_text('#result-state'), pg.inner_text('#result-state'))
    pg.screenshot(path='/tmp/shots/50-not-configured-terminal.png')
    pg.click('#backend-help-button'); pg.wait_for_selector('.fx-modal')
    dlg=pg.inner_text('.fx-modal'); check('the guide lists exactly the missing setting and the steps', 'CODE_BACKEND_SHARED_SECRET' in dlg and 'SUPABASE_URL' not in dlg.split('How to fix it')[0] and 'Redeploy' in dlg and 'openssl rand -base64 48' in dlg, dlg[:300])
    check('no secret values shown', 'backend-test-secret' not in dlg)
    pg.screenshot(path='/tmp/shots/51-backend-setup-guide.png')
    pg.evaluate(AXE); v=pg.evaluate("axe.run(document.querySelector('.fx-modal')).then(r=>r.violations.map(x=>x.id+':'+x.impact))"); check('the guide has no accessibility violations', not v, v)
    os.remove('/tmp/e2e/NO_CONFIG')                       # the owner fixes the setting and redeploys
    pg.click('.fx-actions .panel-primary'); pg.wait_for_function("document.getElementById('connection-label').textContent==='Connected'", timeout=15000)
    check('"Check again" turns the badge to Connected and hides the help button', pg.is_hidden('#backend-help-button'))
    pg.click('#run-button'); pg.wait_for_function("document.querySelector('#console-output .term-pre')?.textContent.includes('Process finished')", timeout=30000)
    check('after the fix, Python runs', 'Hello from Draco Code' in tx(pg), repr(tx(pg)))
    e=[x for x in errs if '503' not in x]; check('no unexpected JS errors', not e, e)
    br.close()
try: os.remove('/tmp/e2e/NO_CONFIG')
except FileNotFoundError: pass
print('\nFAILED:' if fails else '\nALL NOT-CONFIGURED CHECKS PASSED', fails or ''); sys.exit(1 if fails else 0)
