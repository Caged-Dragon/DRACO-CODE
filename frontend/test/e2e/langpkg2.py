import os, sys, time
exec(open('/tmp/e2e/ui.py').read().split('    # ---------- guest ----------')[0].replace("def page(sess=None, w=1440, h=900, mode=None):","def page(sess=None, w=1440, h=900, mode=None, scheme='light'):").replace("ctx=br.new_context(viewport={'width':w,'height':h})","ctx=br.new_context(viewport={'width':w,'height':h}, color_scheme=scheme)"))
for f in ('NO_TOOLCHAIN','SETUP_DONE'):
    try: os.remove('/tmp/e2e/'+f)
    except FileNotFoundError: pass
def tx(pg): return pg.evaluate("document.querySelector('#console-output .term-pre')?.textContent || ''")
def wait_done(pg, secs=60):
    pg.wait_for_function("(()=>{const t=document.querySelector('#console-output .term-pre')?.textContent||'';return /Process (finished|exited)|Compilation failed|Terminated/.test(t)})()", timeout=secs*1000)
def opts(pg): return pg.evaluate("[...document.querySelectorAll('#language-select option')].map(o=>o.value+':'+(o.disabled?'locked':'ok')).join(' ')")
with sync_playwright() as pw:
    br=pw.chromium.launch()
    pg,errs=page(session(UA,'alice@example.com'))
    # ---------------- 1. add Java, then actually USE it ----------------
    pg.click('#signin-button'); pg.wait_for_selector('#account-panel.open'); pg.wait_for_timeout(500)
    pg.click('[data-add-language="java"]'); pg.wait_for_timeout(1500)
    check('adding Java tells you what to do next', 'Use Java' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    row=pg.locator('.language-row:has(.language-info > span:text-is("Java"))'); check('Java row says Ready and offers "Use Java"', 'Ready' in row.inner_text() and row.locator('.use-language').count()==1, row.inner_text())
    check('Java is unlocked in the language dropdown', 'java:ok' in opts(pg), opts(pg))
    pg.screenshot(path='/tmp/shots/40-account-language-ready.png')
    row.locator('.use-language').click(); pg.wait_for_timeout(600)
    check('"Use Java" closes the panel and selects Java', pg.is_hidden('#account-panel.open') and pg.input_value('#language-select')=='java')
    ed=pg.input_value('#editor'); check('the editor holds a JAVA starter, not leftover Python', 'public class Main' in ed and 'def main' not in ed, ed[:80])
    pg.click('#run-button'); wait_done(pg, 40); t=tx(pg); check('the Java program runs and prints', '$ javac Main.java && java Main' in t and 'exit code 0' in t, repr(t))
    # ---------------- 2. changing language never leaves foreign code behind ----------------
    pg.select_option('#language-select','python'); pg.wait_for_timeout(500)
    check('untouched Java starter -> switching to Python gives a Python starter in place', 'def main' in pg.input_value('#editor') and pg.locator('#program-list > *').count()==1, pg.input_value('#editor')[:50])
    pg.fill('#editor','print("my own work")\n'); pg.select_option('#language-select','java'); pg.wait_for_timeout(600)
    check('with your own code -> a NEW Java program opens, your Python is kept', pg.locator('#program-list > *').count()==2 and 'public class Main' in pg.input_value('#editor'), pg.locator('#program-list > *').count())
    check('...and says so', 'still in My programs' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    pg.click('#run-button'); wait_done(pg, 40); check('that Java program also runs', 'exit code 0' in tx(pg), repr(tx(pg)))
    # ---------------- 3. packages: tested right after adding ----------------
    pg.select_option('#language-select','python'); pg.wait_for_timeout(400)
    pg.click('#signin-button'); pg.wait_for_selector('#account-panel.open'); pg.select_option('#package-language','python')
    pg.fill('#package-name','six'); pg.click('#account-add-package')
    pg.wait_for_function("document.querySelector('.package-row .package-state')?.textContent.includes('Works')", timeout=90000)
    check('a good package shows "Works" after the automatic test', 'Works' in pg.locator('.package-row:has-text("six") .package-state').inner_text())
    pg.fill('#package-name','surely-not-a-real-package-zzq'); pg.click('#account-add-package')
    pg.wait_for_function("[...document.querySelectorAll('.package-row')].find(r=>r.textContent.includes('surely'))?.querySelector('.package-state')?.textContent.includes('\\u2717')", timeout=90000)
    bad=pg.locator('.package-row:has-text("surely") .package-state').inner_text(); check('a bad package shows the REAL reason and that it is skipped', 'No matching distribution' in bad and 'skipped' in bad, bad)
    pg.screenshot(path='/tmp/shots/41-package-status.png')
    pg.locator('.package-row:has-text("six") button:has-text("Test")').click(); pg.wait_for_function("[...document.querySelectorAll('.package-row')].find(r=>r.textContent.startsWith('six'))?.querySelector('.package-state')?.textContent.includes('Works')", timeout=90000)
    check('the Test button re-tests', True)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.fill('#editor','import six\nprint("six", six.__version__)\n'); pg.click('#run-button'); wait_done(pg, 90); t=tx(pg)
    check('the good package works in a run even with a bad one saved', 'six 1.17.0' in t and 'exit code 0' in t, repr(t))
    check('...and the bad one is reported inside the terminal, not fatal', 'surely-not-a-real-package-zzq' in t and 'skipped' in t.lower(), repr(t[:300]))
    # ---------------- 4. first-time compiler setup (backend never ran /setup) ----------------
    open('/tmp/e2e/NO_TOOLCHAIN','w').write('1')
    pg2,errs2=page(session(UA,'alice@example.com')); pg2.wait_for_timeout(800)
    pg2.click('#signin-button'); pg2.wait_for_selector('#account-panel.open'); pg2.wait_for_timeout(600)
    jrow=pg2.locator('.language-row:has(.language-info > span:text-is("Java"))'); check('Java (added earlier) is flagged as needing the one-time setup', 'one-time compiler setup' in jrow.inner_text() and jrow.locator('button:has-text("Set up now")').count()==1, jrow.inner_text())
    pg2.screenshot(path='/tmp/shots/42-account-needs-setup.png')
    pg2.keyboard.press('Escape'); pg2.wait_for_timeout(300)
    pg2.select_option('#language-select','java'); pg2.wait_for_timeout(500)
    if 'public class Main' not in pg2.input_value('#editor'): pg2.fill('#editor','public class Main { public static void main(String[] a){ System.out.println("compilers ready"); } }')
    pg2.click('#run-button'); pg2.wait_for_function("document.querySelector('#console-output .term-pre')?.textContent.includes('prepared for the first time')", timeout=30000)
    check('first Java run explains the one-time setup (not a dead end)', 'being prepared for the first time' in tx(pg2) and 'Preparing' in pg2.inner_text('#result-state'), (tx(pg2), pg2.inner_text('#result-state')))
    pg2.screenshot(path='/tmp/shots/43-terminal-preparing.png')
    open('/tmp/e2e/SETUP_DONE','w').write('1')           # the "setup" finishes
    try: pg2.wait_for_function("document.querySelector('#console-output .term-pre')?.textContent.includes('Process finished')", timeout=60000)
    except Exception: pass
    t=tx(pg2); check('when setup completes the program starts BY ITSELF (no second click) and runs', 'Hello from Draco Code' in t and 'exit code 0' in t, repr(t))
    e2=[e for e in errs2 if '503' not in e]; check('no JS errors (the 503 is the expected "being prepared" answer)', not errs and not e2, (errs[:2], e2[:2]))
    br.close()
for f in ('NO_TOOLCHAIN','SETUP_DONE'):
    try: os.remove('/tmp/e2e/'+f)
    except FileNotFoundError: pass
print('\nFAILED:' if fails else '\nALL LANGUAGE + PACKAGE CHECKS PASSED', fails or ''); sys.exit(1 if fails else 0)
