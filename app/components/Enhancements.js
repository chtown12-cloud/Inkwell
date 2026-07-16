"use client";
/* ═══════════════════════════════════════════════════════════════════════
   INKWELL — ENHANCEMENTS MODULE
   Command palette, easter eggs, accessibility hooks, changelog scroll,
   undo-capable toasts. Imported by app/page.js.
   ═══════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   HOOK — useAutoTheme: respects prefers-color-scheme when user hasn't
   manually overridden. userOverride null = auto.
   ═══════════════════════════════════════════════════════════════════════ */
export function useAutoTheme(userOverride) {
  const [systemDark, setSystemDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (e) => setSystemDark(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return userOverride == null ? systemDark : userOverride;
}

/* ═══════════════════════════════════════════════════════════════════════
   HOOK — useMidnight: returns true between 12:00–01:00 local.
   ═══════════════════════════════════════════════════════════════════════ */
export function useMidnight() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const check = () => {
      const h = new Date().getHours();
      setActive(h === 0);
    };
    check();
    const iv = setInterval(check, 60_000);
    return () => clearInterval(iv);
  }, []);
  return active;
}

/* ═══════════════════════════════════════════════════════════════════════
   HOOK — useKonami: fires cb() when ↑↑↓↓←→←→BA typed in order.
   ═══════════════════════════════════════════════════════════════════════ */
