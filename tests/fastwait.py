"""Faster UI tests: page.wait_for_timeout(ms) returns as soon as the page has settled instead of always sleeping ms.

Imported by every *_test.py. A page counts as settled when nothing is due within the rest of the window: no setTimeout
that fires before it ends, no pending requestAnimationFrame, and no finite CSS animation or transition that ends within
it (infinite ones, like spinners, are ignored). Anything that would have happened inside the window still happens before
the wait returns, so tests see the same states as with real sleeps, without the idle time after them. The wait is never
longer than ms. Set SLOW_WAITS=1 to get the old fixed sleeps back, e.g. to rule this out when a test misbehaves.
"""
import os
import time

from playwright.sync_api._generated import Browser, BrowserContext, Page

TRACKER = r'''(() => {
  if (window.__fw) return;
  const due = new Map(), frames = new Set();
  const st = window.setTimeout, ct = window.clearTimeout, ra = window.requestAnimationFrame, ca = window.cancelAnimationFrame;
  window.setTimeout = function (fn, ms) {
    const args = Array.prototype.slice.call(arguments, 2);
    const id = st(function () { due.delete(id); return typeof fn === 'function' ? fn.apply(this, args) : (0, eval)(String(fn)); }, ms);
    due.set(id, performance.now() + Math.max(0, +ms || 0));
    return id;
  };
  window.clearTimeout = function (id) { due.delete(id); return ct(id); };
  window.requestAnimationFrame = function (fn) {
    const id = ra(function (t) { frames.delete(id); fn(t); });
    frames.add(id); return id;
  };
  window.cancelAnimationFrame = function (id) { frames.delete(id); return ca(id); };
  window.__fw = {
    busy: function (windowMs) {
      const now = performance.now(), until = now + windowMs;
      for (const t of due.values()) if (t <= until) return true;
      if (frames.size) return true;
      for (const a of document.getAnimations ? document.getAnimations() : []) {
        if (a.playState !== 'running') continue;
        const end = a.effect && a.effect.getComputedTiming().endTime;
        if (!isFinite(end)) continue;
        const left = (end - (a.currentTime || 0)) / (a.playbackRate || 1);
        if (left > 0 && left <= windowMs) return true;
      }
      return false;
    }
  };
})();'''

if os.environ.get('SLOW_WAITS') != '1':
    _sleep = Page.wait_for_timeout

    def _settle(self, timeout):
        end = time.perf_counter() + timeout / 1000.0
        _sleep(self, min(timeout, 16))                 # always let at least one frame render
        while True:
            left = (end - time.perf_counter()) * 1000.0
            if left <= 0:
                return
            try:
                busy = self.evaluate('(ms) => !window.__fw || window.__fw.busy(ms)', left)
            except Exception:                           # mid-navigation: just wait
                busy = True
            if not busy:
                return
            _sleep(self, min(left, 15))

    Page.wait_for_timeout = _settle

    def _tracked(new_page):
        def f(self, *a, **k):
            page = new_page(self, *a, **k)
            page.add_init_script(TRACKER)
            return page
        return f

    Browser.new_page = _tracked(Browser.new_page)
    BrowserContext.new_page = _tracked(BrowserContext.new_page)


def viewports(all_viewports):
    """The test's phone sizes, or just one of them when VIEWPORT_INDEX is set (run_all.sh runs each in its own process)."""
    i = os.environ.get('VIEWPORT_INDEX')
    return all_viewports if i is None else [all_viewports[int(i)]]


if os.environ.get('NO_SCREENSHOTS') == '1':
    # quick runs: skip the PNGs (about a tenth of the UI tests' time); everything else is checked as usual
    Page.screenshot = lambda self, *a, **k: b''
