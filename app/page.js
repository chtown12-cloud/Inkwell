"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "../lib/supabase";

/* ═══════════════════════════════════════════════════════════════════════
   SUPABASE AUTH + SYNC HOOK
   ═══════════════════════════════════════════════════════════════════════ */
function useSupabaseSync() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const saveTimer = useRef(null);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithEmail = async (email) => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) setAuthError(error.message);
    return !error;
  };

  const signInWithPassword = async (email, password, isSignUp) => {
    setAuthError(null);
    const { error } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
    return !error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const loadFromCloud = async () => {
    if (!supabase || !user) return null;
    const { data, error } = await supabase
      .from("user_data")
      .select("tasks, lists, settings")
      .eq("user_id", user.id)
      .single();
    if (error) { console.warn("Cloud load failed:", error.message); return null; }
    return data;
  };

  const saveToCloud = useCallback((tasks, lists, settings) => {
    if (!supabase || !user) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const { error } = await supabase
        .from("user_data")
        .upsert({ user_id: user.id, tasks, lists, settings }, { onConflict: "user_id" });
      if (error) console.warn("Cloud save failed:", error.message);
    }, 1500); /* debounce 1.5s */
  }, [user]);

  return { user, authLoading, authError, signInWithEmail, signInWithPassword, signOut, loadFromCloud, saveToCloud, hasSupabase: !!supabase };
}

/* ═══════════════════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
   ═══════════════════════════════════════════════════════════════════════ */
const TASKS_KEY = "inkwell-tasks-v2";
const LISTS_KEY = "inkwell-lists-v2";
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const todayStr = () => { const d=new Date(); return localDateStr(d); };
const tomorrowStr = () => { const d = new Date(); d.setDate(d.getDate() + 1); return localDateStr(d); };
const nextMondayStr = () => { const d = new Date(); const day = d.getDay(); const diff = day === 0 ? 1 : day === 1 ? 7 : 8 - day; d.setDate(d.getDate() + diff); return localDateStr(d); };
const dateOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDateStr(d); };

/* ═══════════════════════════════════════════════════════════════════════
   TOUCH DRAG SYSTEM — long-press to drag on mobile
   
   Architecture:
   - Draggable elements MUST have CSS touch-action: none
     (This prevents the browser from hijacking touches for scrolling
      at the compositor level, which would fire touchcancel and kill
      our 400ms long-press timer before it ever fires.)
   - When the user swipes quickly (moves >12px within 400ms), we cancel
     the drag and enter "scroll assist" mode — manually scrolling the
     nearest scrollable container via JS so the user can still scroll
     even though native scroll is disabled on task elements.
   - When drag activates, we call onSidebarShow(true) so mobile users
     can see sidebar drop targets (lists, dates).
   ═══════════════════════════════════════════════════════════════════════ */
const useTouchDrag = (onDrop, onDragStateChange, onSidebarShow) => {
  const onDropRef = useRef(onDrop);
  const onStateRef = useRef(onDragStateChange);
  const onSidebarRef = useRef(onSidebarShow);
  useEffect(() => { onDropRef.current = onDrop; }, [onDrop]);
  useEffect(() => { onStateRef.current = onDragStateChange; }, [onDragStateChange]);
  useEffect(() => { onSidebarRef.current = onSidebarShow; }, [onSidebarShow]);

  useEffect(() => {
    const s = {
      phase: "idle", /* idle | waiting | dragging | scrolling */
      dragId: null, dragSource: null, ghost: null, timer: null,
      startX: 0, startY: 0, lastY: 0, moved: false,
      lastTarget: null, srcEl: null, scrollEl: null, sidebarShown: false,
      autoScrollTimer: null, autoScrollEl: null, _scrollDir: 0
    };

    /* Track if current interaction is touch-based. When it is, prevent the
       browser's native HTML5 drag (from the 'draggable' attr) from firing,
       because on Chrome Android native drag intercepts touch events and
       kills our custom long-press-to-drag system. */
    let lastInputWasTouch = false;
    const markTouch = () => { lastInputWasTouch = true; };
    const markMouse = () => { lastInputWasTouch = false; };
    const blockNativeDrag = (e) => {
      if (lastInputWasTouch && e.target?.closest?.("[data-drag-id]")) {
        e.preventDefault();
      }
    };
    document.addEventListener("touchstart", markTouch, { passive: true, capture: true });
    document.addEventListener("mousedown", markMouse, { passive: true, capture: true });
    document.addEventListener("dragstart", blockNativeDrag, { capture: true });

    /* ── Helpers ── */
    const closest = (el, sel) => {
      if (!el) return null;
      if (el.nodeType === 3) el = el.parentElement;
      if (!el) return null;
      /* Try native closest (works on HTML elements, modern SVG) */
      try { const r = el.closest?.(sel); if (r) return r; } catch(e) {}
      /* Manual walk for old SVG engines */
      let c = el;
      while (c && c !== document.body) {
        try { if (c.matches?.(sel)) return c; } catch(e) {}
        c = c.parentElement;
      }
      return null;
    };

    const findDropTarget = (x, y) => {
      if (s.ghost) s.ghost.style.display = "none";
      const el = document.elementFromPoint(x, y);
      if (s.ghost) s.ghost.style.display = "";
      return closest(el, "[data-drop-type]");
    };

    /* Find the nearest scrollable ancestor */
    const findScrollParent = (el) => {
      let c = el?.parentElement;
      while (c && c !== document.body) {
        const ov = getComputedStyle(c).overflowY;
        if ((ov === "auto" || ov === "scroll") && c.scrollHeight > c.clientHeight) return c;
        c = c.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    };

    const clearHL = () => {
      if (s.lastTarget) {
        s.lastTarget.style.outline = "";
        s.lastTarget.style.background = s.lastTarget.dataset.dropBg || "";
        s.lastTarget = null;
      }
    };

    const reset = () => {
      clearTimeout(s.timer); s.timer = null;
      clearInterval(s.autoScrollTimer); s.autoScrollTimer = null; s.autoScrollEl = null;
      if (s.ghost) { s.ghost.remove(); s.ghost = null; }
      if (s.srcEl) { try { s.srcEl.style.opacity = ""; } catch(e){} s.srcEl = null; }
      clearHL();
      const wasDragging = s.phase === "dragging";
      s.phase = "idle"; s.dragId = null; s.dragSource = null;
      s.moved = false; s.scrollEl = null;
      document.body.style.overflow = "";
      document.body.style.userSelect = "";
      if (wasDragging) {
        if (onStateRef.current) onStateRef.current(false);
      }
      if (s.sidebarShown) {
        s.sidebarShown = false;
        if (onSidebarRef.current) onSidebarRef.current(false);
      }
    };

    const activateDrag = () => {
      if (!s.dragId || !s.srcEl) return;
      s.phase = "dragging";
      if (onStateRef.current) onStateRef.current(true);
      document.body.style.overflow = "hidden";
      document.body.style.userSelect = "none";
      /* Ghost pill */
      const rect = s.srcEl.getBoundingClientRect();
      const g = document.createElement("div");
      g.textContent = s.srcEl.dataset.dragLabel || "•";
      Object.assign(g.style, {
        position:"fixed", top:rect.top+"px", left:rect.left+"px", zIndex:"9999",
        padding:"8px 14px", background:"#1c1917", color:"white", borderRadius:"10px",
        fontSize:"13px", fontWeight:"600", fontFamily:"sans-serif",
        boxShadow:"0 8px 24px rgba(0,0,0,0.3)", pointerEvents:"none",
        whiteSpace:"nowrap", maxWidth:"200px", overflow:"hidden",
        textOverflow:"ellipsis", opacity:"0.95"
      });
      document.body.appendChild(g);
      s.ghost = g;
      s.srcEl.style.opacity = "0.3";
      try { navigator.vibrate?.(30); } catch(e){}
    };

    /* ─── TOUCH START ─── */
    const onStart = (e) => {
      if (s.phase !== "idle") return;

      const el = e.target;
      const tag = el?.tagName?.toLowerCase?.() || "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (tag === "button" || closest(el, "button")) return;

      const draggable = closest(el, "[data-drag-id]");
      if (!draggable) return;

      const t = e.touches[0];
      s.startX = t.clientX;
      s.startY = t.clientY;
      s.lastY = t.clientY;
      s.moved = false;
      s.dragId = draggable.dataset.dragId;
      s.dragSource = draggable.dataset.dragSource || "task";
      s.srcEl = draggable;
      s.scrollEl = findScrollParent(draggable);
      s.phase = "waiting";

      s.timer = setTimeout(() => { activateDrag(); }, 400);
    };

    /* ─── TOUCH MOVE ─── */
    const onMove = (e) => {
      if (s.phase === "idle") return;

      const t = e.touches[0];

      /* === WAITING for long-press === */
      if (s.phase === "waiting") {
        const dx = t.clientX - s.startX;
        const dy = t.clientY - s.startY;
        const dist = Math.abs(dx) + Math.abs(dy);

        if (dist > 12) {
          /* User is swiping, not holding — cancel drag, enter scroll mode */
          clearTimeout(s.timer); s.timer = null;
          s.phase = "scrolling";
          s.lastY = t.clientY;
          /* Don't reset dragId etc yet — we need scrollEl */
          return; /* Don't preventDefault — but we have touch-action:none so
                     browser won't scroll natively; we handle it below */
        }
        /* Still holding — prevent any possible scroll */
        e.preventDefault();
        return;
      }

      /* === SCROLL ASSIST mode === */
      if (s.phase === "scrolling") {
        const dy = s.lastY - t.clientY; /* positive = scroll down */
        s.lastY = t.clientY;
        if (s.scrollEl) {
          s.scrollEl.scrollTop += dy;
        }
        e.preventDefault(); /* prevent any other default behavior */
        return;
      }

      /* === ACTIVE DRAG === */
      e.preventDefault();
      s.moved = true;
      if (s.ghost) {
        s.ghost.style.top = (t.clientY - 20) + "px";
        s.ghost.style.left = (t.clientX - 10) + "px";
      }

      /* Show sidebar when finger approaches left edge, hide when moves away */
      const EDGE = 50;
      if (t.clientX < EDGE && !s.sidebarShown) {
        s.sidebarShown = true;
        if (onSidebarRef.current) onSidebarRef.current(true);
      } else if (t.clientX > EDGE + 200 && s.sidebarShown) {
        s.sidebarShown = false;
        if (onSidebarRef.current) onSidebarRef.current(false);
      }

      /* Auto-scroll horizontally scrollable containers (e.g. kanban board)
         Right edge (last 70px): scroll right
         Left zone (70-160px, after sidebar edge): scroll left
         Center: stop auto-scrolling */
      const screenW = window.innerWidth;
      const R_ZONE = screenW - 70;
      const L_ZONE_START = s.sidebarShown ? 280 : 70;
      const L_ZONE_END = s.sidebarShown ? 350 : 160;

      if (t.clientX > R_ZONE) {
        s._scrollDir = 1;
      } else if (t.clientX > L_ZONE_START && t.clientX < L_ZONE_END) {
        s._scrollDir = -1;
      } else {
        s._scrollDir = 0;
      }

      if (s._scrollDir !== 0) {
        if (!s.autoScrollEl) s.autoScrollEl = document.querySelector("[data-kanban-scroll]");
        if (s.autoScrollEl && !s.autoScrollTimer) {
          s.autoScrollTimer = setInterval(() => {
            if (s.autoScrollEl && s._scrollDir) s.autoScrollEl.scrollLeft += s._scrollDir * 4;
          }, 16);
        }
      } else if (s.autoScrollTimer) {
        clearInterval(s.autoScrollTimer); s.autoScrollTimer = null;
      }

      const target = findDropTarget(t.clientX, t.clientY);
      if (target !== s.lastTarget) {
        clearHL();
        if (target) {
          target.dataset.dropBg = target.style.background || "";
          target.style.outline = "2px solid #d97706";
          target.style.background = "rgba(217,119,6,0.1)";
          target.style.borderRadius = "10px";
          s.lastTarget = target;
        }
      }
    };

    /* ─── TOUCH END ─── */
    const onEnd = (e) => {
      if (s.phase === "scrolling") { reset(); return; }
      if (s.phase !== "dragging" || !s.moved) { reset(); return; }

      const t = e.changedTouches[0];
      const target = findDropTarget(t.clientX, t.clientY);

      if (target && onDropRef.current) {
        onDropRef.current({
          dragId: s.dragId,
          dragSource: s.dragSource,
          dropType: target.dataset.dropType,
          dropValue: target.dataset.dropValue,
          dropZone: target.dataset.dropZone,
        });
      }
      reset();
    };

    /* Register — touchstart passive is fine (we don't need preventDefault on it);
       touchmove MUST be non-passive so we can preventDefault during drag/scroll */
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", reset, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", reset);
      document.removeEventListener("touchstart", markTouch, { capture: true });
      document.removeEventListener("mousedown", markMouse, { capture: true });
      document.removeEventListener("dragstart", blockNativeDrag, { capture: true });
      reset();
    };
  }, []);
};

const PRIORITY = {
  none:   { color: "#a8a29e", label: "None" },
  low:    { color: "#60a5fa", label: "Low" },
  medium: { color: "#fbbf24", label: "Medium" },
  high:   { color: "#f87171", label: "High" },
};

const DEFAULT_LISTS = ["Inbox", "Work", "Personal"];
const LIST_PALETTE = ["#78716c","#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6","#f97316","#6366f1"];

const formatDate = (d) => {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  const today = new Date(); today.setHours(0,0,0,0);
  const tmrw = new Date(today); tmrw.setDate(tmrw.getDate()+1);
  const yest = new Date(today); yest.setDate(yest.getDate()-1);
  if (date.getTime()===today.getTime()) return "Today";
  if (date.getTime()===tmrw.getTime()) return "Tomorrow";
  if (date.getTime()===yest.getTime()) return "Yesterday";
  return date.toLocaleDateString("en-IE",{month:"short",day:"numeric",year:date.getFullYear()!==today.getFullYear()?"numeric":undefined});
};

const isOverdue = (d) => d && new Date(d+"T23:59:59") < new Date();
const load = (k,fb) => { try { const r=localStorage.getItem(k); return r?JSON.parse(r):fb; } catch{return fb;} };
const save = (k,d) => { try{localStorage.setItem(k,JSON.stringify(d));}catch{} };
const getListColor = (name, lists) => LIST_PALETTE[lists.indexOf(name) % LIST_PALETTE.length];

/* Default subtask with all properties (mirrors parent task shape) */
const newSubtask = (title) => ({
  id:uid(), title, completed:false, subtasks:[],
  dueDate:null, startDate:null, endDate:null,
  priority:"none", notes:"", tags:[]
});

/* Recursive subtask helpers */
const countSubs = (subs) => { if(!subs?.length) return {total:0,done:0}; let t=0,d=0; for(const s of subs){t++;if(s.completed)d++;const c=countSubs(s.subtasks);t+=c.total;d+=c.done;} return{total:t,done:d}; };
const updateSubById = (subs, id, changes) => {
  if(!subs) return [];
  return subs.map(s => s.id===id ? {...s,...changes} : {...s, subtasks: updateSubById(s.subtasks, id, changes)});
};
const removeSubById = (subs, id) => {
  if(!subs) return [];
  return subs.filter(s=>s.id!==id).map(s=>({...s, subtasks: removeSubById(s.subtasks, id)}));
};
const addSubTo = (subs, parentId, newSub) => {
  if(!subs) return [];
  return subs.map(s => s.id===parentId ? {...s, subtasks:[...(s.subtasks||[]), newSub]} : {...s, subtasks: addSubTo(s.subtasks, parentId, newSub)});
};
const findSubById = (subs, id) => {
  if(!subs) return null;
  for(const s of subs){ if(s.id===id) return s; const f=findSubById(s.subtasks,id); if(f) return f; }
  return null;
};

/* ═══════════════════════════════════════════════════════════════════════
   SVG ICONS
   ═══════════════════════════════════════════════════════════════════════ */
const I = ({children,size=18,...p}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}} {...p}>{children}</svg>
);
const Icons = {
  inbox:    <I><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></I>,
  today:    <I><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></I>,
  upcoming: <I><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></I>,
  all:      <I><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></I>,
  done:     <I><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></I>,
  calendar: <I><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></I>,
  camera:   <I><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></I>,
  plus:     <I><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></I>,
  chevL:    <I size={16}><polyline points="15 18 9 12 15 6"/></I>,
  chevR:    <I size={16}><polyline points="9 18 15 12 9 6"/></I>,
  chevD:    <I size={14}><polyline points="6 9 12 15 18 9"/></I>,
  x:        <I size={16}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></I>,
  trash:    <I size={16}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></I>,
  flag:     <I size={14}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/></I>,
  upload:   <I><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></I>,
  search:   <I size={18}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></I>,
  menu:     <I size={22}><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></I>,
  subtask:  <I size={14}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></I>,
  note:     <I size={14}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></I>,
  sparkle:  <I size={16}><path d="M12 2L14.5 9.5 22 12 14.5 14.5 12 22 9.5 14.5 2 12 9.5 9.5z"/></I>,
  grip:     <I size={16}><circle cx="9" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="19" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="19" r="1" fill="currentColor" stroke="none"/></I>,
  duration: <I size={14}><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 00-.586-1.414L12 12l-4.414 4.414A2 2 0 007 17.828V22"/><path d="M7 2v4.172a2 2 0 00.586 1.414L12 12l4.414-4.414A2 2 0 0017 6.172V2"/></I>,
  keyboard: <I size={16}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></I>,
  settings: <I size={16}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></I>,
  back:     <I size={16}><polyline points="15 18 9 12 15 6"/></I>,
};

/* ═══════════════════════════════════════════════════════════════════════
   SHARED UI COMPONENTS
   ═══════════════════════════════════════════════════════════════════════ */
const Checkbox = ({checked, onChange, priority="none", size=20, animating=false}) => (
  <button onClick={e=>{e.stopPropagation();onChange(!checked);}}
    aria-label={checked?"Mark incomplete":"Mark complete"} role="checkbox" aria-checked={checked}
    style={{width:size,height:size,borderRadius:6,flexShrink:0,padding:0,
      border:`2px solid ${checked?PRIORITY[priority].color:(priority!=="none"?PRIORITY[priority].color:"#cbd5e1")}`,
      background:checked?PRIORITY[priority].color:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
      transition:animating?"none":"all 0.2s ease",
      boxShadow:animating&&checked?`0 0 0 4px ${PRIORITY[priority].color}33`:"none"}}>
    {checked && <svg width={size*.6} height={size*.6} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"
      style={{strokeDasharray:animating?24:undefined,strokeDashoffset:0,animation:animating?"checkmarkDraw 0.3s ease 0.1s both":"none"}}>
      <polyline points="20 6 9 17 4 12"/></svg>}
  </button>
);

/* Double-click to edit any text inline */
const EditableText = ({value, onSave, onEditStart, style={}, tag:Tag="span"}) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const ref = useRef(null);
  useEffect(()=>{setText(value);},[value]);
  useEffect(()=>{if(editing&&ref.current){ref.current.focus();ref.current.select();}},[editing]);
  if(!editing) return <Tag onDoubleClick={e=>{e.stopPropagation();e.preventDefault();if(onEditStart)onEditStart();setEditing(true);}} title="Double-click to edit" style={{...style,cursor:"default"}}>{value}</Tag>;
  return <input ref={ref} value={text} onChange={e=>setText(e.target.value)}
    onClick={e=>e.stopPropagation()}
    onBlur={()=>{if(text.trim()&&text.trim()!==value)onSave(text.trim());setEditing(false);}}
    onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape"){setText(value);setEditing(false);}}}
    style={{border:"none",outline:"none",background:"rgba(217,119,6,0.1)",borderRadius:4,padding:"2px 6px",fontFamily:"inherit",...style}} />;
};

