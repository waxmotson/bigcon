'use strict';
/* app: the composition root. Connects the DOM-free rules engine to the browser layer
   (net.js, ui.js, core.js) through the hooks interface (hooks.js) and boots the page.
   No module in the graph does anything at import time except declare things; this is
   the one place where the pieces are wired, and the harness in tests/ calls the very
   same installHooks()/boot() against a stub DOM. */
import { setHooks } from './hooks.js';
import { announceAll, askPlayer, loadTransportSettings, revealAll, sendBegin, sync, sysTo } from './net.js';
import { initUI, modal, render, showGame, toast } from './ui.js';
import { Presence, initCore } from './core.js';
import { mountIntro } from './intro.js';

/* `extra` carries optional hooks the page decides on, e.g. {bots: () => BigConBots}. */
export function installHooks(extra) {
  setHooks({
    /* host services — net.js */
    sync, sysTo, askPlayer, announceAll, revealAll, beginGame: sendBegin,
    /* presentation — ui.js */
    showGame, toast, modal, render,
    gameOver: (name, char, scores) => Presence.gameOver(name, char, scores),
    /* a fixed bot seed requested by the host page (debugging / reproducible runs); 0 = random */
    botSeed: () => (window.__BIGCON_BOT_SEED__ | 0) || 0,
    ...extra,
  });
}

/* Everything that used to run as load-time side effects of the classic scripts,
   in one explicit, ordered place. */
export function boot() {
  initCore();            /* build stamp + splash-logo fallback */
  loadTransportSettings(); /* restore the saved connection system */
  initUI();              /* listeners, setup screen, Discord join bridge, presence menu */
  if (typeof document !== 'undefined' && document.getElementById) mountIntro(document.getElementById('splashIntro')); /* the splash animation */
}
