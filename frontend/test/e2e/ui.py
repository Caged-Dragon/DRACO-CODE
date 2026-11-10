import json, hmac, hashlib, base64, time, sys
from playwright.sync_api import sync_playwright
def b64(x): return base64.urlsafe_b64encode(x).rstrip(b'=').decode()
def jwt(sub, email):
    h=b64(json.dumps({'alg':'HS256','typ':'JWT'}).encode()); p=b64(json.dumps({'sub':sub,'email':email,'role':'authenticated','aud':'authenticated','exp':int(time.time())+3600}).encode())
    sig=b64(hmac.new(b'super-secret-jwt-key-at-least-32-characters-long',f'{h}.{p}'.encode(),hashlib.sha256).digest()); return f'{h}.{p}.{sig}'
def session(sub,email):
    return json.dumps({'access_token':jwt(sub,email),'refresh_token':'r','expires_at':int(time.time())+3600,'expires_in':3600,'token_type':'bearer','user':{'id':sub,'email':email,'aud':'authenticated','role':'authenticated'}})
UA='11111111-1111-1111-1111-111111111111'; UB='22222222-2222-2222-2222-222222222222'
fails=[]
def check(name, cond, extra=''):
    print(('  PASS ' if cond else '  FAIL ')+name+(' '+str(extra) if (extra and not cond) else '')); 
    if not cond: fails.append(name)