const Overlay = ({onClose,children,wide}) => (
  <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.45)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,animation:"fadeIn 0.2s ease",padding:16}} onClick={onClose} role="dialog" aria-modal="true">
    <div onClick={e=>e.stopPropagation()} style={{background:"var(--bg)",borderRadius:20,padding:28,width:"100%",maxWidth:wide?560:500,boxShadow:"0 25px 60px rgba(0,0,0,0.25)",position:"relative",display:"flex",flexDirection:"column",maxHeight:"90vh"}}>
      <button onClick={onClose} style={{position:"absolute",top:16,right:16,background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:4}} aria-label="Close">{Icons.x}</button>
      {children}
    </div>
  </div>
);
const Btn = ({children,variant="primary",...p}) => (
  <button {...p} style={{flex:1,padding:"12px 16px",borderRadius:12,border:variant==="secondary"?"1px solid var(--border)":"none",background:variant==="secondary"?"white":"linear-gradient(135deg,#d97706,#ea580c)",color:variant==="secondary"?"var(--text)":"white",fontSize:14,fontWeight:600,cursor:p.disabled?"wait":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"inherit",opacity:p.disabled?0.6:1,...(p.style||{})}}>{children}</button>
);
const IconBtn = ({children,...p}) => (<button {...p} style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:6,borderRadius:6,display:"flex",...(p.style||{})}}>{children}</button>);
const Spinner = () => <div style={{width:16,height:16,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"white",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>;
const Field = ({label,children}) => (<div style={{marginBottom:18}}><label style={{fontSize:11,fontWeight:700,color:"var(--muted)",display:"block",marginBottom:7,textTransform:"uppercase",letterSpacing:0.8}}>{label}</label>{children}</div>);
const fieldInput = {width:"100%",padding:"10px 12px",borderRadius:10,border:"1px solid var(--border)",fontSize:14,color:"var(--text)",background:"white",fontFamily:"inherit",boxSizing:"border-box",outline:"none"};
const calNav = {background:"none",border:"1px solid var(--border)",borderRadius:8,padding:"8px 12px",cursor:"pointer",color:"var(--text)",display:"flex"};

/* Inline date picker — click date label to reveal native date input */
const InlineDatePicker = ({value, overdue, onChange}) => {
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  useEffect(()=>{if(editing && ref.current){ref.current.showPicker?.();ref.current.focus();}},[editing]);
  if(editing) return (
    <input ref={ref} type="date" value={value||""} onClick={e=>e.stopPropagation()}
      onChange={e=>{onChange(e.target.value);setEditing(false);}}
      onBlur={()=>setEditing(false)}
      style={{fontSize:12,fontWeight:600,border:"1px solid var(--accent)",borderRadius:6,padding:"2px 6px",outline:"none",fontFamily:"inherit",color:"var(--accent)",background:"white",cursor:"pointer"}}/>
  );
  return (
    <span onClick={e=>{e.stopPropagation();setEditing(true);}} title="Click to change date"
      style={{fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:3,cursor:"pointer",borderRadius:4,padding:"1px 4px",transition:"background 0.15s",
        color:value?(overdue?"#ef4444":value===todayStr()?"var(--accent)":"var(--muted)"):"#a78bfa",
        background:value?"transparent":"#f5f3ff",border:value?"none":"1px solid #ede9fe"}}>
      {Icons.calendar} {value?formatDate(value):"No date"}
    </span>
  );
};

/* Subtasks in TaskRow — draggable to promote to task */
const DraggableSubtaskTree = ({subtasks, onAction, onDragStart, onDragEnd, depth=0}) => {
  const [openIds, setOpenIds] = useState({});
  const toggle = id => setOpenIds(p=>({...p,[id]:!p[id]}));
  if(!subtasks?.length) return null;
  const indent = Math.min(depth * 18, 54);
  return (
    <div style={{paddingLeft:indent}}>
      {subtasks.map(sub => {
        const childCount = countSubs(sub.subtasks);
        const hasChildren = (sub.subtasks||[]).length > 0;
        const isOpen = openIds[sub.id];
        return (
          <div key={sub.id}>
            <div draggable onDragStart={e=>onDragStart(e,sub,"subtask")} onDragEnd={onDragEnd}
              data-drag-id={sub.id} data-drag-source="subtask" data-drag-label={sub.title}
              style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",fontSize:13,cursor:"grab",touchAction:"none"}}>
              <span style={{color:"var(--border)",flexShrink:0,cursor:"grab"}}>{Icons.grip}</span>
              <Checkbox checked={sub.completed} size={15} onChange={c=>onAction("update",sub.id,{completed:c})}/>
              <span style={{flex:1,color:sub.completed?"var(--muted)":"var(--text)",textDecoration:sub.completed?"line-through":"none",minWidth:0,fontSize:13}}>{sub.title}</span>
              {hasChildren && (
                <button onClick={()=>toggle(sub.id)} style={{background:"none",border:"none",cursor:"pointer",padding:2,color:"var(--muted)",display:"flex",alignItems:"center",gap:2,fontSize:11,fontFamily:"inherit"}}>
                  {childCount.done}/{childCount.total}
                  <span style={{transform:isOpen?"rotate(0)":"rotate(-90deg)",transition:"transform 0.15s",display:"flex"}}>{Icons.chevD}</span>
                </button>
              )}
            </div>
            {hasChildren && isOpen && (
              <DraggableSubtaskTree subtasks={sub.subtasks} onAction={onAction} onDragStart={onDragStart} onDragEnd={onDragEnd} depth={depth+1}/>
            )}
          </div>
        );
      })}
    </div>
  );
};

const ToggleRow = ({label, sublabel, checked, onChange}) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0",borderBottom:"1px solid var(--border-light)"}}>
    <div>
      <div style={{fontSize:14,fontWeight:500,color:"var(--ink)"}}>{label}</div>
      {sublabel && <div style={{fontSize:12,color:"var(--muted)",marginTop:2}}>{sublabel}</div>}
    </div>
    <button onClick={()=>onChange(!checked)} role="switch" aria-checked={checked}
      style={{width:44,height:26,borderRadius:13,border:"none",cursor:"pointer",padding:2,
        background:checked?"var(--accent)":"var(--border)",transition:"background 0.2s",flexShrink:0,position:"relative"}}>
      <div style={{width:22,height:22,borderRadius:11,background:"white",boxShadow:"0 1px 3px rgba(0,0,0,0.2)",
        transform:checked?"translateX(18px)":"translateX(0)",transition:"transform 0.2s"}}/>
    </button>
  </div>
);

/* ═══════════════════════════════════════════════════════════════════════
   RECURSIVE SUBTASK TREE (infinite nesting, editable titles, clickable)
   ═══════════════════════════════════════════════════════════════════════ */
const SubtaskTree = ({subtasks, onAction, onOpenSub, depth=0, compact=false}) => {
  const [openIds, setOpenIds] = useState({});
  const [addingTo, setAddingTo] = useState(null);
  const [addText, setAddText] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const editRef = useRef(null);
  const toggle = id => setOpenIds(p=>({...p,[id]:!p[id]}));
  if(!subtasks?.length && !compact) return null;
  const indent = compact ? 0 : Math.min(depth * 20, 60);

  useEffect(()=>{if(editingId&&editRef.current){editRef.current.focus();editRef.current.select();}},[editingId]);

  return (
    <div style={{paddingLeft:indent}}>
      {(subtasks||[]).map(sub => {
        const childCount = countSubs(sub.subtasks);
        const hasChildren = (sub.subtasks||[]).length > 0;
        const isOpen = openIds[sub.id];
        const isEditing = editingId===sub.id;
        return (
          <div key={sub.id}>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:compact?"6px 0":"4px 0",fontSize:compact?14:13}}>
              <Checkbox checked={sub.completed} size={compact?16:15} onChange={c=>onAction("update",sub.id,{completed:c})}/>

              {/* Title: double-click to edit inline, single-click to open details */}
              {isEditing ? (
                <input ref={editRef} value={editText} onChange={e=>setEditText(e.target.value)}
                  onClick={e=>e.stopPropagation()}
                  onBlur={()=>{if(editText.trim()&&editText.trim()!==sub.title)onAction("update",sub.id,{title:editText.trim()});setEditingId(null);}}
                  onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape"){setEditingId(null);}}}
                  style={{flex:1,border:"none",outline:"none",background:"rgba(217,119,6,0.1)",borderRadius:4,padding:"2px 6px",fontFamily:"inherit",fontSize:compact?14:13,minWidth:0,color:"var(--text)"}}/>
              ) : (
                <span
                  onClick={e=>{e.stopPropagation();if(compact&&onOpenSub)onOpenSub(sub.id);}}
                  onDoubleClick={e=>{e.stopPropagation();setEditingId(sub.id);setEditText(sub.title);}}
                  title={compact?"Click to edit details · Double-click to rename":"Double-click to rename"}
                  style={{flex:1,color:sub.completed?"var(--muted)":"var(--text)",textDecoration:sub.completed?"line-through":"none",
                    cursor:compact?"pointer":"default",minWidth:0,
                    borderRadius:4,padding:"1px 4px",transition:"background 0.1s",
                    ...(compact?{":hover":{background:"var(--surface)"}}:{})}}>
                  {sub.title}
                </span>
              )}

              {sub.priority&&sub.priority!=="none"&&<span style={{width:6,height:6,borderRadius:"50%",background:PRIORITY[sub.priority].color,flexShrink:0}}/>}
              {sub.dueDate&&<span style={{fontSize:10,color:isOverdue(sub.dueDate)?"#ef4444":"var(--muted)",fontWeight:500}}>{formatDate(sub.dueDate)}</span>}
              {hasChildren && (
                <button onClick={e=>{e.stopPropagation();toggle(sub.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:2,color:"var(--muted)",display:"flex",alignItems:"center",gap:2,fontSize:11,fontFamily:"inherit"}}>
                  {childCount.done}/{childCount.total}
                  <span style={{transform:isOpen?"rotate(0)":"rotate(-90deg)",transition:"transform 0.15s",display:"flex"}}>{Icons.chevD}</span>
                </button>
              )}
              {compact && (
                <button onClick={e=>{e.stopPropagation();setAddingTo(addingTo===sub.id?null:sub.id);setAddText("");}} style={{background:"none",border:"none",cursor:"pointer",padding:2,color:"var(--muted)",display:"flex"}} title="Add sub-subtask">
                  {Icons.plus}
                </button>
              )}
              {compact && <IconBtn onClick={e=>{e.stopPropagation();onAction("remove",sub.id);}} aria-label="Remove subtask">{Icons.x}</IconBtn>}
            </div>
            {compact && addingTo===sub.id && (
              <div style={{paddingLeft:20,paddingBottom:4}}>
                <input autoFocus value={addText} onChange={e=>setAddText(e.target.value)} placeholder="Add nested subtask..."
                  onKeyDown={e=>{if(e.key==="Enter"&&addText.trim()){onAction("add",sub.id,newSubtask(addText.trim()));setAddText("");setAddingTo(null);}if(e.key==="Escape"){setAddingTo(null);setAddText("");}}}
                  onBlur={()=>{setAddingTo(null);setAddText("");}}
                  style={{width:"100%",padding:"6px 10px",borderRadius:8,border:"1px solid var(--accent)",fontSize:13,outline:"none",background:"white",fontFamily:"inherit"}}/>
              </div>
            )}
            {hasChildren && isOpen && (
              <SubtaskTree subtasks={sub.subtasks} onAction={onAction} onOpenSub={onOpenSub} depth={depth+1} compact={compact}/>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   PHOTO UPLOAD MODAL
   ═══════════════════════════════════════════════════════════════════════ */
const PhotoModal = ({onClose,onProcess,processing}) => {
  const [dragOver,setDragOver]=useState(false);
  const [preview,setPreview]=useState(null);
  const [fileData,setFileData]=useState(null);
  const [mediaType,setMediaType]=useState("image/jpeg");
  const inputRef=useRef(null);
  const handleFile=f=>{if(!f?.type.startsWith("image/"))return;setMediaType(f.type);const r=new FileReader();r.onload=e=>{setPreview(e.target.result);setFileData(e.target.result.split(",")[1]);};r.readAsDataURL(f);};
  return (
    <Overlay onClose={onClose}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
        <div style={{width:40,height:40,borderRadius:12,background:"linear-gradient(135deg,#d97706,#ea580c)",display:"flex",alignItems:"center",justifyContent:"center",color:"white"}}>{Icons.camera}</div>
        <div><h2 style={{margin:0,fontSize:19,fontFamily:"var(--font-display)",color:"var(--ink)"}}>Scan Notebook Page</h2><p style={{margin:0,fontSize:13,color:"var(--muted)"}}>AI extracts and syncs your handwritten to-dos</p></div>
      </div>
      {!preview?(
        <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e.dataTransfer.files[0]);}} onClick={()=>inputRef.current?.click()}
          style={{border:`2px dashed ${dragOver?"var(--accent)":"#cbd5e1"}`,borderRadius:16,padding:"44px 24px",textAlign:"center",cursor:"pointer",background:dragOver?"var(--accent-bg)":"var(--surface)",transition:"all 0.2s"}}>
          <div style={{marginBottom:14,color:dragOver?"var(--accent)":"#94a3b8"}}>{Icons.upload}</div>
          <p style={{margin:0,fontSize:15,fontWeight:600,color:"var(--text)"}}>Drop your notebook photo here</p>
          <p style={{margin:"8px 0 0",fontSize:13,color:"var(--muted)"}}>or tap to browse</p>
          <input ref={inputRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
        </div>
      ):(
        <div>
          <div style={{borderRadius:12,overflow:"hidden",marginBottom:16,border:"1px solid var(--border)",maxHeight:260}}><img src={preview} alt="Preview" style={{width:"100%",display:"block",objectFit:"contain",maxHeight:260}}/></div>
          <div style={{display:"flex",gap:10}}>
            <Btn variant="secondary" onClick={()=>{setPreview(null);setFileData(null);}}>Change</Btn>
            <Btn onClick={()=>onProcess(fileData,mediaType)} disabled={processing}>{processing?<><Spinner/> Scanning...</>:<>{Icons.sparkle} Extract To-dos</>}</Btn>
          </div>
        </div>
      )}
    </Overlay>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   SCAN RESULTS MODAL — outcome sections, zone-based drag (before/nest/after)
   ═══════════════════════════════════════════════════════════════════════ */
const ScanResultsModal = ({results,onConfirm,onClose,lists}) => {
  const [items,setItems]=useState(()=>{
    const flat=[];let id=0;
    const walk=(arr,depth)=>{
      (arr||[]).forEach(it=>{
        flat.push({title:it.title,completed:it.completed||false,category:depth===0?(it.category||null):null,date:depth===0?(it.date||null):null,is_duplicate_of:it.is_duplicate_of||null,_depth:depth,_selected:true,_id:id++});
        walk(it.subtasks,depth+1);
      });
    };
    walk(results.items,0);return flat;
  });
  const [localLists,setLocalLists]=useState([]);
  const [newInputIdx,setNewInputIdx]=useState(null);
  const [newInputVal,setNewInputVal]=useState("");
  const didCommit=useRef(false);
  const [dragIdx,setDragIdx]=useState(null);
  const [dropTarget,setDropTarget]=useState(null); /* {idx, zone:'before'|'nest'|'after'} or {section:'complete'|'skip'} */
  const [showSkipped,setShowSkipped]=useState(false);

  const allLists=[...lists,...localLists.filter(l=>!lists.includes(l))];
  const updateItem=(idx,changes)=>setItems(prev=>prev.map((it,i)=>i===idx?{...it,...changes}:it));

  const getItemRange=(idx)=>{
    const base=items[idx]._depth;let end=idx+1;
    while(end<items.length&&items[end]._depth>base) end++;
    return [idx,end];
  };

  const indent=(idx)=>{
    if(idx===0) return;const item=items[idx];if(item._depth>=2) return;
    const prev=items[idx-1];if(prev._depth<item._depth) return;
    updateItem(idx,{_depth:item._depth+1});
  };
  const outdent=(idx)=>{
    const item=items[idx];if(item._depth<=0) return;
    setItems(prev=>{
      const next=[...prev];const old=next[idx]._depth;
      next[idx]={...next[idx],_depth:old-1};
      for(let i=idx+1;i<next.length;i++){if(next[i]._depth<=old)break;next[i]={...next[i],_depth:next[i]._depth-1};}
      return next;
    });
  };
  const removeRow=(idx)=>{const[s,e]=getItemRange(idx);setItems(prev=>prev.filter((_,i)=>i<s||i>=e));};

  /* ── Zone-based drag: before / nest / after ── */
  const onRowDragStart=(e,idx)=>{
    setDragIdx(idx);e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",String(idx));
    requestAnimationFrame(()=>{const el=e.target.closest("[data-scan-row]");if(el)el.style.opacity="0.4";});
  };
  const onRowDragEnd=(e)=>{
    const el=e.target.closest("[data-scan-row]");if(el)el.style.opacity="";
    setDragIdx(null);setDropTarget(null);
  };
  const onRowDragOver=(e,idx)=>{
    e.preventDefault();e.dataTransfer.dropEffect="move";
    if(dragIdx===null||idx===dragIdx){setDropTarget(null);return;}
    const [ds,de]=getItemRange(dragIdx);
    if(idx>=ds&&idx<de){setDropTarget(null);return;}
    const rect=e.currentTarget.getBoundingClientRect();
    const y=(e.clientY-rect.top)/rect.height;
    const zone=y<0.25?"before":y>0.75?"after":"nest";
    setDropTarget({idx,zone});
  };
  const onRowDrop=(e,targetIdx)=>{
    e.preventDefault();
    if(dragIdx===null||!dropTarget||dropTarget.section){setDragIdx(null);setDropTarget(null);return;}
    const [start,end]=getItemRange(dragIdx);
    if(targetIdx>=start&&targetIdx<end){setDragIdx(null);setDropTarget(null);return;}
    const zone=dropTarget.zone;

    setItems(prev=>{
      const next=[...prev];
      const chunk=next.splice(start,end-start);
      /* Adjust target after removal */
      let ti=targetIdx>start?targetIdx-(end-start):targetIdx;
      const target=next[ti];

      if(zone==="nest"){
        /* Nest: set depth to target+1, clamp children */
        const newBase=Math.min((target?._depth||0)+1,2);
        const shift=newBase-chunk[0]._depth;
        const adjusted=chunk.map(c=>({...c,_depth:Math.min(Math.max(c._depth+shift,0),2)}));
        /* Insert after target + its children */
        let ins=ti+1;
        while(ins<next.length&&next[ins]._depth>(target?._depth||0)) ins++;
        next.splice(ins,0,...adjusted);
      } else {
        const insertAt=zone==="before"?ti:ti+1;
        /* Match depth to context */
        const ctxDepth=target?._depth||0;
        const shift=ctxDepth-chunk[0]._depth;
        const adjusted=chunk.map(c=>({...c,_depth:Math.min(Math.max(c._depth+shift,0),2)}));
        next.splice(insertAt,0,...adjusted);
      }
      return next;
    });
    setDragIdx(null);setDropTarget(null);
  };

  /* ── Section drops: drag into Marking Complete or Already In App ── */
  const onSectionDragOver=(e)=>{e.preventDefault();e.dataTransfer.dropEffect="move";};
  const onSectionDrop=(e,section)=>{
    e.preventDefault();
    if(dragIdx===null) return;
    const item=items[dragIdx];
    if(section==="complete"){
      updateItem(dragIdx,{completed:true,_depth:0});
    } else if(section==="skip"){
      updateItem(dragIdx,{is_duplicate_of:item.is_duplicate_of||item.title,completed:false,_depth:0});
      setShowSkipped(true);
    } else if(section==="add"){
      /* Drag back from complete/skip to tasks-to-add */
      updateItem(dragIdx,{completed:false,is_duplicate_of:null,_depth:0});
    }
    setDragIdx(null);setDropTarget(null);
  };

  /* Reconstruct tree */
  const buildTree=()=>{
    const roots=[];const stack=[{children:roots,depth:-1}];
    items.forEach(it=>{
      if(!it._selected) return;
      const node={title:it.title,completed:it.completed,category:it._depth===0?it.category:null,date:it._depth===0?it.date:null,is_duplicate_of:it._depth===0?it.is_duplicate_of:null,subtasks:[]};
      while(stack.length>1&&stack[stack.length-1].depth>=it._depth) stack.pop();
      stack[stack.length-1].children.push(node);
      stack.push({children:node.subtasks,depth:it._depth});
    });
    return roots;
  };

  const commitNewList=()=>{
    if(didCommit.current) return;didCommit.current=true;
    const val=newInputVal.trim();const idx=newInputIdx;
    if(val&&idx!==null){if(!lists.includes(val)&&!localLists.includes(val))setLocalLists(prev=>[...prev,val]);updateItem(idx,{category:val});}
    setNewInputIdx(null);setNewInputVal("");setTimeout(()=>{didCommit.current=false;},50);
  };

  /* ── Group & categorize ── */
  const groups=[];
  items.forEach((it,idx)=>{
    if(it._depth===0) groups.push({root:it,rootIdx:idx,children:[]});
    else if(groups.length>0) groups[groups.length-1].children.push({item:it,idx});
  });
  const tasksToAdd=[];const markingComplete=[];const alreadyInApp=[];
  groups.forEach(g=>{
    const r=g.root;
    if(r.is_duplicate_of&&!r.completed) alreadyInApp.push(g);
    else if(r.completed) markingComplete.push(g);
    else tasksToAdd.push(g);
  });
  const newTaskCount=tasksToAdd.filter(g=>g.root._selected).length;
  const completeCount=markingComplete.filter(g=>g.root._selected).length;

  /* ── Row renderer with zone indicators ── */
  const renderRow=(item,idx,{showControls=true}={})=>{
    const isTask=item._depth===0;
    const indentPx=item._depth*28;
    const dt=dropTarget&&dropTarget.idx===idx&&dragIdx!==null&&dragIdx!==idx&&!dropTarget.section?dropTarget:null;
    return (
      <div key={item._id} data-scan-row
        onDragOver={e=>onRowDragOver(e,idx)} onDrop={e=>onRowDrop(e,idx)}
        style={{paddingLeft:indentPx,borderBottom:isTask?"1px solid var(--border-light)":"none",
          opacity:item._selected?1:0.3,transition:"opacity 0.15s,padding 0.15s",position:"relative",
          background:dt?.zone==="nest"?"rgba(217,119,6,0.06)":"transparent",
          outline:dt?.zone==="nest"?"2px dashed var(--accent)":"none",borderRadius:dt?.zone==="nest"?8:0}}>
        {dt?.zone==="before"&&<div style={{position:"absolute",top:-1,left:8,right:8,height:2,background:"var(--accent)",borderRadius:1,zIndex:5}}/>}
        {dt?.zone==="after"&&<div style={{position:"absolute",bottom:-1,left:8,right:8,height:2,background:"var(--accent)",borderRadius:1,zIndex:5}}/>}
        {dt?.zone==="nest"&&<div style={{position:"absolute",left:indentPx+32,top:"50%",transform:"translateY(-50%)",fontSize:10,color:"var(--accent)",fontWeight:700,zIndex:5,pointerEvents:"none"}}>↳ nest</div>}
        <div style={{display:"flex",alignItems:"center",gap:4,padding:isTask?"10px 4px":"4px 4px"}}>
          <span draggable onDragStart={e=>onRowDragStart(e,idx)} onDragEnd={onRowDragEnd}
            style={{cursor:"grab",color:"var(--border)",fontSize:12,flexShrink:0,padding:"0 2px",userSelect:"none",touchAction:"none",lineHeight:1}}>⠿</span>
          {item._depth>0&&<span style={{fontSize:10,color:"var(--border)",flexShrink:0,width:14,textAlign:"center"}}>{item._depth===1?"↳":"↳↳"}</span>}
          <input value={item.title} onChange={e=>updateItem(idx,{title:e.target.value})}
            style={{flex:1,border:"1px solid transparent",borderRadius:6,padding:"3px 6px",
              fontSize:isTask?14:12,fontWeight:isTask?600:400,
              color:item.completed?"var(--muted)":"var(--ink)",background:"transparent",outline:"none",
              fontFamily:"inherit",boxSizing:"border-box",minWidth:0,
              textDecoration:item.completed?"line-through":"none"}}
            onFocus={e=>{e.target.style.borderColor="var(--accent)";e.target.style.background="white";}}
            onBlur={e=>{e.target.style.borderColor="transparent";e.target.style.background="transparent";}}/>
          <div style={{display:"flex",gap:1,flexShrink:0}}>
            <button onClick={()=>outdent(idx)} disabled={item._depth<=0} title="Outdent"
              style={{background:"none",border:"none",cursor:item._depth>0?"pointer":"default",color:item._depth>0?"var(--muted)":"var(--border-light)",fontSize:14,padding:"2px 3px",borderRadius:4,fontWeight:700,lineHeight:1,display:"flex"}}>←</button>
            <button onClick={()=>indent(idx)} disabled={idx===0||item._depth>=2} title="Indent"
              style={{background:"none",border:"none",cursor:idx>0&&item._depth<2?"pointer":"default",color:idx>0&&item._depth<2?"var(--muted)":"var(--border-light)",fontSize:14,padding:"2px 3px",borderRadius:4,fontWeight:700,lineHeight:1,display:"flex"}}>→</button>
            <button onClick={()=>removeRow(idx)} title="Remove"
              style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",fontSize:13,padding:"2px 3px",borderRadius:4,lineHeight:1,display:"flex",flexShrink:0}}>✕</button>
          </div>
        </div>
        {showControls&&isTask&&item._selected&&(
          <div style={{display:"flex",alignItems:"center",gap:8,paddingLeft:24,paddingBottom:8,flexWrap:"wrap"}}>
            <select value={item.category||""} onChange={e=>{
              const v=e.target.value;
              if(v==="__new__"){didCommit.current=false;setNewInputIdx(idx);setNewInputVal("");return;}
              updateItem(idx,{category:v||null});
            }} style={{fontSize:12,padding:"2px 6px",borderRadius:4,border:"1px solid var(--border)",background:"white",color:"var(--text)",cursor:"pointer",fontFamily:"inherit"}}>
              <option value="">Inbox</option>
              {allLists.filter(l=>l!=="Inbox").map(l=><option key={l} value={l}>{l}</option>)}
              <option value="__new__">+ New list...</option>
            </select>
            {newInputIdx===idx&&(
              <input autoFocus value={newInputVal} onChange={e=>setNewInputVal(e.target.value)}
                placeholder="List name, Enter to save"
                onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commitNewList();}if(e.key==="Escape"){setNewInputIdx(null);setNewInputVal("");}}}
                onBlur={()=>commitNewList()}
                style={{fontSize:12,padding:"3px 8px",borderRadius:4,border:"1px solid var(--accent)",width:140,outline:"none",fontFamily:"inherit",background:"#fffbeb"}}/>
            )}
            <input type="date" value={item.date||results.page_date||""} onChange={e=>updateItem(idx,{date:e.target.value||null})}
              style={{fontSize:12,padding:"2px 6px",borderRadius:4,border:"1px solid var(--border)",background:"white",color:"var(--text)",cursor:"pointer",fontFamily:"inherit"}}/>
            {item.completed&&<span style={{fontSize:11,background:"#dcfce7",color:"#166534",padding:"1px 7px",borderRadius:4,fontWeight:600}}>✓ done</span>}
          </div>
        )}
      </div>
    );
  };

  const isDragging=dragIdx!==null;

  return (
    <Overlay onClose={onClose} wide>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
        <span style={{color:"var(--accent)"}}>{Icons.sparkle}</span>
        <h2 style={{margin:0,fontSize:19,fontFamily:"var(--font-display)"}}>Scanned {items.length} Item{items.length!==1?"s":""}</h2>
      </div>
      {results.page_date&&(<div style={{padding:"8px 12px",background:"var(--accent-bg)",borderRadius:8,marginBottom:10,fontSize:13,color:"var(--accent-dark)",display:"flex",alignItems:"center",gap:6}}>{Icons.calendar} Page dated {formatDate(results.page_date)}</div>)}

      <div style={{flex:1,overflowY:"auto",marginBottom:16,maxHeight:"55vh"}}>

        {/* ── Section 1: Tasks to add ── */}
        <div onDragOver={isDragging?onSectionDragOver:undefined} onDrop={isDragging?e=>onSectionDrop(e,"add"):undefined}
          style={{padding:"10px 12px",background:isDragging?"rgba(217,119,6,0.1)":"rgba(217,119,6,0.06)",borderRadius:10,marginBottom:2,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",transition:"background 0.15s"}}>
          <span style={{fontSize:15}}>＋</span>
          <span style={{fontSize:14,fontWeight:700,color:"var(--accent)"}}>Tasks to add</span>
          <span style={{fontSize:12,color:"var(--accent)",fontWeight:600}}>{newTaskCount}</span>
          {isDragging&&<span style={{fontSize:11,color:"var(--accent)",fontStyle:"italic",marginLeft:4}}>Drop to add as task</span>}
        </div>
        <p style={{fontSize:12,color:"var(--muted)",margin:"4px 0 8px 12px"}}>Drag onto a task to nest, between to reorder, or to a section header</p>
        {tasksToAdd.length>0&&(
          <div style={{marginBottom:16}}>
            {tasksToAdd.map(g=>[
              renderRow(g.root,g.rootIdx),
              ...g.children.map(c=>renderRow(c.item,c.idx))
            ])}
          </div>
        )}
        {tasksToAdd.length===0&&<div style={{padding:"12px",fontSize:13,color:"var(--muted)",fontStyle:"italic",marginBottom:16}}>No new tasks to add</div>}

        {/* ── Section 2: Marking complete ── */}
        <div onDragOver={isDragging?onSectionDragOver:undefined} onDrop={isDragging?e=>onSectionDrop(e,"complete"):undefined}
          style={{padding:"10px 12px",background:isDragging?"rgba(34,197,94,0.15)":"rgba(34,197,94,0.08)",borderRadius:10,marginBottom:2,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",transition:"background 0.15s"}}>
          <span style={{fontSize:15}}>✓</span>
          <span style={{fontSize:14,fontWeight:700,color:"#166534"}}>Marking complete</span>
          <span style={{fontSize:12,color:"#166534",fontWeight:600}}>{completeCount}</span>
          {isDragging&&<span style={{fontSize:11,color:"#166534",fontStyle:"italic",marginLeft:4}}>Drop to mark done</span>}
        </div>
        {markingComplete.length>0&&(
          <div style={{marginBottom:16}}>
            {markingComplete.map(g=>{
              const r=g.root;const idx=g.rootIdx;
              const isMatch=!!r.is_duplicate_of;
              return (
                <div key={r._id} style={{padding:"8px 12px",borderBottom:"1px solid var(--border-light)",
                  opacity:r._selected?1:0.3,transition:"opacity 0.15s",display:"flex",alignItems:"center",gap:8}}>
                  <span draggable onDragStart={e=>onRowDragStart(e,idx)} onDragEnd={onRowDragEnd}
                    style={{cursor:"grab",color:"var(--border)",fontSize:12,flexShrink:0,padding:"0 2px",userSelect:"none",lineHeight:1}}>⠿</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <div style={{flex:1,minWidth:0}}>
                    <span style={{fontSize:14,fontWeight:500,color:"var(--muted)",textDecoration:"line-through"}}>{r.title}</span>
                    <div style={{display:"flex",gap:6,marginTop:2,alignItems:"center",flexWrap:"wrap"}}>
                      {isMatch?<span style={{fontSize:11,color:"#166534",fontWeight:600}}>Updates existing task</span>
                        :<span style={{fontSize:11,color:"#166534",fontWeight:600}}>New completed task</span>}
                      {r.category&&<span style={{fontSize:11,color:"var(--muted)"}}>{r.category}</span>}
                    </div>
                    {g.children.length>0&&(
                      <div style={{marginTop:4,paddingLeft:8}}>
                        {g.children.map(c=>(
                          <div key={c.item._id} style={{fontSize:12,color:"var(--muted)",padding:"1px 0"}}>
                            <span style={{textDecoration:c.item.completed?"line-through":"none"}}>↳ {c.item.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {r._selected
                    ?<button onClick={()=>updateItem(idx,{_selected:false})} title="Exclude"
                      style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",fontSize:13,padding:"2px 4px",borderRadius:4,lineHeight:1,display:"flex",flexShrink:0}}>✕</button>
                    :<button onClick={()=>updateItem(idx,{_selected:true})} title="Restore"
                      style={{background:"none",border:"none",cursor:"pointer",color:"var(--accent)",fontSize:12,padding:"2px 6px",borderRadius:4,fontWeight:600,flexShrink:0}}>Undo</button>
                  }
                </div>
              );
            })}
          </div>
        )}
        {markingComplete.length===0&&<div style={{padding:"8px 12px",fontSize:13,color:"var(--muted)",fontStyle:"italic",marginBottom:16}}>None</div>}

        {/* ── Section 3: Already in app (collapsible) ── */}
        <button onClick={()=>setShowSkipped(!showSkipped)}
          onDragOver={isDragging?e=>{e.preventDefault();e.dataTransfer.dropEffect="move";if(!showSkipped)setShowSkipped(true);}:undefined}
          onDrop={isDragging?e=>onSectionDrop(e,"skip"):undefined}
          style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",
            background:isDragging?"rgba(120,120,120,0.12)":"var(--surface)",
            borderRadius:10,border:"none",cursor:"pointer",width:"100%",fontFamily:"inherit",transition:"background 0.15s"}}>
          <span style={{fontSize:15}}>↻</span>
          <span style={{fontSize:14,fontWeight:700,color:"var(--muted)"}}>Already in app</span>
          <span style={{fontSize:12,color:"var(--muted)"}}>{alreadyInApp.length}</span>
          {isDragging&&<span style={{fontSize:11,color:"var(--muted)",fontStyle:"italic",marginLeft:4}}>Drop to skip</span>}
          <span style={{marginLeft:"auto",fontSize:12,color:"var(--muted)",transform:showSkipped?"rotate(0)":"rotate(-90deg)",transition:"transform 0.15s",display:"flex"}}>{Icons.chevD}</span>
        </button>
        {showSkipped&&alreadyInApp.length>0&&(
          <div style={{padding:"4px 0",marginBottom:8}}>
            {alreadyInApp.map(g=>(
              <div key={g.root._id} style={{padding:"6px 12px 6px 20px",fontSize:13,color:"var(--muted)",display:"flex",alignItems:"center",gap:6}}>
                <span draggable onDragStart={e=>onRowDragStart(e,g.rootIdx)} onDragEnd={onRowDragEnd}
                  style={{cursor:"grab",color:"var(--border)",fontSize:12,userSelect:"none",lineHeight:1}}>⠿</span>
                <span>↻</span><span>{g.root.title}</span>
                <span style={{fontSize:11,fontStyle:"italic"}}>— no changes</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{display:"flex",gap:10,flexShrink:0,alignItems:"center",flexWrap:"wrap"}}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={()=>onConfirm(buildTree())}>
          {newTaskCount>0?`Add ${newTaskCount}`:""}{newTaskCount>0&&completeCount>0?" · ":""}{completeCount>0?`Complete ${completeCount}`:""}{newTaskCount===0&&completeCount===0?"Nothing to import":""}
        </Btn>
      </div>
    </Overlay>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   TASK DETAIL PANEL — with subtask navigation (click into any subtask)
   ═══════════════════════════════════════════════════════════════════════ */
const TaskDetail = ({task, onUpdate, onDelete, onClose, lists}) => {
  /* Navigation stack: view subtask details, then go back */
  const [subPath, setSubPath] = useState([]);
  const [newSub, setNewSub] = useState("");
  const [newTag, setNewTag] = useState("");

  /* Reset path when switching tasks */
  useEffect(()=>{ setSubPath([]); },[task.id]);

  /* Resolve current item from path */
  let current = task;
  let breadcrumbs = [{id:task.id, title:task.title}];
  for(const sid of subPath) {
    const found = findSubById(current.subtasks, sid);
    if(found) { current = found; breadcrumbs.push({id:found.id, title:found.title}); }
    else break;
  }
  const isSubtask = subPath.length > 0;

  /* Update helpers — route changes through the correct path */
  const updateCurrent = (changes) => {
    if(!isSubtask) { onUpdate({...task, ...changes}); return; }
    const newSubs = updateSubById(task.subtasks, current.id, changes);
    onUpdate({...task, subtasks: newSubs});
  };

  /* Local state for title/notes */
  const [title, setTitle] = useState(current.title);
  const [notes, setNotes] = useState(current.notes||"");
  useEffect(()=>{setTitle(current.title);setNotes(current.notes||"");setNewSub("");setNewTag("");},[current.id, task]);

  const durationDays = current.startDate&&current.endDate ? Math.max(1,Math.ceil((new Date(current.endDate)-new Date(current.startDate))/(86400000))) : null;

  /* Subtask actions for the tree */
  const handleSubAction = (action, targetId, data) => {
    let newSubs;
    if(action==="remove") newSubs = removeSubById(current.subtasks||[], targetId);
    else if(action==="add") newSubs = addSubTo(current.subtasks||[], targetId, data);
    else newSubs = updateSubById(current.subtasks||[], targetId, data);
    updateCurrent({subtasks: newSubs});
  };

  return (
    <div className="detail-panel" role="complementary" aria-label="Task details"
      style={{width:380,borderLeft:"1px solid var(--border)",background:"var(--bg)",display:"flex",flexDirection:"column",height:"100%",flexShrink:0,animation:"slideIn 0.2s ease"}}>
      {/* Header */}
      <div style={{padding:"12px 20px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",minHeight:48}}>
        <div style={{display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0}}>
          {isSubtask && (
            <button onClick={()=>setSubPath(p=>p.slice(0,-1))} style={{background:"none",border:"none",cursor:"pointer",color:"var(--accent)",padding:2,display:"flex",flexShrink:0}} aria-label="Back to parent">
              {Icons.back}
            </button>
          )}
          <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {breadcrumbs.map((b,i)=>(
              <span key={b.id}>
                {i>0&&" › "}
                {i<breadcrumbs.length-1 ? (
                  <button onClick={()=>setSubPath(subPath.slice(0,i))} style={{background:"none",border:"none",cursor:"pointer",color:"var(--accent)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,padding:0,fontFamily:"inherit"}}>{b.title.slice(0,12)}{b.title.length>12?"…":""}</button>
                ) : (isSubtask ? "Subtask" : "Task Details")}
              </span>
            ))}
          </div>
        </div>
        <div style={{display:"flex",gap:2,flexShrink:0}}>
          {!isSubtask && <IconBtn onClick={()=>onDelete(task.id)} title="Delete" aria-label="Delete task">{Icons.trash}</IconBtn>}
          {isSubtask && <IconBtn onClick={()=>{handleSubAction("remove",current.id);setSubPath(p=>p.slice(0,-1));}} title="Delete subtask" aria-label="Delete subtask">{Icons.trash}</IconBtn>}
          <IconBtn onClick={onClose} aria-label="Close">{Icons.x}</IconBtn>
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"18px 20px"}}>
        {/* Title + checkbox */}
        <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:20}}>
          <div style={{paddingTop:4}}><Checkbox checked={current.completed} priority={current.priority||"none"} onChange={c=>updateCurrent({completed:c,completedAt:c?new Date().toISOString():null})}/></div>
          <textarea ref={el=>{if(el){el.style.height="auto";el.style.height=el.scrollHeight+"px";}}} value={title} onChange={e=>{setTitle(e.target.value);e.target.style.height="auto";e.target.style.height=e.target.scrollHeight+"px";}} rows={1} onBlur={e=>{if(title.trim())updateCurrent({title:title.trim()});e.target.style.borderColor="transparent";e.target.style.background="none";}} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.target.blur();}}}
            style={{flex:1,border:"1px solid transparent",borderRadius:8,background:"none",fontSize:18,fontFamily:"var(--font-display)",fontWeight:700,color:current.completed?"var(--muted)":"var(--ink)",textDecoration:current.completed?"line-through":"none",outline:"none",padding:"6px 8px",resize:"none",lineHeight:1.3,overflow:"hidden",transition:"border-color 0.15s, background 0.15s",cursor:"text"}}
            onFocus={e=>{e.target.style.borderColor="var(--accent)";e.target.style.background="white";}}
            onMouseEnter={e=>{if(document.activeElement!==e.target)e.target.style.borderColor="var(--border)";}}
            onMouseLeave={e=>{if(document.activeElement!==e.target)e.target.style.borderColor="transparent";}}/>
        </div>

        {/* Due Date */}
        <Field label="Due Date"><input type="date" value={current.dueDate||""} onChange={e=>updateCurrent({dueDate:e.target.value||null})} style={fieldInput}/></Field>

        {/* Duration */}
        <Field label="Duration (Start → End)">
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input type="date" value={current.startDate||""} onChange={e=>updateCurrent({startDate:e.target.value||null})} style={{...fieldInput,flex:1}}/>
            <span style={{color:"var(--muted)",fontSize:13,flexShrink:0}}>→</span>
            <input type="date" value={current.endDate||""} onChange={e=>updateCurrent({endDate:e.target.value||null})} style={{...fieldInput,flex:1}}/>
          </div>
          {durationDays&&<div style={{fontSize:12,color:"var(--muted)",marginTop:6}}>{durationDays} day{durationDays!==1?"s":""}</div>}
        </Field>

        {/* Priority */}
        <Field label="Priority">
          <div style={{display:"flex",gap:6}}>
            {Object.entries(PRIORITY).map(([k,{color,label}])=>(
              <button key={k} onClick={()=>updateCurrent({priority:k})} style={{flex:1,padding:"8px 2px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s",border:(current.priority||"none")===k?`2px solid ${color}`:"1px solid var(--border)",background:(current.priority||"none")===k?`${color}12`:"white",color:(current.priority||"none")===k?color:"var(--muted)"}}>{label}</button>
            ))}
          </div>
        </Field>

        {/* List (only on top-level tasks) */}
        {!isSubtask && (
          <Field label="List">
            <select value={task.list} onChange={e=>onUpdate({...task,list:e.target.value})} style={{...fieldInput,cursor:"pointer"}}>
              {lists.map(l=><option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
        )}

        {/* Tags */}
        <Field label="Tags">
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
            {(current.tags||[]).map(t=>(
              <span key={t} style={{fontSize:12,padding:"2px 8px",borderRadius:12,background:"var(--accent-bg)",color:"var(--accent-dark)",display:"flex",alignItems:"center",gap:4,fontWeight:500}}>
                #{t}<button onClick={()=>updateCurrent({tags:(current.tags||[]).filter(x=>x!==t)})} style={{background:"none",border:"none",cursor:"pointer",color:"var(--accent)",padding:0,fontSize:14,lineHeight:1}}>×</button>
              </span>
            ))}
          </div>
          <input value={newTag} onChange={e=>setNewTag(e.target.value)} placeholder="Add tag, press Enter..."
            onKeyDown={e=>{if(e.key==="Enter"&&newTag.trim()){const tag=newTag.trim().replace(/^#/,"");if(!(current.tags||[]).includes(tag))updateCurrent({tags:[...(current.tags||[]),tag]});setNewTag("");}}}
            style={{...fieldInput,fontSize:13}}/>
        </Field>

        {/* Subtasks — recursive, with clickable items to drill in */}
        <Field label={`Subtasks (${countSubs(current.subtasks).done}/${countSubs(current.subtasks).total})`}>
          {(current.subtasks||[]).length>0&&(
            <div style={{background:"white",borderRadius:10,border:"1px solid var(--border)",overflow:"hidden",marginBottom:8,padding:"6px 12px"}}>
              <SubtaskTree subtasks={current.subtasks} compact={true}
                onAction={handleSubAction}
                onOpenSub={(subId)=>setSubPath(p=>[...p, subId])}/>
            </div>
          )}
          <input value={newSub} onChange={e=>setNewSub(e.target.value)} placeholder="Add subtask, press Enter..."
            onKeyDown={e=>{if(e.key==="Enter"&&newSub.trim()){updateCurrent({subtasks:[...(current.subtasks||[]),newSubtask(newSub.trim())]});setNewSub("");}}}
            style={{...fieldInput,fontSize:13}}/>
        </Field>

        {/* Notes */}
        <Field label="Notes"><textarea value={notes} onChange={e=>setNotes(e.target.value)} onBlur={()=>updateCurrent({notes})} placeholder="Add notes..." rows={4} style={{...fieldInput,resize:"vertical",minHeight:80,fontFamily:"inherit"}}/></Field>

        {task.createdAt&&!isSubtask&&<div style={{fontSize:12,color:"var(--muted)",marginTop:8,paddingTop:12,borderTop:"1px solid var(--border-light)"}}>Created {new Date(task.createdAt).toLocaleDateString("en-IE",{month:"short",day:"numeric",year:"numeric"})}{task.completedAt&&<> · Done {new Date(task.completedAt).toLocaleDateString("en-IE",{month:"short",day:"numeric"})}</>}</div>}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   SCAN TIPS MODAL — notebook formatting guide for best photo recognition
   ═══════════════════════════════════════════════════════════════════════ */
const ScanTipsModal = ({onClose}) => {
  const tipStyle={marginBottom:18};
  const numStyle={display:"inline-flex",alignItems:"center",justifyContent:"center",width:22,height:22,borderRadius:"50%",background:"var(--accent)",color:"white",fontSize:12,fontWeight:700,marginRight:8,flexShrink:0};
  const headStyle={fontSize:14,fontWeight:700,color:"var(--ink)",display:"flex",alignItems:"center",marginBottom:6};
  const bodyStyle={fontSize:13,color:"var(--muted)",lineHeight:1.6,paddingLeft:30};
  const codeStyle={display:"block",background:"var(--surface)",borderRadius:8,padding:"10px 14px",fontSize:12,fontFamily:"monospace",lineHeight:1.7,color:"var(--ink)",marginTop:8,whiteSpace:"pre",overflowX:"auto"};

  return (
    <Overlay onClose={onClose}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
        <span style={{fontSize:22}}>📓</span>
        <h2 style={{margin:0,fontSize:19,fontFamily:"var(--font-display)"}}>Scan Tips</h2>
      </div>
      <p style={{fontSize:13,color:"var(--muted)",margin:"0 0 20px"}}>Format your notebook pages like this for the best scan accuracy.</p>

      <div style={{overflowY:"auto",maxHeight:"55vh"}}>
        <div style={tipStyle}>
          <div style={headStyle}><span style={numStyle}>1</span>Date at the top</div>
          <div style={bodyStyle}>Write the date clearly at the top of the page — <b>19/2</b>, <b>Feb 19</b>, or <b>2026-02-19</b> all work. This becomes the default due date for everything on the page.</div>
        </div>

        <div style={tipStyle}>
          <div style={headStyle}><span style={numStyle}>2</span>Underline category headers</div>
          <div style={bodyStyle}>Underline or box each section name so it stands out. Inkwell fuzzy-matches headers to your existing lists — e.g. "Work tasks" matches your "Work" list.</div>
        </div>

        <div style={tipStyle}>
          <div style={headStyle}><span style={numStyle}>3</span>Indent for subtasks</div>
          <div style={bodyStyle}>
            Use indentation to show hierarchy. Anything indented beneath a task becomes its subtask, and further indentation becomes a sub-subtask.
            <span style={codeStyle}>{`☐ Plan team offsite
    - Book venue
    - Send invitations
        - Draft email template
☐ Update project roadmap`}</span>
          </div>
        </div>

        <div style={tipStyle}>
          <div style={headStyle}><span style={numStyle}>4</span>Use clear markers</div>
          <div style={bodyStyle}>
            <b>Open tasks:</b> ☐  □  [ ]  –  •<br/>
            <b>Completed:</b> ☑  ✓  [x]  or strikethrough<br/>
            <b>Subtasks:</b> indented –  →  {'>'}  or letters (a, b, c)
          </div>
        </div>

        <div style={tipStyle}>
          <div style={headStyle}><span style={numStyle}>5</span>Example page</div>
          <div style={bodyStyle}>
            <span style={codeStyle}>{`Feb 19

Work
──────
☐ Prepare quarterly review
    - Gather metrics
    - Draft slides
        - Add charts
☐ Schedule 1:1 meetings
✓ Submit expense report

Personal
────────
☐ Book dentist appointment
☐ Research weekend trips
    - Compare prices
    - Check availability`}</span>
          </div>
        </div>

        <div style={{padding:"12px 14px",background:"#fffbeb",borderRadius:10,border:"1px solid rgba(217,119,6,0.2)",fontSize:12,color:"var(--accent-dark)",lineHeight:1.6}}>
          <b>💡 Tip:</b> After scanning, you can drag rows to reorder, use ← → to fix nesting, edit titles, and reassign lists — all before importing.
        </div>
      </div>

      <div style={{marginTop:16,flexShrink:0}}>
        <Btn onClick={onClose} style={{width:"100%"}}>Got it</Btn>
      </div>
    </Overlay>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   KANBAN BOARD — editable columns with configurable names & dates
   ═══════════════════════════════════════════════════════════════════════ */

/* Collect subtasks (any depth) that have their own dueDate */
const collectDatedSubtasks = (tasks) => {
  const results = [];
  const walk = (subs, parentTask, breadcrumb) => {
    (subs || []).forEach(sub => {
      if (sub.dueDate && !sub.completed) {
        results.push({ _type: "subtask", sub, parentTask, breadcrumb: [...breadcrumb, sub.title] });
      }
      walk(sub.subtasks, parentTask, [...breadcrumb, sub.title]);
    });
  };
  tasks.forEach(t => {
    if (!t.completed) walk(t.subtasks, t, [t.title]);
  });
  return results;
};

const KanbanBoard = ({tasks, columns, onColumnsChange, onResetColumns, onSelect, onUpdate, onToggle, onUpdateSubtask, flash, setIsDragging, animatingTasks}) => {
  const [hoverCol, setHoverCol] = useState(null);
  const [editingCol, setEditingCol] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDate, setEditDate] = useState("");

  const overdueTasks = useMemo(() => tasks.filter(t => !t.completed && t.dueDate && t.dueDate < todayStr()), [tasks]);

  /* Collect subtasks with own due dates */
  const datedSubs = useMemo(() => collectDatedSubtasks(tasks), [tasks]);

  const byDate = useMemo(() => {
    const map = {};
    const colDates = new Set(columns.map(c => c.dateStr));
    columns.forEach(c => {
      const directTasks = tasks.filter(t => !t.completed && t.dueDate === c.dateStr);
      /* Add surfaced subtasks whose dueDate matches this column AND parent task isn't already in this column */
      const surfaced = datedSubs.filter(ds => ds.sub.dueDate === c.dateStr && ds.parentTask.dueDate !== c.dateStr);
      map[c.dateStr] = { tasks: directTasks, subtasks: surfaced };
    });
    return map;
  }, [tasks, columns, datedSubs]);

  const onColDragOver = (e, ds) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHoverCol(ds); };
  const onColDrop = (e, ds) => {
    e.preventDefault(); setHoverCol(null);
    const tid = e.dataTransfer.getData("text/plain");
    if (!tid) return;
    const t = tasks.find(x => x.id === tid);
    if (t) onUpdate({ ...t, dueDate: ds });
  };

  const startEdit = (col) => { setEditingCol(col.id); setEditName(col.name); setEditDate(col.dateStr); };
  const saveEdit = () => {
    if (!editingCol) return;
    onColumnsChange(columns.map(c => c.id === editingCol ? { ...c, name: editName.trim() || c.name, dateStr: editDate || c.dateStr } : c));
    setEditingCol(null);
  };
  const removeCol = (id) => { if (columns.length <= 1) return; onColumnsChange(columns.filter(c => c.id !== id)); };
  const addCol = () => {
    const lastDate = columns[columns.length - 1]?.dateStr || todayStr();
    const d = new Date(lastDate + "T12:00:00"); d.setDate(d.getDate() + 1);
    const ds = localDateStr(d);
    const label = d.toLocaleDateString("en-IE", { weekday: "long" });
    onColumnsChange([...columns, { id: uid(), name: label, dateStr: ds }]);
  };

  return (
    <div data-kanban-scroll style={{display:"flex",gap:16,height:"100%",overflowX:"auto",paddingBottom:16}}>
      {overdueTasks.length > 0 && (
        <div style={{minWidth:220,maxWidth:280,flex:"1 0 220px",display:"flex",flexDirection:"column",background:"#fef2f2",borderRadius:14,border:"1px solid #fecaca",overflow:"hidden"}}>
          <div style={{padding:"14px 14px 10px",borderBottom:"1px solid #fecaca",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#ef4444"}}>Overdue</div>
              <div style={{fontSize:12,color:"#f87171",marginTop:2}}>{overdueTasks.length} task{overdueTasks.length !== 1 ? "s" : ""}</div>
            </div>
            <button onClick={()=>{overdueTasks.forEach(t=>onUpdate({...t,dueDate:todayStr()}));if(flash)flash(`Moved ${overdueTasks.length} task${overdueTasks.length!==1?"s":""} to today`);}}
              style={{fontSize:11,fontWeight:700,color:"#ef4444",background:"white",border:"1px solid #fecaca",borderRadius:8,padding:"5px 10px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",transition:"background 0.15s"}}
              onMouseEnter={e=>e.currentTarget.style.background="#fef2f2"}
              onMouseLeave={e=>e.currentTarget.style.background="white"}
              title="Move all overdue tasks to today">→ Today</button>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:8}}>
            {overdueTasks.map(t => (
              <KanbanCard key={t.id} task={t} onSelect={onSelect} onToggle={onToggle} onDragBegin={setIsDragging} animateState={animatingTasks?.[t.id]} />
            ))}
          </div>
        </div>
      )}
      {columns.map(col => {
        const colData = byDate[col.dateStr] || { tasks: [], subtasks: [] };
        const colTasks = colData.tasks;
        const colSubs = colData.subtasks;
        const totalItems = colTasks.length + colSubs.length;
        const isHover = hoverCol === col.dateStr;
        const isToday = col.dateStr === todayStr();
        const isEditing = editingCol === col.id;
        return (
          <div key={col.id}
            data-drop-type="date" data-drop-value={col.dateStr}
            onDragOver={e => onColDragOver(e, col.dateStr)}
            onDragLeave={() => setHoverCol(null)}
            onDrop={e => onColDrop(e, col.dateStr)}
            style={{minWidth:220,maxWidth:280,flex:"1 0 220px",display:"flex",flexDirection:"column",
              background:isHover?"rgba(217,119,6,0.08)":isToday?"rgba(217,119,6,0.04)":"var(--surface)",
              borderRadius:14,border:isHover?"2px solid var(--accent)":`1px solid ${isToday?"rgba(217,119,6,0.3)":"var(--border)"}`,
              overflow:"hidden",transition:"border 0.15s, background 0.15s"}}>
            <div style={{padding:"10px 14px 8px",borderBottom:`1px solid ${isToday?"rgba(217,119,6,0.2)":"var(--border)"}`}}>
              {isEditing ? (
                <div style={{display:"flex",flexDirection:"column",gap:6}} onClick={e=>e.stopPropagation()}>
                  <input autoFocus value={editName} onChange={e=>setEditName(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter")saveEdit();if(e.key==="Escape")setEditingCol(null);}}
                    style={{fontSize:14,fontWeight:700,border:"1px solid var(--accent)",borderRadius:6,padding:"3px 8px",outline:"none",fontFamily:"inherit",background:"white",color:"var(--ink)",width:"100%",boxSizing:"border-box"}}/>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <input type="date" value={editDate} onChange={e=>setEditDate(e.target.value)}
                      style={{fontSize:12,border:"1px solid var(--border)",borderRadius:6,padding:"3px 6px",fontFamily:"inherit",flex:1}}/>
                    <button onClick={saveEdit} style={{fontSize:11,fontWeight:700,color:"white",background:"var(--accent)",border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>Save</button>
                    {columns.length > 1 && <button onClick={()=>{removeCol(col.id);setEditingCol(null);}} title="Remove column" style={{fontSize:13,fontWeight:700,color:"#ef4444",background:"#fef2f2",border:"none",borderRadius:6,padding:"3px 7px",cursor:"pointer",fontFamily:"inherit",lineHeight:1}}>✕</button>}
                  </div>
                </div>
              ) : (
                <div onClick={()=>startEdit(col)} style={{cursor:"pointer"}} title="Click to edit column">
                  <div style={{fontSize:14,fontWeight:700,color:isToday?"var(--accent)":"var(--ink)"}}>{col.name}</div>
                  <div style={{fontSize:12,color:"var(--muted)",marginTop:2}}>{formatDate(col.dateStr)} · {totalItems} task{totalItems !== 1 ? "s" : ""}</div>
                </div>
              )}
            </div>
            <div style={{flex:1,overflowY:"auto",padding:8,minHeight:100}}>
              {totalItems === 0 && (
                <div style={{textAlign:"center",padding:"24px 8px",color:"var(--muted)",fontSize:12,fontStyle:"italic"}}>Drop tasks here</div>
              )}
              {colTasks.map(t => (
                <KanbanCard key={t.id} task={t} onSelect={onSelect} onToggle={onToggle} onDragBegin={setIsDragging} animateState={animatingTasks?.[t.id]} />
              ))}
              {colSubs.length > 0 && colTasks.length > 0 && <div style={{borderTop:"1px dashed var(--border)",margin:"6px 0"}} />}
              {colSubs.map(ds => (
                <SubtaskKanbanCard key={ds.sub.id} subInfo={ds} onSelect={onSelect} onToggleSub={onUpdateSubtask} />
              ))}
            </div>
          </div>
        );
      })}
      {/* Add column */}
      <div style={{minWidth:100,flex:"0 0 100px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
        <div onClick={addCol} style={{width:"100%",flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",borderRadius:14,border:"2px dashed var(--border)",cursor:"pointer",transition:"border-color 0.15s,background 0.15s",background:"transparent",gap:4}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--accent)";e.currentTarget.style.background="rgba(217,119,6,0.04)";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.background="transparent";}}>
          <span style={{fontSize:22,color:"var(--muted)",lineHeight:1}}>+</span>
          <span style={{fontSize:11,color:"var(--muted)",fontWeight:600}}>Column</span>
        </div>
        {onResetColumns && (
          <button onClick={onResetColumns} style={{fontSize:11,color:"var(--muted)",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:"4px 8px",borderRadius:6,transition:"color 0.15s",whiteSpace:"nowrap"}}
            onMouseEnter={e=>e.currentTarget.style.color="var(--accent)"}
            onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>↻ Reset defaults</button>
        )}
      </div>
    </div>
  );
};

const KanbanCard = ({task, onSelect, onToggle, onDragBegin, animateState}) => {
  const pc = PRIORITY[task.priority || "none"].color;
  return (
    <div draggable
      data-drag-id={task.id} data-drag-source="task" data-drag-label={task.title}
      onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", task.id); if(onDragBegin)onDragBegin(true); }}
      onDragEnd={()=>{ if(onDragBegin) onDragBegin(false); }}
      onClick={() => onSelect(task)}
      style={{padding:"10px 12px",background:"white",borderRadius:10,marginBottom:6,cursor:"grab",touchAction:"none",
        borderLeft:`3px solid ${pc}`,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",
        animation:animateState==="complete"?"cardComplete 0.6s ease forwards":animateState==="uncomplete"?"cardUncomplete 0.5s ease forwards":"none",
        transition:"box-shadow 0.15s,transform 0.15s"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
        <div style={{paddingTop:1,animation:animateState?"checkPop 0.45s ease":"none"}}>
          <Checkbox checked={task.completed} priority={task.priority} size={16} onChange={()=>onToggle(task.id)} animating={!!animateState}/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:500,color:"var(--ink)",lineHeight:1.4,wordWrap:"break-word"}}>{task.title}</div>
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginTop:4}}>
            {task.priority !== "none" && <span style={{fontSize:10,fontWeight:700,color:pc}}>{PRIORITY[task.priority].label}</span>}
            {(task.tags||[]).map(t => <span key={t} style={{fontSize:10,color:"var(--accent)"}}>#{t}</span>)}
            {task.notes && <span style={{color:"#cbd5e1",display:"flex",transform:"scale(0.8)"}}>{Icons.note}</span>}
            {(task.subtasks||[]).length > 0 && (() => { const {total,done} = countSubs(task.subtasks); return <span style={{fontSize:10,color:done===total?"#16a34a":"var(--muted)"}}>{Icons.subtask} {done}/{total}</span>; })()}
            <span style={{fontSize:10,color:"var(--muted)",background:"var(--surface)",padding:"1px 5px",borderRadius:3}}>{task.list}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

/* Surfaced subtask card — shows a subtask on the kanban with parent breadcrumb */
const SubtaskKanbanCard = ({subInfo, onSelect, onToggleSub}) => {
  const {sub, parentTask, breadcrumb} = subInfo;
  const parentLabel = breadcrumb.length > 1 ? breadcrumb.slice(0, -1).join(" › ") : parentTask.title;
  const pc = PRIORITY[sub.priority || "none"].color;
  return (
    <div onClick={() => onSelect(parentTask)}
      style={{padding:"10px 12px",background:"white",borderRadius:10,marginBottom:6,cursor:"pointer",touchAction:"none",
        borderLeft:`3px solid ${pc}`,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",
        border:"1px dashed var(--border)",transition:"box-shadow 0.15s"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
        <div style={{paddingTop:1}}>
          <Checkbox checked={sub.completed} priority={sub.priority} size={16}
            onChange={()=>onToggleSub(parentTask.id, sub.id)}/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:500,color:"var(--ink)",lineHeight:1.4,wordWrap:"break-word"}}>{sub.title}</div>
          <div style={{display:"flex",alignItems:"center",gap:4,marginTop:3,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:"var(--accent)",fontWeight:500,display:"flex",alignItems:"center",gap:2}}>
              ↳ {parentLabel}
            </span>
            <span style={{fontSize:10,color:"var(--muted)",background:"var(--surface)",padding:"1px 5px",borderRadius:3}}>{parentTask.list}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   CALENDAR VIEW — vertical scroll, drag-to-move, drag-to-resize duration
   ═══════════════════════════════════════════════════════════════════════ */
const CalendarView = ({tasks, onSelect, onUpdate}) => {
  const scrollRef = useRef(null);
  const currentMonthRef = useRef(null);
  const [extraMonths, setExtraMonths] = useState(0);
  const td = todayStr();
  const [dragInfo, setDragInfo] = useState(null); // {taskId, type:'move'|'resize-start'|'resize-end'}
  const [hoverDate, setHoverDate] = useState(null);

  const PAST = 2, FUTURE = 12;
  const months = useMemo(() => {
    const now = new Date();
    const r = [];
    for (let i = -PAST; i <= FUTURE + extraMonths; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      r.push({ year: d.getFullYear(), month: d.getMonth(), isCurrent: i === 0 });
    }
    return r;
  }, [extraMonths]);

  /* scroll to current month on mount */
  useEffect(() => { setTimeout(() => currentMonthRef.current?.scrollIntoView({ block: "start" }), 80); }, []);

  /* infinite scroll */
  const onScroll = () => {
    const el = scrollRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 300) setExtraMonths(p => p + 6);
  };

  /* helper: date string */
  const ds = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  /* weeks for a month: each week = array of 7 date-strings or null */
  const getWeeks = (yr, mo) => {
    const last = new Date(yr, mo + 1, 0).getDate();
    const weeks = [];
    let week = Array(7).fill(null);
    for (let d = 1; d <= last; d++) {
      const dow = (new Date(yr, mo, d).getDay() + 6) % 7;
      week[dow] = ds(yr, mo, d);
      if (dow === 6 || d === last) { weeks.push(week); week = Array(7).fill(null); }
    }
    return weeks;
  };

  /* index single-day tasks by dueDate (exclude multi-day) */
  const tasksByDate = useMemo(() => {
    const map = {};
    tasks.forEach(t => {
      if (t.dueDate && !(t.startDate && t.endDate && t.startDate !== t.endDate))
        (map[t.dueDate] ||= []).push(t);
    });
    return map;
  }, [tasks]);

  /* multi-day tasks */
  const multiDay = useMemo(() => tasks.filter(t => t.startDate && t.endDate && t.startDate !== t.endDate), [tasks]);

  /* bars for one week + lane allocation */
  const getWeekBars = (week) => {
    const valid = week.filter(Boolean);
    if (!valid.length) return { bars: [], lanes: 0 };
    const wS = valid[0], wE = valid[valid.length - 1];
    const raw = multiDay
      .filter(t => t.startDate <= wE && t.endDate >= wS)
      .map(t => {
        const cS = t.startDate < wS ? wS : t.startDate;
        const cE = t.endDate > wE ? wE : t.endDate;
        let sc = week.indexOf(cS), ec = week.indexOf(cE);
        if (sc < 0) sc = week.findIndex(Boolean);
        if (ec < 0) ec = 6 - [...week].reverse().findIndex(Boolean);
        return { task: t, sc, ec, trimL: t.startDate < wS, trimR: t.endDate > wE };
      })
      .filter(b => b.ec >= b.sc);
    /* greedy lane allocation */
    const lanes = [];
    const allocated = raw.map(bar => {
      for (let l = 0; l < lanes.length; l++) {
        if (!lanes[l].some(b => b.sc <= bar.ec && b.ec >= bar.sc)) { lanes[l].push(bar); return { ...bar, lane: l }; }
      }
      lanes.push([bar]); return { ...bar, lane: lanes.length - 1 };
    });
    return { bars: allocated, lanes: lanes.length };
  };

  /* ── Drag handlers ────────────────────────────────────── */
  const startDrag = (e, task, type) => {
    e.stopPropagation();
    setDragInfo({ taskId: task.id, type });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.id);
    /* ghost label */
    const g = document.createElement("div");
    g.textContent = type === "resize-start" ? "◁ start" : type === "resize-end" ? "▷ end" : task.title;
    g.style.cssText = "position:absolute;top:-200px;padding:4px 10px;background:var(--ink,#1c1917);color:white;border-radius:6px;font-size:12px;white-space:nowrap;font-family:sans-serif;";
    document.body.appendChild(g);
    e.dataTransfer.setDragImage(g, 0, 0);
    requestAnimationFrame(() => g.remove());
  };

  const onCellOver = (e, d) => { if (!dragInfo) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHoverDate(d); };
  const onCellLeave = () => setHoverDate(null);

  const onCellDrop = (e, d) => {
    e.preventDefault(); setHoverDate(null);
    if (!dragInfo || !d) { setDragInfo(null); return; }
    const t = tasks.find(x => x.id === dragInfo.taskId);
    if (!t) { setDragInfo(null); return; }
    const u = { ...t };
    const { type } = dragInfo;

    if (type === "move") {
      if (t.startDate && t.endDate && t.startDate !== t.endDate) {
        const anchor = t.dueDate || t.startDate;
        const diff = Math.round((new Date(d) - new Date(anchor)) / 864e5);
        const shift = (s) => { if (!s) return s; const x = new Date(s+"T12:00:00"); x.setDate(x.getDate() + diff); return localDateStr(x); };
        u.dueDate = d; u.startDate = shift(t.startDate); u.endDate = shift(t.endDate);
      } else {
        u.dueDate = d;
      }
    } else if (type === "resize-start") {
      u.startDate = d;
      if (!u.endDate || d > u.endDate) u.endDate = d;
      if (u.dueDate && u.dueDate < d) u.dueDate = d;
    } else if (type === "resize-end") {
      u.endDate = d;
      if (!u.startDate || d < u.startDate) u.startDate = d;
      if (u.dueDate && u.dueDate > d) u.dueDate = d;
    }
    onUpdate(u);
    setDragInfo(null);
  };

  const endDrag = () => { setDragInfo(null); setHoverDate(null); };

  /* ── Render ───────────────────────────────────────────── */
  const BAR_H = 22, BAR_GAP = 2;

  return (
    <div ref={scrollRef} onScroll={onScroll} style={{height:"100%",overflowY:"auto",overflowX:"hidden",paddingBottom:40}}>
      {months.map(({ year, month, isCurrent }) => {
        const weeks = getWeeks(year, month);
        const label = new Date(year, month).toLocaleDateString("en-IE", { month: "long", year: "numeric" });
        return (
          <div key={`${year}-${month}`} ref={isCurrent ? currentMonthRef : null} style={{marginBottom:28}}>
            {/* Sticky month header */}
            <div style={{position:"sticky",top:0,zIndex:10,padding:"10px 0 8px",background:"var(--bg)",borderBottom:"2px solid var(--border)"}}>
              <h3 style={{margin:0,fontSize:18,fontFamily:"var(--font-display)",fontWeight:700,color:"var(--ink)"}}>{label}</h3>
            </div>
            {/* Weekday labels */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginTop:6}}>
              {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
                <div key={d} style={{textAlign:"center",fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.5,padding:"4px 0"}}>{d}</div>
              ))}
            </div>
            {/* Weeks */}
            {weeks.map((week, wi) => {
              const { bars, lanes } = getWeekBars(week);
              const barsH = lanes * (BAR_H + BAR_GAP);
              return (
                <div key={wi} style={{position:"relative"}}>
                  {/* Day cell grid */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
                    {week.map((dStr, col) => {
                      const dayN = dStr ? parseInt(dStr.split("-")[2]) : null;
                      const isT = dStr === td;
                      const isH = dStr === hoverDate;
                      const dayTasks = dStr ? (tasksByDate[dStr] || []) : [];
                      return (
                        <div key={col} data-drop-type={dStr?"date":undefined} data-drop-value={dStr||undefined}
                          onDragOver={e => dStr && onCellOver(e, dStr)} onDragLeave={onCellLeave} onDrop={e => dStr && onCellDrop(e, dStr)}
                          style={{minHeight:56 + barsH,padding:4,overflow:"hidden",minWidth:0,background:isH?"rgba(217,119,6,0.12)":isT?"rgba(217,119,6,0.05)":"transparent",borderBottom:"1px solid var(--border-light)",borderRight:col < 6 ? "1px solid var(--border-light)":"none",transition:"background 0.1s"}}>
                          {dayN != null && (
                            <div style={{fontSize:13,fontWeight:isT?800:500,width:isT?26:"auto",height:isT?26:"auto",borderRadius:"50%",display:isT?"flex":"block",alignItems:"center",justifyContent:"center",background:isT?"var(--accent)":"none",color:isT?"white":dStr < td?"var(--muted)":"var(--text)",marginBottom:2}}>{dayN}</div>
                          )}
                          {/* spacer for multi-day bars */}
                          {barsH > 0 && <div style={{height:barsH}} />}
                          {/* single-day tasks */}
                          {dayTasks.slice(0, 4).map(t => (
                            <div key={t.id} draggable onDragStart={e => startDrag(e, t, "move")} onDragEnd={endDrag}
                              data-drag-id={t.id} data-drag-source="task" data-drag-label={t.title}
                              onClick={e => { e.stopPropagation(); onSelect(t); }}
                              style={{fontSize:11,padding:"2px 5px",borderRadius:4,marginBottom:2,cursor:"pointer",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:500,maxWidth:"100%",display:"block",background:t.completed?"var(--surface)":`${PRIORITY[t.priority||"none"].color}15`,color:t.completed?"var(--muted)":"var(--text)",textDecoration:t.completed?"line-through":"none",borderLeft:`2px solid ${PRIORITY[t.priority||"none"].color}`,opacity:dragInfo?.taskId === t.id ? 0.3 : 1,touchAction:"none"}}
                              title={t.title}>{t.title}</div>
                          ))}
                          {dayTasks.length > 4 && <div style={{fontSize:10,color:"var(--muted)",paddingLeft:4}}>+{dayTasks.length - 4}</div>}
                        </div>
                      );
                    })}
                  </div>
                  {/* ── Multi-day bar overlay ── */}
                  {bars.map(bar => {
                    const leftPct = (bar.sc / 7) * 100;
                    const widthPct = ((bar.ec - bar.sc + 1) / 7) * 100;
                    const topPx = 30 + bar.lane * (BAR_H + BAR_GAP);
                    const pc = PRIORITY[bar.task.priority || "none"].color;
                    const isDragging = dragInfo?.taskId === bar.task.id;
                    return (
                      <div key={bar.task.id + "-" + wi}
                        style={{position:"absolute",left:`calc(${leftPct}% + 5px)`,width:`calc(${widthPct}% - 10px)`,top:topPx,height:BAR_H,display:"flex",alignItems:"center",borderRadius:5,background:bar.task.completed?"var(--surface)":`${pc}18`,border:`1px solid ${bar.task.completed?"var(--border)":`${pc}50`}`,fontSize:11,fontWeight:600,color:bar.task.completed?"var(--muted)":"var(--text)",cursor:"grab",overflow:"hidden",opacity:isDragging?0.3:1,pointerEvents:dragInfo && !isDragging?"none":"auto",zIndex:5,transition:"opacity 0.15s",touchAction:"none"}}
                        draggable onDragStart={e => startDrag(e, bar.task, "move")} onDragEnd={endDrag}
                        data-drag-id={bar.task.id} data-drag-source="task" data-drag-label={bar.task.title}
                        onClick={e => { e.stopPropagation(); onSelect(bar.task); }}>
                        {/* Left resize handle */}
                        {!bar.trimL && (
                          <div draggable onDragStart={e => { e.stopPropagation(); startDrag(e, bar.task, "resize-start"); }} onDragEnd={endDrag}
                            style={{width:7,minWidth:7,height:"100%",cursor:"ew-resize",background:`${pc}35`,borderRadius:"5px 0 0 5px",flexShrink:0}}
                            title="Drag to change start date" />
                        )}
                        <span style={{flex:1,padding:"0 5px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textDecoration:bar.task.completed?"line-through":"none"}}>{bar.task.title}</span>
                        {/* Right resize handle */}
                        {!bar.trimR && (
                          <div draggable onDragStart={e => { e.stopPropagation(); startDrag(e, bar.task, "resize-end"); }} onDragEnd={endDrag}
                            style={{width:7,minWidth:7,height:"100%",cursor:"ew-resize",background:`${pc}35`,borderRadius:"0 5px 5px 0",flexShrink:0}}
                            title="Drag to change end date" />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
      <div style={{textAlign:"center",padding:"20px 0 40px",color:"var(--muted)",fontSize:13}}>Scroll down for more months…</div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   TASK ROW — editable title, drag handle, collapsible subtasks
   ═══════════════════════════════════════════════════════════════════════ */
const TaskRow = ({task,isActive,isSelected,onSelect,onToggle,onUpdateTask,onDragStart,onDragOver,onDrop,onDragEnd,dropTarget,view,lists,animateState}) => {
  const [subsOpen,setSubsOpen]=useState(false);
  const clickTimer=useRef(null);
  const overdue=!task.completed&&isOverdue(task.dueDate);
  const {total:subTotal,done:subDone}=countSubs(task.subtasks);
  const hasDuration=task.startDate&&task.endDate;
  const isDT=dropTarget?.id===task.id;
  const dtZone=isDT?dropTarget.zone:null;

  const handleSubAction = (action, targetId, data) => {
    let newSubs;
    if(action==="remove") newSubs = removeSubById(task.subtasks||[], targetId);
    else if(action==="add") newSubs = addSubTo(task.subtasks||[], targetId, data);
    else newSubs = updateSubById(task.subtasks||[], targetId, data);
    onUpdateTask({...task, subtasks: newSubs});
  };

  const handleRowClick = (e) => {
    if(clickTimer.current) return;
    clickTimer.current = setTimeout(()=>{clickTimer.current=null; onSelect(task,e);}, 250);
  };
  const cancelRowClick = () => {
    if(clickTimer.current){clearTimeout(clickTimer.current);clickTimer.current=null;}
  };

  return (
    <div draggable onDragStart={e=>onDragStart(e,task,"task")} onDragOver={e=>onDragOver(e,task)} onDrop={e=>onDrop(e,task)} onDragEnd={onDragEnd}
      data-drag-id={task.id} data-drag-source="task" data-drag-label={task.title}
      data-drop-type="task" data-drop-value={task.id} data-drop-zone="nest"
      style={{marginBottom:2,borderRadius:12,position:"relative",touchAction:"none",
        background:isSelected?"rgba(217,119,6,0.1)":dtZone==="nest"?"rgba(217,119,6,0.08)":isActive?"var(--active-bg)":"transparent",
        outline:isSelected?"2px solid var(--accent)":dtZone==="nest"?"2px dashed var(--accent)":"none",
        animation:animateState==="complete"?"taskComplete 0.7s ease forwards":animateState==="uncomplete"?"taskUncomplete 0.6s ease forwards":"none",
        transition:"background 0.15s,opacity 0.3s,outline 0.1s",opacity:task.completed&&!animateState?0.45:animateState?undefined:1}}>
      {/* Drop indicator lines */}
      {dtZone==="before"&&<div style={{position:"absolute",top:-1,left:12,right:12,height:2,background:"var(--accent)",borderRadius:1,zIndex:5}}/>}
      {dtZone==="after"&&<div style={{position:"absolute",bottom:-1,left:12,right:12,height:2,background:"var(--accent)",borderRadius:1,zIndex:5}}/>}
      {dtZone==="nest"&&<div style={{position:"absolute",left:42,top:"50%",transform:"translateY(-50)",fontSize:10,color:"var(--accent)",fontWeight:700,zIndex:5,pointerEvents:"none"}}>↳ nest</div>}

      <div onClick={handleRowClick} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"11px 12px",cursor:"pointer"}}>
        <div style={{paddingTop:3,cursor:"grab",color:"var(--border)"}} onMouseDown={e=>e.stopPropagation()}>{Icons.grip}</div>
        <div style={{paddingTop:2,animation:animateState?"checkPop 0.45s ease":"none"}}><Checkbox checked={task.completed} priority={task.priority} onChange={()=>onToggle(task.id)} animating={!!animateState}/></div>
        <div style={{flex:1,minWidth:0}}>
          <EditableText value={task.title} onSave={t=>onUpdateTask({...task,title:t})} onEditStart={cancelRowClick}
            style={{fontSize:15,fontWeight:task.completed?400:500,lineHeight:1.4,color:task.completed?"var(--muted)":"var(--ink)",textDecoration:task.completed?"line-through":"none",display:"block",marginBottom:3}}/>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <InlineDatePicker value={task.dueDate} overdue={overdue} onChange={d=>onUpdateTask({...task,dueDate:d||null})}/>
            {hasDuration&&<span style={{fontSize:11,display:"flex",alignItems:"center",gap:3,color:"var(--muted)"}}>{Icons.duration} {formatDate(task.startDate)}–{formatDate(task.endDate)}</span>}
            {task.priority!=="none"&&<span style={{fontSize:11,fontWeight:700,display:"flex",alignItems:"center",gap:3,color:PRIORITY[task.priority].color}}>{Icons.flag} {PRIORITY[task.priority].label}</span>}
            {subTotal>0&&(<button onClick={e=>{e.stopPropagation();setSubsOpen(!subsOpen);}} style={{fontSize:12,display:"flex",alignItems:"center",gap:3,color:subDone===subTotal?"#16a34a":"var(--muted)",background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"inherit"}}>{Icons.subtask} {subDone}/{subTotal} <span style={{transform:subsOpen?"rotate(0)":"rotate(-90deg)",transition:"transform 0.15s",display:"flex"}}>{Icons.chevD}</span></button>)}
            {(task.tags||[]).map(t=><span key={t} style={{fontSize:11,color:"var(--accent)",fontWeight:500}}>#{t}</span>)}
            {task.notes&&<span style={{color:"#cbd5e1",display:"flex"}}>{Icons.note}</span>}
            {!view.startsWith("list:")&&view!=="inbox"&&<span style={{fontSize:11,color:"var(--muted)",background:"var(--surface)",padding:"1px 7px",borderRadius:4}}>{task.list}</span>}
          </div>
        </div>
      </div>
      {/* Expanded subtasks — each one is draggable to promote */}
      {subsOpen&&subTotal>0&&(
        <div style={{paddingLeft:52,paddingBottom:8,paddingRight:12}}>
          <DraggableSubtaskTree subtasks={task.subtasks} onAction={handleSubAction} onDragStart={onDragStart} onDragEnd={onDragEnd} parentTask={task}/>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════
   LOGIN SCREEN
   ═══════════════════════════════════════════════════════════════════════ */
const LoginScreen = ({ onSignIn, onSignInPassword, error }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("magic"); /* magic | password | signup */
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleMagicLink = async () => {
    if (!email.trim()) return;
    setLoading(true);
    const ok = await onSignIn(email.trim());
    setLoading(false);
    if (ok) setSent(true);
  };

  const handlePassword = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    await onSignInPassword(email.trim(), password, mode === "signup");
    setLoading(false);
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)",fontFamily:"var(--font-body)",padding:20}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&family=Source+Sans+3:wght@300;400;500;600;700&display=swap');
        :root{--font-display:'Playfair Display',Georgia,serif;--font-body:'Source Sans 3',-apple-system,sans-serif;--ink:#1c1917;--text:#44403c;--muted:#a8a29e;--bg:#fafaf9;--surface:#f5f5f4;--border:#e7e5e4;--accent:#d97706;--accent-dark:#b45309;--accent-bg:#fffbeb;}
        *{box-sizing:border-box;margin:0;padding:0;font-family:var(--font-body);}
        html,body{height:100%;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;}`}
      </style>
      <div style={{maxWidth:380,width:"100%",textAlign:"center"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:32}}>
          <div style={{width:40,height:40,background:"linear-gradient(135deg,#d97706,#ea580c)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontFamily:"var(--font-display)",fontSize:20}}>I</div>
          <h1 style={{fontFamily:"var(--font-display)",fontSize:32,fontWeight:700,color:"var(--ink)"}}>Inkwell</h1>
        </div>
        <p style={{color:"var(--muted)",fontSize:15,marginBottom:32}}>Sign in to sync your tasks across devices</p>

        {sent ? (
          <div style={{padding:24,background:"var(--accent-bg)",borderRadius:14,border:"1px solid rgba(217,119,6,0.2)"}}>
            <div style={{fontSize:32,marginBottom:8}}>✉️</div>
            <p style={{fontWeight:600,color:"var(--ink)",marginBottom:8}}>Check your email</p>
            <p style={{color:"var(--muted)",fontSize:14}}>We sent a magic link to <strong>{email}</strong></p>
            <button onClick={()=>setSent(false)} style={{marginTop:16,background:"none",border:"none",color:"var(--accent)",cursor:"pointer",fontSize:13,fontFamily:"inherit"}}>Use a different email</button>
          </div>
        ) : (
          <div style={{background:"white",borderRadius:16,border:"1px solid var(--border)",padding:24,boxShadow:"0 2px 12px rgba(0,0,0,0.04)"}}>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com"
              onKeyDown={e=>e.key==="Enter"&&(mode==="magic"?handleMagicLink():handlePassword())}
              style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1px solid var(--border)",fontSize:15,outline:"none",marginBottom:10,fontFamily:"inherit",background:"var(--surface)"}}/>

            {mode !== "magic" && (
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password"
                onKeyDown={e=>e.key==="Enter"&&handlePassword()}
                style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1px solid var(--border)",fontSize:15,outline:"none",marginBottom:10,fontFamily:"inherit",background:"var(--surface)"}}/>
            )}

            {error && <p style={{color:"#ef4444",fontSize:13,marginBottom:10}}>{error}</p>}

            {mode === "magic" ? (
              <button onClick={handleMagicLink} disabled={loading}
                style={{width:"100%",padding:"12px",borderRadius:10,border:"none",background:loading?"var(--muted)":"linear-gradient(135deg,#d97706,#ea580c)",color:"white",fontSize:15,fontWeight:600,cursor:loading?"wait":"pointer",fontFamily:"inherit",marginBottom:12}}>
                {loading ? "Sending..." : "Send magic link ✨"}
              </button>
            ) : (
              <button onClick={handlePassword} disabled={loading}
                style={{width:"100%",padding:"12px",borderRadius:10,border:"none",background:loading?"var(--muted)":"linear-gradient(135deg,#d97706,#ea580c)",color:"white",fontSize:15,fontWeight:600,cursor:loading?"wait":"pointer",fontFamily:"inherit",marginBottom:12}}>
                {loading ? "..." : mode === "signup" ? "Create account" : "Sign in"}
              </button>
            )}

            <div style={{display:"flex",justifyContent:"center",gap:16,fontSize:13}}>
              {mode === "magic" ? (
                <button onClick={()=>setMode("password")} style={{background:"none",border:"none",color:"var(--accent)",cursor:"pointer",fontFamily:"inherit"}}>Use password instead</button>
              ) : (
                <>
                  <button onClick={()=>setMode("magic")} style={{background:"none",border:"none",color:"var(--accent)",cursor:"pointer",fontFamily:"inherit"}}>Use magic link</button>
                  <span style={{color:"var(--border)"}}>|</span>
                  <button onClick={()=>setMode(mode==="signup"?"password":"signup")} style={{background:"none",border:"none",color:"var(--accent)",cursor:"pointer",fontFamily:"inherit"}}>
                    {mode==="signup"?"Sign in":"Create account"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default function InkwellApp() {
  const { user, authLoading, authError, signInWithEmail, signInWithPassword, signOut, loadFromCloud, saveToCloud, hasSupabase } = useSupabaseSync();
  const [tasks,setTasks]=useState([]);
  const [lists,setLists]=useState(DEFAULT_LISTS);
  const [view,setView]=useState("today");
  const [selectedTask,setSelectedTask]=useState(null);
  const [showPhoto,setShowPhoto]=useState(false);
  const [scanResults,setScanResults]=useState(null);
  const [processing,setProcessing]=useState(false);
  const [search,setSearch]=useState("");
  const [showSearch,setShowSearch]=useState(false);
  const [newTitle,setNewTitle]=useState("");
  const [newList,setNewList]=useState("");
  const [showNewList,setShowNewList]=useState(false);
  const [ready,setReady]=useState(false);
  const [sidebar,setSidebar]=useState(true);
  const [toast,setToast]=useState(null);
  const [isMobile,setIsMobile]=useState(false);
  const [dragTask,setDragTask]=useState(null);
  const [isDragging,setIsDragging]=useState(false);

  /* Global drag detection — uses dragover heartbeat so re-renders can't kill it */
  useEffect(()=>{
    let timer=null;
    const pulse=()=>{setIsDragging(true);clearTimeout(timer);timer=setTimeout(()=>setIsDragging(false),150);};
    const onEnd=()=>{clearTimeout(timer);setIsDragging(false);};
    document.addEventListener("dragover",pulse);
    document.addEventListener("dragend",onEnd);
    document.addEventListener("drop",onEnd);
    return()=>{document.removeEventListener("dragover",pulse);document.removeEventListener("dragend",onEnd);document.removeEventListener("drop",onEnd);clearTimeout(timer);};
  },[]);
  const [selectedIds,setSelectedIds]=useState(new Set());
  const [dropTarget,setDropTarget]=useState(null); // {id, zone:'before'|'nest'|'after'}
  /* Safety: clear stale drop target if no drag is active */
  useEffect(()=>{if(!dragTask&&dropTarget)setDropTarget(null);},[dragTask,dropTarget]);
  /* Safety: if isDragging stays false for 500ms but dragTask is set, force cleanup */
  useEffect(()=>{
    if(!isDragging&&dragTask){const t=setTimeout(()=>setDragTask(null),500);return()=>clearTimeout(t);}
  },[isDragging,dragTask]);
  const [showShortcuts,setShowShortcuts]=useState(false);
  const [showSettings,setShowSettings]=useState(false);
  const [showTips,setShowTips]=useState(()=>{if(typeof window==="undefined")return false;if(!localStorage.getItem("inkwell-welcomed")){localStorage.setItem("inkwell-welcomed","1");return true;}return false;});
  const [listMenu,setListMenu]=useState(null); // {name, x, y}
  const [editingList,setEditingList]=useState(null);
  const [dragList,setDragList]=useState(null);
  const [dragListOver,setDragListOver]=useState(null);
  const [showViewCounts,setShowViewCounts]=useState(()=>load("inkwell-showViewCounts",true));
  const [showListCounts,setShowListCounts]=useState(()=>load("inkwell-showListCounts",true));
  const [todayMode,setTodayMode]=useState(()=>load("inkwell-todayMode","kanban")); /* "kanban" | "list" */
  const [kanbanColumns, setKanbanColumns] = useState(() => {
    const saved = load("inkwell-kanbanCols", null);
    if (!saved || saved.length === 0) return null;
    /* Auto-expire: if the first column date is before today, the window has drifted → reset */
    const today = todayStr();
    const firstDate = saved[0]?.dateStr;
    if (firstDate && firstDate < today) return null;
    return saved;
  });
  useEffect(() => { save("inkwell-kanbanCols", kanbanColumns); }, [kanbanColumns]);
  const activeKanbanCols = useMemo(() => {
    if (kanbanColumns && kanbanColumns.length > 0) return kanbanColumns;
    /* Default: today + next 3 days */
    const cols = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const ds = localDateStr(d);
      const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-IE", { weekday: "long" });
      cols.push({ id: `default-${i}`, name: label, dateStr: ds });
    }
    return cols;
  }, [kanbanColumns]);
  const resetKanbanCols = useCallback(() => { setKanbanColumns(null); }, []);
  /* Auto-reset stale columns when tab regains focus (handles overnight) */
  useEffect(() => {
    const check = () => {
      if (document.hidden) return;
      setKanbanColumns(prev => {
        if (!prev || prev.length === 0) return prev;
        if (prev[0]?.dateStr < todayStr()) return null;
        return prev;
      });
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);
  useEffect(()=>{save("inkwell-showViewCounts",showViewCounts);},[showViewCounts]);
  useEffect(()=>{save("inkwell-showListCounts",showListCounts);},[showListCounts]);
  useEffect(()=>{save("inkwell-todayMode",todayMode);},[todayMode]);

  useEffect(()=>{
    const init = async () => {
      /* Try cloud first, fall back to localStorage */
      let cloudData = null;
      if (hasSupabase && user) {
        cloudData = await loadFromCloud();
      }
      if (cloudData) {
        setTasks(cloudData.tasks || []);
        setLists(cloudData.lists || DEFAULT_LISTS);
        if (cloudData.settings) {
          if (cloudData.settings.showViewCounts !== undefined) setShowViewCounts(cloudData.settings.showViewCounts);
          if (cloudData.settings.showListCounts !== undefined) setShowListCounts(cloudData.settings.showListCounts);
        }
        /* Also update localStorage as cache */
        save(TASKS_KEY, cloudData.tasks || []);
        save(LISTS_KEY, cloudData.lists || DEFAULT_LISTS);
      } else {
        setTasks(load(TASKS_KEY, []));
        setLists(load(LISTS_KEY, DEFAULT_LISTS));
      }
      setReady(true);
    };
    init();
    const mob=window.innerWidth<768;setIsMobile(mob);if(mob)setSidebar(false);
    const fn=()=>{const m=window.innerWidth<768;setIsMobile(m);if(m)setSidebar(false);};
    window.addEventListener("resize",fn);
    if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
    return()=>window.removeEventListener("resize",fn);
  },[user, hasSupabase]);
  useEffect(()=>{if(ready){save(TASKS_KEY,tasks);saveToCloud(tasks,lists,{showViewCounts,showListCounts});}},[tasks,ready]);
  useEffect(()=>{if(ready){save(LISTS_KEY,lists);saveToCloud(tasks,lists,{showViewCounts,showListCounts});}},[lists,ready]);
  useEffect(()=>{if(ready)saveToCloud(tasks,lists,{showViewCounts,showListCounts});},[showViewCounts,showListCounts]);
  useEffect(()=>{if(selectedTask){const u=tasks.find(t=>t.id===selectedTask.id);if(u)setSelectedTask(u);else setSelectedTask(null);}},[tasks]);
  const flash=msg=>{setToast(msg);setTimeout(()=>setToast(null),3000);};

  /* Bulk operations */
  const bulkDelete=()=>{setTasks(prev=>prev.filter(t=>!selectedIds.has(t.id)));flash(`Deleted ${selectedIds.size} tasks`);setSelectedIds(new Set());setSelectedTask(null);};
  const bulkMove=(listName)=>{setTasks(prev=>prev.map(t=>selectedIds.has(t.id)?{...t,list:listName}:t));flash(`Moved ${selectedIds.size} tasks to ${listName}`);setSelectedIds(new Set());};
  const bulkPriority=(p)=>{setTasks(prev=>prev.map(t=>selectedIds.has(t.id)?{...t,priority:p}:t));flash(`Set ${selectedIds.size} tasks to ${PRIORITY[p].label}`);setSelectedIds(new Set());};
  const bulkComplete=()=>{setTasks(prev=>prev.map(t=>selectedIds.has(t.id)?{...t,completed:true,completedAt:new Date().toISOString()}:t));flash(`Completed ${selectedIds.size} tasks`);setSelectedIds(new Set());};





  const addTask=useCallback(data=>{
    const task={id:uid(),title:data.title||"Untitled",completed:data.completed||false,dueDate:data.dueDate||todayStr(),startDate:data.startDate||null,endDate:data.endDate||null,priority:data.priority||"none",list:data.list||(view.startsWith("list:")?view.replace("list:",""):"Inbox"),subtasks:data.subtasks||[],notes:data.notes||"",tags:data.tags||[],createdAt:new Date().toISOString(),completedAt:data.completed?new Date().toISOString():null};
    setTasks(prev=>[task,...prev]);return task;
  },[view]);

  const updateTask=useCallback(updated=>{setTasks(prev=>prev.map(t=>t.id===updated.id?updated:t));},[]);
  const [animatingTasks,setAnimatingTasks]=useState({}); /* {taskId: "complete"|"uncomplete"} */
  const toggleTask=useCallback(id=>{
    setTasks(prev=>prev.map(t=>{
      if(t.id!==id) return t;
      const nowComplete = !t.completed;
      return {...t,completed:nowComplete,completedAt:nowComplete?new Date().toISOString():null};
    }));
    /* Trigger animation */
    setAnimatingTasks(prev=>{
      const task = tasks.find(t=>t.id===id);
      return {...prev, [id]: task?.completed ? "uncomplete" : "complete"};
    });
    setTimeout(()=>setAnimatingTasks(prev=>{const n={...prev};delete n[id];return n;}), 900);
  },[tasks]);
  const deleteTask=useCallback(id=>{setTasks(prev=>prev.filter(t=>t.id!==id));if(selectedTask?.id===id)setSelectedTask(null);},[selectedTask]);

  const renameList=useCallback((oldN,newN)=>{if(!newN.trim()||newN===oldN||lists.includes(newN))return;setLists(prev=>prev.map(l=>l===oldN?newN:l));setTasks(prev=>prev.map(t=>t.list===oldN?{...t,list:newN}:t));if(view===`list:${oldN}`)setView(`list:${newN}`);},[lists,view]);
  const deleteList=useCallback((name)=>{if(name==="Inbox")return;const ct=tasks.filter(t=>t.list===name).length;if(ct>0&&!confirm(`"${name}" has ${ct} task${ct>1?"s":""}. They'll be moved to Inbox. Continue?`))return;setTasks(prev=>prev.map(t=>t.list===name?{...t,list:"Inbox"}:t));setLists(prev=>prev.filter(l=>l!==name));if(view===`list:${name}`)setView("all");flash(`Deleted list "${name}"`);},[tasks,view,flash]);
  const bulkDate=(d)=>{setTasks(prev=>prev.map(t=>selectedIds.has(t.id)?{...t,dueDate:d}:t));flash(`Set ${selectedIds.size} tasks to ${formatDate(d)}`);setSelectedIds(new Set());};

  const onDragStart=(e,task,source="task")=>{setDragTask({...task,_source:source});setIsDragging(true);e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",task.id);e.dataTransfer.setData("application/x-source",source);};
  const onDragOver=(e,overTask)=>{
    e.preventDefault();e.dataTransfer.dropEffect="move";
    if(!dragTask||dragTask.id===overTask?.id){setDropTarget(null);return;}
    if(!overTask){setDropTarget(null);return;}
    const rect=e.currentTarget.getBoundingClientRect();
    const y=(e.clientY-rect.top)/rect.height;
    const zone=y<0.25?"before":y>0.75?"after":"nest";
    setDropTarget({id:overTask.id,zone});
  };
  const onDrop=(e,overTask)=>{
    e.preventDefault();
    if(!dragTask||!overTask){setDragTask(null);setDropTarget(null);return;}
    const zone=dropTarget?.zone||"nest";
    const src=dragTask._source;

    if(dragTask.id===overTask.id){setDragTask(null);setDropTarget(null);return;}

    if(zone==="nest"){
      /* ── Nest: make dragged task a subtask of target ── */
      if(src==="subtask"){
        /* subtask→subtask nest: remove from old parent, add to new parent */
        setTasks(prev=>{
          let arr=prev.map(t=>({...t,subtasks:removeSubById(t.subtasks||[],dragTask.id)}));
          return arr.map(t=>t.id===overTask.id?{...t,subtasks:[...(t.subtasks||[]),{...dragTask,_source:undefined}]}:t);
        });
      } else {
        /* task→subtask: remove from top level, add as sub */
        const sub={id:dragTask.id,title:dragTask.title,completed:dragTask.completed,subtasks:dragTask.subtasks||[],dueDate:dragTask.dueDate,startDate:dragTask.startDate,endDate:dragTask.endDate,priority:dragTask.priority||"none",notes:dragTask.notes||"",tags:dragTask.tags||[]};
        setTasks(prev=>{
          const without=prev.filter(t=>t.id!==dragTask.id);
          return without.map(t=>t.id===overTask.id?{...t,subtasks:[...(t.subtasks||[]),sub]}:t);
        });
      }
      flash(`Nested under "${overTask.title}"`);
    } else {
      /* ── Reorder: insert before/after target ── */
      if(src==="subtask"){
        /* Promote subtask to task and insert at position */
        const promoted={id:dragTask.id,title:dragTask.title,completed:dragTask.completed||false,dueDate:dragTask.dueDate||todayStr(),startDate:dragTask.startDate||null,endDate:dragTask.endDate||null,priority:dragTask.priority||"none",list:overTask.list||"Inbox",subtasks:dragTask.subtasks||[],notes:dragTask.notes||"",tags:dragTask.tags||[],createdAt:new Date().toISOString(),completedAt:dragTask.completed?new Date().toISOString():null};
        setTasks(prev=>{
          const cleaned=prev.map(t=>({...t,subtasks:removeSubById(t.subtasks||[],dragTask.id)}));
          const idx=cleaned.findIndex(t=>t.id===overTask.id);
          const ins=zone==="after"?idx+1:idx;
          cleaned.splice(ins,0,promoted);
          return cleaned;
        });
        flash(`Promoted "${dragTask.title}" to task`);
      } else {
        setTasks(prev=>{
          const w=prev.filter(t=>t.id!==dragTask.id);
          const idx=w.findIndex(t=>t.id===overTask.id);
          const ins=zone==="after"?idx+1:idx;
          w.splice(ins,0,{...dragTask,_source:undefined,list:overTask.list});
          return w;
        });
      }
    }
    setDragTask(null);setDropTarget(null);setSelectedIds(new Set());setIsDragging(false);
  };
  const onDragEnd=()=>{setDragTask(null);setDropTarget(null);setIsDragging(false);};
  const onListDrop=(e,listName)=>{e.preventDefault();setDropTarget(null);const tid=e.dataTransfer.getData("text/plain");const src=e.dataTransfer.getData("application/x-source");
    if(tid&&src==="subtask"){
      /* Promote subtask to task in the target list */
      setTasks(prev=>{
        let sub=null;
        for(const t of prev){sub=findSubById(t.subtasks,tid);if(sub)break;}
        if(!sub)return prev;
        const cleaned=prev.map(t=>({...t,subtasks:removeSubById(t.subtasks||[],tid)}));
        const promoted={id:sub.id,title:sub.title,completed:sub.completed||false,dueDate:sub.dueDate||todayStr(),startDate:sub.startDate||null,endDate:sub.endDate||null,priority:sub.priority||"none",list:listName,subtasks:sub.subtasks||[],notes:sub.notes||"",tags:sub.tags||[],createdAt:new Date().toISOString(),completedAt:sub.completed?new Date().toISOString():null};
        return[promoted,...cleaned];
      });
      flash(`Promoted to "${listName}"`);
    } else if(tid){
      /* Multi-select: move all selected if applicable */
      const ids=selectedIds.size>1&&selectedIds.has(tid)?selectedIds:new Set([tid]);
      setTasks(prev=>prev.map(t=>ids.has(t.id)?{...t,list:listName}:t));
      flash(`Moved ${ids.size>1?ids.size+" tasks":"task"} to ${listName}`);
      setSelectedIds(new Set());
    }
    setIsDragging(false);
  };

  /* ── Multi-select handlers ── */
  const lastClickedIdx=useRef(null);
  const handleTaskClick=(task,e)=>{
    const idx=filtered.findIndex(t=>t.id===task.id);
    if(e.shiftKey&&lastClickedIdx.current!=null){
      const start=Math.min(lastClickedIdx.current,idx);
      const end=Math.max(lastClickedIdx.current,idx);
      const range=new Set(filtered.slice(start,end+1).map(t=>t.id));
      setSelectedIds(range);
    } else if(e.metaKey||e.ctrlKey){
      setSelectedIds(prev=>{const n=new Set(prev);if(n.has(task.id))n.delete(task.id);else n.add(task.id);return n;});
      lastClickedIdx.current=idx;
    } else {
      setSelectedIds(new Set());
      lastClickedIdx.current=idx;
      setSelectedTask(task);
    }
  };

  /* ── Touch drag handler ── */
  const touchDropHandler = useCallback((info) => {
    const { dragId, dragSource, dropType, dropValue } = info;
    if (!dragId) return;

    if (dropType === "date" && dropValue) {
      if (dragSource === "subtask") {
        setTasks(prev => {
          let sub = null;
          for (const t of prev) { sub = findSubById(t.subtasks, dragId); if (sub) break; }
          if (!sub) return prev;
          const cleaned = prev.map(t => ({...t, subtasks: removeSubById(t.subtasks||[], dragId)}));
          const promoted = {id:sub.id,title:sub.title,completed:sub.completed||false,dueDate:dropValue,startDate:sub.startDate||null,endDate:sub.endDate||null,priority:sub.priority||"none",list:"Inbox",subtasks:sub.subtasks||[],notes:sub.notes||"",tags:sub.tags||[],createdAt:new Date().toISOString(),completedAt:null};
          return [promoted,...cleaned];
        });
        flash("Promoted with date set");
      } else {
        setTasks(prev => prev.map(t => t.id === dragId ? {...t, dueDate: dropValue} : t));
        flash(`Due date set to ${formatDate(dropValue)}`);
      }
    } else if (dropType === "list" && dropValue) {
      if (dragSource === "subtask") {
        setTasks(prev => {
          let sub = null;
          for (const t of prev) { sub = findSubById(t.subtasks, dragId); if (sub) break; }
          if (!sub) return prev;
          const cleaned = prev.map(t => ({...t, subtasks: removeSubById(t.subtasks||[], dragId)}));
          const promoted = {id:sub.id,title:sub.title,completed:sub.completed||false,dueDate:sub.dueDate||todayStr(),startDate:sub.startDate||null,endDate:sub.endDate||null,priority:sub.priority||"none",list:dropValue,subtasks:sub.subtasks||[],notes:sub.notes||"",tags:sub.tags||[],createdAt:new Date().toISOString(),completedAt:null};
          return [promoted,...cleaned];
        });
        flash(`Promoted to "${dropValue}"`);
      } else if (dragSource === "listItem") {
        if (dragId !== dropValue) {
          setLists(prev => { const w = prev.filter(x => x !== dragId); const idx = w.indexOf(dropValue); w.splice(idx, 0, dragId); return w; });
        }
      } else {
        setTasks(prev => prev.map(t => t.id === dragId ? {...t, list: dropValue} : t));
        flash(`Moved to ${dropValue}`);
      }
    } else if (dropType === "task" && dropValue) {
      if (dragId === dropValue) return;
      const zone = info.dropZone || "nest";
      const overTask = tasks.find(t => t.id === dropValue);
      if (!overTask) return;
      if (zone === "nest") {
        if (dragSource === "subtask") {
          setTasks(prev => {
            let arr = prev.map(t => ({...t, subtasks: removeSubById(t.subtasks||[], dragId)}));
            const sub = (() => { let s = null; for (const t of tasks) { s = findSubById(t.subtasks, dragId); if (s) return s; } return null; })();
            if (!sub) return prev;
            return arr.map(t => t.id === dropValue ? {...t, subtasks: [...(t.subtasks||[]), sub]} : t);
          });
        } else {
          const dragTask = tasks.find(t => t.id === dragId);
          if (!dragTask) return;
          const sub = {id:dragTask.id,title:dragTask.title,completed:dragTask.completed,subtasks:dragTask.subtasks||[],dueDate:dragTask.dueDate,startDate:dragTask.startDate,endDate:dragTask.endDate,priority:dragTask.priority||"none",notes:dragTask.notes||"",tags:dragTask.tags||[]};
          setTasks(prev => {
            const without = prev.filter(t => t.id !== dragId);
            return without.map(t => t.id === dropValue ? {...t, subtasks: [...(t.subtasks||[]), sub]} : t);
          });
        }
        flash(`Nested under "${overTask.title}"`);
      }
    }
  }, [tasks, flash]);

  const touchSidebarCb = useCallback((show) => {
    if (isMobile) setSidebar(show);
  }, [isMobile]);
  useTouchDrag(touchDropHandler, setIsDragging, touchSidebarCb);

  /* Bulk operations */


  const handleScan=async(b64,mt)=>{setProcessing(true);try{const res=await fetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({imageData:b64,mediaType:mt,existingTasks:tasks.map(t=>t.title),existingLists:lists})});if(!res.ok){const err=await res.json();throw new Error(err.error||"Scan failed");}const results=await res.json();setShowPhoto(false);setScanResults(results);}catch(e){flash("⚠ "+(e.message||"Failed"));}setProcessing(false);};

  const confirmScan=items=>{let added=0,checked=0;const pageDate=scanResults?.page_date;const newCats=new Set();items.forEach(it=>{if(it.category?.trim()&&!lists.includes(it.category.trim()))newCats.add(it.category.trim());});if(newCats.size>0)setLists(prev=>[...prev,...Array.from(newCats)]);const all=[...lists,...Array.from(newCats)];
    /* Convert scanned subtask tree to app format */
    const convertSubs=(subs)=>(subs||[]).map(s=>({id:uid(),title:s.title,completed:s.completed||false,dueDate:null,startDate:null,endDate:null,priority:"none",notes:"",tags:[],subtasks:convertSubs(s.subtasks)}));
    items.forEach(item=>{if(item.is_duplicate_of){const ex=tasks.find(t=>t.title.toLowerCase().trim()===item.is_duplicate_of.toLowerCase().trim());if(ex&&item.completed&&!ex.completed){updateTask({...ex,completed:true,completedAt:new Date().toISOString()});checked++;return;}if(ex)return;}const tl=item.category&&all.includes(item.category.trim())?item.category.trim():"Inbox";addTask({title:item.title,completed:item.completed,dueDate:item.date||pageDate||todayStr(),list:tl,subtasks:convertSubs(item.subtasks)});added++;});
    setScanResults(null);const lm=newCats.size>0?`, created ${newCats.size} list${newCats.size!==1?"s":""}`:""
    flash(`✓ Added ${added} task${added!==1?"s":""}${checked?`, checked off ${checked}`:""}${lm}`);};

  const filtered=useMemo(()=>{let f=tasks;
    if(search){const q=search.toLowerCase();f=f.filter(t=>t.title.toLowerCase().includes(q)||(t.notes||"").toLowerCase().includes(q)||(t.tags||[]).some(tg=>tg.toLowerCase().includes(q)));}
    else{switch(view){case"today":f=f.filter(t=>t.dueDate===todayStr()||(!t.dueDate&&t.createdAt?.startsWith(todayStr())));break;case"upcoming":f=f.filter(t=>!t.completed&&t.dueDate&&t.dueDate>=todayStr());f.sort((a,b)=>(a.dueDate||"").localeCompare(b.dueDate||""));break;case"all":break;case"completed":return f.filter(t=>t.completed).sort((a,b)=>(b.completedAt||"").localeCompare(a.completedAt||""));case"inbox":f=f.filter(t=>t.list==="Inbox");break;default:if(view.startsWith("list:"))f=f.filter(t=>t.list===view.replace("list:",""));}}
    return[...f.filter(t=>!t.completed),...f.filter(t=>t.completed)];
  },[tasks,view,search]);

  const overdueCount=useMemo(()=>tasks.filter(t=>!t.completed&&isOverdue(t.dueDate)).length,[tasks]);
  const todayCount=useMemo(()=>tasks.filter(t=>!t.completed&&t.dueDate===todayStr()).length,[tasks]);

  /* Keyboard shortcuts — must be after filtered/bulkDelete definitions */
  useEffect(()=>{const h=e=>{if(["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName))return;if(e.key==="n"&&!e.metaKey){e.preventDefault();document.getElementById("quick-add")?.focus();}if(e.key==="/"||((e.metaKey||e.ctrlKey)&&e.key==="f")){e.preventDefault();setShowSearch(true);}if(e.key==="b"&&!e.metaKey&&!e.ctrlKey){setSidebar(s=>!s);}if(e.key==="?")setShowShortcuts(s=>!s);if(e.key==="Escape"){setShowSearch(false);setSearch("");setSelectedTask(null);setShowShortcuts(false);setShowTips(false);setSelectedIds(new Set());}if(e.key==="a"&&(e.metaKey||e.ctrlKey)){e.preventDefault();setSelectedIds(new Set(filtered.map(t=>t.id)));}if((e.key==="Delete"||e.key==="Backspace")&&selectedIds.size>0&&!e.metaKey){bulkDelete();}};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);},[filtered,selectedIds]);
  const titles={today:"Today",upcoming:"Upcoming",all:"All Tasks",completed:"Completed",inbox:"Inbox",calendar:"Calendar"};
  const iconsMap={today:Icons.today,upcoming:Icons.upcoming,all:Icons.all,completed:Icons.done,inbox:Icons.inbox,calendar:Icons.calendar};
  const viewTitle=titles[view]||(view.startsWith("list:")?view.replace("list:",""):"Tasks");
  const viewIcon=iconsMap[view]||Icons.all;
  const selectView=v=>{setView(v);setSelectedTask(null);setSearch("");if(isMobile)setSidebar(false);};

  /* Auth gate: show login if Supabase is configured but user isn't signed in */
  if (hasSupabase && authLoading) return <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-display)",fontSize:22,color:"var(--muted)"}}>Loading...</div>;
  if (hasSupabase && !user) return <LoginScreen onSignIn={signInWithEmail} onSignInPassword={signInWithPassword} error={authError}/>;

  if(!ready)return<div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-display)",fontSize:22,color:"var(--muted)"}}>Loading...</div>;

  return (
    <div style={{height:"100vh",display:"flex",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&family=Source+Sans+3:wght@300;400;500;600;700&display=swap');
        :root{--font-display:'Playfair Display',Georgia,serif;--font-body:'Source Sans 3',-apple-system,sans-serif;--ink:#1c1917;--text:#44403c;--muted:#a8a29e;--bg:#fafaf9;--surface:#f5f5f4;--border:#e7e5e4;--border-light:#f5f5f4;--active-bg:#fffbeb;--accent:#d97706;--accent-dark:#b45309;--accent-bg:#fffbeb;--accent2:#ea580c;}
        *{box-sizing:border-box;margin:0;padding:0;font-family:var(--font-body);}
        html,body{height:100%;overflow:hidden;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;}
        ::selection{background:rgba(217,119,6,0.15);}
        .list-row:hover .list-menu-btn{opacity:1!important;}
        @keyframes fadeIn{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}
        @keyframes fanOut{from{max-height:0;opacity:0;transform:translateY(-8px)}to{max-height:50px;opacity:1;transform:translateY(0)}}
        @keyframes taskComplete{
          0%{background:transparent;transform:translateX(0)}
          10%{background:rgba(34,197,94,0.15);transform:translateX(4px)}
          25%{background:rgba(34,197,94,0.2);transform:translateX(0)}
          50%{background:rgba(34,197,94,0.12)}
          100%{background:transparent;opacity:0.45}
        }
        @keyframes taskUncomplete{
          0%{opacity:0.45;transform:scale(0.98)}
          15%{opacity:0.7;background:rgba(217,119,6,0.18);transform:scale(1.01)}
          40%{background:rgba(217,119,6,0.12);transform:scale(1)}
          100%{opacity:1;background:transparent;transform:scale(1)}
        }
        @keyframes checkPop{
          0%{transform:scale(1)}
          20%{transform:scale(0.8)}
          45%{transform:scale(1.4)}
          65%{transform:scale(0.95)}
          85%{transform:scale(1.05)}
          100%{transform:scale(1)}
        }
        @keyframes cardComplete{
          0%{transform:scale(1);opacity:1}
          15%{transform:scale(1.02);opacity:1;background:rgba(34,197,94,0.15)}
          35%{transform:scale(0.98);opacity:0.8;background:rgba(34,197,94,0.12)}
          60%{transform:scale(0.96);opacity:0.4}
          100%{transform:scale(0.94);opacity:0}
        }
        @keyframes cardUncomplete{
          0%{transform:scale(0.96);opacity:0.5}
          30%{transform:scale(1.03);opacity:0.8;background:rgba(217,119,6,0.15)}
          60%{transform:scale(0.99);opacity:0.95}
          100%{transform:scale(1);opacity:1;background:transparent}
        }
        @keyframes strikeReveal{
          0%{text-decoration-color:transparent}
          40%{text-decoration-color:var(--muted)}
          100%{text-decoration-color:var(--muted)}
        }
        @keyframes checkmarkDraw{
          0%{stroke-dashoffset:24}
          100%{stroke-dashoffset:0}
        }
        ::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:#d6d3d1;border-radius:3px;}
        input::placeholder,textarea::placeholder{color:#a8a29e;}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes toastIn{from{opacity:0;transform:translate(-50%,20px)}to{opacity:1;transform:translate(-50%,0)}}
        button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
        [draggable]{user-select:none;}
        @media(max-width:768px){.sidebar{position:fixed!important;z-index:100!important;height:100vh!important;}.detail-panel{position:fixed!important;right:0;top:0;height:100vh!important;z-index:100;width:100%!important;max-width:420px;}}
      `}</style>

      {isMobile&&sidebar&&<div onClick={()=>setSidebar(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:99}}/>}

      {/* ═══ SIDEBAR ═══ */}
      <nav className="sidebar" aria-label="Navigation" style={{width:sidebar?264:0,...(isMobile?{position:"fixed",zIndex:100,height:"100dvh"}:{}),background:"var(--surface)",borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column",transition:"width 0.25s ease",overflow:"hidden",flexShrink:0}}>
        <div style={{padding:"20px 16px 12px",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
            <div style={{width:34,height:34,borderRadius:10,background:"linear-gradient(135deg,#d97706,#ea580c)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:800,color:"white",fontFamily:"var(--font-display)"}}>I</div>
            <span style={{fontSize:20,fontWeight:700,fontFamily:"var(--font-display)",color:"var(--ink)",whiteSpace:"nowrap"}}>Inkwell</span>
          </div>
          <button onClick={()=>{setShowPhoto(true);if(isMobile)setSidebar(false);}} style={{width:"100%",padding:"11px 14px",borderRadius:12,border:"2px dashed #d6d3d1",background:"rgba(217,119,6,0.04)",color:"var(--accent)",fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:10,transition:"all 0.2s",marginBottom:16,whiteSpace:"nowrap",fontFamily:"inherit"}}>{Icons.camera} Scan Notebook Page</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"0 8px"}}>
          <NavSection title="Views">
            {(()=>{
              const dateDrop=(dateStr,label)=>({
                onDragOver:e=>{e.preventDefault();e.currentTarget.style.background="var(--accent-bg)";e.currentTarget.style.outline="2px solid var(--accent)";e.currentTarget.style.borderRadius="10px";},
                onDragLeave:e=>{e.currentTarget.style.background="";e.currentTarget.style.outline="";},
                onDrop:e=>{e.preventDefault();e.currentTarget.style.background="";e.currentTarget.style.outline="";const tid=e.dataTransfer.getData("text/plain");if(!tid)return;const src=e.dataTransfer.getData("application/x-source");
                  if(src==="subtask"){setTasks(prev=>{let sub=null;for(const t of prev){sub=findSubById(t.subtasks,tid);if(sub)break;}if(!sub)return prev;const cleaned=prev.map(t=>({...t,subtasks:removeSubById(t.subtasks||[],tid)}));const promoted={id:sub.id,title:sub.title,completed:sub.completed||false,dueDate:dateStr,startDate:sub.startDate||null,endDate:sub.endDate||null,priority:sub.priority||"none",list:"Inbox",subtasks:sub.subtasks||[],notes:sub.notes||"",tags:sub.tags||[],createdAt:new Date().toISOString(),completedAt:null};return[promoted,...cleaned];});flash(`Promoted to ${label}`);setIsDragging(false);}
                  else{const ids=selectedIds.size>1&&selectedIds.has(tid)?selectedIds:new Set([tid]);setTasks(prev=>prev.map(t=>ids.has(t.id)?{...t,dueDate:dateStr}:t));flash(`Set ${ids.size>1?ids.size+" tasks":"task"} to ${label}`);setSelectedIds(new Set());setIsDragging(false);}
                }
              });
              const baseViews=[
                {id:"upcoming",icon:Icons.upcoming,label:"Upcoming"},
                {id:"all",icon:Icons.all,label:"All Tasks",count:tasks.filter(t=>!t.completed).length},
                {id:"completed",icon:Icons.done,label:"Completed",count:tasks.filter(t=>t.completed).length},
                {id:"calendar",icon:Icons.calendar,label:"Calendar"},
              ];
              return (<>
                {/* Today — fans out into Today/Tomorrow/Next Monday during drag */}
                <div {...dateDrop(todayStr(),"Today")} data-drop-type="date" data-drop-value={todayStr()}>
                  <NavItem active={view==="today"} icon={Icons.today} label="Today" count={showViewCounts?todayCount:0}
                    onClick={()=>selectView("today")} countColor={overdueCount>0?"#ef4444":undefined}/>
                </div>
                {isDragging&&(<>
                  <div style={{overflow:"hidden",animation:"fanOut 0.2s ease",paddingLeft:16}}>
                    <div {...dateDrop(tomorrowStr(),"Tomorrow")} data-drop-type="date" data-drop-value={tomorrowStr()}>
                      <NavItem icon={Icons.upcoming} label="Tomorrow" count={0}/>
                    </div>
                  </div>
                  <div style={{overflow:"hidden",animation:"fanOut 0.25s ease",paddingLeft:16}}>
                    <div {...dateDrop(nextMondayStr(),"Next Monday")} data-drop-type="date" data-drop-value={nextMondayStr()}>
                      <NavItem icon={Icons.calendar} label="Next Monday" count={0}/>
                    </div>
                  </div>
                </>)}
                {baseViews.map(({id,icon,label,count})=>(
                  <div key={id}>
                    <NavItem active={view===id} icon={icon} label={label} count={showViewCounts?count:0}
                      onClick={()=>selectView(id)}/>
                  </div>
                ))}
              </>);
            })()}
          </NavSection>
          <NavSection title="Lists" action={()=>setShowNewList(true)}>
            {lists.map((l,li)=>{const lv=l==="Inbox"?"inbox":`list:${l}`;const color=getListColor(l,lists);return(
              <div key={l}
                data-drop-type="list" data-drop-value={l}
                data-drag-id={l!=="Inbox"?l:undefined} data-drag-source={l!=="Inbox"?"listItem":undefined} data-drag-label={l}
                draggable={l!=="Inbox"&&!editingList}
                onDragStart={e=>{if(l==="Inbox")return;/* Only set dragList if no task is being dragged */if(!dragTask){setDragList(l);e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("application/x-list",l);}}}
                onDragEnd={()=>{setDragList(null);setDragListOver(null);}}
                onContextMenu={e=>{if(l==="Inbox")return;e.preventDefault();setListMenu({name:l,x:e.clientX,y:e.clientY});}}
                onDragOver={e=>{e.preventDefault();
                  if(dragList){/* List reorder */setDragListOver(l);e.currentTarget.style.background="";e.currentTarget.style.outline="";}
                  else{/* Task drop onto list */e.currentTarget.style.background="var(--accent-bg)";e.currentTarget.style.outline="2px solid var(--accent)";e.currentTarget.style.borderRadius="10px";}
                }}
                onDragLeave={e=>{e.currentTarget.style.background="";e.currentTarget.style.outline="";if(dragList)setDragListOver(null);}}
                onDrop={e=>{e.currentTarget.style.background="";e.currentTarget.style.outline="";
                  if(dragList&&dragList!==l){/* Reorder lists */setLists(prev=>{const w=prev.filter(x=>x!==dragList);const idx=w.indexOf(l);w.splice(idx,0,dragList);return w;});setDragList(null);setDragListOver(null);}
                  else if(!dragList){onListDrop(e,l);}
                }}
                style={{position:"relative",opacity:dragList===l?0.3:1,transition:"opacity 0.15s",touchAction:"none"}}>
                {/* Drop indicator line for list reorder */}
                {dragListOver===l&&dragList&&dragList!==l&&<div style={{position:"absolute",top:-1,left:8,right:8,height:2,background:"var(--accent)",borderRadius:1,zIndex:5}}/>}
                <div style={{display:"flex",alignItems:"center",position:"relative"}} className="list-row">
                  <div style={{flex:1}}>
                    <NavItem active={view===lv} count={showListCounts?tasks.filter(t=>!t.completed&&t.list===l).length:0} onClick={()=>selectView(lv)}
                      icon={<span style={{width:8,height:8,borderRadius:"50%",display:"inline-block",background:color,flexShrink:0}}/>}
                      label={editingList===l?(
                        <input autoFocus defaultValue={l}
                          onClick={e=>e.stopPropagation()}
                          onKeyDown={e=>{if(e.key==="Enter"){const v=e.target.value.trim();if(v&&v!==l)renameList(l,v);setEditingList(null);}if(e.key==="Escape")setEditingList(null);}}
                          onBlur={e=>{const v=e.target.value.trim();if(v&&v!==l)renameList(l,v);setEditingList(null);}}
                          style={{border:"none",outline:"none",background:"rgba(217,119,6,0.1)",borderRadius:4,padding:"2px 6px",fontSize:14,fontWeight:view===lv?600:500,width:"100%",fontFamily:"inherit"}}/>
                      ):(
                        <span onDoubleClick={e=>{if(l!=="Inbox"){e.stopPropagation();setEditingList(l);}}}
                          style={{fontSize:14,fontWeight:view===lv?600:500,color:view===lv?"var(--ink)":"var(--text)",cursor:l!=="Inbox"?"grab":"default"}}>{l}</span>
                      )}/>
                  </div>
                  {l!=="Inbox"&&(
                    <button onClick={e=>{e.stopPropagation();setListMenu({name:l,x:e.clientX,y:e.clientY});}}
                      className="list-menu-btn" style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:"4px 6px",borderRadius:4,fontSize:14,lineHeight:1,fontFamily:"inherit",opacity:0,transition:"opacity 0.15s",position:"absolute",right:4,top:"50%",transform:"translateY(-50%)"}}>⋯</button>
                  )}
                </div>
              </div>);})}
            {/* List context menu */}
            {listMenu&&(<>
              <div style={{position:"fixed",inset:0,zIndex:999}} onClick={()=>setListMenu(null)}/>
              <div style={{position:"fixed",left:listMenu.x,top:listMenu.y,background:"white",borderRadius:10,boxShadow:"0 4px 20px rgba(0,0,0,0.15)",border:"1px solid var(--border)",padding:4,zIndex:1000,minWidth:140,animation:"fadeIn 0.1s ease"}}>
                <button onClick={()=>{setEditingList(listMenu.name);setListMenu(null);}} style={{width:"100%",padding:"8px 12px",border:"none",background:"none",cursor:"pointer",fontSize:13,fontWeight:500,color:"var(--text)",textAlign:"left",borderRadius:6,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surface)"} onMouseLeave={e=>e.currentTarget.style.background="none"}>✏️ Rename</button>
                <button onClick={()=>{deleteList(listMenu.name);setListMenu(null);}} style={{width:"100%",padding:"8px 12px",border:"none",background:"none",cursor:"pointer",fontSize:13,fontWeight:500,color:"#ef4444",textAlign:"left",borderRadius:6,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                  onMouseEnter={e=>e.currentTarget.style.background="#fef2f2"} onMouseLeave={e=>e.currentTarget.style.background="none"}>🗑 Delete list</button>
              </div>
            </>)}
            {showNewList&&(<div style={{padding:"4px 6px"}}><input autoFocus value={newList} onChange={e=>setNewList(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&newList.trim()&&!lists.includes(newList.trim())){setLists(p=>[...p,newList.trim()]);setNewList("");setShowNewList(false);}if(e.key==="Escape"){setShowNewList(false);setNewList("");}}}
              onBlur={()=>{setShowNewList(false);setNewList("");}} placeholder="List name..." style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid var(--accent)",fontSize:13,outline:"none",background:"white",fontFamily:"inherit"}}/></div>)}
          </NavSection>
        </div>
        {overdueCount>0&&<div style={{margin:"0 8px 8px",padding:"10px 14px",borderRadius:10,background:"#fef2f2",border:"1px solid #fecaca",fontSize:13,color:"#ef4444",fontWeight:600,flexShrink:0}}>⚠ {overdueCount} overdue</div>}
        {hasSupabase && user && (
          <div style={{padding:"6px 16px",fontSize:11,color:"var(--muted)",display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
            <span>☁️</span><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.email}</span>
          </div>
        )}
        <div style={{padding:"8px 16px 12px",borderTop:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <button onClick={()=>setShowShortcuts(true)} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"var(--muted)",display:"flex",alignItems:"center",gap:6,fontFamily:"inherit",padding:0}}>{Icons.keyboard}{!isMobile&&" Press ? for shortcuts"}</button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <button onClick={()=>setShowTips(true)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:4,display:"flex",borderRadius:6,transition:"color 0.15s"}} aria-label="Scan tips" title="Scan tips"
              onMouseEnter={e=>e.currentTarget.style.color="var(--accent)"}
              onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 7h6"/><path d="M8 11h8"/></svg>
            </button>
            <button onClick={()=>setShowSettings(true)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:4,display:"flex",borderRadius:6}} aria-label="Settings" title="Settings">{Icons.settings}</button>
          </div>
        </div>
      </nav>

      {/* ═══ MAIN ═══ */}
      <main style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
        <header style={{padding:isMobile?"14px 16px":"14px 24px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <button onClick={()=>setSidebar(!sidebar)} title={sidebar?"Hide sidebar (B)":"Show sidebar (B)"} style={{background:"none",border:"none",cursor:"pointer",color:sidebar?"var(--muted)":"var(--accent)",padding:6,display:"flex",borderRadius:6,transition:"color 0.15s"}} aria-label="Toggle sidebar">{Icons.menu}</button>
          <div style={{flex:1,display:"flex",alignItems:"center",gap:10,minWidth:0}}>
            {!showSearch?(<>
              <span style={{color:"var(--accent)",flexShrink:0}}>{viewIcon}</span>
              {view.startsWith("list:")?(<EditableText value={viewTitle} onSave={n=>renameList(viewTitle,n)} tag="h1" style={{fontSize:isMobile?20:22,fontFamily:"var(--font-display)",fontWeight:700,color:"var(--ink)"}}/>):(<h1 style={{margin:0,fontSize:isMobile?20:22,fontFamily:"var(--font-display)",fontWeight:700,color:"var(--ink)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{viewTitle}</h1>)}
              {view==="today"&&!isMobile&&<span style={{fontSize:13,color:"var(--muted)"}}>{new Date().toLocaleDateString("en-IE",{weekday:"long",month:"long",day:"numeric"})}</span>}
            </>):(<input autoFocus value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Escape"){setShowSearch(false);setSearch("");}}} placeholder="Search tasks, tags..." style={{flex:1,padding:"10px 14px",borderRadius:12,border:"1px solid var(--border)",fontSize:15,outline:"none",background:"white",fontFamily:"inherit",minWidth:0}}/>)}
          </div>
          <button onClick={()=>{setShowSearch(!showSearch);if(showSearch)setSearch("");}} style={{background:showSearch?"var(--surface)":"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:8,borderRadius:8,display:"flex",flexShrink:0}} aria-label="Search">{Icons.search}</button>
        </header>

        <div style={{flex:1,display:"flex",overflow:"hidden"}}>
          <div style={{flex:1,overflowY:"auto",padding:isMobile?"16px":"20px 24px"}}>
            {view==="calendar"?(<CalendarView tasks={tasks} onSelect={t=>setSelectedTask(t)} onUpdate={updateTask}/>):(view==="today"&&todayMode==="kanban")?(<div style={{display:"flex",flexDirection:"column",height:"100%"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"white",borderRadius:14,border:"1px solid var(--border)",marginBottom:10,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",flexShrink:0}}>
                <span style={{color:"var(--accent)",flexShrink:0}}>{Icons.plus}</span>
                <input id="quick-add" value={newTitle} onChange={e=>setNewTitle(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newTitle.trim()){const t=addTask({title:newTitle.trim()});setNewTitle("");flash(`✓ Added "${t.title}"`);}}} placeholder="Add a task... (Enter) · defaults to today" style={{flex:1,border:"none",outline:"none",fontSize:15,color:"var(--ink)",background:"none",fontFamily:"inherit",minWidth:0}}/>
              </div>
              <div style={{display:"flex",background:"var(--surface)",borderRadius:8,padding:2,marginBottom:14,width:"fit-content",flexShrink:0}}>
                <button onClick={()=>setTodayMode("kanban")} style={{padding:"5px 12px",borderRadius:6,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:todayMode==="kanban"?"white":"transparent",color:todayMode==="kanban"?"var(--ink)":"var(--muted)",boxShadow:todayMode==="kanban"?"0 1px 3px rgba(0,0,0,0.08)":"none",transition:"all 0.15s"}}>Board</button>
                <button onClick={()=>setTodayMode("list")} style={{padding:"5px 12px",borderRadius:6,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:todayMode==="list"?"white":"transparent",color:todayMode==="list"?"var(--ink)":"var(--muted)",boxShadow:todayMode==="list"?"0 1px 3px rgba(0,0,0,0.08)":"none",transition:"all 0.15s"}}>List</button>
              </div>
              <div style={{flex:1,minHeight:0}}><KanbanBoard tasks={tasks} columns={activeKanbanCols} onColumnsChange={setKanbanColumns} onResetColumns={kanbanColumns?resetKanbanCols:null} onSelect={t=>setSelectedTask(t)} onUpdate={updateTask} onToggle={toggleTask} onUpdateSubtask={(taskId,subId)=>{setTasks(prev=>prev.map(t=>t.id!==taskId?t:{...t,subtasks:updateSubById(t.subtasks,subId,{completed:!findSubById(t.subtasks,subId)?.completed,completedAt:!findSubById(t.subtasks,subId)?.completed?new Date().toISOString():null})}));}} flash={flash} setIsDragging={setIsDragging} animatingTasks={animatingTasks}/></div>
            </div>):(<>
              {view!=="completed"&&(<div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"white",borderRadius:14,border:"1px solid var(--border)",marginBottom:view==="today"?10:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <span style={{color:"var(--accent)",flexShrink:0}}>{Icons.plus}</span>
                <input id="quick-add" value={newTitle} onChange={e=>setNewTitle(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newTitle.trim()){const t=addTask({title:newTitle.trim()});setNewTitle("");flash(`✓ Added "${t.title}"`);}}} placeholder="Add a task... (Enter) · defaults to today" style={{flex:1,border:"none",outline:"none",fontSize:15,color:"var(--ink)",background:"none",fontFamily:"inherit",minWidth:0}}/>
              </div>)}
              {view==="today"&&(
                <div style={{display:"flex",background:"var(--surface)",borderRadius:8,padding:2,marginBottom:14,width:"fit-content",flexShrink:0}}>
                  <button onClick={()=>setTodayMode("kanban")} style={{padding:"5px 12px",borderRadius:6,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:todayMode==="kanban"?"white":"transparent",color:todayMode==="kanban"?"var(--ink)":"var(--muted)",boxShadow:todayMode==="kanban"?"0 1px 3px rgba(0,0,0,0.08)":"none",transition:"all 0.15s"}}>Board</button>
                  <button onClick={()=>setTodayMode("list")} style={{padding:"5px 12px",borderRadius:6,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:todayMode==="list"?"white":"transparent",color:todayMode==="list"?"var(--ink)":"var(--muted)",boxShadow:todayMode==="list"?"0 1px 3px rgba(0,0,0,0.08)":"none",transition:"all 0.15s"}}>List</button>
                </div>
              )}
              {filtered.length===0?(<div style={{textAlign:"center",padding:"50px 20px",color:"var(--muted)"}}><div style={{fontSize:44,marginBottom:14,opacity:0.4}}>{view==="completed"?"🎉":view==="today"?"☀️":search?"🔍":"📋"}</div><div style={{fontSize:16,fontWeight:600,marginBottom:4}}>{view==="completed"?"No completed tasks yet":search?"No matching tasks":"All clear!"}</div><div style={{fontSize:14}}>Add a task above or scan a notebook page</div></div>):(
                <div role="list" aria-label="Tasks">
                  {filtered.map((task,i)=>{const prev=i>0?filtered[i-1]:null;const showSep=task.completed&&prev&&!prev.completed;
                    return(<div key={task.id} role="listitem">
                      {showSep&&(<div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 12px 8px",marginTop:8}}><div style={{height:1,flex:1,background:"var(--border)"}}/><span style={{fontSize:12,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8}}>Completed</span><div style={{height:1,flex:1,background:"var(--border)"}}/></div>)}
                      <TaskRow task={task} isActive={selectedTask?.id===task.id} isSelected={selectedIds.has(task.id)} onSelect={handleTaskClick} onToggle={toggleTask} onUpdateTask={updateTask} view={view} lists={lists} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} dropTarget={dropTarget?.id===task.id?dropTarget:null} animateState={animatingTasks[task.id]}/>
                    </div>);})}
                </div>
              )}
            </>)}
          </div>
          {selectedTask&&!isMobile&&<TaskDetail task={selectedTask} onUpdate={updateTask} onDelete={deleteTask} onClose={()=>setSelectedTask(null)} lists={lists}/>}
        </div>
        {selectedTask&&isMobile&&(<div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.4)",zIndex:100,display:"flex",justifyContent:"flex-end"}} onClick={()=>setSelectedTask(null)}><div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:420}}><TaskDetail task={selectedTask} onUpdate={updateTask} onDelete={deleteTask} onClose={()=>setSelectedTask(null)} lists={lists}/></div></div>)}
      </main>

      {showPhoto&&<PhotoModal onClose={()=>setShowPhoto(false)} onProcess={handleScan} processing={processing}/>}
      {scanResults&&<ScanResultsModal results={scanResults} onConfirm={confirmScan} onClose={()=>setScanResults(null)} lists={lists}/>}
      {showTips&&<ScanTipsModal onClose={()=>setShowTips(false)}/>}
      {showShortcuts&&(<Overlay onClose={()=>setShowShortcuts(false)}><h2 style={{fontSize:19,fontFamily:"var(--font-display)",marginBottom:16}}>Keyboard Shortcuts</h2>{[["N","New task"],["B","Toggle sidebar"],["/ or ⌘F","Search"],["⌘A","Select all tasks"],["Shift+Click","Select range"],["⌘/Ctrl+Click","Toggle select"],["Delete","Delete selected"],["Esc","Clear selection / close"],["?","This help"],["Double-click","Edit any name"]].map(([k,d])=>(<div key={k} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:"1px solid var(--border-light)"}}><kbd style={{fontSize:12,fontWeight:600,background:"var(--surface)",padding:"3px 8px",borderRadius:6,border:"1px solid var(--border)",fontFamily:"inherit",minWidth:50,textAlign:"center"}}>{k}</kbd><span style={{fontSize:14,color:"var(--text)"}}>{d}</span></div>))}</Overlay>)}
      {showSettings&&(<Overlay onClose={()=>setShowSettings(false)}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
          <div style={{width:36,height:36,borderRadius:10,background:"var(--surface)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--muted)"}}>{Icons.settings}</div>
          <h2 style={{margin:0,fontSize:19,fontFamily:"var(--font-display)"}}>Settings</h2>
        </div>
        <div style={{marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>Sidebar Display</div>
          <ToggleRow label="Show task counts on Views" sublabel="Today, All Tasks, Completed, etc." checked={showViewCounts} onChange={setShowViewCounts}/>
          <ToggleRow label="Show task counts on Lists" sublabel="Inbox, Work, Personal, etc." checked={showListCounts} onChange={setShowListCounts}/>
        </div>
        {hasSupabase && user && (
          <div style={{marginBottom:24}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>Account</div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",background:"var(--surface)",borderRadius:10,marginBottom:8}}>
              <div>
                <div style={{fontSize:14,fontWeight:500,color:"var(--ink)"}}>{user.email}</div>
                <div style={{fontSize:12,color:"var(--muted)"}}>Synced to cloud ☁️</div>
              </div>
              <button onClick={async()=>{await signOut();setShowSettings(false);}}
                style={{padding:"6px 14px",borderRadius:8,border:"1px solid var(--border)",background:"white",color:"#ef4444",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                Sign out
              </button>
            </div>
          </div>
        )}
        {!hasSupabase && (
          <div style={{marginBottom:24}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>Storage</div>
            <div style={{padding:"12px 14px",background:"var(--surface)",borderRadius:10,fontSize:13,color:"var(--muted)"}}> Data stored in this browser only. Set up Supabase for cloud sync.</div>
          </div>
        )}
      </Overlay>)}
      {/* ═══ BULK ACTION BAR ═══ */}
      {selectedIds.size>1&&(
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"var(--ink)",color:"white",padding:"10px 16px",borderRadius:14,fontSize:13,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.25)",animation:"toastIn 0.3s ease",zIndex:1500,display:"flex",alignItems:"center",gap:10,whiteSpace:"nowrap"}}>
          <span style={{opacity:0.7}}>{selectedIds.size} selected</span>
          <div style={{width:1,height:20,background:"rgba(255,255,255,0.2)"}}/>
          <select onChange={e=>{if(e.target.value)bulkMove(e.target.value);e.target.value="";}} defaultValue="" style={{background:"rgba(255,255,255,0.15)",border:"none",color:"white",borderRadius:6,padding:"5px 8px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            <option value="" disabled>Move to…</option>
            {lists.map(l=><option key={l} value={l} style={{color:"#1c1917"}}>{l}</option>)}
          </select>
          <select onChange={e=>{if(e.target.value)bulkPriority(e.target.value);e.target.value="";}} defaultValue="" style={{background:"rgba(255,255,255,0.15)",border:"none",color:"white",borderRadius:6,padding:"5px 8px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            <option value="" disabled>Priority…</option>
            {Object.entries(PRIORITY).map(([k,v])=><option key={k} value={k} style={{color:"#1c1917"}}>{v.label}</option>)}
          </select>
          <button onClick={bulkComplete} style={{background:"rgba(255,255,255,0.15)",border:"none",color:"white",borderRadius:6,padding:"5px 10px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>✓ Done</button>
          <input type="date" onChange={e=>{if(e.target.value)bulkDate(e.target.value);}} style={{background:"rgba(255,255,255,0.15)",border:"none",color:"white",borderRadius:6,padding:"4px 8px",fontSize:12,cursor:"pointer",fontFamily:"inherit",colorScheme:"dark"}} title="Set due date"/>
          <button onClick={bulkDelete} style={{background:"rgba(239,68,68,0.8)",border:"none",color:"white",borderRadius:6,padding:"5px 10px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Delete</button>
          <button onClick={()=>setSelectedIds(new Set())} style={{background:"none",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",padding:4,display:"flex"}}>{Icons.x}</button>
        </div>
      )}
      {toast&&<div role="status" aria-live="polite" style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"var(--ink)",color:"white",padding:"12px 24px",borderRadius:12,fontSize:14,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.2)",animation:"toastIn 0.3s ease",zIndex:2000,whiteSpace:"nowrap"}}>{toast}</div>}
    </div>
  );
}

function NavSection({title,action,children}){return(<div style={{marginBottom:14}}><div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,padding:"0 8px",marginBottom:4,display:"flex",alignItems:"center",justifyContent:"space-between"}}>{title}{action&&<button onClick={action} style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:0,display:"flex"}} aria-label={`Add ${title.toLowerCase()}`}>{Icons.plus}</button>}</div>{children}</div>);}
function NavItem({active,icon,label,count,onClick,countColor}){return(<button onClick={onClick} style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"none",background:active?"#fef3c7":"transparent",color:active?"var(--ink)":"var(--text)",fontSize:14,fontWeight:active?600:500,cursor:"pointer",display:"flex",alignItems:"center",gap:10,textAlign:"left",transition:"all 0.12s",whiteSpace:"nowrap",fontFamily:"inherit"}}><span style={{display:"flex",flexShrink:0}}>{icon}</span><span style={{flex:1}}>{typeof label==="string"?label:label}</span>{count>0&&<span style={{fontSize:12,fontWeight:700,minWidth:18,textAlign:"right",color:countColor||"var(--muted)"}}>{count}</span>}</button>);}