const KONAMI = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","b","a"];
export function useKonami(cb) {
  const ref = useRef([]);
  const cbRef = useRef(cb);
  useEffect(() => { cbRef.current = cb; }, [cb]);
  useEffect(() => {
    const on = (e) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      ref.current = [...ref.current, key].slice(-KONAMI.length);
      if (ref.current.length === KONAMI.length &&
          ref.current.every((k, i) => k === KONAMI[i])) {
        cbRef.current?.();
        ref.current = [];
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}

/* ═══════════════════════════════════════════════════════════════════════
   HOOK — useLongPress: returns event handlers; fires onLong() after
   `ms` ms of continuous press without movement.
   ═══════════════════════════════════════════════════════════════════════ */
export function useLongPress(onLong, { ms = 600, moveTolerance = 10 } = {}) {
  const timer = useRef(null);
  const start = useRef(null);
  const cancel = () => { clearTimeout(timer.current); timer.current = null; start.current = null; };
  const down = (e) => {
    const p = e.touches?.[0] || e;
    start.current = { x: p.clientX, y: p.clientY };
    timer.current = setTimeout(() => { onLong?.(e); timer.current = null; }, ms);
  };
  const move = (e) => {
    if (!start.current) return;
    const p = e.touches?.[0] || e;
    const dx = Math.abs(p.clientX - start.current.x);
    const dy = Math.abs(p.clientY - start.current.y);
    if (dx > moveTolerance || dy > moveTolerance) cancel();
  };
  return {
    onMouseDown: down, onMouseUp: cancel, onMouseLeave: cancel, onMouseMove: move,
    onTouchStart: down, onTouchEnd: cancel, onTouchCancel: cancel, onTouchMove: move,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   HELPER — renderCoffee: replace :coffee: with a steaming mug span.
   Returns array of React children.
   ═══════════════════════════════════════════════════════════════════════ */
export function renderCoffee(text) {
  if (!text || typeof text !== "string" || !text.includes(":coffee:")) return text;
  const parts = text.split(":coffee:");
  const out = [];
  parts.forEach((p, i) => {
    out.push(p);
    if (i < parts.length - 1) {
      out.push(
        <span key={`c-${i}`} className="coffee-mug" style={{display:"inline-block",position:"relative",width:"1.1em",height:"1.1em",verticalAlign:"-0.2em",margin:"0 0.05em"}} aria-label="coffee">
          <span style={{fontSize:"1em",filter:"saturate(1.3)"}}>☕</span>
          <span style={{position:"absolute",top:"-0.4em",left:"0.2em",width:"0.25em",height:"0.5em",background:"currentColor",opacity:0.35,borderRadius:"50%",animation:"steam 1.8s ease-in-out infinite"}}/>
          <span style={{position:"absolute",top:"-0.5em",left:"0.55em",width:"0.22em",height:"0.45em",background:"currentColor",opacity:0.3,borderRadius:"50%",animation:"steam 1.8s ease-in-out infinite 0.6s"}}/>
        </span>
      );
    }
  });
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════
   COMPONENT — ConfettiInk: triggers a burst when `trigger` changes.
   ═══════════════════════════════════════════════════════════════════════ */
export function ConfettiInk({ trigger }) {
  const [pieces, setPieces] = useState([]);
  useEffect(() => {
    if (!trigger) return;
    const colors = ["#b45309","#d97706","#1a2238","#5b7fa8","#7b7968"];
    const batch = Array.from({ length: 38 }, (_, i) => ({
      id: `${trigger}-${i}`,
      left: 20 + Math.random() * 60,
      cx: (Math.random() - 0.5) * 420,
      size: 6 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      delay: Math.random() * 0.15,
      dur: 1.6 + Math.random() * 1.2,
      rot: Math.random() * 360,
    }));
    setPieces(batch);
    const t = setTimeout(() => setPieces([]), 3200);
    return () => clearTimeout(t);
  }, [trigger]);
  if (!pieces.length) return null;
  return (
    <div aria-hidden="true" style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:2400,overflow:"hidden"}}>
      {pieces.map(p => (
        <span key={p.id} className="confetti-ink-piece" style={{
          position:"absolute",
          top:"-20px",
          left:`${p.left}%`,
          width:`${p.size}px`,
          height:`${p.size * 1.6}px`,
          background:p.color,
          borderRadius:"2px",
          transform:`rotate(${p.rot}deg)`,
          animation:`confettiFall ${p.dur}s cubic-bezier(.4,.1,.6,1) ${p.delay}s forwards`,
          "--cx":`${p.cx}px`,
        }}/>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   COMPONENT — MidnightMoon: shows during midnight hour.
   ═══════════════════════════════════════════════════════════════════════ */
export function MidnightMoon({ show }) {
  if (!show) return null;
  return (
    <svg className="midnight-moon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"
        fill="#e9e6d9" stroke="#c8c3b2" strokeWidth="1"/>
      <circle cx="14" cy="9" r="0.7" fill="#c8c3b2" opacity="0.6"/>
      <circle cx="17" cy="13" r="0.5" fill="#c8c3b2" opacity="0.5"/>
      <circle cx="13" cy="14" r="0.4" fill="#c8c3b2" opacity="0.4"/>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   HOOK — useInkSpatter: call spatter(x, y) to drop 5 ink dots at that
   spot. Active only when quill mode is on (handled by caller).
   ═══════════════════════════════════════════════════════════════════════ */
export function useInkSpatter() {
  const spatter = useCallback((x, y) => {
    if (typeof document === "undefined") return;
    for (let i = 0; i < 6; i++) {
      const dot = document.createElement("span");
      dot.className = "ink-spatter";
      const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.4;
      const dist = 18 + Math.random() * 30;
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      dot.style.setProperty("--spatter-end", `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`);
      dot.style.width = dot.style.height = `${3 + Math.random() * 4}px`;
      document.body.appendChild(dot);
      setTimeout(() => dot.remove(), 900);
    }
  }, []);
  return spatter;
}

/* ═══════════════════════════════════════════════════════════════════════
   COMPONENT — CommandPalette
   Props: open, onClose, commands[] (each: {id, label, hint?, run, group?, icon?})
   Keyboard: ↑↓ navigate, Enter runs, Esc closes, typing filters.
   ═══════════════════════════════════════════════════════════════════════ */
export function CommandPalette({ open, onClose, commands }) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!q.trim()) return commands;
    const needle = q.toLowerCase();
    return commands
      .map(c => {
        const hay = `${c.label} ${c.hint || ""} ${c.group || ""}`.toLowerCase();
        const i = hay.indexOf(needle);
        if (i === -1) return null;
        return { ...c, _rank: i };
      })
      .filter(Boolean)
      .sort((a, b) => a._rank - b._rank);
  }, [q, commands]);

  useEffect(() => { setCursor(0); }, [q]);

  if (!open) return null;

  const runAt = (i) => {
    const c = filtered[i];
    if (!c) return;
    onClose();
    setTimeout(() => c.run(), 0);
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); runAt(cursor); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Command palette"
      onClick={onClose}
      style={{position:"fixed",inset:0,background:"var(--overlay)",backdropFilter:"blur(8px)",zIndex:3000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"10vh 16px 16px",animation:"fadeIn 0.15s ease"}}>
      <div onClick={e=>e.stopPropagation()}
        style={{width:"100%",maxWidth:560,background:"var(--card)",borderRadius:"var(--radius-lg)",border:"1px solid var(--border)",boxShadow:"var(--shadow-3)",overflow:"hidden",fontFamily:"var(--font-body)",animation:"toastIn 0.18s ease"}}>
        <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border-light)",display:"flex",alignItems:"center",gap:10}}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
          <input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Type a command or search…"
            aria-label="Command"
            style={{flex:1,border:"none",outline:"none",background:"transparent",fontSize:16,color:"var(--ink)",fontFamily:"inherit"}}/>
          <kbd className="kbd" style={{fontSize:11,padding:"3px 7px",borderRadius:6,background:"var(--surface)",border:"1px solid var(--border)",color:"var(--muted)"}}>Esc</kbd>
        </div>
        <div ref={listRef} role="listbox" aria-label="Commands"
          style={{maxHeight:"50vh",overflowY:"auto",padding:"6px 0"}}>
          {filtered.length === 0 ? (
            <div style={{padding:"28px 16px",textAlign:"center",color:"var(--muted)",fontSize:14}}>No matches</div>
          ) : filtered.map((c, i) => (
            <button key={c.id}
              onClick={()=>runAt(i)}
              onMouseEnter={()=>setCursor(i)}
              role="option"
              aria-selected={i === cursor}
              style={{width:"100%",textAlign:"left",border:"none",background:i===cursor?"var(--accent-a10)":"transparent",color:"var(--ink)",padding:"10px 16px",display:"flex",alignItems:"center",gap:12,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>
              {c.icon && <span style={{display:"flex",flexShrink:0,color:i===cursor?"var(--accent)":"var(--muted)"}}>{c.icon}</span>}
              <span style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:500,color:"var(--ink)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.label}</div>
                {c.hint && <div style={{fontSize:12,color:"var(--muted)",marginTop:1}}>{c.hint}</div>}
              </span>
              {c.group && <span style={{fontSize:11,color:"var(--muted)",padding:"2px 7px",borderRadius:6,background:"var(--surface)",border:"1px solid var(--border)",whiteSpace:"nowrap"}}>{c.group}</span>}
            </button>
          ))}
        </div>
        <div style={{padding:"8px 14px",borderTop:"1px solid var(--border-light)",fontSize:11,color:"var(--muted)",display:"flex",gap:14,alignItems:"center"}}>
          <span><kbd className="kbd" style={{padding:"1px 5px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:4,fontSize:10}}>↑↓</kbd> navigate</span>
          <span><kbd className="kbd" style={{padding:"1px 5px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:4,fontSize:10}}>↵</kbd> run</span>
          <span style={{marginLeft:"auto"}}><kbd className="kbd" style={{padding:"1px 5px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:4,fontSize:10}}>⌘K</kbd> to open</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   HOOK — useUndoToast: returns { toast, show, render }
   show(message, undoFn) displays a toast with an Undo button for 5s.
   render() returns the toast JSX — mount once at root.
   ═══════════════════════════════════════════════════════════════════════ */
export function useUndoToast() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const show = useCallback((message, undoFn, { duration = 5000 } = {}) => {
    clearTimeout(timerRef.current);
    const id = Date.now();
    setToast({ id, message, undoFn });
    timerRef.current = setTimeout(() => {
      setToast(t => (t?.id === id ? null : t));
    }, duration);
  }, []);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const render = () => toast && (
    <div role="status" aria-live="polite"
      style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"var(--ink)",color:"var(--bg)",padding:"10px 8px 10px 18px",borderRadius:"var(--radius-lg)",fontSize:14,fontWeight:500,boxShadow:"var(--shadow-2)",zIndex:2200,display:"flex",alignItems:"center",gap:12,animation:"toastIn 0.25s ease",maxWidth:"calc(100vw - 32px)",fontFamily:"var(--font-body)"}}>
      <span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"60vw"}}>{toast.message}</span>
      {toast.undoFn && (
        <button onClick={() => { toast.undoFn(); dismiss(); }}
          style={{background:"var(--accent)",color:"#fff",border:"none",padding:"6px 14px",borderRadius:"var(--radius-pill)",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
          Undo
        </button>
      )}
      <button onClick={dismiss} aria-label="Dismiss"
        style={{background:"transparent",border:"none",color:"inherit",opacity:0.6,cursor:"pointer",padding:4,display:"flex"}}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
  );

  return { show, dismiss, render, active: !!toast };
}

/* ═══════════════════════════════════════════════════════════════════════
   COMPONENT — ChangelogScroll
   Revealed by long-pressing the logo. Parchment scroll animation.
   ═══════════════════════════════════════════════════════════════════════ */
const CHANGELOG = [
  {
    v: "2026.04.17",
    title: "The Glow-Up",
    notes: [
      "Warm inkwell palette: cream paper + deep ink navy",
      "Fraunces serif for headings, Inter Tight body, JetBrains Mono for dates",
      "Paper texture + deckled card edges",
      "Command palette — ⌘K to jump anywhere",
      "Undo-friendly toasts",
      "Accessibility: skip link, dyslexic-font toggle, text-size scale",
      "Auto light/dark by system preference",
      "Easter eggs: Konami quill mode, midnight moon, :coffee: emoji, completion streak confetti",
    ],
  },
  {
    v: "2026.04.15",
    title: "Stability pass",
    notes: ["Cloud sync hardening", "Offline merge utilities"],
  },
];

export function ChangelogScroll({ open, onClose }) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Changelog"
      onClick={onClose}
      style={{position:"fixed",inset:0,background:"var(--overlay)",backdropFilter:"blur(6px)",zIndex:3100,display:"flex",alignItems:"center",justifyContent:"center",padding:16,animation:"fadeIn 0.2s ease"}}>
      <div onClick={e=>e.stopPropagation()}
        style={{maxWidth:520,width:"100%",maxHeight:"80vh",overflowY:"auto",background:"var(--card)",borderRadius:"var(--radius-xl)",border:"1px solid var(--border)",boxShadow:"var(--shadow-3)",padding:"28px 28px 22px",animation:"scrollRoll 0.4s cubic-bezier(.25,.8,.3,1) forwards",transformOrigin:"top center",fontFamily:"var(--font-body)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <h2 style={{margin:0,fontSize:22,fontFamily:"var(--font-display)",color:"var(--ink)",fontWeight:600}}>The Scroll</h2>
          <button onClick={onClose} aria-label="Close"
            style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:6,display:"flex",borderRadius:8}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <p style={{fontSize:13,color:"var(--muted)",marginBottom:20,fontStyle:"italic"}}>A handwritten log of Inkwell's journey.</p>
        {CHANGELOG.map((entry) => (
          <div key={entry.v} style={{marginBottom:22,paddingBottom:16,borderBottom:"1px solid var(--border-light)"}}>
            <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:8}}>
              <span className="font-mono" style={{fontSize:12,color:"var(--muted)",fontFamily:"var(--font-mono)"}}>{entry.v}</span>
              <h3 style={{margin:0,fontSize:16,fontWeight:600,fontFamily:"var(--font-display)",color:"var(--ink)"}}>{entry.title}</h3>
            </div>
            <ul style={{listStyle:"none",padding:0,margin:0}}>
              {entry.notes.map((n,i) => (
                <li key={i} style={{fontSize:14,color:"var(--text)",padding:"4px 0",display:"flex",gap:10,lineHeight:1.55}}>
                  <span style={{color:"var(--accent)",flexShrink:0,fontWeight:700}}>·</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div style={{textAlign:"center",fontSize:12,color:"var(--muted)",fontStyle:"italic",marginTop:6}}>
          Long-press the logo anytime to unroll this.
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   HOOK — useA11yPrefs: persists dyslexic font + text-size, applies to
   <body data-*> attributes. Returns { dyslexic, setDyslexic, textSize,
   setTextSize }.
   ═══════════════════════════════════════════════════════════════════════ */
const TEXT_SIZES = ["sm", "md", "lg", "xl"];
export function useA11yPrefs() {
  const [dyslexic, setDyslexic] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem("inkwell-a11y-dyslexic") === "1"; } catch { return false; }
  });
  const [textSize, setTextSize] = useState(() => {
    if (typeof window === "undefined") return "md";
    try { return localStorage.getItem("inkwell-a11y-textsize") || "md"; } catch { return "md"; }
  });
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.setAttribute("data-dyslexic", dyslexic ? "true" : "false");
    try { localStorage.setItem("inkwell-a11y-dyslexic", dyslexic ? "1" : "0"); } catch {}
  }, [dyslexic]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const v = TEXT_SIZES.includes(textSize) ? textSize : "md";
    document.body.setAttribute("data-text-size", v);
    try { localStorage.setItem("inkwell-a11y-textsize", v); } catch {}
  }, [textSize]);
  return { dyslexic, setDyslexic, textSize, setTextSize };
}