with sync_playwright() as pw:
    br=pw.chromium.launch()
    def page(sess=None, w=1440, h=900, mode=None):
        ctx=br.new_context(viewport={'width':w,'height':h}); pg=ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' and 'favicon' not in m.text else None)
        pg.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=open('/tmp/e2e/node_modules/@supabase/supabase-js/dist/umd/supabase.js').read()))
        init=[]
        if sess: init.append(f"localStorage.setItem('sb-localhost-auth-token', {json.dumps(sess)});")
        if mode: init.append(f"localStorage.setItem('draco-code-mode-v1','{mode}');")
        if init: pg.add_init_script(';'.join(init))
        pg.goto('http://localhost:8000/'); pg.wait_for_timeout(700); return pg, errs
    # ---------- guest ----------
    pg,errs=page()
    order=pg.evaluate("""()=>{const l=document.querySelector('.topbar-left');return [...l.children].map(c=>c.id||c.className)}""")
    check('top bar order: menu, sign in, brand', order[:3]==['menu-button','signin-button','brand'], order)
    box=pg.evaluate("""()=>{const a=document.getElementById('menu-button').getBoundingClientRect(),b=document.getElementById('signin-button').getBoundingClientRect();return [a.left,a.right,b.left,b.right,a.top,b.top]}""")
    check('menu is at the left edge and sign in sits right next to it', box[0]<30 and 0<=box[2]-box[1]<=16, box)
    check('guest button says Sign in', pg.inner_text('#signin-label')=='Sign in')
    pg.screenshot(path='/tmp/shots/01-guest-topbar.png')
    pg.click('#signin-button'); pg.wait_for_selector('#auth-dialog:not([hidden])')
    check('Sign in opens the login dialog', pg.is_visible('#auth-dialog') and pg.is_visible('#account-email'))
    pg.screenshot(path='/tmp/shots/02-auth-dialog.png')
    pg.click('#auth-tab-signup'); check('tab switches to Create account', pg.inner_text('#auth-submit')=='Create account')
    pg.keyboard.press('Escape'); check('Escape closes dialog', pg.is_hidden('#auth-dialog'))
    pg.click('#menu-button'); pg.wait_for_timeout(300)
    check('menu lists Compiler, Project mode, Languages and packages', all(pg.is_visible(i) for i in ['#menu-compiler','#menu-project','#menu-packages']))
    check('Project mode shows an Account badge for guests', pg.is_visible('#menu-project-badge'))
    pg.screenshot(path='/tmp/shots/03-menu.png')
    pg.click('#menu-project'); pg.wait_for_selector('#auth-dialog:not([hidden])')
    check('guest choosing Project mode is asked to sign in (stays in compiler)', pg.evaluate("document.body.dataset.mode")=='compiler')
    pg.keyboard.press('Escape')
    pg.click('#run-button'); pg.wait_for_timeout(2500)
    check('guest compiler still runs code', 'Hello from Draco Code' in pg.inner_text('#console-output'), pg.inner_text('#console-output')[:120])
    check('no JS errors (guest)', not errs, errs)
    # ---------- signed in, project mode ----------
    pg,errs=page(session(UA,'alice@example.com'))
    check('signed-in button shows the account name', pg.inner_text('#signin-label')=='alice', pg.inner_text('#signin-label'))
    check('no Account badge when signed in', pg.is_hidden('#menu-project-badge'))
    pg.click('#menu-button'); pg.click('#menu-project'); pg.wait_for_timeout(900)
    check('project mode opens; first-time user sees empty state', pg.evaluate("document.body.dataset.mode")=='project' and pg.is_visible('#project-ide'))
    pg.click('#act-projects'); pg.wait_for_timeout(200); pg.screenshot(path='/tmp/shots/04-no-projects.png')
    pg.click('#project-new'); pg.fill('#ide-f-name','demo'); pg.select_option('#ide-f-language','python'); pg.click('.ide-modal .panel-primary'); pg.wait_for_timeout(1200)
    check('project created with starter files in the explorer', pg.inner_text('#ide-project-name')=='demo' and pg.locator('.tree-name').all_inner_texts()==['main.py','utils.py'], pg.locator('.tree-name').all_inner_texts())
    check('entry file opened in a tab and marked', pg.locator('.ide-tab-name').all_inner_texts()==['main.py'] and pg.is_visible('.tree-entry'))
    pg.click('#ide-run'); pg.wait_for_function("document.querySelector('#panel-output .term-pre')?.textContent.includes('Process finished')", timeout=20000)
    out=pg.inner_text('#panel-output'); check('project run output is correct (multi-file import)', 'Hello, Draco!' in out and '5 + 7 = 12' in out, out)
    pg.screenshot(path='/tmp/shots/05-project-run.png')
    # edit + autosave to DB
    pg.click('.ide-editor-host.active textarea'); pg.keyboard.press('Control+End'); pg.keyboard.type('\nprint("edited")'); 
    check('typing marks tab unsaved', pg.is_visible('.ide-tab-close.dirty'))
    pg.wait_for_timeout(2200); check('autosave clears the unsaved dot', pg.is_hidden('.ide-tab-close.dirty') and pg.inner_text('#ide-st-save')=='Saved')
    # create file in a new folder through the tree
    pg.click('#tree-new-folder'); pg.wait_for_selector('.tree-input:focus'); pg.keyboard.type('pkg'); pg.keyboard.press('Enter'); pg.wait_for_timeout(700)
    pg.click('#tree-new-file'); pg.wait_for_selector('.tree-input:focus'); pg.keyboard.type('mod.py'); pg.keyboard.press('Enter'); pg.wait_for_timeout(900)
    names=pg.locator('.tree-name').all_inner_texts(); check('folder and nested file created (mod.py is inside pkg)', names[:2]==['pkg','mod.py'], names)
    pg.click('.ide-editor-host.active textarea'); pg.keyboard.type('VALUE = 99\n'); pg.wait_for_timeout(1800)
    pg.click('.tree-row:has-text("main.py")'); pg.click('.ide-editor-host.active textarea'); pg.keyboard.press('Control+Home'); pg.keyboard.type('from pkg.mod import VALUE\nprint("value", VALUE)\n'); 
    pg.keyboard.press('Control+s'); pg.wait_for_timeout(1200)
    pg.keyboard.press('Control+Enter'); pg.wait_for_function("document.querySelector('#panel-output .term-pre')?.textContent.includes('Process finished')", timeout=20000); pg.wait_for_timeout(300)
    out=pg.inner_text('#panel-output'); check('Run uses saved edits across folders (value 99)', 'value 99' in out and 'edited' in out, out)
    # compile error -> Problems
    pg.click('#act-projects'); pg.click('#project-new'); pg.fill('#ide-f-name','cdemo'); pg.select_option('#ide-f-language','python'); pg.click('.ide-modal .panel-primary'); pg.wait_for_timeout(1200)
    pg.click('.ide-editor-host.active textarea'); pg.keyboard.press('Control+End'); pg.keyboard.type('\nraise ValueError("boom")'); pg.wait_for_timeout(1800)
    pg.click('#ide-run'); pg.wait_for_function("document.querySelector('#problems-count') && !document.querySelector('#problems-count').hidden", timeout=20000); pg.wait_for_timeout(300)
    check('runtime error populates Problems with a badge', pg.is_visible('#problems-count') and pg.inner_text('#problems-count')!='0')
    pg.screenshot(path='/tmp/shots/06-problems.png')
    pg.click('.ide-problem'); pg.wait_for_timeout(300); check('clicking a problem jumps to that file', 'main.py' in pg.inner_text('#ide-crumbs'))
    # persistence across reload
    pg.reload(); pg.wait_for_timeout(1500)
    check('reload restores project mode, last project and files from the database', pg.evaluate("document.body.dataset.mode")=='project' and pg.inner_text('#ide-project-name')=='cdemo' and 'main.py' in pg.locator('.tree-name').all_inner_texts())
    pg.click('#act-projects'); pg.wait_for_timeout(200); pg.click('.ide-proj:not(:has-text("cdemo")):has-text("demo") .ide-proj-open'); pg.wait_for_timeout(900)
    names=pg.locator('.tree-name').all_inner_texts(); check('switching projects loads the saved files (pkg/mod.py persisted)', 'pkg' in names, names)
    src=pg.evaluate("document.querySelector('.ide-editor-host.active textarea').value"); check('saved content really came back from the database', 'from pkg.mod import VALUE' in src and 'edited' in src, repr(src)+' tabs='+str(pg.locator('.ide-tab-name').all_inner_texts())+' project='+pg.inner_text('#ide-project-name'))
    # rename + delete
    pg.click('.tree-row:has-text("utils.py")'); pg.keyboard.press('F2'); pg.wait_for_selector('.tree-input:focus'); pg.keyboard.press('Control+a'); pg.keyboard.type('helpers.py'); pg.keyboard.press('Enter'); pg.wait_for_timeout(900)
    check('rename with F2', 'helpers.py' in pg.locator('.tree-name').all_inner_texts())
    pg.hover('.tree-row:has-text("helpers.py")'); pg.click('.tree-row:has-text("helpers.py") button[aria-label="Delete"]'); pg.click('.ide-modal .panel-primary'); pg.wait_for_timeout(900)
    check('delete with confirmation', 'helpers.py' not in pg.locator('.tree-name').all_inner_texts())
    # light theme + screenshot
    pg.click('[data-theme-toggle]'); pg.wait_for_timeout(200); pg.screenshot(path='/tmp/shots/07-light.png'); pg.click('[data-theme-toggle]')
    check('no JS errors (signed in)', not errs, errs)
    # ---------- another account sees nothing ----------
    pgb,errsb=page(session(UB,'bob@example.com'), mode='project'); pgb.wait_for_timeout(800)
    check('a different account has no access to alice projects', pgb.locator('.ide-proj').count()==0 and pgb.inner_text('#ide-project-name')=='No project', pgb.locator('.ide-proj').count())
    # ---------- mobile ----------
    pgm,errsm=page(session(UA,'alice@example.com'), w=390, h=800, mode='project'); pgm.wait_for_timeout(1200); pgm.screenshot(path='/tmp/shots/08-mobile.png')
    ov=pgm.evaluate("document.documentElement.scrollWidth>window.innerWidth+1"); check('mobile: no horizontal overflow', not ov)
    pgm2,_=page(w=390,h=800); pgm2.screenshot(path='/tmp/shots/09-mobile-guest.png')
    check('no JS errors (mobile)', not errsm, errsm)
    br.close()
print('\nFAILED:' if fails else '\nALL UI CHECKS PASSED', fails or ''); sys.exit(1 if fails else 0)
