"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { terminalFontSize, useChatAppearance } from "@/hooks/useChatAppearance";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import { setTerminalTheme, useTerminalTheme } from "@/hooks/useTerminalTheme";
import { TERMINAL_XTERM_THEMES } from "@/lib/terminal-theme";
import { applyTerminalModifiers, NO_TERMINAL_MODIFIERS, terminalExtraKeySequence, type TerminalExtraKey, type TerminalModifier, type TerminalModifiers } from "@/lib/terminal-extra-keys";
import { TerminalExtraKeys, useTerminalExtraKeysVisible } from "./TerminalExtraKeys";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useI18n } from "@/hooks/useI18n";
import { createTerminalWriter, terminalRequest } from "@/lib/terminal-client";
import type { TerminalEvent } from "@/lib/terminal-manager";
import type { TerminalTab } from "./terminal-tab-state";

const TERMINAL_FONT_KEY = "pi-web:terminal-font";
type TerminalFont = "nerd" | "system";

interface Props {
  tab: TerminalTab;
  active: boolean;
  onRestart: () => void;
  onClosed: () => void;
  onCloseError: () => void;
}

export function TerminalPanel({ tab, active, onRestart, onClosed, onCloseError }: Props) {
  const { t } = useI18n();
  const { id, cwd, restored } = tab;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [font, setFont] = useState<TerminalFont>("nerd");
  const fontRef = useRef(font);
  fontRef.current = font;
  const startRef = useRef<Promise<void>>(Promise.resolve());
  const writerRef = useRef<ReturnType<typeof createTerminalWriter> | null>(null);
  const closingRef = useRef(Boolean(tab.closing));
  closingRef.current = Boolean(tab.closing);
  const disconnectRef = useRef<(() => void) | null>(null);
  const callbacksRef = useRef({ onClosed, onCloseError });
  callbacksRef.current = { onClosed, onCloseError };
  const [status, setStatus] = useState<"connecting" | "ready" | "exited" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [modifiers, setModifiers] = useState<TerminalModifiers>(NO_TERMINAL_MODIFIERS);
  const modifiersRef = useRef(modifiers);
  const showExtraKeys = useTerminalExtraKeysVisible();
  const theme = useTerminalTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const fontSize = terminalFontSize(useChatAppearance().fontSize);
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const { mono: monoFamily, monoWeight } = useFontPreferences();
  const monoWeightRef = useRef(monoWeight);
  monoWeightRef.current = monoWeight;
  const refitRef = useRef<() => void>(() => {});
  const consumeModifiers = useCallback(() => {
    const current = modifiersRef.current;
    if (current.ctrl || current.alt) {
      modifiersRef.current = NO_TERMINAL_MODIFIERS;
      setModifiers(NO_TERMINAL_MODIFIERS);
    }
    return current;
  }, []);
  const sendExtraKey = (key: TerminalExtraKey) => {
    const terminal = terminalRef.current;
    if (!terminal || terminal.options.disableStdin) return;
    terminal.input(terminalExtraKeySequence(key, consumeModifiers(), terminal.modes.applicationCursorKeysMode), true);
  };
  const toggleModifier = (modifier: TerminalModifier) => {
    const next = { ...modifiersRef.current, [modifier]: !modifiersRef.current[modifier] };
    modifiersRef.current = next;
    setModifiers(next);
  };

  useEffect(() => {
    try {
      if (localStorage.getItem(TERMINAL_FONT_KEY) === "system") setFont("system");
    } catch { /* Storage can be unavailable in private browsing. */ }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let events: EventSource | null = null;
    let offset: number | undefined;
    let connected = false;
    let exited = false;
    let inputFailed = false;
    setStatus("connecting");
    setError(null);
    setExitCode(null);

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: fontRef.current === "nerd"
        ? '"Pi Web Nerd Font", monospace'
        : getComputedStyle(container).getPropertyValue("--font-mono").trim() || "monospace",
      fontSize: fontSizeRef.current,
      fontWeight: monoWeightRef.current,
      lineHeight: 1.25,
      scrollback: 8000,
      screenReaderMode: true,
      disableStdin: true,
      theme: TERMINAL_XTERM_THEMES[themeRef.current],
    });
    terminalRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    fitRef.current = fit;
    terminal.open(container);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "v") return false;
      if ((event.ctrlKey || event.metaKey) && key === "c" && terminal.hasSelection()) return false;
      return true;
    });

    const writer = createTerminalWriter(id, (reason) => {
      if (disposed) return;
      inputFailed = true;
      terminal.options.disableStdin = true;
      setError(reason.message);
      setStatus("error");
    });
    writerRef.current = writer;
    const onData = terminal.onData((data) => {
      if (connected && !exited && !inputFailed) writer.write(applyTerminalModifiers(data, consumeModifiers()));
    });
    let appliedFont = "";
    let fontLoadGeneration = 0;
    let needsRemeasure = true;
    const fitAndResize = () => {
      // xterm's DOM fallback retains old nonzero glyph measurements while hidden.
      // Apply metrics only when measurable, including after a retained tab is revealed.
      if (disposed || terminalRef.current !== terminal || !container.offsetWidth || !container.offsetHeight) return;
      const fontFamily = fontRef.current === "nerd"
        ? '"Pi Web Nerd Font", monospace'
        : getComputedStyle(container).getPropertyValue("--font-mono").trim() || "monospace";
      const fontWeight = monoWeightRef.current;
      const size = fontSizeRef.current;
      const key = JSON.stringify([fontFamily, fontWeight, size]);
      if (key !== appliedFont) {
        appliedFont = key;
        terminal.options.fontFamily = fontFamily;
        terminal.options.fontWeight = fontWeight;
        terminal.options.fontSize = size;
        needsRemeasure = true;
        const generation = ++fontLoadGeneration;
        // Fallback is fitted immediately. Delayed font readiness remeasures the
        // same instance; obsolete completions cannot touch a replacement terminal.
        void document.fonts.load(`${fontWeight} ${size}px ${fontFamily}`).catch(() => []).then(() => {
          if (disposed || generation !== fontLoadGeneration || terminalRef.current !== terminal) return;
          needsRemeasure = true;
          fitAndResize();
        });
      }
      if (needsRemeasure) {
        needsRemeasure = false;
        // Public size changes force glyph remeasurement; fit alone and weight
        // changes do not. No intermediate fit/PTY resize is emitted.
        terminal.options.fontSize = size + 1;
        terminal.options.fontSize = size;
      }
      fit.fit();
    };
    const onResize = terminal.onResize(({ cols, rows }) => {
      if (!connected || exited || inputFailed) return;
      writer.resize(Math.max(2, cols), Math.max(2, rows));
    });
    refitRef.current = fitAndResize;
    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(container);

    const connect = () => {
      // Internet-interface state is advisory: loopback can remain reachable offline.
      // Let the real transport determine whether this terminal can reconnect.
      if (disposed || closingRef.current || exited) return;
      events?.close();
      events = new EventSource(`/api/terminal/${encodeURIComponent(id)}/events${offset === undefined ? "" : `?after=${offset}`}`);
      events.onmessage = (message) => {
        const event = JSON.parse(message.data) as TerminalEvent;
        if (event.type === "output") {
          if (event.reset) terminal.reset();
          else if (offset !== undefined && event.offset <= offset) return;
          terminal.write(event.data);
          offset = event.offset;
        } else {
          exited = true;
          connected = false;
          terminal.options.disableStdin = true;
          events?.close();
          setExitCode(event.type === "exit" ? event.exitCode : null);
          setStatus("exited");
        }
      };
      events.onopen = () => {
        if (disposed || closingRef.current || exited) return;
        connected = true;
        if (inputFailed) return;
        terminal.options.disableStdin = false;
        setStatus("ready");
        fitAndResize();
        writer.resize(Math.max(2, terminal.cols), Math.max(2, terminal.rows));
        if (container.offsetWidth && container.offsetHeight) terminal.focus();
      };
      events.onerror = () => {
        if (disposed || closingRef.current || exited) return;
        connected = false;
        terminal.options.disableStdin = true;
        setStatus(events?.readyState === EventSource.CLOSED ? "error" : "connecting");
      };
    };

    startRef.current = (async () => {
      fitAndResize();
      if (restored || reconnectKey > 0) {
        // Restoring a tab must never silently launch a replacement shell.
        await terminalRequest(`/api/terminal/${encodeURIComponent(id)}`);
      } else {
        await terminalRequest("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, cwd, cols: terminal.cols, rows: terminal.rows }),
        });
      }
      connect();
    })().catch((reason: Error) => {
      if (disposed) return;
      setError(reason.message);
      setStatus("error");
    });

    const pageHide = () => {
      connected = false;
      terminal.options.disableStdin = true;
      events?.close();
      if (!exited && !inputFailed) setStatus("connecting");
    };
    disconnectRef.current = pageHide;
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) connect(); };
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("offline", pageHide);
    window.addEventListener("online", connect);
    return () => {
      disposed = true;
      if (disconnectRef.current === pageHide) disconnectRef.current = null;
      events?.close();
      void writer.stop();
      resizeObserver.disconnect();
      onData.dispose();
      onResize.dispose();
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", pageShow);
      window.removeEventListener("offline", pageHide);
      window.removeEventListener("online", connect);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      refitRef.current = () => {};
    };
  }, [id, cwd, restored, reconnectKey, consumeModifiers]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = TERMINAL_XTERM_THEMES[theme];
  }, [theme]);
  // Appearance owns only live options/geometry, never transport or PTY lifetime.
  useEffect(() => {
    refitRef.current();
  }, [font, monoFamily, monoWeight, fontSize]);

  useEffect(() => {
    if (active) {
      refitRef.current();
      terminalRef.current?.focus();
    }
  }, [active]);

  useEffect(() => {
    if (!tab.closing) return;
    let cancelled = false;
    // Disconnect before creation/drain completes: its continuation must not
    // race DELETE with a new subscription to the terminal being removed.
    disconnectRef.current?.();
    if (terminalRef.current) terminalRef.current.options.disableStdin = true;
    void (async () => {
      await startRef.current;
      await writerRef.current?.stop();
      await terminalRequest(`/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true });
      if (!cancelled) callbacksRef.current.onClosed();
    })().catch((reason: Error) => {
      if (cancelled) return;
      setError(reason.message);
      setStatus("error");
      callbacksRef.current.onCloseError();
    });
    return () => { cancelled = true; };
  }, [id, tab.closing]);

  return (
    <section className="terminal-panel" data-terminal-theme={theme} aria-label={t("terminal.title")}>
      <header className="terminal-panel-header">
        <div className="terminal-panel-path">
          <span className={`terminal-status-dot is-${status}`} title={t(`terminal.${status}`)} />
          <span title={cwd}>{cwd}</span>
        </div>
        <label className="terminal-font-choice">
          {t("terminal.font")}
          <select
            aria-label={t("terminal.font")}
            value={font}
            onChange={(event) => {
              const next = event.target.value as TerminalFont;
              setFont(next);
              try { localStorage.setItem(TERMINAL_FONT_KEY, next); }
              catch { /* Continue without persistence. */ }
            }}
          >
            <option value="nerd">{t("terminal.fontNerd")}</option>
            <option value="system">{t("terminal.fontSystem")}</option>
          </select>
        </label>
        {status === "error" && (
          <button type="button" onClick={() => setReconnectKey((key) => key + 1)} disabled={Boolean(tab.closing)} title={t("terminal.reconnect")} aria-label={t("terminal.reconnect")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" />
            </svg>
          </button>
        )}
        <button type="button" onClick={() => setTerminalTheme(theme === "dark" ? "light" : "dark")} title={t(theme === "dark" ? "terminal.lightTheme" : "terminal.darkTheme")} aria-label={t(theme === "dark" ? "terminal.lightTheme" : "terminal.darkTheme")}>
          <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
        </button>
        <button type="button" onClick={onRestart} disabled={Boolean(tab.closing)} title={t("terminal.restart")} aria-label={t("terminal.restart")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.34 5.66" /><polyline points="20 4 20 11 13 11" />
          </svg>
        </button>
      </header>
      <div>
        {error && <div className="terminal-panel-error" role="alert">{error}</div>}
        {status === "exited" && <div className="terminal-panel-exit" role="status">{exitCode === null ? t("terminal.exited") : t("terminal.exitCode", { code: exitCode })}</div>}
      </div>
      <div className="terminal-xterm"><div ref={containerRef} className="terminal-xterm-host" /></div>
      {active && showExtraKeys && <TerminalExtraKeys modifiers={modifiers} onKey={sendExtraKey} onToggleModifier={toggleModifier} />}
    </section>
  );
}
