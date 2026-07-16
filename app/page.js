"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "../lib/supabase";
import {
  useKonami, useLongPress, useMidnight, useA11yPrefs, useInkSpatter,
  renderCoffee, CommandPalette, ChangelogScroll, ConfettiInk, MidnightMoon, useUndoToast,
} from "./components/Enhancements";

/* ═══════════════════════════════════════════════════════════════════════
   SUPABASE AUTH + SYNC HOOK
   ═══════════════════════════════════════════════════════════════════════ */
function useSupabaseSync() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const saveTimer = useRef(null);

  const accessTokenRef = useRef(null);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      accessTokenRef.current = session?.access_token ?? null;
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      accessTokenRef.current = session?.access_token ?? null;
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

  const loadFromCloud = useCallback(async () => {
    if (!supabase || !user) return null;
    const { data, error } = await supabase
      .from("user_data")
      .select("tasks, lists, settings, updated_at")
      .eq("user_id", user.id)
      .single();
    if (error) { console.warn("Cloud load failed:", error.message); return null; }
    return data;
  }, [user]);

  const saveToCloud = useCallback((tasks, lists, settings) => {
    if (!supabase || !user) return;
    /* ── SAFETY: Never save empty tasks to cloud — this would wipe user data ── */
    if (!tasks || (Array.isArray(tasks) && tasks.length === 0)) {
      console.warn("[Inkwell Sync] Blocked save: refusing to push empty tasks array to cloud");
      return;
    }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const { error } = await supabase
        .from("user_data")
        .upsert({ user_id: user.id, tasks, lists, settings, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) console.warn("Cloud save failed:", error.message);
    }, 800); /* debounce 800ms — fast enough for cross-device */
  }, [user]);

  /* Immediate (non-debounced) cloud save — for flush on tab hide */
  const saveToCloudNow = useCallback(async (tasks, lists, settings) => {
    if (!supabase || !user) return;
    if (!tasks || (Array.isArray(tasks) && tasks.length === 0)) {
      console.warn("[Inkwell Sync] Blocked immediate save: refusing to push empty tasks array");
      return;
    }
    clearTimeout(saveTimer.current);
    try {
      await supabase
        .from("user_data")
        .upsert({ user_id: user.id, tasks, lists, settings, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    } catch(e) { /* best effort */ }
  }, [user]);

  /* keepalive flush for beforeunload — survives page close/refresh */
  const flushToCloudKeepalive = useCallback((tasks, lists, settings) => {
    if (!supabase || !user) return;
    if (!tasks || (Array.isArray(tasks) && tasks.length === 0)) return;
    clearTimeout(saveTimer.current);
    try {
      const token = accessTokenRef.current;
      if (!token) return;
      const url = `${supabase.supabaseUrl}/rest/v1/user_data?on_conflict=user_id`;
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabase.supabaseKey,
          "Authorization": `Bearer ${token}`,
          "Prefer": "resolution=merge-duplicates"
        },
        body: JSON.stringify({ user_id: user.id, tasks, lists, settings, updated_at: new Date().toISOString() }),
        keepalive: true
      }).catch(() => {});
    } catch(e) { /* best effort */ }
  }, [user]);

  return { user, authLoading, authError, signInWithEmail, signInWithPassword, signOut, loadFromCloud, saveToCloud, saveToCloudNow, flushToCloudKeepalive, hasSupabase: !!supabase };
}

/* ═══════════════════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
   ═══════════════════════════════════════════════════════════════════════ */
const TASKS_KEY = "inkwell-tasks-v2";
const LISTS_KEY = "inkwell-lists-v2";
const TOMBSTONES_KEY = "inkwell-tombstones";
const PENDING_SYNC_KEY = "inkwell-pending-sync";
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const todayStr = () => { const d=new Date(); return localDateStr(d); };
const tomorrowStr = () => { const d = new Date(); d.setDate(d.getDate() + 1); return localDateStr(d); };
const nextMondayStr = () => { const d = new Date(); const day = d.getDay(); const diff = day === 0 ? 1 : day === 1 ? 7 : 8 - day; d.setDate(d.getDate() + diff); return localDateStr(d); };
const dateOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDateStr(d); };
/* Advance a date string by a recurrence interval */
const advanceRecurrenceDate = (dateStr, frequency, interval) => {
  const d = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  if (frequency === "daily") d.setDate(d.getDate() + interval);
  else if (frequency === "weekly") d.setDate(d.getDate() + interval * 7);
  else if (frequency === "monthly") d.setMonth(d.getMonth() + interval);
  /* If the advanced date is in the past (was overdue), jump to next occurrence from today */
  const today = new Date(); today.setHours(0,0,0,0);
  if (d < today) {
    const now = new Date();
    if (frequency === "daily") now.setDate(now.getDate() + interval);
    else if (frequency === "weekly") now.setDate(now.getDate() + interval * 7);
    else if (frequency === "monthly") now.setMonth(now.getMonth() + interval);
    return localDateStr(now);
  }
  return localDateStr(d);
};
const nextWeekday = (wd) => { const d = new Date(); const cur = d.getDay(); const diff = wd <= cur ? 7 - cur + wd : wd - cur; d.setDate(d.getDate() + diff); return localDateStr(d); };
const WEEKDAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const resolveQuickDate = (offset) => {
  if(offset==="tomorrow") return tomorrowStr();
  if(offset==="nextMonday") return nextWeekday(1);
  if(typeof offset==="string"&&offset.startsWith("next:")) return nextWeekday(parseInt(offset.split(":")[1]));
  if(typeof offset==="string"&&offset.startsWith("+")) return dateOffset(parseInt(offset.slice(1)));
  return todayStr();
};

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
      if (lastInputWasTouch && (e.target?.closest?.("[data-drag-id]") || e.target?.closest?.("[data-sub-drag]"))) {
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
        padding:"8px 14px", background:"#292524", color:"#fafaf9", borderRadius:"10px",
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
          target.style.outline = "2px solid var(--accent)";
          target.style.background = "var(--accent-a10)";
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
  low:    { color: "#7ba7d7", label: "Low" },
  medium: { color: "#d9b25c", label: "Medium" },
  high:   { color: "#dd7f72", label: "High" },
};

const DEFAULT_LISTS = ["Inbox", "Work", "Personal"];
const LIST_PALETTE = ["#8a8578","#6f8fb4","#5fa287","#c9a25a","#c07a6d","#9784bb","#c589a2","#6ba8a0","#c98d5f","#8b8fc0"];

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

/* ═══ OFFLINE MERGE UTILITIES ═══ */
const taskTs = (t) => t?.updatedAt || t?.createdAt || "1970-01-01";
const subTs = (s) => s?.updatedAt || s?.createdAt || "1970-01-01";

/**
 * Merge two subtask arrays at the individual subtask level.
 * - Both have same subtask ID → newer updatedAt wins (recursive for nested subtasks)
 * - Subtask only in local → keep (added offline)
 * - Subtask only in cloud → keep (added on other device)
 */
const mergeSubtasks = (localSubs, cloudSubs) => {
  if (!localSubs?.length && !cloudSubs?.length) return [];
  if (!localSubs?.length) return cloudSubs || [];
  if (!cloudSubs?.length) return localSubs || [];

  const localMap = new Map(localSubs.map(s => [s.id, s]));
  const cloudMap = new Map(cloudSubs.map(s => [s.id, s]));
  const allIds = new Set([...localMap.keys(), ...cloudMap.keys()]);
  const merged = [];

  for (const id of allIds) {
    const local = localMap.get(id);
    const cloud = cloudMap.get(id);
    if (local && cloud) {
      /* Both have it — pick newer, then recursively merge nested subtasks */
      const winner = subTs(local) >= subTs(cloud) ? { ...local } : { ...cloud };
      winner.subtasks = mergeSubtasks(local.subtasks, cloud.subtasks);
      merged.push(winner);
    } else {
      merged.push(local || cloud);
    }
  }
  return merged;
};

/**
 * Merge local + cloud tasks with tombstone-aware conflict resolution.
 * - Both have same task ID → merge field-by-field (newer updatedAt wins for task props,
 *   subtasks are merged recursively at subtask level)
 * - Task only in local → new offline task → keep (unless cloud-tombstoned)
 * - Task only in cloud → new from other device → keep (unless local-tombstoned)
 * - Tombstoned task → stays deleted unless edited AFTER the deletion
 */
const mergeTasks = (localTasks, cloudTasks, localTombstones, cloudTombstones) => {
  /* 1. Combine tombstones (union by ID, keep newer timestamp) */
  const tombMap = new Map();
  for (const t of (localTombstones || [])) tombMap.set(t.id, t);
  for (const t of (cloudTombstones || [])) {
    const existing = tombMap.get(t.id);
    if (!existing || t.deletedAt > existing.deletedAt) tombMap.set(t.id, t);
  }

  /* 2. Build ID→task maps */
  const localMap = new Map((localTasks||[]).map(t => [t.id, t]));
  const cloudMap = new Map((cloudTasks||[]).map(t => [t.id, t]));
  const allIds = new Set([...localMap.keys(), ...cloudMap.keys()]);

  /* 3. Merge each task */
  const merged = [];
  for (const id of allIds) {
    const tomb = tombMap.get(id);
    const local = localMap.get(id);
    const cloud = cloudMap.get(id);

    if (tomb) {
      /* Task was deleted somewhere — resurrect only if edited after deletion */
      const winner = local && cloud
        ? (taskTs(local) >= taskTs(cloud) ? local : cloud)
        : (local || cloud);
      if (winner && taskTs(winner) > tomb.deletedAt) {
        merged.push(winner); /* Resurrection — edit happened after delete */
        tombMap.delete(id);
      }
      /* else: stays deleted */
      continue;
    }

    if (local && cloud) {
      /* Both have it — pick the one with newer updatedAt for task-level props,
         but merge subtasks at the subtask level for better conflict resolution */
      const winner = taskTs(local) >= taskTs(cloud) ? { ...local } : { ...cloud };
      winner.subtasks = mergeSubtasks(local.subtasks, cloud.subtasks);
      merged.push(winner);
    } else {
      merged.push(local || cloud);
    }
  }

  /* 4. Prune tombstones older than 30 days */
  const cutoff = new Date(Date.now() - 30*24*60*60*1000).toISOString();
  const prunedTombstones = [...tombMap.values()].filter(t => t.deletedAt > cutoff);

  return { tasks: merged, tombstones: prunedTombstones };
};

/**
 * Merge two lists arrays — union preserving order.
 * Cloud order first, then any local-only lists appended.
 */
const mergeLists = (localLists, cloudLists) => {
  const merged = [...(cloudLists || DEFAULT_LISTS)];
  for (const l of (localLists || [])) {
    if (!merged.includes(l)) merged.push(l);
  }
  return merged;
};

/* ═══ END MERGE UTILITIES ═══ */
const getListColor = (name, lists) => LIST_PALETTE[lists.indexOf(name) % LIST_PALETTE.length];
/* Convert hex color to rgba with alpha — e.g. hexTint("#3b82f6", 0.08) → "rgba(98,146,216,0.08)" */
const hexTint = (hex, alpha) => {
  if(!hex || !hex.startsWith("#")) return `rgba(120,120,120,${alpha})`;
  const h = hex.slice(1);
  const r = parseInt(h.slice(0,2), 16);
  const g = parseInt(h.slice(2,4), 16);
  const b = parseInt(h.slice(4,6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};
/* Returns the list color only if it's a "real" categorized list — Inbox stays neutral */
const listAccentColor = (listName, lists) => {
  if(!listName || listName === "Inbox") return null;
  return getListColor(listName, lists);
};

/* Default subtask with all properties (mirrors parent task shape) */
const newSubtask = (title) => ({
  id:uid(), title, completed:false, subtasks:[],
  dueDate:null, startDate:null, endDate:null,
  priority:"none", notes:"", tags:[]
});

/* Recursive subtask helpers */
const countSubs = (subs) => { if(!subs?.length) return {total:0,done:0}; let t=0,d=0; for(const s of subs){t++;if(s.completed)d++;const c=countSubs(s.subtasks);t+=c.total;d+=c.done;} return{total:t,done:d}; };
const hasOpenSubs = (subs) => { if(!subs?.length) return false; for(const s of subs){ if(!s.completed) return true; if(hasOpenSubs(s.subtasks)) return true; } return false; };
const completeAllSubs = (subs) => { if(!subs?.length) return subs; return subs.map(s=>({...s, completed:true, completedAt:s.completed?s.completedAt:new Date().toISOString(), subtasks:completeAllSubs(s.subtasks)})); };
const updateSubById = (subs, id, changes) => {
  if(!subs) return [];
  return subs.map(s => s.id===id ? {...s,...changes} : {...s, subtasks: updateSubById(s.subtasks, id, changes)});
};
/* Remove sub from tree — keeps its children attached (for drag/move operations) */
const removeSubById = (subs, id) => {
  if(!subs) return [];
  return subs.filter(s=>s.id!==id).map(s=>({...s, subtasks: removeSubById(s.subtasks, id)}));
};
/* Delete sub from tree — promotes its children up into the parent level */
const deleteSubById = (subs, id) => {
  if(!subs) return [];
  const result = [];
  for(const s of subs){
    if(s.id === id){
      if(s.subtasks && s.subtasks.length > 0) result.push(...s.subtasks);
    } else {
      result.push({...s, subtasks: deleteSubById(s.subtasks, id)});
    }
  }
  return result;
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
/* Check if targetId exists anywhere in the subtask tree of a task/subtask */
const isDescendant = (subs, targetId) => {
  if(!subs) return false;
  for(const s of subs){ if(s.id===targetId) return true; if(isDescendant(s.subtasks, targetId)) return true; }
  return false;
};
/* Check if a drag source is any kind of subtask */
const isSubSource = (src) => src === "subtask" || src === "detail-subtask" || src === "kanban-subtask";
/* Insert a subtask before or after a target sibling in the tree */
const insertSubNear = (subs, targetId, newSub, position) => {
  if(!subs) return [];
  const idx = subs.findIndex(s => s.id === targetId);
  if(idx !== -1) {
    const result = [...subs];
    result.splice(position === "before" ? idx : idx + 1, 0, newSub);
    return result;
  }
  return subs.map(s => ({...s, subtasks: insertSubNear(s.subtasks, targetId, newSub, position)}));
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
  repeat:   <I size={14}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></I>,
  sparkle:  <I size={16}><path d="M12 2L14.5 9.5 22 12 14.5 14.5 12 22 9.5 14.5 2 12 9.5 9.5z"/></I>,
  grip:     <I size={16}><circle cx="9" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="19" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="19" r="1" fill="currentColor" stroke="none"/></I>,
  duration: <I size={14}><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 00-.586-1.414L12 12l-4.414 4.414A2 2 0 007 17.828V22"/><path d="M7 2v4.172a2 2 0 00.586 1.414L12 12l4.414-4.414A2 2 0 0017 6.172V2"/></I>,
  keyboard: <I size={16}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></I>,
  settings: <I size={16}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></I>,
  back:     <I size={16}><polyline points="15 18 9 12 15 6"/></I>,
  overdue:  <I size={16}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></I>,
  sort:     <I size={16}><path d="M11 5h10"/><path d="M11 9h7"/><path d="M11 13h4"/><path d="M3 17l3 3 3-3"/><path d="M6 18V4"/></I>,
};

/* ═══════════════════════════════════════════════════════════════════════
   SHARED UI COMPONENTS
   ═══════════════════════════════════════════════════════════════════════ */
const Checkbox = ({checked, onChange, priority="none", size=20, animating=false}) => (
  <button onClick={e=>{e.stopPropagation();onChange(!checked);}} className="cb-hit"
    aria-label={checked?"Mark incomplete":"Mark complete"} role="checkbox" aria-checked={checked}
    style={{width:size,height:size,borderRadius:7,flexShrink:0,padding:0,position:"relative",
      border:`2px solid ${checked?PRIORITY[priority].color:(priority!=="none"?PRIORITY[priority].color:"var(--border)")}`,
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
    style={{border:"none",outline:"none",background:"var(--accent-a10)",borderRadius:4,padding:"2px 6px",fontFamily:"inherit",...style}} />;
};

const Overlay = ({onClose,children,wide}) => {
  /* Esc closes every modal, not just the ones the global handler knows about */
  useEffect(()=>{
    const h=e=>{if(e.key==="Escape"){e.stopPropagation();onClose();}};
    window.addEventListener("keydown",h);
    return()=>window.removeEventListener("keydown",h);
  },[onClose]);
  return (
  <div style={{position:"fixed",inset:0,background:"var(--overlay)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,animation:"fadeIn 0.2s ease",padding:16}} onClick={onClose} role="dialog" aria-modal="true">
    <div onClick={e=>e.stopPropagation()} style={{background:"var(--bg)",borderRadius:"var(--radius-xl)",padding:28,width:"100%",maxWidth:wide?560:500,boxShadow:"var(--shadow-3)",position:"relative",display:"flex",flexDirection:"column",maxHeight:"90vh"}}>
      <button onClick={onClose} style={{position:"absolute",top:16,right:16,background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:4}} aria-label="Close">{Icons.x}</button>
      {children}
    </div>
  </div>
  );
};
const Btn = ({children,variant="primary",...p}) => (
  <button {...p} className={variant==="secondary"?"btn-secondary":"btn-primary"} style={{flex:1,padding:"12px 16px",borderRadius:"var(--radius-md)",border:variant==="secondary"?"1px solid var(--border)":"none",background:variant==="secondary"?"var(--card)":"linear-gradient(135deg,var(--accent),var(--accent2))",color:variant==="secondary"?"var(--text)":"white",fontSize:14,fontWeight:600,cursor:p.disabled?"wait":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"inherit",opacity:p.disabled?0.6:1,...(p.style||{})}}>{children}</button>
);
const IconBtn = ({children,...p}) => (<button {...p} className="icon-btn" style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:6,borderRadius:"var(--radius-sm)",display:"flex",...(p.style||{})}}>{children}</button>);
const Spinner = () => <div style={{width:16,height:16,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"white",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>;
const Field = ({label,children}) => (<div style={{marginBottom:18}}><label style={{fontSize:11,fontWeight:700,color:"var(--muted)",display:"block",marginBottom:7,textTransform:"uppercase",letterSpacing:0.8}}>{label}</label>{children}</div>);
const fieldInput = {width:"100%",padding:"10px 12px",borderRadius:"var(--radius-md)",border:"1px solid var(--border)",fontSize:14,color:"var(--text)",background:"var(--card)",fontFamily:"inherit",boxSizing:"border-box",outline:"none"};
const calNav = {background:"none",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"8px 12px",cursor:"pointer",color:"var(--text)",display:"flex"};

/* Inline date picker — click date label to reveal native date input */
const InlineDatePicker = ({value, overdue, onChange}) => {
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  useEffect(()=>{if(editing && ref.current){ref.current.showPicker?.();ref.current.focus();}},[editing]);
  if(editing) return (
    <input ref={ref} type="date" value={value||""} onClick={e=>e.stopPropagation()}
      onChange={e=>{onChange(e.target.value);setEditing(false);}}
      onBlur={()=>setEditing(false)}
      style={{fontSize:12,fontWeight:600,border:"1px solid var(--accent)",borderRadius:6,padding:"2px 6px",outline:"none",fontFamily:"inherit",color:"var(--accent)",background:"var(--card)",cursor:"pointer"}}/>
  );
  return (
    <span onClick={e=>{e.stopPropagation();setEditing(true);}} title="Click to change date"
      style={{fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:3,cursor:"pointer",borderRadius:4,padding:"1px 4px",transition:"background 0.15s",
        color:value?(overdue?"var(--danger)":value===todayStr()?"var(--accent)":"var(--muted)"):"var(--muted)",
        background:value?"transparent":"var(--surface)",border:value?"none":"1px solid var(--border-light)"}}>
      {Icons.calendar} {value?formatDate(value):"No date"}
    </span>
  );
};

/* ═══ SNOOZE — one-tap "push it out" with fixed horizons. Designed to feel
   like dismissing a notification, not like project management. ═══ */
const SNOOZE_PRESETS = [
  { label: "Tomorrow",   offset: 1 },
  { label: "Next week",  offset: 7 },
  { label: "In 2 weeks", offset: 14 },
  { label: "In a month", offset: 30 },
  { label: "In 3 months", offset: 90 },
];
const SnoozeButton = ({task, onSnooze}) => {
  const [menu, setMenu] = useState(null); /* {x,y} or null */
  const [picking, setPicking] = useState(false);
  const close = () => { setMenu(null); setPicking(false); };
  return (<>
    <button onClick={e=>{e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();setMenu({x:Math.min(r.left,window.innerWidth-210),y:Math.min(r.bottom+4,window.innerHeight-280)});}}
      title="Snooze — push this task out, it returns on Today when due" aria-label={`Snooze "${task.title}"`} aria-haspopup="menu"
      style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:"1px 4px",borderRadius:4,display:"flex",alignItems:"center",gap:3,fontSize:11,fontWeight:600,fontFamily:"inherit"}}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
      <span>zZ</span>
    </button>
    {menu&&(<>
      <div style={{position:"fixed",inset:0,zIndex:1199}} onClick={e=>{e.stopPropagation();close();}}/>
      <div role="menu" onClick={e=>e.stopPropagation()}
        style={{position:"fixed",left:menu.x,top:menu.y,zIndex:1200,background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius-md)",boxShadow:"var(--shadow-2)",padding:6,minWidth:190,animation:"fadeIn 0.1s ease"}}>
        <div style={{fontSize:10,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8,padding:"5px 10px 3px"}}>Snooze until</div>
        {SNOOZE_PRESETS.map(p=>{const d=dateOffset(p.offset);return(
          <button key={p.label} role="menuitem" onClick={()=>{onSnooze(task,d);close();}}
            style={{width:"100%",padding:"8px 10px",border:"none",borderRadius:8,background:"transparent",color:"var(--text)",fontSize:13,fontWeight:500,cursor:"pointer",textAlign:"left",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,transition:"background 0.1s"}}
            onMouseEnter={e=>e.currentTarget.style.background="var(--surface)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span>{p.label}</span><span style={{fontSize:11,color:"var(--muted)"}}>{formatDate(d)}</span>
          </button>);})}
        <div style={{height:1,background:"var(--border-light)",margin:"4px 4px"}}/>
        {!picking?(
          <button role="menuitem" onClick={()=>setPicking(true)}
            style={{width:"100%",padding:"8px 10px",border:"none",borderRadius:8,background:"transparent",color:"var(--accent)",fontSize:13,fontWeight:600,cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"background 0.1s"}}
            onMouseEnter={e=>e.currentTarget.style.background="var(--accent-a06)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            Pick a date…
          </button>
        ):(
          <input type="date" autoFocus min={todayStr()}
            onChange={e=>{if(e.target.value){onSnooze(task,e.target.value);close();}}}
            onKeyDown={e=>{if(e.key==="Escape")close();}}
            style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid var(--accent)",fontSize:13,outline:"none",background:"var(--card)",color:"var(--text)",fontFamily:"inherit",boxSizing:"border-box"}}/>
        )}
      </div>
    </>)}
  </>);
};

/* ═══════════════════════════════════════════════════════════════════════
   PAPER MODE — JOURNAL SCENE
   The skeuomorphic "dot journal on a wooden desk" rendering. Styles live
   in app/paper-mode.css; these components only produce the markup. Bullet
   journal conventions: • open task, × done, ◦/– nested, − note lines.
   Marks are real buttons (the mark IS the checkbox); rows open the detail
   panel; a faint › on hover reveals the snooze (migration) menu.
   ═══════════════════════════════════════════════════════════════════════ */
const JournalRule = () => (
  <svg className="journal-rule" viewBox="0 0 240 8" preserveAspectRatio="none" aria-hidden="true">
    <path d="M2 5 C 42 2, 84 7, 126 4 S 206 3, 238 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
  </svg>
);

/* Days a task has rolled forward past its due date */
const carriedDays = (t) => !t.completed && t.dueDate && t.dueDate < todayStr()
  ? Math.max(1, Math.floor((new Date(todayStr()+"T00:00:00") - new Date(t.dueDate+"T00:00:00"))/86400000))
  : 0;

/* Nested subtasks — always fully visible (no collapse), journal indentation */
const JournalSubList = ({subs, depth, taskId, onSubToggle}) => {
  if(!subs?.length) return null;
  return subs.map(s => (
    <div key={s.id}>
      <div className={`journal-entry ${depth>1?"sub2":"sub"} ${s.completed?"done":""}`} style={{marginLeft: 22 + depth*24}}>
        <button className="journal-mark" onClick={e=>{e.stopPropagation();onSubToggle(taskId, s.id);}}
          aria-label={s.completed?`Mark "${s.title}" incomplete`:`Mark "${s.title}" complete`}>
          {s.completed ? "×" : depth === 1 ? "◦" : "–"}
        </button>
        <span className="journal-text">{s.title}</span>
        {s.dueDate && <span className="journal-due">— {formatDate(s.dueDate).toLowerCase()}</span>}
      </div>
      <JournalSubList subs={s.subtasks} depth={depth+1} taskId={taskId} onSubToggle={onSubToggle}/>
    </div>
  ));
};

const JournalEntry = ({task, onToggle, onSubToggle, onSelect, onSnooze}) => {
  const carried = carriedDays(task);
  const notes = (task.notes||"").split("\n").map(n=>n.trim()).filter(Boolean).slice(0,2);
  return (
    <div role="listitem">
      <div className={`journal-entry ${task.completed?"done":""}`} onClick={()=>onSelect(task)}>
        <button className="journal-mark" onClick={e=>{e.stopPropagation();onToggle(task.id);}}
          aria-label={task.completed?`Mark "${task.title}" incomplete`:`Mark "${task.title}" complete`}>
          {task.completed ? "×" : "•"}
        </button>
        {task.priority==="high" && !task.completed && <span className="journal-sig" title="High priority">*</span>}
        <span className="journal-text">
          {task.title}
          {(task.tags||[]).map(tg=><span key={tg} className="journal-tag">#{tg}</span>)}
        </span>
        <span className="journal-due">
          {task.dueDate && task.dueDate !== todayStr() && !carried ? `— due ${formatDate(task.dueDate).toLowerCase()}` : ""}
          {carried ? ` — carried ${carried}d` : ""}
          {!task.completed && task.snoozedFrom && task.dueDate === todayStr() ? " — back today" : ""}
        </span>
        {!task.completed && onSnooze && (
          <span className="journal-snooze" onClick={e=>e.stopPropagation()}>
            <SnoozeButton task={task} onSnooze={onSnooze}/>
          </span>
        )}
      </div>
      {notes.map((n,i)=><div key={i} className="journal-note">− {n}</div>)}
      <JournalSubList subs={task.subtasks} depth={1} taskId={task.id} onSubToggle={onSubToggle}/>
    </div>
  );
};

/* Subtasks surfaced onto Today by their own due date (parent lives elsewhere) */
const JournalSurfacedEntry = ({item, onSubToggle, onSelect}) => (
  <div role="listitem">
    <div className={`journal-entry sub ${item.completed?"done":""}`} onClick={()=>onSelect(item._parentTask)}>
      <button className="journal-mark" onClick={e=>{e.stopPropagation();onSubToggle(item._parentTask.id, item.id);}}
        aria-label={item.completed?`Mark "${item.title}" incomplete`:`Mark "${item.title}" complete`}>
        {item.completed ? "×" : "◦"}
      </button>
      <span className="journal-text">{item.title}</span>
      <span className="journal-due">↳ {item._breadcrumb.slice(0,-1).join(" › ")}</span>
    </div>
  </div>
);

const JournalView = ({tasks, lists, dateLabel, searching, onToggle, onSubToggle, onSelect, onSnooze, onAdd}) => {
  const [jot, setJot] = useState("");
  /* Group by list, in sidebar order, unknown lists appended */
  const order = [...lists];
  tasks.forEach(t=>{const l=(t._surfacedSub?t._parentTask.list:t.list)||"Inbox"; if(!order.includes(l)) order.push(l);});
  const groups = order.map(l=>({
    list: l,
    items: tasks.filter(t=>(((t._surfacedSub?t._parentTask.list:t.list))||"Inbox")===l)
  })).filter(g=>g.items.length>0)
    .map(g=>({...g, items:[...g.items.filter(t=>!t.completed), ...g.items.filter(t=>t.completed)]}));
  const showHeaders = groups.length > 1 || (groups.length === 1 && groups[0].list !== "Inbox");

  return (
    <div className="journal-page">
      <div className="journal-datehead">
        <h2>{searching ? "Looking back…" : "Today"}</h2>
        <span className="journal-date">{dateLabel}</span>
      </div>
      <JournalRule/>
      {!searching && (
        <div className="journal-jot">
          <span className="journal-mark" aria-hidden="true">•</span>
          <input id="quick-add" value={jot} onChange={e=>setJot(e.target.value)} aria-label="Add a task"
            enterKeyHint="done" placeholder="jot a task…"
            onKeyDown={e=>{if(e.key==="Enter"&&jot.trim()){onAdd(jot.trim());setJot("");}}}/>
        </div>
      )}
      {groups.length===0 && (
        <div className="journal-empty">{searching ? "Nothing written under that…" : "Nothing on today's page — go fill the paper one. ✎"}</div>
      )}
      <div role="list" aria-label="Tasks">
        {groups.map(g=>(
          <section key={g.list}>
            {showHeaders && (<><div className="journal-cat">{g.list}</div><JournalRule/></>)}
            {g.items.map(t=>t._surfacedSub
              ? <JournalSurfacedEntry key={`sub-${t.id}`} item={t} onSubToggle={onSubToggle} onSelect={onSelect}/>
              : <JournalEntry key={t.id} task={t} onToggle={onToggle} onSubToggle={onSubToggle} onSelect={onSelect} onSnooze={onSnooze}/>)}
          </section>
        ))}
      </div>
      {/* Coffee ring easter egg — hover: it freshens and steams */}
      <div className="coffee-ring" aria-hidden="true">
        <span className="steam s1"/><span className="steam s2"/><span className="steam s3"/>
      </div>
    </div>
  );
};

/* Fountain pen resting across the page edge — hover nudges it, ink blots */
const DeskPen = () => (
  <div className="desk-pen" aria-hidden="true">
    <span className="pen-inkblot"/>
    <svg viewBox="0 0 240 28" width="100%" height="auto">
      <defs>
        <linearGradient id="penBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5c2331"/><stop offset="0.4" stopColor="#83364a"/>
          <stop offset="0.55" stopColor="#96475d"/><stop offset="1" stopColor="#43181f"/>
        </linearGradient>
        <linearGradient id="penMetal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8a6a2f"/><stop offset="0.5" stopColor="#dcb768"/><stop offset="1" stopColor="#755625"/>
        </linearGradient>
      </defs>
      <path d="M2 14 L30 7 L46 14 L30 21 Z" fill="url(#penMetal)"/>
      <line x1="9" y1="14" x2="30" y2="14" stroke="#5c451c" strokeWidth="0.9"/>
      <circle cx="30" cy="14" r="1.5" fill="#5c451c"/>
      <rect x="42" y="7.5" width="24" height="13" rx="5.5" fill="#2c2128"/>
      <rect x="63" y="6" width="116" height="16" rx="8" fill="url(#penBody)"/>
      <rect x="177" y="6.5" width="7" height="15" rx="2.5" fill="url(#penMetal)"/>
      <rect x="184" y="6.5" width="48" height="15" rx="7.5" fill="url(#penBody)"/>
      <rect x="196" y="2.5" width="32" height="4.5" rx="2.2" fill="url(#penMetal)"/>
      <ellipse cx="232" cy="14" rx="5.5" ry="7" fill="#43181f"/>
    </svg>
  </div>
);

/* Afternoon sun through a window pane — fixed multiply layer over the desk */
const WindowLight = () => <div className="window-light" aria-hidden="true"/>;

/* Depth styling for subtask hierarchy — warm amber→gold→honey gradient
   No reds (avoids urgency connotation). All pass WCAG AA contrast. */
const DEPTH_STYLES = [
  { border: "var(--depth0)", bg: "var(--depth0-bg)",  prefix: "",     prefixColor: "var(--depth0)" },  // depth 0: dark amber
  { border: "var(--depth1)", bg: "var(--depth1-bg)",  prefix: "↳ ",  prefixColor: "var(--depth1)" },  // depth 1: golden
  { border: "var(--depth1)", bg: "var(--depth2-bg)",   prefix: "↳↳ ", prefixColor: "var(--depth2)" },  // depth 2+: honey
];
const getDepthStyle = (d) => DEPTH_STYLES[Math.min(d, DEPTH_STYLES.length - 1)];

/* Subtasks in TaskRow — draggable to promote to task */
const DraggableSubtaskTree = ({subtasks, onAction, onDragStart, onDragEnd, depth=0, listColor=null}) => {
  const [openIds, setOpenIds] = useState({});
  const toggle = id => setOpenIds(p=>({...p,[id]:!p[id]}));
  if(!subtasks?.length) return null;
  const ds = getDepthStyle(depth);
  /* When a list color is provided, override the depth styling with the list color + faint tint */
  const borderCol = listColor || ds.border;
  const bgCol = listColor ? hexTint(listColor, 0.05 + depth*0.015) : ds.bg;
  return (
    <div style={{marginLeft: depth > 0 ? 10 : 0, borderLeft: `3px solid ${borderCol}`,
      background: bgCol, borderRadius: "0 6px 6px 0", paddingLeft: 8}}>
      {subtasks.map(sub => {
        const childCount = countSubs(sub.subtasks);
        const hasChildren = (sub.subtasks||[]).length > 0;
        const isOpen = openIds[sub.id] !== false;
        return (
          <div key={sub.id}>
            <div draggable onDragStart={e=>{e.stopPropagation();onDragStart(e,sub,"subtask");}} onDragEnd={onDragEnd}
              data-drag-id={sub.id} data-drag-source="subtask" data-drag-label={sub.title}
              style={{display:"flex",alignItems:"center",gap:8,padding:"4px 4px",fontSize:13,cursor:"grab",touchAction:"none"}}>
              <span style={{color:"var(--border)",flexShrink:0,cursor:"grab"}}>{Icons.grip}</span>
              {depth > 0 && <span style={{fontSize:9,color:listColor||ds.prefixColor,flexShrink:0,fontWeight:700}}>{ds.prefix.trim()}</span>}
              <Checkbox checked={sub.completed} size={15} onChange={c=>onAction("update",sub.id,{completed:c,completedAt:c?new Date().toISOString():null})}/>
              <span style={{flex:1,color:sub.completed?"var(--muted)":"var(--text)",textDecoration:sub.completed?"line-through":"none",minWidth:0,fontSize:13}}>{sub.title}</span>
              {sub.dueDate&&<span style={{fontSize:10,color:isOverdue(sub.dueDate)?"var(--danger)":"var(--muted)",fontWeight:500,flexShrink:0}}>{formatDate(sub.dueDate)}</span>}
              {hasChildren && (
                <button onClick={e=>{e.stopPropagation();toggle(sub.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:2,color:"var(--muted)",display:"flex",alignItems:"center",gap:2,fontSize:11,fontFamily:"inherit",flexShrink:0}}>
                  {childCount.done}/{childCount.total}
                  <span style={{transform:isOpen?"rotate(0)":"rotate(-90deg)",transition:"transform 0.15s",display:"flex"}}>{Icons.chevD}</span>
                </button>
              )}
            </div>
            {hasChildren && isOpen && (
              <DraggableSubtaskTree subtasks={sub.subtasks} onAction={onAction} onDragStart={onDragStart} onDragEnd={onDragEnd} depth={depth+1} listColor={listColor}/>
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
      <div style={{width:22,height:22,borderRadius:11,background:"var(--card)",boxShadow:"0 1px 3px rgba(0,0,0,0.2)",
        transform:checked?"translateX(18px)":"translateX(0)",transition:"transform 0.2s"}}/>
    </button>
  </div>
);

/* ═══════════════════════════════════════════════════════════════════════
   SUBTASK TOUCH DRAG — self-contained long-press drag for detail panel
   Handles reorder (before/after) and nest within the subtask tree.
   ═══════════════════════════════════════════════════════════════════════ */
const useSubtaskTouchDrag = (containerRef, onReorder) => {
  const onReorderRef = useRef(onReorder);
  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const s = { phase:"idle", dragId:null, ghost:null, timer:null,
      startX:0, startY:0, moved:false, srcEl:null, lastTarget:null, lastZone:null };

    const closest = (el, sel) => {
      if(!el) return null;
      if(el.nodeType===3) el=el.parentElement;
      try { return el?.closest?.(sel) || null; } catch(e) { return null; }
    };

    const clearHL = () => {
      if(s.lastTarget) {
        s.lastTarget.style.outline=""; s.lastTarget.style.background="";
        const indicators = s.lastTarget.querySelectorAll("[data-zone-indicator]");
        indicators.forEach(i => i.remove());
        s.lastTarget = null; s.lastZone = null;
      }
    };

    const reset = () => {
      clearTimeout(s.timer);
      if(s.ghost) { s.ghost.remove(); s.ghost=null; }
      if(s.srcEl) { s.srcEl.style.opacity=""; s.srcEl=null; }
      clearHL();
      s.phase="idle"; s.dragId=null; s.moved=false;
      document.body.style.userSelect="";
    };

    const onStart = (e) => {
      if(s.phase!=="idle") return;
      const el = e.target;
      const tag = el?.tagName?.toLowerCase?.()||"";
      if(tag==="input"||tag==="textarea"||tag==="select") return;
      if(tag==="button"||closest(el,"button")) return;

      const row = closest(el, "[data-sub-drag]");
      if(!row || !container.contains(row)) return;

      const t = e.touches[0];
      s.startX=t.clientX; s.startY=t.clientY; s.moved=false;
      s.dragId=row.dataset.subDrag;
      s.srcEl=row;
      s.phase="waiting";
      s.timer = setTimeout(() => {
        s.phase="dragging";
        document.body.style.userSelect="none";
        /* Ghost */
        const rect = row.getBoundingClientRect();
        const g = document.createElement("div");
        g.textContent = row.dataset.subLabel||"•";
        Object.assign(g.style, {
          position:"fixed",top:rect.top+"px",left:rect.left+"px",zIndex:"9999",
          padding:"8px 14px",background:"#292524",color:"#fafaf9",borderRadius:"10px",
          fontSize:"13px",fontWeight:"600",fontFamily:"sans-serif",
          boxShadow:"0 8px 24px rgba(0,0,0,0.3)",pointerEvents:"none",
          whiteSpace:"nowrap",maxWidth:"200px",overflow:"hidden",
          textOverflow:"ellipsis",opacity:"0.95"
        });
        document.body.appendChild(g);
        s.ghost=g;
        row.style.opacity="0.3";
        try { navigator.vibrate?.(30); } catch(e){}
      }, 400);
    };

    const onMove = (e) => {
      if(s.phase==="idle") return;
      const t = e.touches[0];
      if(s.phase==="waiting") {
        if(Math.abs(t.clientX-s.startX)+Math.abs(t.clientY-s.startY)>12) { reset(); return; }
        e.preventDefault(); return;
      }
      if(s.phase!=="dragging") return;
      e.preventDefault();
      s.moved=true;
      if(s.ghost) { s.ghost.style.top=(t.clientY-20)+"px"; s.ghost.style.left=(t.clientX-10)+"px"; }

      /* Find drop target */
      if(s.ghost) s.ghost.style.display="none";
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if(s.ghost) s.ghost.style.display="";
      const target = closest(el, "[data-sub-drop]");

      if(target !== s.lastTarget || target) {
        clearHL();
        if(target && target.dataset.subDrop !== s.dragId) {
          const rect = target.getBoundingClientRect();
          const y = (t.clientY - rect.top) / rect.height;
          const zone = y < 0.25 ? "before" : y > 0.75 ? "after" : "nest";
          s.lastTarget = target;
          s.lastZone = zone;

          if(zone==="nest") {
            target.style.outline="2px dashed var(--depth0)";
            target.style.background="rgba(168,100,46,0.08)";
          } else {
            const indicator = document.createElement("div");
            indicator.dataset.zoneIndicator = "1";
            Object.assign(indicator.style, {
              position:"absolute", left:"0", right:"0", height:"2px",
              background:"var(--depth0)", borderRadius:"1px", zIndex:"5", pointerEvents:"none",
              [zone==="before"?"top":"bottom"]: "-1px"
            });
            if(getComputedStyle(target).position==="static") target.style.position="relative";
            target.appendChild(indicator);
          }
        }
      }
    };

    const onEnd = (e) => {
      if(s.phase!=="dragging"||!s.moved) { reset(); return; }
      if(s.lastTarget && s.lastZone && onReorderRef.current) {
        const targetId = s.lastTarget.dataset.subDrop;
        if(targetId && targetId !== s.dragId) {
          onReorderRef.current(s.dragId, targetId, s.lastZone);
        }
      }
      reset();
    };

    container.addEventListener("touchstart", onStart, {passive:true});
    document.addEventListener("touchmove", onMove, {passive:false});
    document.addEventListener("touchend", onEnd, {passive:true});
    document.addEventListener("touchcancel", reset, {passive:true});

    return () => {
      container.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", reset);
      reset();
    };
  }, [containerRef]);
};

/* ═══════════════════════════════════════════════════════════════════════
   RECURSIVE SUBTASK TREE (infinite nesting, editable titles, clickable)
   Visual depth cues + drag to reorder/nest (desktop + mobile)
   ═══════════════════════════════════════════════════════════════════════ */
const SubtaskTree = ({subtasks, onAction, onOpenSub, onReorder, depth=0, compact=false, listColor=null}) => {
  const [openIds, setOpenIds] = useState({});
  const [addingTo, setAddingTo] = useState(null);
  const [addText, setAddText] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [dropZone, setDropZone] = useState(null); /* {id, zone} */
  const editRef = useRef(null);
  const toggle = id => setOpenIds(p=>({...p,[id]:!p[id]}));
  /* Hooks must run before any conditional return (Rules of Hooks) */
  useEffect(()=>{if(editingId&&editRef.current){editRef.current.focus();editRef.current.select();}},[editingId]);
  if(!subtasks?.length && !compact) return null;
  const ds = getDepthStyle(depth);
  const borderCol = listColor || ds.border;
  const bgCol = listColor ? hexTint(listColor, 0.05 + depth*0.015) : ds.bg;

  const handleDragStart = (e, sub) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", sub.id);
    e.dataTransfer.setData("application/x-source", "detail-subtask");
    requestAnimationFrame(() => { const el = e.target.closest("[data-sub-row]"); if(el) el.style.opacity = "0.4"; });
  };
  const handleDragEnd = (e) => {
    const el = e.target.closest("[data-sub-row]"); if(el) el.style.opacity = "";
    setDropZone(null);
  };
  const handleDragOver = (e, sub) => {
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const dragId = e.dataTransfer.types.includes("text/plain") ? true : false;
    if(!dragId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const zone = y < 0.25 ? "before" : y > 0.75 ? "after" : "nest";
    setDropZone({id: sub.id, zone});
  };
  const handleDrop = (e, targetSub) => {
    e.preventDefault(); e.stopPropagation();
    const dragId = e.dataTransfer.getData("text/plain");
    const src = e.dataTransfer.getData("application/x-source");
    if(!dragId || dragId === targetSub.id || src !== "detail-subtask") { setDropZone(null); return; }
    if(onReorder && dropZone) onReorder(dragId, targetSub.id, dropZone.zone);
    setDropZone(null);
  };
  const handleDragLeave = (e) => {
    /* Only clear if truly leaving the element, not entering a child */
    const related = e.relatedTarget;
    if(related && e.currentTarget.contains(related)) return;
    setDropZone(null);
  };

  return (
    <div style={{marginLeft: depth > 0 ? 12 : 0, borderLeft: `3px solid ${borderCol}`,
      background: bgCol, borderRadius: "0 8px 8px 0", paddingLeft: 10}}>
      {(subtasks||[]).map(sub => {
        const childCount = countSubs(sub.subtasks);
        const hasChildren = (sub.subtasks||[]).length > 0;
        const isOpen = openIds[sub.id] !== false;
        const isEditing = editingId===sub.id;
        const dz = dropZone?.id === sub.id ? dropZone : null;
        return (
          <div key={sub.id} data-sub-row data-sub-drag={sub.id} data-sub-drop={sub.id} data-sub-label={sub.title}
            onDragOver={e => handleDragOver(e, sub)}
            onDrop={e => handleDrop(e, sub)}
            onDragLeave={handleDragLeave}
            style={{position:"relative",
              background: dz?.zone === "nest" ? "rgba(168,100,46,0.08)" : "transparent",
              outline: dz?.zone === "nest" ? "2px dashed var(--accent)" : "none",
              borderRadius: dz?.zone === "nest" ? 6 : 0,
              transition:"background 0.1s"}}>
            {dz?.zone === "before" && <div style={{position:"absolute",top:-1,left:0,right:0,height:2,background:"var(--accent)",borderRadius:1,zIndex:5}}/>}
            {dz?.zone === "after" && <div style={{position:"absolute",bottom:-1,left:0,right:0,height:2,background:"var(--accent)",borderRadius:1,zIndex:5}}/>}
            {dz?.zone === "nest" && <div style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",fontSize:10,color:"var(--accent)",fontWeight:700,zIndex:5,pointerEvents:"none"}}>↳ nest</div>}
            <div draggable onDragStart={e => handleDragStart(e, sub)} onDragEnd={handleDragEnd}
              style={{display:"flex",alignItems:"center",gap:8,padding:compact?"7px 4px":"5px 4px",fontSize:compact?14:13,
                borderBottom:"1px solid var(--border-light)",cursor:"grab"}}>
              <span style={{color:"var(--border)",flexShrink:0,cursor:"grab",fontSize:12,lineHeight:1,userSelect:"none",touchAction:"none"}}>{Icons.grip}</span>
              <Checkbox checked={sub.completed} size={compact?16:15} onChange={c=>onAction("update",sub.id,{completed:c,completedAt:c?new Date().toISOString():null})}/>

              {depth > 0 && <span style={{fontSize:10,color:ds.prefixColor,flexShrink:0,fontWeight:700,lineHeight:1}}>{ds.prefix.trim()}</span>}

              {isEditing ? (
                <input ref={editRef} value={editText} onChange={e=>setEditText(e.target.value)}
                  onClick={e=>e.stopPropagation()}
                  onBlur={()=>{if(editText.trim()&&editText.trim()!==sub.title)onAction("update",sub.id,{title:editText.trim()});setEditingId(null);}}
                  onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape"){setEditingId(null);}}}
                  style={{flex:1,border:"none",outline:"none",background:"var(--accent-a10)",borderRadius:4,padding:"2px 6px",fontFamily:"inherit",fontSize:compact?14:13,minWidth:0,color:"var(--text)"}}/>
              ) : (
                <span
                  onClick={e=>{e.stopPropagation();if(compact&&onOpenSub)onOpenSub(sub.id);}}
                  onDoubleClick={e=>{e.stopPropagation();setEditingId(sub.id);setEditText(sub.title);}}
                  title={compact?"Click to edit details · Double-click to rename":"Double-click to rename"}
                  style={{flex:1,color:sub.completed?"var(--muted)":"var(--text)",textDecoration:sub.completed?"line-through":"none",
                    cursor:compact?"pointer":"default",minWidth:0,
                    borderRadius:4,padding:"1px 4px",transition:"background 0.1s"}}>
                  {sub.title}
                </span>
              )}

              {sub.priority&&sub.priority!=="none"&&<span style={{width:6,height:6,borderRadius:"50%",background:PRIORITY[sub.priority].color,flexShrink:0}}/>}
              {sub.dueDate&&<span style={{fontSize:10,color:isOverdue(sub.dueDate)?"var(--danger)":"var(--muted)",fontWeight:500,flexShrink:0,whiteSpace:"nowrap"}}>{formatDate(sub.dueDate)}</span>}
              {hasChildren && (
                <button onClick={e=>{e.stopPropagation();toggle(sub.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:2,color:"var(--muted)",display:"flex",alignItems:"center",gap:2,fontSize:11,fontFamily:"inherit",flexShrink:0}}>
                  {childCount.done}/{childCount.total}
                  <span style={{transform:isOpen?"rotate(0)":"rotate(-90deg)",transition:"transform 0.15s",display:"flex"}}>{Icons.chevD}</span>
                </button>
              )}
              {compact && (
                <button onClick={e=>{e.stopPropagation();setAddingTo(addingTo===sub.id?null:sub.id);setAddText("");}} style={{background:"none",border:"none",cursor:"pointer",padding:2,color:"var(--muted)",display:"flex",flexShrink:0}} title="Add sub-subtask">
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
                  style={{width:"100%",padding:"6px 10px",borderRadius:8,border:"1px solid var(--accent)",fontSize:13,outline:"none",background:"var(--card)",fontFamily:"inherit"}}/>
              </div>
            )}
            {hasChildren && isOpen && (
              <SubtaskTree subtasks={sub.subtasks} onAction={onAction} onOpenSub={onOpenSub} onReorder={onReorder} depth={depth+1} compact={compact} listColor={listColor}/>
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
const PhotoModal = ({onClose,onProcess,processing,error}) => {
  const [dragOver,setDragOver]=useState(false);
  const [preview,setPreview]=useState(null);
  const [fileData,setFileData]=useState(null);
  const [mediaType,setMediaType]=useState("image/jpeg");
  const inputRef=useRef(null);
  /* Downscale big phone photos client-side: modern cameras produce 8–20MB
     images that blow past the vision API's size limit and waste upload time.
     1600px on the long edge keeps handwriting crisp for OCR. */
  const handleFile=f=>{
    if(!f?.type.startsWith("image/"))return;
    const r=new FileReader();
    r.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const MAX=1600;
        const scale=Math.min(1,MAX/Math.max(img.width,img.height));
        if(scale>=1&&f.size<2.5*1024*1024){
          setMediaType(f.type);setPreview(e.target.result);setFileData(e.target.result.split(",")[1]);
          return;
        }
        const c=document.createElement("canvas");
        c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);
        c.getContext("2d").drawImage(img,0,0,c.width,c.height);
        const dataUrl=c.toDataURL("image/jpeg",0.85);
        setMediaType("image/jpeg");setPreview(dataUrl);setFileData(dataUrl.split(",")[1]);
      };
      img.src=e.target.result;
    };
    r.readAsDataURL(f);
  };
  return (
    <Overlay onClose={onClose}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
        <div style={{width:40,height:40,borderRadius:12,background:"linear-gradient(135deg,var(--accent),var(--accent2))",display:"flex",alignItems:"center",justifyContent:"center",color:"white"}}>{Icons.camera}</div>
        <div><h2 style={{margin:0,fontSize:19,fontFamily:"var(--font-display)",color:"var(--ink)"}}>Scan Notebook Page</h2><p style={{margin:0,fontSize:13,color:"var(--muted)"}}>AI extracts and syncs your handwritten to-dos</p></div>
      </div>
      {!preview?(
        <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e.dataTransfer.files[0]);}} onClick={()=>inputRef.current?.click()}
          style={{border:`2px dashed ${dragOver?"var(--accent)":"var(--border)"}`,borderRadius:16,padding:"44px 24px",textAlign:"center",cursor:"pointer",background:dragOver?"var(--accent-bg)":"var(--surface)",transition:"all 0.2s"}}>
          <div style={{marginBottom:14,color:dragOver?"var(--accent)":"var(--muted)"}}>{Icons.upload}</div>
          <p style={{margin:0,fontSize:15,fontWeight:600,color:"var(--text)"}}>Drop your notebook photo here</p>
          <p style={{margin:"8px 0 0",fontSize:13,color:"var(--muted)"}}>or tap to browse</p>
          <input ref={inputRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
        </div>
      ):(
        <div>
          <div style={{borderRadius:12,overflow:"hidden",marginBottom:16,border:"1px solid var(--border)",maxHeight:260}}><img src={preview} alt="Preview" style={{width:"100%",display:"block",objectFit:"contain",maxHeight:260}}/></div>
          {error && (
            <div style={{background:"var(--danger-bg)",border:"1px solid var(--danger-border)",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:13,color:"var(--danger)",lineHeight:1.4}}>
              <strong>Scan failed:</strong> {error}
            </div>
          )}
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
        flat.push({title:it.title,completed:it.completed||false,category:depth===0?(it.category||null):null,date:depth===0?(it.date||null):null,priority:depth===0?(it.priority||null):null,is_duplicate_of:it.is_duplicate_of||null,_depth:depth,_selected:true,_id:id++});
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
      const node={title:it.title,completed:it.completed,category:it._depth===0?it.category:null,date:it._depth===0?it.date:null,priority:it._depth===0?it.priority:null,is_duplicate_of:it._depth===0?it.is_duplicate_of:null,subtasks:[]};
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
    const scanDepthBg = item._depth > 0 ? getDepthStyle(item._depth).bg : "transparent";
    return (
      <div key={item._id} data-scan-row
        onDragOver={e=>onRowDragOver(e,idx)} onDrop={e=>onRowDrop(e,idx)}
        style={{paddingLeft:indentPx,borderBottom:isTask?"1px solid var(--border-light)":"none",
          borderLeft:item._depth>0?`3px solid ${getDepthStyle(item._depth).border}`:"none",
          opacity:item._selected?1:0.3,transition:"opacity 0.15s,padding 0.15s",position:"relative",
          background:dt?.zone==="nest"?"var(--accent-a06)":scanDepthBg,
          outline:dt?.zone==="nest"?"2px dashed var(--accent)":"none",borderRadius:dt?.zone==="nest"?8:item._depth>0?"0 4px 4px 0":0,
          marginLeft:item._depth>0?4:0}}>
        {dt?.zone==="before"&&<div style={{position:"absolute",top:-1,left:8,right:8,height:2,background:"var(--accent)",borderRadius:1,zIndex:5}}/>}
        {dt?.zone==="after"&&<div style={{position:"absolute",bottom:-1,left:8,right:8,height:2,background:"var(--accent)",borderRadius:1,zIndex:5}}/>}
        {dt?.zone==="nest"&&<div style={{position:"absolute",left:indentPx+32,top:"50%",transform:"translateY(-50%)",fontSize:10,color:"var(--accent)",fontWeight:700,zIndex:5,pointerEvents:"none"}}>↳ nest</div>}
        <div style={{display:"flex",alignItems:"center",gap:4,padding:isTask?"10px 4px":"4px 4px"}}>
          <span draggable onDragStart={e=>onRowDragStart(e,idx)} onDragEnd={onRowDragEnd}
            style={{cursor:"grab",color:"var(--border)",fontSize:12,flexShrink:0,padding:"0 2px",userSelect:"none",touchAction:"none",lineHeight:1}}>⠿</span>
          {item._depth>0&&<span style={{fontSize:10,color:getDepthStyle(item._depth).prefixColor,flexShrink:0,width:14,textAlign:"center",fontWeight:700}}>{item._depth===1?"↳":"↳↳"}</span>}
          <input value={item.title} onChange={e=>updateItem(idx,{title:e.target.value})}
            style={{flex:1,border:"1px solid transparent",borderRadius:6,padding:"3px 6px",
              fontSize:isTask?14:12,fontWeight:isTask?600:400,
              color:item.completed?"var(--muted)":"var(--ink)",background:"transparent",outline:"none",
              fontFamily:"inherit",boxSizing:"border-box",minWidth:0,
              textDecoration:item.completed?"line-through":"none"}}
            onFocus={e=>{e.target.style.borderColor="var(--accent)";e.target.style.background="var(--card)";}}
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
            }} style={{fontSize:12,padding:"2px 6px",borderRadius:4,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text)",cursor:"pointer",fontFamily:"inherit"}}>
              <option value="">Inbox</option>
              {allLists.filter(l=>l!=="Inbox").map(l=><option key={l} value={l}>{l}</option>)}
              <option value="__new__">+ New list...</option>
            </select>
            {newInputIdx===idx&&(
              <input autoFocus value={newInputVal} onChange={e=>setNewInputVal(e.target.value)}
                placeholder="List name, Enter to save"
                onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commitNewList();}if(e.key==="Escape"){setNewInputIdx(null);setNewInputVal("");}}}
                onBlur={()=>commitNewList()}
                style={{fontSize:12,padding:"3px 8px",borderRadius:4,border:"1px solid var(--accent)",width:140,outline:"none",fontFamily:"inherit",background:"var(--accent-bg)"}}/>
            )}
            <input type="date" value={item.date||results.page_date||""} onChange={e=>updateItem(idx,{date:e.target.value||null})}
              style={{fontSize:12,padding:"2px 6px",borderRadius:4,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text)",cursor:"pointer",fontFamily:"inherit"}}/>
            {item.completed&&<span style={{fontSize:11,background:"#dcfce7",color:"#166534",padding:"1px 7px",borderRadius:4,fontWeight:600}}>✓ done</span>}
            {item.priority==="high"&&<span style={{fontSize:11,background:"rgba(248,113,113,0.12)",color:"#dc2626",padding:"1px 7px",borderRadius:4,fontWeight:600}} title="Marked with * or ! on the page">⚑ high</span>}
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
          style={{padding:"10px 12px",background:isDragging?"var(--accent-a10)":"var(--accent-a06)",borderRadius:10,marginBottom:2,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",transition:"background 0.15s"}}>
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
                      <div style={{marginTop:4,paddingLeft:8,borderLeft:"3px solid var(--depth0)",borderRadius:"0 4px 4px 0",marginLeft:4}}>
                        {g.children.map(c=>(
                          <div key={c.item._id} style={{fontSize:12,color:"var(--muted)",padding:"2px 0"}}>
                            <span style={{color:"var(--depth0)",fontWeight:700,fontSize:10,marginRight:4}}>↳</span>
                            <span style={{textDecoration:c.item.completed?"line-through":"none"}}>{c.item.title}</span>
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
const TaskDetail = ({task, onUpdate, onDelete, onClose, onToggle, lists}) => {
  /* Navigation stack: view subtask details, then go back */
  const [subPath, setSubPath] = useState([]);
  const [newSub, setNewSub] = useState("");
  const [newTag, setNewTag] = useState("");
  const subTreeRef = useRef(null);
  const [navDir, setNavDir] = useState("in"); /* "in"=drill deeper, "out"=go back */
  const [animKey, setAnimKey] = useState(0);

  /* Reset path when switching tasks */
  useEffect(()=>{ setSubPath([]); setAnimKey(k=>k+1); },[task.id]);

  const drillIn = (subId) => { setNavDir("in"); setSubPath(p=>[...p, subId]); setAnimKey(k=>k+1); };
  const goBack = () => { setNavDir("out"); setSubPath(p=>p.slice(0,-1)); setAnimKey(k=>k+1); };

  /* Resolve current item from path */
  let current = task;
  let breadcrumbs = [{id:task.id, title:task.title, depth:0}];
  for(const sid of subPath) {
    const found = findSubById(current.subtasks, sid);
    if(found) { current = found; breadcrumbs.push({id:found.id, title:found.title, depth:breadcrumbs.length}); }
    else break;
  }
  const isSubtask = subPath.length > 0;
  const depth = subPath.length;
  const depthLabels = ["Task", "Subtask", "Sub-subtask", "Sub-sub-subtask"];
  const depthLabel = depth < depthLabels.length ? depthLabels[depth] : `Depth ${depth}`;
  const ds = getDepthStyle(depth);
  const depthColors = ["var(--accent)", "var(--depth1)", "var(--depth2)", "var(--depth3)"];
  const taskListColor = listAccentColor(task.list, lists);
  const accentColor = depthColors[Math.min(depth, depthColors.length - 1)];

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
    if(action==="remove") newSubs = deleteSubById(current.subtasks||[], targetId);
    else if(action==="add") newSubs = addSubTo(current.subtasks||[], targetId, data);
    else newSubs = updateSubById(current.subtasks||[], targetId, data);
    updateCurrent({subtasks: newSubs});
  };

  /* Drag-to-reorder/nest subtasks within the detail panel */
  const handleSubReorder = (dragId, targetId, zone) => {
    if(dragId === targetId) return;
    const subs = current.subtasks || [];
    const dragged = findSubById(subs, dragId);
    if(!dragged) return;
    /* Circular reference: promote the target up instead of blocking */
    if(zone === "nest" && isDescendant(dragged.subtasks, targetId)) {
      const target = findSubById(subs, targetId);
      if(!target) return;
      /* Remove target from tree, insert as sibling after dragged item */
      let cleaned = removeSubById(subs, targetId);
      cleaned = insertSubNear(cleaned, dragId, target, "after");
      updateCurrent({subtasks: cleaned});
      return;
    }
    /* Normal: remove dragged from tree, reinsert at target position */
    let cleaned = removeSubById(subs, dragId);
    if(zone === "nest") {
      cleaned = addSubTo(cleaned, targetId, dragged);
    } else {
      cleaned = insertSubNear(cleaned, targetId, dragged, zone);
    }
    updateCurrent({subtasks: cleaned});
  };

  /* Mobile touch drag for subtasks */
  useSubtaskTouchDrag(subTreeRef, handleSubReorder);

  return (
    <div className="detail-panel" role="complementary" aria-label="Task details"
      style={{width:"33vw",minWidth:380,maxWidth:520,borderLeft:"1px solid var(--border)",background:"var(--bg)",display:"flex",flexDirection:"column",height:"100%",flexShrink:0,animation:"slideIn 0.2s ease"}}>

      {/* ── Header: depth-colored accent bar + breadcrumbs ── */}
      <div style={{borderBottom:"1px solid var(--border)"}}>
        {/* Colored depth indicator strip */}
        <div style={{height:3,background:accentColor,transition:"background 0.3s"}}/>
        {/* List color stripe (only when task has a categorized list) */}
        {taskListColor&&<div style={{height:2,background:taskListColor,transition:"background 0.3s"}}/>}

        <div style={{padding:"10px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",minHeight:44}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
            {isSubtask && (
              <button onClick={goBack} style={{background:"none",border:"none",cursor:"pointer",color:accentColor,padding:2,display:"flex",flexShrink:0,transition:"color 0.2s"}} aria-label="Back to parent">
                {Icons.back}
              </button>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:2,minWidth:0}}>
              {/* Type badge */}
              <span style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1.2,color:accentColor,lineHeight:1}}>
                {depthLabel} Details
              </span>
              {/* Breadcrumb trail */}
              {isSubtask && (
                <div style={{display:"flex",alignItems:"center",gap:0,fontSize:11,color:"var(--muted)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {breadcrumbs.slice(0,-1).map((b,i)=>(
                    <span key={b.id} style={{display:"inline-flex",alignItems:"center",gap:0}}>
                      {i>0&&<span style={{margin:"0 3px",color:"var(--border)"}}>›</span>}
                      <button onClick={()=>{setNavDir("out");setSubPath(subPath.slice(0,i));setAnimKey(k=>k+1);}}
                        style={{background:"none",border:"none",cursor:"pointer",color:depthColors[Math.min(i, depthColors.length-1)],fontSize:11,fontWeight:600,padding:0,fontFamily:"inherit",maxWidth:80,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                        title={b.title}>
                        {b.title.length>14?b.title.slice(0,14)+"…":b.title}
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={{display:"flex",gap:2,flexShrink:0}}>
            {!isSubtask && <IconBtn onClick={()=>onDelete(task.id)} title="Delete" aria-label="Delete task">{Icons.trash}</IconBtn>}
            {isSubtask && <IconBtn onClick={()=>{handleSubAction("remove",current.id);goBack();}} title="Delete subtask" aria-label="Delete subtask">{Icons.trash}</IconBtn>}
            <IconBtn onClick={onClose} aria-label="Close">{Icons.x}</IconBtn>
          </div>
        </div>
      </div>

      {/* ── Animated content area ── */}
      <div key={animKey} style={{flex:1,overflowY:"auto",padding:"18px 20px",animation:`${navDir==="in"?"drillIn":"drillOut"} 0.2s ease`}}>
        {/* Title + checkbox */}
        <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:20}}>
          <div style={{paddingTop:4}}><Checkbox checked={current.completed} priority={current.priority||"none"} onChange={c=>{
            /* Top-level task completion — delegate to onToggle which handles the subtask confirmation modal */
            if(!isSubtask && c) {
              onToggle(task.id);
              return;
            }
            /* Uncompleting top-level or any subtask toggle */
            updateCurrent({completed:c,completedAt:c?new Date().toISOString():null});
          }}/></div>
          <textarea ref={el=>{if(el){el.style.height="auto";el.style.height=el.scrollHeight+"px";}}} value={title} onChange={e=>{setTitle(e.target.value);e.target.style.height="auto";e.target.style.height=e.target.scrollHeight+"px";}} rows={1} onBlur={e=>{if(title.trim())updateCurrent({title:title.trim()});e.target.style.borderColor="transparent";e.target.style.background="none";}} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.target.blur();}}}
            style={{flex:1,border:"1px solid transparent",borderRadius:8,background:"none",fontSize:18,fontFamily:"var(--font-display)",fontWeight:700,color:current.completed?"var(--muted)":"var(--ink)",textDecoration:current.completed?"line-through":"none",outline:"none",padding:"6px 8px",resize:"none",lineHeight:1.3,overflow:"hidden",transition:"border-color 0.15s, background 0.15s",cursor:"text"}}
            onFocus={e=>{e.target.style.borderColor=accentColor;e.target.style.background="var(--card)";}}
            onMouseEnter={e=>{if(document.activeElement!==e.target)e.target.style.borderColor="var(--border)";}}
            onMouseLeave={e=>{if(document.activeElement!==e.target)e.target.style.borderColor="transparent";}}/>
        </div>

        {/* Due Date */}
        <Field label="Due Date"><input type="date" value={current.dueDate||""} onChange={e=>updateCurrent({dueDate:e.target.value||null})} style={fieldInput}/></Field>

        {/* Repeats */}
        {!isSubtask && (
          <Field label="Repeats">
            {!current.recurrence ? (
              <button onClick={()=>updateCurrent({recurrence:{frequency:"daily",interval:1,endAfter:null,completedCount:0}})}
                style={{...fieldInput,cursor:"pointer",color:"var(--muted)",textAlign:"left",display:"flex",alignItems:"center",gap:8}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
                Add recurrence…
              </button>
            ) : (
              <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px"}}>
                {/* Frequency row: every [N] [unit] */}
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap"}}>
                  <span style={{fontSize:13,color:"var(--text)",fontWeight:500}}>Every</span>
                  <input type="number" min="1" max="365" value={current.recurrence.interval||1}
                    onChange={e=>{const v=Math.max(1,parseInt(e.target.value)||1);updateCurrent({recurrence:{...current.recurrence,interval:v}});}}
                    style={{width:52,padding:"6px 8px",borderRadius:8,border:"1px solid var(--border)",fontSize:13,textAlign:"center",color:"var(--text)",background:"var(--bg)",fontFamily:"inherit",outline:"none"}}/>
                  <select value={current.recurrence.frequency}
                    onChange={e=>updateCurrent({recurrence:{...current.recurrence,frequency:e.target.value}})}
                    style={{padding:"6px 10px",borderRadius:8,border:"1px solid var(--border)",fontSize:13,color:"var(--text)",background:"var(--bg)",fontFamily:"inherit",cursor:"pointer",outline:"none"}}>
                    <option value="daily">{(current.recurrence.interval||1)===1?"day":"days"}</option>
                    <option value="weekly">{(current.recurrence.interval||1)===1?"week":"weeks"}</option>
                    <option value="monthly">{(current.recurrence.interval||1)===1?"month":"months"}</option>
                  </select>
                </div>

                {/* End after row */}
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap"}}>
                  <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:13,color:"var(--text)"}}>
                    <input type="checkbox" checked={current.recurrence.endAfter!==null && current.recurrence.endAfter!==undefined}
                      onChange={e=>{updateCurrent({recurrence:{...current.recurrence,endAfter:e.target.checked?5:null}});}}
                      style={{width:15,height:15,accentColor:"var(--accent)",cursor:"pointer"}}/>
                    End after
                  </label>
                  {current.recurrence.endAfter!==null && current.recurrence.endAfter!==undefined && (
                    <>
                      <input type="number" min="1" max="999" value={current.recurrence.endAfter}
                        onChange={e=>{const v=Math.max(1,parseInt(e.target.value)||1);updateCurrent({recurrence:{...current.recurrence,endAfter:v}});}}
                        style={{width:52,padding:"6px 8px",borderRadius:8,border:"1px solid var(--border)",fontSize:13,textAlign:"center",color:"var(--text)",background:"var(--bg)",fontFamily:"inherit",outline:"none"}}/>
                      <span style={{fontSize:13,color:"var(--text)"}}>occurrence{current.recurrence.endAfter!==1?"s":""}</span>
                    </>
                  )}
                </div>

                {/* Progress indicator */}
                {(current.recurrence.completedCount||0) > 0 && (
                  <div style={{fontSize:12,color:"var(--muted)",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    {current.recurrence.endAfter
                      ? `${current.recurrence.completedCount} of ${current.recurrence.endAfter} completed`
                      : `${current.recurrence.completedCount} completed`}
                  </div>
                )}

                {/* Readable summary */}
                <div style={{fontSize:12,color:"#7c3aed",fontWeight:500,marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                  {Icons.repeat}
                  {(() => {
                    const r = current.recurrence;
                    const n = r.interval || 1;
                    const unit = r.frequency === "daily" ? (n===1?"day":"days") : r.frequency === "weekly" ? (n===1?"week":"weeks") : (n===1?"month":"months");
                    return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}`;
                  })()}
                  {current.recurrence.endAfter ? ` · ${current.recurrence.endAfter} times total` : " · forever"}
                </div>

                {/* Remove recurrence */}
                <button onClick={()=>updateCurrent({recurrence:null})}
                  style={{background:"none",border:"none",cursor:"pointer",color:"var(--danger)",fontSize:12,fontWeight:500,padding:0,fontFamily:"inherit"}}>
                  Remove recurrence
                </button>
              </div>
            )}
          </Field>
        )}

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
              <button key={k} onClick={()=>updateCurrent({priority:k})} style={{flex:1,padding:"8px 2px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s",border:(current.priority||"none")===k?`2px solid ${color}`:"1px solid var(--border)",background:(current.priority||"none")===k?`${color}12`:"var(--card)",color:(current.priority||"none")===k?color:"var(--muted)"}}>{label}</button>
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
              <span key={t} style={{fontSize:12,padding:"2px 8px",borderRadius:"var(--radius-pill)",background:"var(--accent-bg)",color:"var(--accent-dark)",display:"flex",alignItems:"center",gap:4,fontWeight:500}}>
                #{t}<button onClick={()=>updateCurrent({tags:(current.tags||[]).filter(x=>x!==t)})} style={{background:"none",border:"none",cursor:"pointer",color:"var(--accent)",padding:0,fontSize:14,lineHeight:1}}>×</button>
              </span>
            ))}
          </div>
          <input value={newTag} onChange={e=>setNewTag(e.target.value)} placeholder="Add tag…"
            enterKeyHint="done"
            onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();if(newTag.trim()){const tag=newTag.trim().replace(/^#/,"");if(!(current.tags||[]).includes(tag))updateCurrent({tags:[...(current.tags||[]),tag]});setNewTag("");}}}}
            style={{...fieldInput,fontSize:13}}/>
        </Field>

        {/* Subtasks — recursive, with clickable items to drill in */}
        <Field label={`Subtasks (${countSubs(current.subtasks).done}/${countSubs(current.subtasks).total})`}>
          <div ref={subTreeRef} style={(current.subtasks||[]).length>0?{background:"var(--card)",borderRadius:"var(--radius-md)",border:"1px solid var(--border)",marginBottom:8,padding:"6px 12px"}:{marginBottom:0}}>
            {(current.subtasks||[]).length>0&&(
              <SubtaskTree subtasks={current.subtasks} compact={true}
                onAction={handleSubAction}
                onReorder={handleSubReorder}
                onOpenSub={drillIn}
                listColor={taskListColor}/>
            )}
          </div>
          <div style={{display:"flex",gap:6}}>
            <input value={newSub} onChange={e=>setNewSub(e.target.value)} placeholder="Add subtask…"
              enterKeyHint="done"
              onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();if(newSub.trim()){updateCurrent({subtasks:[...(current.subtasks||[]),newSubtask(newSub.trim())]});setNewSub("");}}}}
              style={{...fieldInput,fontSize:13,flex:1}}/>
            {newSub.trim()&&<button onClick={()=>{updateCurrent({subtasks:[...(current.subtasks||[]),newSubtask(newSub.trim())]});setNewSub("");}}
              style={{padding:"0 12px",borderRadius:10,border:"1px solid var(--accent)",background:"var(--accent-bg)",color:"var(--accent)",fontSize:18,fontWeight:700,cursor:"pointer",flexShrink:0,lineHeight:1,fontFamily:"inherit"}}>+</button>}
          </div>
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
const HelpSection = ({icon, title, children, defaultOpen=false}) => {
  const [open,setOpen]=useState(defaultOpen);
  return (
    <div style={{borderBottom:"1px solid var(--border-light)",overflow:"hidden"}}>
      <button onClick={()=>setOpen(!open)} style={{width:"100%",padding:"12px 4px",border:"none",background:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:10,textAlign:"left",fontFamily:"inherit",color:"var(--ink)"}}>
        <span style={{fontSize:16,flexShrink:0,width:24,textAlign:"center"}}>{icon}</span>
        <span style={{flex:1,fontSize:14,fontWeight:600}}>{title}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{transition:"transform 0.2s",transform:open?"rotate(180deg)":"rotate(0)"}}><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div style={{maxHeight:open?2000:0,opacity:open?1:0,transition:"max-height 0.35s ease, opacity 0.2s ease",overflow:"hidden"}}>
        <div style={{padding:"0 4px 16px 38px",fontSize:13,color:"var(--text)",lineHeight:1.7}}>
          {children}
        </div>
      </div>
    </div>
  );
};

const HelpGuideModal = ({onClose, initialSection}) => {
  const codeStyle={display:"block",background:"var(--surface)",borderRadius:8,padding:"10px 14px",fontSize:12,fontFamily:"monospace",lineHeight:1.7,color:"var(--ink)",marginTop:8,marginBottom:8,whiteSpace:"pre",overflowX:"auto"};
  const kbdStyle={display:"inline-block",fontSize:11,fontWeight:600,background:"var(--surface)",padding:"2px 6px",borderRadius:4,border:"1px solid var(--border)",fontFamily:"inherit",margin:"0 2px"};
  const featureStyle={display:"flex",alignItems:"flex-start",gap:8,marginBottom:8};
  const dotStyle={width:6,height:6,borderRadius:3,background:"var(--accent)",flexShrink:0,marginTop:7};

  return (
    <Overlay onClose={onClose}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
        <div style={{width:34,height:34,borderRadius:10,background:"linear-gradient(135deg,var(--accent),var(--accent2))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:800,color:"white",fontFamily:"var(--font-display)"}}>I</div>
        <div>
          <h2 style={{margin:0,fontSize:19,fontFamily:"var(--font-display)"}}>Inkwell Guide</h2>
          <p style={{margin:0,fontSize:12,color:"var(--muted)"}}>Everything you can do with Inkwell</p>
        </div>
      </div>

      <div style={{overflowY:"auto",maxHeight:"60vh",margin:"16px -4px 0",padding:"0 4px"}}>

        <HelpSection icon="✨" title="Getting Started" defaultOpen={initialSection==="welcome"}>
          <p style={{marginBottom:10}}>Inkwell is a task manager built for people who think on paper. Snap a photo of your notebook, and Inkwell turns your handwritten lists into organised digital tasks — complete with subtasks, due dates, and categories.</p>
          <p style={{marginBottom:10}}>But it's much more than a scanner. You can also type tasks directly, organise them into lists, drag to reorder and reschedule, track progress on a kanban board, and sync everything across devices.</p>
          <div style={{padding:"10px 14px",background:"var(--accent-bg)",borderRadius:10,border:"1px solid var(--accent-a15)",fontSize:12,color:"var(--accent-dark)",lineHeight:1.6}}>
            <b>Quick start:</b> Type a task in the bar at the top and press Enter, or tap <b>Scan Notebook Page</b> in the sidebar to photograph your notes.
          </div>
        </HelpSection>

        <HelpSection icon="📸" title="Scanning & Note-Taking Best Practices" defaultOpen={initialSection==="scan"}>
          <p style={{marginBottom:10}}>Inkwell understands <b>Bullet Journal rapid logging</b> — a handful of consistent pen marks that carry meaning. Format your pages like this for the best scan accuracy:</p>
          <div style={{marginBottom:12}}>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Date at the top</b> — write <b>19/2</b>, <b>Feb 19</b>, or <b>2026-02-19</b>. This becomes the default due date for the page.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>One bullet per task</b> — short, action-first phrases ("Email Sam re: invoice", not a paragraph). Use ☐ □ [ ] – • for open tasks.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Mark completions clearly</b> — ☑ ✓ [x], an X through the bullet, or a strikethrough. Scanning a page with crossed-off items checks them off in the app too.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Push tasks out with <code>&gt;</code></b> — the BuJo migration mark. Write <b>&gt;1w</b>, <b>&gt;1m</b>, <b>&gt;3m</b>, <b>&gt;Fri</b>, or <b>&gt;Mar 3</b> next to a task and the scan reschedules it to that date. A bare <b>&gt;</b> means tomorrow. This is how you defer tasks <i>without opening the app</i>.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Star what matters</b> — a <b>*</b> or <b>!</b> next to a task imports it as high priority.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Underline category headers</b> — Inkwell fuzzy-matches them to your existing lists (e.g. "Work tasks" → Work).</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Indent for subtasks</b> — anything indented beneath a task becomes a subtask. Deeper indentation creates nested sub-subtasks.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Projects get their own page</b> — a BuJo "collection". Title at the top (underlined), steps listed beneath. Scanning it creates one task with the steps as subtasks, so the project lives in the app as a single record.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Camera basics</b> — dark pen, flat page, good light, fill the frame. Photos are automatically downscaled before upload, so don't worry about file size.</div></div>
          </div>
          <span style={codeStyle}>{`Feb 19

Work
──────
☐ Prepare quarterly review *
    - Gather metrics
    - Draft slides
        - Add charts
☐ Schedule 1:1 meetings  >1w
✓ Submit expense report

Personal
────────
☐ Book dentist appointment  >Fri
☐ Research weekend trips  >1m
    - Compare prices`}</span>
          <div style={{padding:"10px 14px",background:"var(--accent-bg)",borderRadius:10,border:"1px solid var(--accent-a15)",fontSize:12,color:"var(--accent-dark)",lineHeight:1.6,marginTop:4}}>
            <b>💡</b> After scanning, you can drag rows to reorder, use ← → to fix nesting, edit titles, and reassign lists — all before importing.
          </div>
        </HelpSection>

        <HelpSection icon="🖋" title="Paper Mode — Notebook First" defaultOpen={initialSection==="paper"}>
          <p style={{marginBottom:10}}>Paper Mode (Settings → Paper Mode) inverts the app: <b>your notebook is the workspace, Inkwell is the record</b>. It's for people who noticed they were spending more time optimising tasks in the app than doing them on paper.</p>
          <div style={{marginBottom:12}}>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Today is the whole app</b> — boards, lists, calendar, and upcoming views are hidden. The sanctioned verbs are: <b>scan</b>, <b>check off</b>, and <b>snooze</b>.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Carry-forward</b> — unfinished tasks roll onto Today automatically with a "↻ carried" badge, like rewriting a bullet in a journal (without the rewriting). If something keeps carrying, do it, snooze it, or let it go.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Snooze (💤)</b> — the one thing paper can't do: make a task vanish and reappear months later. Tap <b>zZ</b> on any task for one-tap horizons (tomorrow / week / month / 3 months). It returns to Today with an "↩ resurfaced" badge — copy it onto that day's notebook page and carry on.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Defer from the page</b> — better still, write <b>&gt;1w</b> next to the task in your notebook and let the next scan do the snoozing. You never opened a view.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Weekly review</b> — one deliberate, time-boxed session (sidebar → "Weekly review"). The full app unlocks: triage Upcoming, prune stale projects, tidy lists. Tap "End weekly review" and the app pins back to Today.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>No confetti</b> — completion streaks and celebrations are off in Paper Mode. The reward for finishing a task is crossing it off the page.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Inkwell Drop (app blockers)</b> — a scan-only mini app at <b>/capture</b> that installs as its own Android app. If you block Chrome/Inkwell with Brick or Screen Time, exempt "Drop": capture keeps working while the full app stays locked. It also appears in the system Share sheet, so you can send a camera-roll photo straight to it. Scans import automatically — no review screen.</div></div>
          </div>
          <div style={{padding:"10px 14px",background:"var(--accent-bg)",borderRadius:10,border:"1px solid var(--accent-a15)",fontSize:12,color:"var(--accent-dark)",lineHeight:1.6}}>
            <b>The daily loop:</b> ① Each morning, open the app once — Today shows what's due and what resurfaced. ② Copy those onto today's notebook page. ③ Work from paper all day. ④ In the evening (or next morning), scan the page: completions get checked off, new tasks recorded, <code>&gt;</code> marks deferred. Total app time: under a minute.
          </div>
        </HelpSection>

        <HelpSection icon="📋" title="Tasks & Infinite Subtasks" defaultOpen={initialSection==="subtasks"}>
          <p style={{marginBottom:10}}>Every task can have subtasks, and every subtask can have its own subtasks — there's no depth limit. Open any task's detail panel to see and manage its full subtask tree.</p>
          <div style={{marginBottom:12}}>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Add subtasks</b> — open a task's detail panel (click it), then use the subtask input at the bottom of the subtask list.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Nest deeper</b> — drag a subtask onto another subtask to create sub-sub-subtasks, or use the indent button in the detail panel.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Independent due dates</b> — give any subtask its own due date and it will appear independently in Today and Upcoming views while staying nested under its parent.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Recurring tasks</b> — open a task's detail panel and toggle "Repeats" to set a recurrence (every N days/weeks/months). When you complete a recurring task, it automatically resets and advances to the next due date. Optionally set an end after N occurrences.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Notes, priority & tags</b> — every task and subtask supports rich metadata accessible from the detail panel.</div></div>
          </div>
        </HelpSection>

        <HelpSection icon="🖐️" title="Drag & Drop" defaultOpen={initialSection==="dragdrop"}>
          <p style={{marginBottom:10}}>Drag tasks to reorder, reorganise, and reschedule — on both desktop and mobile (long-press to start a drag on mobile).</p>
          <div style={{marginBottom:12}}>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Reorder</b> — drag a task above or below another task. Drop on the top or bottom edge to insert before/after.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Nest as subtask</b> — drop a task onto the middle of another task to make it a subtask.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Move to list</b> — drag a task onto any list in the sidebar to move it.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Reschedule</b> — drag onto Today or any quick date zone in the sidebar to change the due date.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Promote subtasks</b> — drag a subtask out of its parent to promote it to a standalone task. Drop it on a list or date zone.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Delete</b> — drag to the trash zone that appears at the bottom centre of the screen during any drag.</div></div>
          </div>
          <div style={{padding:"10px 14px",background:"var(--accent-bg)",borderRadius:10,border:"1px solid var(--accent-a15)",fontSize:12,color:"var(--accent-dark)",lineHeight:1.6}}>
            <b>💡</b> Circular nesting is handled automatically — if you drag a parent onto its own subtask, Inkwell promotes the subtask instead of creating a loop.
          </div>
        </HelpSection>

        <HelpSection icon="📅" title="Quick Date Drop Zones" defaultOpen={initialSection==="quickdates"}>
          <p style={{marginBottom:10}}>When you start dragging a task, extra date targets fan out below "Today" in the sidebar — like "Tomorrow" and "Next Monday". Drop a task on any zone to instantly reschedule it.</p>
          <div style={{marginBottom:12}}>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Customise zones</b> — go to Settings → Quick Date Drop Zones to add, edit, remove, or reorder your quick date targets.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Offset options</b> — choose from relative dates (+2 days, +1 week, +2 weeks) or named days (Next Monday, Next Friday, etc.).</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Works with subtasks</b> — dragging a subtask to a date zone gives it an independent due date so it surfaces in Today/Upcoming views.</div></div>
          </div>
        </HelpSection>

        <HelpSection icon="🗂️" title="Kanban Board" defaultOpen={initialSection==="kanban"}>
          <p style={{marginBottom:10}}>Switch the Today view to Board mode for a visual kanban layout. Tasks are grouped into columns by list, and you can drag cards between columns.</p>
          <div style={{marginBottom:12}}>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Toggle view</b> — use the Board / List switch on Today, Inbox, or any list to see tasks as a kanban board or a flat list.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Drag between columns</b> — move cards across columns to reassign them to different lists.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Reorder within columns</b> — drag cards up and down to set your own priority order.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Expand subtasks</b> — click the subtask count badge on any card to expand and manage subtasks inline, with cross-column drag support.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Customise columns</b> — choose which lists appear as columns via the column settings in the board header.</div></div>
          </div>
        </HelpSection>

        <HelpSection icon="🔍" title="Sort, Filter & Search" defaultOpen={false}>
          <div style={{marginBottom:12}}>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Sort</b> — click the sort/filter icon in the header to sort by priority, alphabetical, due date, or creation date.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Filter by priority</b> — show only High, Medium, or Low priority tasks.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Search</b> — press <kbd style={kbdStyle}>/</kbd> or <kbd style={kbdStyle}>⌘F</kbd> to search across task titles, notes, and tags.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Smart views</b> — Today, Upcoming, Overdue, and Completed views automatically filter tasks. The Overdue view includes bulk "Move to Today" actions per date group.</div></div>
          </div>
        </HelpSection>

        <HelpSection icon="✅" title="Multi-Select & Bulk Actions" defaultOpen={false}>
          <div style={{marginBottom:12}}>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Select multiple</b> — hold <kbd style={kbdStyle}>⌘</kbd> / <kbd style={kbdStyle}>Ctrl</kbd> and click to toggle individual tasks, or <kbd style={kbdStyle}>Shift</kbd>+click to select a range.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Select all</b> — press <kbd style={kbdStyle}>⌘A</kbd> to select every task in the current view.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Bulk action bar</b> — when multiple tasks are selected, a floating bar appears at the bottom with options to move, set priority, complete, reschedule, or delete all selected tasks at once.</div></div>
          </div>
        </HelpSection>

        <HelpSection icon="📆" title="Calendar View" defaultOpen={false}>
          <p style={{marginBottom:10}}>The Calendar view shows a month grid with task dots on each day. Click any day to see its tasks and quickly reschedule by clicking a different date.</p>
        </HelpSection>

        <HelpSection icon="⌨️" title="Keyboard Shortcuts" defaultOpen={false}>
          <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"6px 14px",fontSize:13}}>
            {[["N","New task"],["B","Toggle sidebar"],["/ or ⌘F","Search"],["⌘Z","Undo"],["⌘⇧Z / ⌘Y","Redo"],["⌘A","Select all"],["Shift+Click","Select range"],["⌘+Click","Toggle select"],["Delete","Delete selected"],["Esc","Close / clear"],["?","Shortcut reference"]].map(([k,d],ki)=>(<div key={ki} style={{display:"contents"}}><kbd style={{...kbdStyle,textAlign:"center",minWidth:36}}>{k}</kbd><span style={{color:"var(--text)",paddingTop:2}}>{d}</span></div>))}
          </div>
        </HelpSection>

        <HelpSection icon="⚙️" title="Settings & Cloud Sync" defaultOpen={false}>
          <div style={{marginBottom:12}}>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Dark mode</b> — toggle under Settings → Appearance. Syncs across all your devices.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Cloud sync</b> — sign in with your email and all tasks, lists, and settings sync automatically via Supabase. Changes are saved in real time and loaded when you switch tabs back.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Undo / Redo</b> — press <kbd style={kbdStyle}>⌘Z</kbd> to undo and <kbd style={kbdStyle}>⌘⇧Z</kbd> to redo. Works up to 50 steps back.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Double-click to rename</b> — double-click any list name in the sidebar or the view title to rename it inline.</div></div>
          </div>
        </HelpSection>

        <HelpSection icon="📶" title="Offline Editing" defaultOpen={false}>
          <p style={{marginBottom:10}}>Inkwell works fully offline. Add, edit, complete, delete, and reorganise tasks without an internet connection — everything is saved to your device instantly.</p>
          <div style={{marginBottom:12}}>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Automatic local save</b> — every change is saved to your device the instant you make it. Even if you close the browser or your phone dies, nothing is lost.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Offline indicator</b> — when you're offline, a yellow banner appears at the top and the sync dot in the sidebar turns red. Your edits are queued for sync.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Smart merge on reconnect</b> — when you come back online, Inkwell merges your local changes with any changes made on other devices. Each task is compared individually by timestamp, so only conflicting edits on the same task need resolution (newer edit wins).</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Multi-device offline edits</b> — if you edit on your phone offline and your laptop offline, both sets of changes merge cleanly when each device reconnects. Tasks added on either device appear on both; tasks deleted on either device are properly removed via tombstone tracking.</div></div>
            <div style={featureStyle}><div style={dotStyle}/><div><b>Scanning requires internet</b> — the notebook scanner uses a cloud AI model, so it needs a connection. You'll see a clear message if you try to scan while offline.</div></div>
          </div>
          <div style={{padding:"10px 14px",background:"var(--accent-bg)",borderRadius:10,border:"1px solid var(--accent-a15)",fontSize:12,color:"var(--accent-dark)",lineHeight:1.6}}>
            <b>💡</b> Inkwell checks for unsynced changes every 30 seconds while online, so even if the initial reconnect attempt fails on flaky wifi, your data will sync shortly after.
          </div>
        </HelpSection>

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

const KanbanBoard = ({tasks, columns, onColumnsChange, onResetColumns, onSelect, onUpdate, onToggle, onUpdateSubtask, onSubUpdate, flash, setIsDragging, animatingTasks, onReorder, sortBy="default", filterPriority="all", lists=[], scopeListName=null, todayListFilter=null}) => {
  const [hoverCol, setHoverCol] = useState(null);
  const [editingCol, setEditingCol] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDate, setEditDate] = useState("");
  const [cardDrop, setCardDrop] = useState(null); /* {id, zone:"before"|"after"} */

  /* Scope filter: when viewing a specific list's board, only show that list's tasks.
     When viewing Today with a multi-select filter, only show those lists' tasks. */
  const scopedTasks = useMemo(() => {
    let t = tasks;
    if (scopeListName) t = t.filter(x => x.list === scopeListName);
    else if (todayListFilter && todayListFilter.size > 0) t = t.filter(x => todayListFilter.has(x.list));
    return t;
  }, [tasks, scopeListName, todayListFilter]);

  const KANBAN_PO={high:0,medium:1,low:2,none:3};
  const kanbanSortAndFilter=(arr)=>{
    let filtered=filterPriority==="all"?arr:arr.filter(t=>(t.priority||"none")===filterPriority);
    if(sortBy==="default") return filtered;
    return [...filtered].sort((a,b)=>{
      if(sortBy==="priority") return (KANBAN_PO[a.priority||"none"]??3)-(KANBAN_PO[b.priority||"none"]??3);
      if(sortBy==="alpha") return (a.title||"").localeCompare(b.title||"");
      if(sortBy==="created") return (b.createdAt||"").localeCompare(a.createdAt||"");
      return 0;
    });
  };

  const overdueTasks = kanbanSortAndFilter(scopedTasks.filter(t => !t.completed && t.dueDate && t.dueDate < todayStr()));

  /* Collect subtasks with own due dates — also scope-filtered via parent task */
  const datedSubs = useMemo(() => {
    const all = collectDatedSubtasks(tasks);
    if (scopeListName) return all.filter(ds => ds.parentTask.list === scopeListName);
    if (todayListFilter && todayListFilter.size > 0) return all.filter(ds => todayListFilter.has(ds.parentTask.list));
    return all;
  }, [tasks, scopeListName, todayListFilter]);

  /* Compute column data — NOT memoized, recomputes every render to guarantee sort freshness */
  const byDate = {};
  columns.forEach(c => {
    const directTasks = kanbanSortAndFilter(scopedTasks.filter(t => !t.completed && t.dueDate === c.dateStr));
    const surfaced = datedSubs.filter(ds => ds.sub.dueDate === c.dateStr);
    byDate[c.dateStr] = { tasks: directTasks, subtasks: surfaced };
  });

  /* "No Date" bucket — only shown in list scope, for that list's undated tasks */
  const noDateTasks = scopeListName
    ? kanbanSortAndFilter(scopedTasks.filter(t => !t.completed && !t.dueDate))
    : [];

  const onColDragOver = (e, ds) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHoverCol(ds); };
  const onColDrop = (e, ds) => {
    e.preventDefault(); setHoverCol(null); setCardDrop(null);
    const tid = e.dataTransfer.getData("text/plain");
    if (!tid) return;
    const src = e.dataTransfer.getData("application/x-source");
    if (isSubSource(src)) {
      /* Find parent task to check if subtask is returning home */
      let parentTask = null;
      for (const t of tasks) { if (findSubById(t.subtasks, tid)) { parentTask = t; break; } }
      if (parentTask && parentTask.dueDate === ds) {
        /* Dropping back on parent's column → clear dueDate so it re-nests */
        if (onSubUpdate) onSubUpdate(tid, {dueDate: null});
        if (flash) flash("Subtask rejoined parent");
      } else {
        if (onSubUpdate) onSubUpdate(tid, {dueDate: ds});
        if (flash) flash("Subtask scheduled");
      }
      return;
    }
    const t = tasks.find(x => x.id === tid);
    if (t) onUpdate({ ...t, dueDate: ds });
  };

  const onCardDragOver = (e, targetTask) => {
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const zone = y < 0.5 ? "before" : "after";
    setCardDrop({id: targetTask.id, zone});
    setHoverCol(null);
  };
  const onCardDrop = (e, targetTask) => {
    e.preventDefault(); e.stopPropagation();
    const tid = e.dataTransfer.getData("text/plain");
    if (!tid || tid === targetTask.id) { setCardDrop(null); return; }
    const src = e.dataTransfer.getData("application/x-source");
    const zone = cardDrop?.zone || "after";
    if (isSubSource(src)) {
      /* Find the subtask and its parent task */
      let sub = null, parentTask = null;
      for (const t of tasks) { sub = findSubById(t.subtasks, tid); if (sub) { parentTask = t; break; } }
      if (!sub) { setCardDrop(null); return; }
      /* If target card is in the same column as parent → rejoin (clear dueDate) */
      if (parentTask && targetTask.dueDate === parentTask.dueDate) {
        if (onSubUpdate) onSubUpdate(tid, {dueDate: null});
        if (flash) flash("Subtask rejoined parent");
      } else {
        /* Cross-column card drop → promote to task at that position */
        const promoted = {id:sub.id,title:sub.title,completed:sub.completed||false,dueDate:targetTask.dueDate||todayStr(),startDate:sub.startDate||null,endDate:sub.endDate||null,priority:sub.priority||"none",list:targetTask.list||"Inbox",subtasks:sub.subtasks||[],notes:sub.notes||"",tags:sub.tags||[],createdAt:new Date().toISOString(),completedAt:sub.completed?new Date().toISOString():null};
        if (onReorder) {
          onReorder(prev => {
            const cleaned = prev.map(t => ({...t, subtasks: removeSubById(t.subtasks||[], tid)}));
            const idx = cleaned.findIndex(t => t.id === targetTask.id);
            const ins = zone === "after" ? idx + 1 : idx;
            cleaned.splice(ins, 0, promoted);
            return cleaned;
          });
        }
        if (flash) flash(`Promoted "${sub.title}" to task`);
      }
    } else {
      /* task → task: reorder + change date if needed */
      if (onReorder) {
        onReorder(prev => {
          const dragTask = prev.find(t => t.id === tid);
          if (!dragTask) return prev;
          const updated = {...dragTask, dueDate: targetTask.dueDate};
          const without = prev.filter(t => t.id !== tid);
          const idx = without.findIndex(t => t.id === targetTask.id);
          const ins = zone === "after" ? idx + 1 : idx;
          without.splice(ins, 0, updated);
          return without;
        });
      }
    }
    setCardDrop(null);
  };
  const onCardDragLeave = (e) => {
    const related = e.relatedTarget;
    if (related && e.currentTarget.contains(related)) return;
    setCardDrop(null);
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
        <div style={{minWidth:220,maxWidth:280,flex:"1 0 220px",display:"flex",flexDirection:"column",background:"var(--danger-bg)",borderRadius:"var(--radius-lg)",border:"1px solid var(--danger-border)",overflow:"hidden"}}>
          <div style={{padding:"14px 14px 10px",borderBottom:"1px solid var(--danger-border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"var(--danger)"}}>Overdue</div>
              <div style={{fontSize:12,color:"#f87171",marginTop:2}}>{overdueTasks.length} task{overdueTasks.length !== 1 ? "s" : ""}</div>
            </div>
            <button onClick={()=>{overdueTasks.forEach(t=>onUpdate({...t,dueDate:todayStr()}));if(flash)flash(`Moved ${overdueTasks.length} task${overdueTasks.length!==1?"s":""} to today`);}}
              style={{fontSize:11,fontWeight:700,color:"var(--danger)",background:"var(--card)",border:"1px solid var(--danger-border)",borderRadius:8,padding:"5px 10px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",transition:"background 0.15s"}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--danger-bg)"}
              onMouseLeave={e=>e.currentTarget.style.background="var(--card)"}
              title="Move all overdue tasks to today">→ Today</button>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:8}}>
            {overdueTasks.map(t => (
              <KanbanCard key={t.id} task={t} onSelect={onSelect} onToggle={onToggle} onDragBegin={setIsDragging} animateState={animatingTasks?.[t.id]}
                cardDrop={cardDrop} onCardDragOver={onCardDragOver} onCardDrop={onCardDrop} onCardDragLeave={onCardDragLeave}
                onUpdateSubtask={onUpdateSubtask} onSubUpdate={onSubUpdate} setIsDragging={setIsDragging} lists={lists}/>
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
              background:isHover?"var(--accent-a08)":isToday?"var(--accent-a04)":"var(--surface)",
              borderRadius:"var(--radius-lg)",border:isHover?"2px solid var(--accent)":`1px solid ${isToday?"var(--accent-a30)":"var(--border)"}`,
              overflow:"hidden",transition:"border 0.15s, background 0.15s"}}>
            <div style={{padding:"10px 14px 8px",borderBottom:`1px solid ${isToday?"var(--accent-a20)":"var(--border)"}`}}>
              {isEditing ? (
                <div style={{display:"flex",flexDirection:"column",gap:6}} onClick={e=>e.stopPropagation()}>
                  <input autoFocus value={editName} onChange={e=>setEditName(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter")saveEdit();if(e.key==="Escape")setEditingCol(null);}}
                    style={{fontSize:14,fontWeight:700,border:"1px solid var(--accent)",borderRadius:6,padding:"3px 8px",outline:"none",fontFamily:"inherit",background:"var(--card)",color:"var(--ink)",width:"100%",boxSizing:"border-box"}}/>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <input type="date" value={editDate} onChange={e=>setEditDate(e.target.value)}
                      style={{fontSize:12,border:"1px solid var(--border)",borderRadius:6,padding:"3px 6px",fontFamily:"inherit",flex:1}}/>
                    <button onClick={saveEdit} style={{fontSize:11,fontWeight:700,color:"white",background:"var(--accent)",border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>Save</button>
                    {columns.length > 1 && <button onClick={()=>{removeCol(col.id);setEditingCol(null);}} title="Remove column" style={{fontSize:13,fontWeight:700,color:"var(--danger)",background:"var(--danger-bg)",border:"none",borderRadius:6,padding:"3px 7px",cursor:"pointer",fontFamily:"inherit",lineHeight:1}}>✕</button>}
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
                <KanbanCard key={t.id} task={t} onSelect={onSelect} onToggle={onToggle} onDragBegin={setIsDragging} animateState={animatingTasks?.[t.id]}
                  cardDrop={cardDrop} onCardDragOver={onCardDragOver} onCardDrop={onCardDrop} onCardDragLeave={onCardDragLeave}
                  onUpdateSubtask={onUpdateSubtask} onSubUpdate={onSubUpdate} setIsDragging={setIsDragging} lists={lists}/>
              ))}
              {colSubs.length > 0 && colTasks.length > 0 && <div style={{borderTop:"1px dashed var(--border)",margin:"6px 0"}} />}
              {colSubs.map(ds => (
                <SubtaskKanbanCard key={ds.sub.id} subInfo={ds} onSelect={onSelect} onToggleSub={onUpdateSubtask} onDragBegin={setIsDragging} lists={lists}/>
              ))}
            </div>
          </div>
        );
      })}
      {/* No Date column — only in list scope, captures undated tasks for that list */}
      {scopeListName && (
        <div
          data-drop-type="date" data-drop-value=""
          onDragOver={e => onColDragOver(e, "__nodate__")}
          onDragLeave={() => setHoverCol(null)}
          onDrop={e => onColDrop(e, null)}
          style={{minWidth:220,maxWidth:280,flex:"1 0 220px",display:"flex",flexDirection:"column",
            background:hoverCol==="__nodate__"?"var(--accent-a08)":"var(--surface)",
            borderRadius:"var(--radius-lg)",border:hoverCol==="__nodate__"?"2px solid var(--accent)":"1px dashed var(--border)",
            overflow:"hidden",transition:"border 0.15s, background 0.15s"}}>
          <div style={{padding:"10px 14px 8px",borderBottom:"1px solid var(--border)"}}>
            <div style={{fontSize:14,fontWeight:700,color:"var(--muted)"}}>No Date</div>
            <div style={{fontSize:12,color:"var(--muted)",marginTop:2}}>Unscheduled · {noDateTasks.length} task{noDateTasks.length!==1?"s":""}</div>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:8,minHeight:100}}>
            {noDateTasks.length===0 && (
              <div style={{textAlign:"center",padding:"24px 8px",color:"var(--muted)",fontSize:12,fontStyle:"italic"}}>Drop tasks here to unschedule</div>
            )}
            {noDateTasks.map(t => (
              <KanbanCard key={t.id} task={t} onSelect={onSelect} onToggle={onToggle} onDragBegin={setIsDragging} animateState={animatingTasks?.[t.id]}
                cardDrop={cardDrop} onCardDragOver={onCardDragOver} onCardDrop={onCardDrop} onCardDragLeave={onCardDragLeave}
                onUpdateSubtask={onUpdateSubtask} onSubUpdate={onSubUpdate} setIsDragging={setIsDragging} lists={lists}/>
            ))}
          </div>
        </div>
      )}
      {/* Add column */}
      <div style={{minWidth:100,flex:"0 0 100px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
        <div onClick={addCol} style={{width:"100%",flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",borderRadius:"var(--radius-lg)",border:"2px dashed var(--border)",cursor:"pointer",transition:"border-color 0.15s,background 0.15s",background:"transparent",gap:4}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--accent)";e.currentTarget.style.background="var(--accent-a04)";}}
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

const KanbanCard = ({task, onSelect, onToggle, onDragBegin, animateState, cardDrop, onCardDragOver, onCardDrop, onCardDragLeave, onUpdateSubtask, onSubUpdate, setIsDragging: setDragging, lists}) => {
  const pc = PRIORITY[task.priority || "none"].color;
  const listColor = listAccentColor(task.list, lists);
  const borderColor = listColor || pc; /* Prefer list color; fall back to priority for Inbox */
  const dz = cardDrop?.id === task.id ? cardDrop : null;
  const subs = task.subtasks || [];
  const hasSubs = subs.length > 0;
  const {total, done} = hasSubs ? countSubs(subs) : {total: 0, done: 0};
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      onDragOver={onCardDragOver ? e => onCardDragOver(e, task) : undefined}
      onDrop={onCardDrop ? e => onCardDrop(e, task) : undefined}
      onDragLeave={onCardDragLeave}
      style={{position:"relative",marginBottom:6}}>
      {dz?.zone === "before" && <div style={{position:"absolute",top:-3,left:4,right:4,height:2,background:"var(--accent)",borderRadius:1,zIndex:5}}/>}
      <div className="lift" style={{background:"var(--card)",borderRadius:"var(--radius-lg)",border:"1px solid var(--border)",borderLeft:`3px solid ${borderColor}`,
        animation:animateState==="complete"?"cardComplete 0.6s ease forwards":animateState==="uncomplete"?"cardUncomplete 0.5s ease forwards":"none",
        transition:"box-shadow 0.15s,transform 0.15s,border-color 0.2s",overflow:"hidden"}}>
        {/* ── Main card row (draggable) ── */}
        <div draggable
          data-drag-id={task.id} data-drag-source="task" data-drag-label={task.title}
          onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", task.id); e.dataTransfer.setData("application/x-source", "task"); if(onDragBegin)onDragBegin(true); }}
          onDragEnd={()=>{ if(onDragBegin) onDragBegin(false); }}
          onClick={() => onSelect(task)}
          style={{padding:"10px 12px",cursor:"grab",touchAction:"none"}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
            <div style={{paddingTop:1,animation:animateState?"checkPop 0.35s cubic-bezier(0.34,1.56,0.64,1)":"none"}}>
              <Checkbox checked={task.completed} priority={task.priority} size={16} onChange={()=>onToggle(task.id)} animating={!!animateState}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:500,color:"var(--ink)",lineHeight:1.4,wordWrap:"break-word"}}>{task.title}</div>
              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginTop:4}}>
                {task.priority !== "none" && <span style={{fontSize:10,fontWeight:700,color:pc}}>{PRIORITY[task.priority].label}</span>}
                {(task.tags||[]).map(t => <span key={t} style={{fontSize:10,color:"var(--accent)"}}>#{t}</span>)}
                {task.notes && <span style={{color:"var(--border)",display:"flex",transform:"scale(0.8)"}}>{Icons.note}</span>}
                {task.recurrence&&<span style={{fontSize:10,display:"flex",alignItems:"center",gap:2,color:"#7c3aed",fontWeight:600}} title={task.recurrence.endAfter?`${task.recurrence.completedCount||0}/${task.recurrence.endAfter} done`:"Repeating"}>{Icons.repeat}{task.recurrence.endAfter?`${task.recurrence.completedCount||0}/${task.recurrence.endAfter}`:""}</span>}
                {hasSubs && (
                  <button onClick={e=>{e.stopPropagation();setExpanded(!expanded);}}
                    style={{fontSize:10,color:done===total?"#16a34a":"var(--muted)",background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"inherit",display:"flex",alignItems:"center",gap:2}}>
                    {Icons.subtask} {done}/{total}
                    <span style={{transform:expanded?"rotate(0)":"rotate(-90deg)",transition:"transform 0.15s",display:"inline-flex",marginLeft:1}}>{Icons.chevD}</span>
                  </button>
                )}
                <span style={{fontSize:10,fontWeight:500,color:listColor||"var(--muted)",background:listColor?hexTint(listColor,0.12):"var(--surface)",padding:"1px 5px",borderRadius:3}}>{task.list}</span>
              </div>
            </div>
          </div>
        </div>
        {/* ── Expanded subtask list ── */}
        {hasSubs && expanded && (
          <div style={{borderTop:"1px solid var(--border-light)",padding:"4px 8px 6px",background:listColor?hexTint(listColor,0.04):"var(--surface)"}}>
            <KanbanSubtaskList subs={subs} taskId={task.id} depth={0}
              parentDueDate={task.dueDate}
              onToggleSub={onUpdateSubtask} onSubUpdate={onSubUpdate}
              onDragBegin={setDragging} onSelect={() => onSelect(task)}
              listColor={listColor}/>
          </div>
        )}
      </div>
      {dz?.zone === "after" && <div style={{position:"absolute",bottom:-3,left:4,right:4,height:2,background:"var(--accent)",borderRadius:1,zIndex:5}}/>}
    </div>
  );
};

/* Recursive subtask list inside kanban cards — collapsible, draggable at any depth.
   Subtasks that have been moved to other dates (surfaced as standalone cards) are hidden here. */
const KanbanSubtaskList = ({subs, taskId, depth, parentDueDate, onToggleSub, onSubUpdate, onDragBegin, onSelect, listColor=null}) => {
  const [openIds, setOpenIds] = useState({});
  const toggle = id => setOpenIds(p => ({...p, [id]: !p[id]}));
  if (!subs?.length) return null;

  /* Any subtask with a dueDate is surfaced as a standalone card — only undated ones stay nested */
  const visible = subs.filter(s => !s.dueDate);
  const movedCount = subs.length - visible.length;

  return (
    <div style={{
      marginLeft: depth > 0 ? 10 : 0,
      borderLeft: listColor ? `2px solid ${listColor}` : (depth > 0 ? `2px solid var(--depth${Math.min(depth,3)})` : "none"),
      background: listColor ? hexTint(listColor, 0.04 + depth*0.012) : "transparent",
      paddingLeft: listColor || depth > 0 ? 6 : 0,
      borderRadius: (listColor || depth > 0) ? "0 6px 6px 0" : 0,
    }}>
      {visible.map(sub => {
        const hasCh = (sub.subtasks || []).length > 0;
        const isOpen = openIds[sub.id] !== false;
        const chCount = hasCh ? countSubs(sub.subtasks) : null;
        return (
          <div key={sub.id}>
            <div
              draggable
              data-drag-id={sub.id} data-drag-source="kanban-subtask" data-drag-label={sub.title}
              onDragStart={e => {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", sub.id);
                e.dataTransfer.setData("application/x-source", "kanban-subtask");
                if(onDragBegin) onDragBegin(true);
              }}
              onDragEnd={() => { if(onDragBegin) onDragBegin(false); }}
              style={{display:"flex",alignItems:"center",gap:5,padding:"3px 4px",borderRadius:6,cursor:"grab",
                transition:"background 0.1s",fontSize:12}}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(0,0,0,0.03)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              {depth > 0 && <span style={{fontSize:9,color:listColor||"var(--depth0)",flexShrink:0,fontWeight:700}}>↳</span>}
              <div onClick={e=>{e.stopPropagation();onToggleSub(taskId, sub.id);}} style={{flexShrink:0,cursor:"pointer"}}>
                <Checkbox checked={sub.completed} priority={sub.priority} size={13}/>
              </div>
              <span onClick={e=>{e.stopPropagation();onSelect();}}
                style={{flex:1,minWidth:0,color:sub.completed?"var(--muted)":"var(--ink)",textDecoration:sub.completed?"line-through":"none",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:"pointer",lineHeight:1.3}}>
                {sub.title}
              </span>
              {sub.dueDate && <span style={{fontSize:9,color:sub.dueDate<todayStr()?"var(--danger)":"var(--muted)",flexShrink:0,whiteSpace:"nowrap"}}>{formatDate(sub.dueDate)}</span>}
              {hasCh && (
                <button onClick={e=>{e.stopPropagation();toggle(sub.id);}}
                  style={{background:"none",border:"none",cursor:"pointer",padding:0,color:"var(--muted)",display:"flex",alignItems:"center",gap:1,fontSize:10,fontFamily:"inherit",flexShrink:0}}>
                  {chCount.done}/{chCount.total}
                  <span style={{transform:isOpen?"rotate(0)":"rotate(-90deg)",transition:"transform 0.15s",display:"flex"}}>{Icons.chevD}</span>
                </button>
              )}
            </div>
            {hasCh && isOpen && (
              <KanbanSubtaskList subs={sub.subtasks} taskId={taskId} depth={depth+1}
                parentDueDate={parentDueDate}
                onToggleSub={onToggleSub} onSubUpdate={onSubUpdate}
                onDragBegin={onDragBegin} onSelect={onSelect}
                listColor={listColor}/>
            )}
          </div>
        );
      })}
      {movedCount > 0 && (
        <div style={{fontSize:10,color:"var(--muted)",fontStyle:"italic",padding:"2px 4px",marginTop:2}}>
          {movedCount} scheduled on board →
        </div>
      )}
    </div>
  );
};

/* Surfaced subtask card — shows a subtask on the kanban with parent breadcrumb, draggable */
const SubtaskKanbanCard = ({subInfo, onSelect, onToggleSub, onDragBegin, lists}) => {
  const {sub, parentTask, breadcrumb} = subInfo;
  const parentLabel = breadcrumb.length > 1 ? breadcrumb.slice(0, -1).join(" › ") : parentTask.title;
  const pc = PRIORITY[sub.priority || "none"].color;
  const listColor = listAccentColor(parentTask.list, lists);
  const borderColor = listColor || pc;
  const hasCh = (sub.subtasks || []).length > 0;
  const chCount = hasCh ? countSubs(sub.subtasks) : null;
  return (
    <div draggable
      data-drag-id={sub.id} data-drag-source="kanban-subtask" data-drag-label={sub.title}
      onDragStart={e => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", sub.id);
        e.dataTransfer.setData("application/x-source", "kanban-subtask");
        if(onDragBegin) onDragBegin(true);
      }}
      onDragEnd={() => { if(onDragBegin) onDragBegin(false); }}
      onClick={() => onSelect(parentTask)}
      style={{padding:"10px 12px",background:"var(--card)",borderRadius:"var(--radius-md)",marginBottom:6,cursor:"grab",touchAction:"none",
        boxShadow:"0 1px 3px var(--shadow)",
        border:"1px dashed var(--accent)",borderLeft:`3px solid ${borderColor}`,transition:"box-shadow 0.15s,border-color 0.2s"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
        <div style={{paddingTop:1}}>
          <Checkbox checked={sub.completed} priority={sub.priority} size={16}
            onChange={()=>onToggleSub(parentTask.id, sub.id)}/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:500,color:"var(--ink)",lineHeight:1.4,wordWrap:"break-word"}}>{sub.title}</div>
          <div style={{display:"flex",alignItems:"center",gap:4,marginTop:3,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:"var(--accent)",fontWeight:600,display:"flex",alignItems:"center",gap:2}}>
              ↳ {parentLabel}
            </span>
            {hasCh && <span style={{fontSize:10,color:"var(--muted)"}}>{Icons.subtask} {chCount.done}/{chCount.total}</span>}
            <span style={{fontSize:10,fontWeight:500,color:listColor||"var(--muted)",background:listColor?hexTint(listColor,0.12):"var(--surface)",padding:"1px 5px",borderRadius:3}}>{parentTask.list}</span>
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
                          style={{minHeight:56 + barsH,padding:4,overflow:"hidden",minWidth:0,background:isH?"var(--accent-a12)":isT?"var(--accent-a06)":"transparent",borderBottom:"1px solid var(--border-light)",borderRight:col < 6 ? "1px solid var(--border-light)":"none",transition:"background 0.1s"}}>
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
const TaskRow = ({task,isActive,isSelected,onSelect,onToggle,onUpdateTask,onSnooze,paperUI,onDragStart,onDragOver,onDrop,onDragEnd,dropTarget,view,lists,animateState}) => {
  const [subsOpen,setSubsOpen]=useState(false);
  const clickTimer=useRef(null);
  const overdue=!task.completed&&isOverdue(task.dueDate);
  const {total:subTotal,done:subDone}=countSubs(task.subtasks);
  const hasDuration=task.startDate&&task.endDate;
  const isDT=dropTarget?.id===task.id;
  const dtZone=isDT?dropTarget.zone:null;
  const listColor = listAccentColor(task.list, lists);

  const handleSubAction = (action, targetId, data) => {
    let newSubs;
    if(action==="remove") newSubs = deleteSubById(task.subtasks||[], targetId);
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
      className="task-row"
      style={{marginBottom:2,borderRadius:"var(--radius-lg)",position:"relative",touchAction:"none",viewTransitionName:`t${task.id}`,
        background:isSelected?"var(--accent-a10)":dtZone==="nest"?"var(--accent-a08)":isActive?"var(--active-bg)":"transparent",
        outline:isSelected?"2px solid var(--accent)":dtZone==="nest"?"2px dashed var(--accent)":"none",
        borderLeft:listColor?`3px solid ${listColor}`:"3px solid transparent",
        animation:animateState==="complete"?"taskComplete 0.7s ease forwards":animateState==="uncomplete"?"taskUncomplete 0.6s ease forwards":"none",
        transition:"background 0.15s,opacity 0.3s,outline 0.1s,border-color 0.2s",opacity:task.completed&&!animateState?0.45:animateState?undefined:1}}>
      {/* Drop indicator lines */}
      {dtZone==="before"&&<div style={{position:"absolute",top:-1,left:12,right:12,height:2,background:"var(--accent)",borderRadius:1,zIndex:5}}/>}
      {dtZone==="after"&&<div style={{position:"absolute",bottom:-1,left:12,right:12,height:2,background:"var(--accent)",borderRadius:1,zIndex:5}}/>}
      {dtZone==="nest"&&<div style={{position:"absolute",left:42,top:"50%",transform:"translateY(-50%)",fontSize:10,color:"var(--accent)",fontWeight:700,zIndex:5,pointerEvents:"none"}}>↳ nest</div>}

      <div onClick={handleRowClick} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"11px 12px",cursor:"pointer"}}>
        <div style={{paddingTop:3,cursor:"grab",color:"var(--border)"}} onMouseDown={e=>e.stopPropagation()}>{Icons.grip}</div>
        <div style={{paddingTop:2,animation:animateState?"checkPop 0.35s cubic-bezier(0.34,1.56,0.64,1)":"none"}}><Checkbox checked={task.completed} priority={task.priority} onChange={()=>onToggle(task.id)} animating={!!animateState}/></div>
        <div style={{flex:1,minWidth:0}}>
          <EditableText value={task.title} onSave={t=>onUpdateTask({...task,title:t})} onEditStart={cancelRowClick}
            style={{fontSize:15,fontWeight:task.completed?400:500,lineHeight:1.4,color:task.completed?"var(--muted)":"var(--ink)",textDecoration:task.completed?"line-through":"none",display:"block",marginBottom:3}}/>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            {/* Always visible: date, priority (the one colored signal), state badges */}
            <InlineDatePicker value={task.dueDate} overdue={overdue} onChange={d=>onUpdateTask({...task,dueDate:d||null})}/>
            {task.priority!=="none"&&<span style={{fontSize:11,fontWeight:700,display:"flex",alignItems:"center",gap:3,color:PRIORITY[task.priority].color}}>{Icons.flag} {PRIORITY[task.priority].label}</span>}
            {!task.completed&&task.snoozedFrom&&task.dueDate===todayStr()&&(
              <span className="chip" title={`Snoozed on ${formatDate(task.snoozedFrom)} — back today`}>↩ resurfaced</span>
            )}
            {paperUI&&overdue&&(()=>{
              const days=Math.max(1,Math.floor((new Date(todayStr()+"T00:00:00")-new Date(task.dueDate+"T00:00:00"))/86400000));
              return <span className="chip" style={{color:"var(--danger)"}} title="Carried forward — do it, snooze it, or let it go">↻ carried {days}d</span>;
            })()}
            {/* Revealed on hover / focus; always visible on touch */}
            <span className="row-secondary">
              {!task.completed&&onSnooze&&<SnoozeButton task={task} onSnooze={onSnooze}/>}
              {subTotal>0&&(<button onClick={e=>{e.stopPropagation();setSubsOpen(!subsOpen);}} style={{fontSize:12,display:"flex",alignItems:"center",gap:3,color:subDone===subTotal?"#16a34a":"var(--muted)",background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"inherit"}}>{Icons.subtask} {subDone}/{subTotal} <span style={{transform:subsOpen?"rotate(0)":"rotate(-90deg)",transition:"transform 0.15s",display:"flex"}}>{Icons.chevD}</span></button>)}
              {hasDuration&&<span className="chip">{Icons.duration} {formatDate(task.startDate)}–{formatDate(task.endDate)}</span>}
              {(task.tags||[]).map(t=><span key={t} className="chip">#{t}</span>)}
              {task.notes&&<span style={{color:"var(--border)",display:"flex"}}>{Icons.note}</span>}
              {task.recurrence&&<span className="chip" title={task.recurrence.endAfter?`${task.recurrence.completedCount||0}/${task.recurrence.endAfter} done`:"Repeating"}>{Icons.repeat}{task.recurrence.endAfter?`${task.recurrence.completedCount||0}/${task.recurrence.endAfter}`:""}</span>}
              {!view.startsWith("list:")&&view!=="inbox"&&<span className="chip"><span style={{width:6,height:6,borderRadius:"50%",background:listColor||"var(--border)",flexShrink:0}}/>{task.list}</span>}
            </span>
          </div>
        </div>
      </div>
      {/* Expanded subtasks — each one is draggable to promote */}
      {subsOpen&&subTotal>0&&(
        <div style={{paddingLeft:52,paddingBottom:8,paddingRight:12}}>
          <DraggableSubtaskTree subtasks={task.subtasks} onAction={handleSubAction} onDragStart={onDragStart} onDragEnd={onDragEnd} parentTask={task} listColor={listColor}/>
        </div>
      )}
    </div>
  );
};

/* Surfaced subtask row for list views (Today/Upcoming) */
const SurfacedSubtaskRow = ({task, onSelect, onToggleSub, view, lists, animateState}) => {
  const parentLabel = task._breadcrumb.slice(0, -1).join(" › ");
  const lc = getListColor(task.list, lists);
  return (
    <div onClick={() => onSelect(task._parentTask)}
      style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",
        borderRadius:10,cursor:"pointer",transition:"background 0.1s",
        borderLeft:"3px dashed var(--border)",marginLeft:4,
        animation:animateState==="complete"?"taskComplete 0.7s ease forwards":animateState==="uncomplete"?"taskUncomplete 0.6s ease forwards":"none"}}
      onMouseEnter={e=>e.currentTarget.style.background="var(--active-bg)"}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      <div style={{animation:animateState?"checkPop 0.35s cubic-bezier(0.34,1.56,0.64,1)":"none"}} onClick={e=>e.stopPropagation()}>
        <Checkbox checked={task.completed} priority={task.priority} size={18}
          onChange={()=>onToggleSub(task._parentTask.id, task.id)} animating={!!animateState}/>
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:14,fontWeight:500,color:task.completed?"var(--muted)":"var(--ink)",
          textDecoration:task.completed?"line-through":"none",lineHeight:1.4}}>{task.title}</div>
        <div style={{display:"flex",alignItems:"center",gap:6,marginTop:2,flexWrap:"wrap"}}>
          <span style={{fontSize:11,color:"var(--accent)",fontWeight:500,display:"flex",alignItems:"center",gap:2}}>
            ↳ {parentLabel}
          </span>
          {view!=="today"&&task.dueDate&&<span style={{fontSize:11,color:isOverdue(task.dueDate)?"var(--danger)":"var(--muted)",display:"flex",alignItems:"center",gap:3}}>{Icons.calendar} {formatDate(task.dueDate)}</span>}
          <span style={{fontSize:11,fontWeight:600,color:lc,background:`${lc}14`,padding:"0 6px",borderRadius:3}}>{task.list}</span>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   EMPTY STATES — small inkwell-and-quill line art + a crafted one-liner
   ═══════════════════════════════════════════════════════════════════════ */
const EmptyState = ({view, search, onGuide}) => {
  const [title, sub] = search ? ["No matches in the inkwell", "Try a different word — or write it fresh above."]
    : view === "completed" ? ["Nothing crossed off yet", "The first ✓ of the day is the sweetest."]
    : view === "overdue" ? ["Nothing overdue", "The ledger is clean."]
    : view === "today" ? ["Today's page is blank", "Add a task above, or scan a notebook page."]
    : view === "inbox" ? ["Inbox is empty — nicely done", "New scans land here first."]
    : ["All clear", "Add a task above, or scan a notebook page."];
  const showGuide = !search && view !== "completed" && view !== "overdue";
  return (
    <div style={{textAlign:"center",padding:"56px 20px",color:"var(--muted)",animation:"fadeIn 0.3s ease"}}>
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{marginBottom:14}} aria-hidden="true">
        <path d="M6 21h9"/>
        <path d="M7.5 21v-3.4a3.2 3.2 0 0 1-1.5-2.7V13h9v1.9a3.2 3.2 0 0 1-1.5 2.7V21"/>
        <path d="M8.2 13v-2.2h4.6V13"/>
        <path d="M13.4 10.6 19.8 3.4c.5-.55 1.35.2.9.82L15.4 11"/>
      </svg>
      <div style={{fontSize:17,fontWeight:600,fontFamily:"var(--font-display)",color:"var(--text)",marginBottom:5}}>{title}</div>
      <div style={{fontSize:13.5,lineHeight:1.6}}>
        {sub}{showGuide && <> <span onClick={onGuide} style={{color:"var(--accent)",cursor:"pointer",fontWeight:600,textDecoration:"underline",textDecorationColor:"var(--accent-a30)",textUnderlineOffset:2}}>See what Inkwell can do →</span></>}
      </div>
    </div>
  );
};

/* ═══ END-OF-DAY FLOURISH — the last Today task was just completed ═══ */
const DayClosed = ({show}) => show ? (
  <div aria-hidden="true" style={{position:"fixed",inset:0,zIndex:2600,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none",animation:"fadeIn 0.4s ease"}}>
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius-xl)",padding:"30px 44px",boxShadow:"var(--shadow-3)",textAlign:"center",maxWidth:340}}>
      <div style={{fontFamily:"var(--font-display)",fontSize:22,fontWeight:700,color:"var(--ink)",marginBottom:12}}>That's everything for today</div>
      <div style={{height:2,background:"var(--ink)",borderRadius:1,opacity:0.7,transformOrigin:"left",animation:"inkLine 0.9s ease 0.25s both"}}/>
      <div style={{fontSize:13,color:"var(--muted)",marginTop:12}}>The page is closed. 🖋</div>
    </div>
  </div>
) : null;

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
    <div style={{minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)",fontFamily:"var(--font-body)",padding:20}}>
      <style>{`
        :root{--font-display:'Fraunces','Playfair Display',Georgia,serif;--font-body:'Inter Tight','Source Sans 3',-apple-system,sans-serif;--font-mono:'JetBrains Mono',ui-monospace,Consolas,monospace;--ink:#222941;--text:#464b63;--muted:#7b7968;--bg:#faf7f0;--surface:#f2ece0;--border:#e4ddd0;--accent:#a8642e;--accent-dark:#8a5426;--accent-bg:#fdf4e3;--accent2:#c98a45;--card:#fffcf5;--danger:#b85454;--shadow:rgba(26,34,56,0.08);--shadow-strong:rgba(26,34,56,0.16);--accent-a15:rgba(168,100,46,0.15);--accent-a20:rgba(168,100,46,0.2);}
        *{box-sizing:border-box;margin:0;padding:0;font-family:var(--font-body);}
        html,body{height:100%;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;}`}
      </style>
      <div style={{maxWidth:380,width:"100%",textAlign:"center"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:32}}>
          <div style={{width:40,height:40,background:"linear-gradient(135deg,var(--accent),var(--accent2))",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontFamily:"var(--font-display)",fontSize:20}}>I</div>
          <h1 style={{fontFamily:"var(--font-display)",fontSize:32,fontWeight:700,color:"var(--ink)"}}>Inkwell</h1>
        </div>
        <p style={{color:"var(--muted)",fontSize:15,marginBottom:32}}>Sign in to sync your tasks across devices</p>

        {sent ? (
          <div style={{padding:24,background:"var(--accent-bg)",borderRadius:14,border:"1px solid var(--accent-a20)"}}>
            <div style={{fontSize:32,marginBottom:8}}>✉️</div>
            <p style={{fontWeight:600,color:"var(--ink)",marginBottom:8}}>Check your email</p>
            <p style={{color:"var(--muted)",fontSize:14}}>We sent a magic link to <strong>{email}</strong></p>
            <button onClick={()=>setSent(false)} style={{marginTop:16,background:"none",border:"none",color:"var(--accent)",cursor:"pointer",fontSize:13,fontFamily:"inherit"}}>Use a different email</button>
          </div>
        ) : (
          <div style={{background:"var(--card)",borderRadius:16,border:"1px solid var(--border)",padding:24,boxShadow:"0 2px 12px var(--shadow)"}}>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com"
              onKeyDown={e=>e.key==="Enter"&&(mode==="magic"?handleMagicLink():handlePassword())}
              style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1px solid var(--border)",fontSize:15,outline:"none",marginBottom:10,fontFamily:"inherit",background:"var(--surface)"}}/>

            {mode !== "magic" && (
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password"
                onKeyDown={e=>e.key==="Enter"&&handlePassword()}
                style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1px solid var(--border)",fontSize:15,outline:"none",marginBottom:10,fontFamily:"inherit",background:"var(--surface)"}}/>
            )}

            {error && <p style={{color:"var(--danger)",fontSize:13,marginBottom:10}}>{error}</p>}

            {mode === "magic" ? (
              <button onClick={handleMagicLink} disabled={loading}
                style={{width:"100%",padding:"12px",borderRadius:10,border:"none",background:loading?"var(--muted)":"linear-gradient(135deg,var(--accent),var(--accent2))",color:"white",fontSize:15,fontWeight:600,cursor:loading?"wait":"pointer",fontFamily:"inherit",marginBottom:12}}>
                {loading ? "Sending..." : "Send magic link ✨"}
              </button>
            ) : (
              <button onClick={handlePassword} disabled={loading}
                style={{width:"100%",padding:"12px",borderRadius:10,border:"none",background:loading?"var(--muted)":"linear-gradient(135deg,var(--accent),var(--accent2))",color:"white",fontSize:15,fontWeight:600,cursor:loading?"wait":"pointer",fontFamily:"inherit",marginBottom:12}}>
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

/* ═══════════════════════════════════════════════════════════════════════
   THEME TRANSITION OVERLAY — snow or heat wave canvas animation
   ═══════════════════════════════════════════════════════════════════════ */
const ThemeTransition = ({type, isLight, onDone}) => {
  const canvasRef = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(()=>{
    const canvas = canvasRef.current;
    if(!canvas) return;
    const ctx = canvas.getContext("2d");
    /* HiDPI support for crisp rendering on retina */
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.scale(dpr, dpr);

    let raf;
    let finished = false;
    const start = performance.now();
    const DURATION = 5000; /* 5 seconds — substantial but not overwhelming */

    /* Handle resize mid-animation */
    const onResize = () => {
      const nw = window.innerWidth, nh = window.innerHeight;
      canvas.width = nw * dpr; canvas.height = nh * dpr;
      canvas.style.width = nw + "px"; canvas.style.height = nh + "px";
      ctx.scale(dpr, dpr);
    };
    window.addEventListener("resize", onResize);

    const finish = () => {
      if(finished) return;
      finished = true;
      if(onDoneRef.current) onDoneRef.current();
    };

    if(type === "snow") {
      /* ── Layered snowfall: 3 depth layers with parallax ── */
      const makeFlakes = (count, sizeRange, speedRange, opacityRange) =>
        Array.from({length:count}, ()=>({
          x: Math.random()*W,
          y: Math.random()*H*-1.2,
          r: sizeRange[0] + Math.random()*(sizeRange[1]-sizeRange[0]),
          speed: speedRange[0] + Math.random()*(speedRange[1]-speedRange[0]),
          drift: (Math.random()-0.5)*0.6,
          wobbleAmp: 15 + Math.random()*35,
          wobbleSpeed: 0.4 + Math.random()*1.2,
          opacity: opacityRange[0] + Math.random()*(opacityRange[1]-opacityRange[0]),
          rotation: Math.random()*Math.PI*2,
          rotSpeed: (Math.random()-0.5)*0.04,
          star: Math.random() < 0.3, /* 30% chance of being a 6-point star flake */
        }));

      const far = makeFlakes(80, [0.8, 2.2], [25, 50], [0.3, 0.55]);   /* Background layer: small, slow */
      const mid = makeFlakes(70, [2, 4], [50, 90], [0.55, 0.8]);        /* Mid layer */
      const near = makeFlakes(50, [3.5, 7], [90, 150], [0.75, 1]);      /* Foreground: big, fast */
      const allLayers = [far, mid, near];

      /* Draw a 6-point star snowflake */
      const drawStar = (cx, cy, r, rot, fillStyle, strokeStyle) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.beginPath();
        for(let i=0; i<6; i++) {
          ctx.moveTo(0, 0);
          const angle = (Math.PI/3)*i;
          ctx.lineTo(Math.cos(angle)*r, Math.sin(angle)*r);
        }
        ctx.lineWidth = r*0.35;
        ctx.lineCap = "round";
        ctx.strokeStyle = fillStyle;
        ctx.stroke();
        if(strokeStyle) {
          ctx.lineWidth = r*0.15;
          ctx.strokeStyle = strokeStyle;
          ctx.stroke();
        }
        ctx.restore();
      };

      let lastTime = start;
      const draw = (now) => {
        const elapsed = now - start;
        const dt = Math.min((now - lastTime)/1000, 0.05); /* dt in seconds, cap at 50ms */
        lastTime = now;
        const progress = Math.min(elapsed/DURATION, 1);
        /* Smooth fade curve: ease in 0-15%, full 15-70%, ease out 70-100% */
        let globalAlpha;
        if(progress < 0.15) globalAlpha = progress/0.15;
        else if(progress > 0.7) globalAlpha = Math.max(0, 1 - (progress-0.7)/0.3);
        else globalAlpha = 1;
        /* Smooth ease */
        globalAlpha = globalAlpha * globalAlpha * (3 - 2*globalAlpha);

        ctx.clearRect(0,0,W,H);

        for(let layer=0; layer<allLayers.length; layer++) {
          const flakes = allLayers[layer];
          const depthScale = 0.6 + layer*0.2; /* far=0.6, mid=0.8, near=1.0 */
          for(const f of flakes) {
            f.y += f.speed * dt;
            f.x += f.drift + Math.sin(elapsed*0.001*f.wobbleSpeed)*0.4;
            f.rotation += f.rotSpeed;
            if(f.y > H+20) { f.y = -20; f.x = Math.random()*W; }
            const wobbleX = f.x + Math.sin(elapsed*0.001*f.wobbleSpeed)*f.wobbleAmp*0.3;
            const alpha = f.opacity * globalAlpha;

            if(isLight) {
              /* ── Light mode: blue-tinted flakes with darker outlines ── */
              const baseFill = `rgba(191,219,254,${alpha})`;
              const outline = `rgba(30,64,175,${alpha * 0.9})`;
              if(f.star && f.r > 2.5) {
                drawStar(wobbleX, f.y, f.r*1.3, f.rotation, outline, null);
                drawStar(wobbleX, f.y, f.r*1.1, f.rotation, baseFill, null);
              } else {
                ctx.beginPath();
                ctx.arc(wobbleX, f.y, f.r, 0, Math.PI*2);
                ctx.fillStyle = baseFill;
                ctx.fill();
                ctx.lineWidth = Math.max(0.8, f.r*0.25);
                ctx.strokeStyle = outline;
                ctx.stroke();
                if(f.r > 3) {
                  ctx.beginPath();
                  ctx.arc(wobbleX, f.y, f.r*0.45, 0, Math.PI*2);
                  ctx.fillStyle = `rgba(98,146,216,${alpha * (0.5 + 0.5*Math.abs(Math.sin(elapsed*0.003+f.x)))})`;
                  ctx.fill();
                }
              }
            } else {
              /* ── Dark mode: bright white flakes with blue shimmer ── */
              const baseFill = `rgba(255,255,255,${alpha})`;
              if(f.star && f.r > 2.5) {
                drawStar(wobbleX, f.y, f.r*1.4, f.rotation, baseFill, `rgba(191,219,254,${alpha*0.6})`);
              } else {
                /* Soft glow around flake */
                const gradient = ctx.createRadialGradient(wobbleX, f.y, 0, wobbleX, f.y, f.r*2.5);
                gradient.addColorStop(0, `rgba(255,255,255,${alpha * 0.6})`);
                gradient.addColorStop(0.4, `rgba(191,219,254,${alpha * 0.2})`);
                gradient.addColorStop(1, `rgba(98,146,216,0)`);
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(wobbleX, f.y, f.r*2.5, 0, Math.PI*2);
                ctx.fill();
                /* Solid core */
                ctx.beginPath();
                ctx.arc(wobbleX, f.y, f.r, 0, Math.PI*2);
                ctx.fillStyle = baseFill;
                ctx.fill();
                if(f.r > 3) {
                  ctx.beginPath();
                  ctx.arc(wobbleX, f.y, f.r*0.4, 0, Math.PI*2);
                  ctx.fillStyle = `rgba(147,197,253,${alpha * (0.5 + 0.5*Math.abs(Math.sin(elapsed*0.003+f.x)))})`;
                  ctx.fill();
                }
              }
            }
          }
        }

        if(elapsed < DURATION) raf = requestAnimationFrame(draw);
        else { ctx.clearRect(0,0,W,H); finish(); }
      };
      raf = requestAnimationFrame(draw);

    } else {
      /* ── Heat wave: layered distortion + rising embers + shimmer ── */
      const waves = Array.from({length:40}, ()=>({
        y: H + Math.random()*100,
        amplitude: 5 + Math.random()*14,
        frequency: 0.004 + Math.random()*0.01,
        speed: 30 + Math.random()*60,
        phase: Math.random()*Math.PI*2,
        width: 1 + Math.random()*3,
        opacity: 0.1 + Math.random()*0.2,
        hue: 15 + Math.random()*35, /* amber-orange-red range */
      }));
      /* Background warmth glow */
      const glowParticles = Array.from({length:30}, ()=>({
        x: Math.random()*W,
        y: Math.random()*H,
        radius: 80 + Math.random()*160,
        speed: (Math.random()-0.5)*15,
        ySpeed: -10 - Math.random()*20,
        opacity: 0.04 + Math.random()*0.08,
        hue: 20 + Math.random()*25,
      }));
      /* Rising ember particles */
      const embers = Array.from({length:120}, ()=>({
        x: Math.random()*W,
        y: H + Math.random()*H,
        speed: 30 + Math.random()*80,
        size: 0.8 + Math.random()*3.5,
        opacity: 0.25 + Math.random()*0.5,
        drift: (Math.random()-0.5)*15,
        hue: 25 + Math.random()*25,
        flickerSpeed: 3 + Math.random()*6,
      }));

      let lastTime = start;
      const draw = (now) => {
        const elapsed = now - start;
        const dt = Math.min((now - lastTime)/1000, 0.05);
        lastTime = now;
        const progress = Math.min(elapsed/DURATION, 1);
        let globalAlpha;
        if(progress < 0.15) globalAlpha = progress/0.15;
        else if(progress > 0.7) globalAlpha = Math.max(0, 1 - (progress-0.7)/0.3);
        else globalAlpha = 1;
        globalAlpha = globalAlpha * globalAlpha * (3 - 2*globalAlpha);

        ctx.clearRect(0,0,W,H);

        /* Warm background glow — big soft radial gradients */
        for(const g of glowParticles) {
          g.x += g.speed * dt;
          g.y += g.ySpeed * dt;
          if(g.y < -g.radius) { g.y = H + g.radius; g.x = Math.random()*W; }
          if(g.x < -g.radius) g.x = W + g.radius;
          if(g.x > W + g.radius) g.x = -g.radius;
          const gradient = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.radius);
          const a = g.opacity * globalAlpha;
          gradient.addColorStop(0, `hsla(${g.hue},90%,${isLight?60:55}%,${a})`);
          gradient.addColorStop(0.5, `hsla(${g.hue},90%,${isLight?65:50}%,${a*0.4})`);
          gradient.addColorStop(1, `hsla(${g.hue},90%,50%,0)`);
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(g.x, g.y, g.radius, 0, Math.PI*2);
          ctx.fill();
        }

        /* Wavy heat distortion lines */
        for(const w of waves) {
          w.y -= w.speed * dt;
          if(w.y < -30) { w.y = H + 30; w.phase = Math.random()*Math.PI*2; }
          ctx.beginPath();
          ctx.lineWidth = w.width;
          const lightness = isLight ? 50 : 60;
          ctx.strokeStyle = `hsla(${w.hue},90%,${lightness}%,${w.opacity * globalAlpha})`;
          ctx.lineCap = "round";
          for(let x=0; x<W; x+=4) {
            const dy = Math.sin(x*w.frequency + elapsed*0.0025 + w.phase)*w.amplitude;
            if(x===0) ctx.moveTo(x, w.y+dy);
            else ctx.lineTo(x, w.y+dy);
          }
          ctx.stroke();
        }

        /* Rising embers with flicker and glow */
        for(const p of embers) {
          p.y -= p.speed * dt;
          p.x += (p.drift + Math.sin(elapsed*0.002+p.x*0.01)*8) * dt;
          if(p.y < -20) { p.y = H+20; p.x = Math.random()*W; }
          const flicker = 0.5 + 0.5*Math.sin(elapsed*0.001*p.flickerSpeed + p.x);
          const alpha = p.opacity * globalAlpha * flicker;
          /* Glow halo */
          const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size*4);
          halo.addColorStop(0, `hsla(${p.hue},95%,60%,${alpha * 0.8})`);
          halo.addColorStop(0.5, `hsla(${p.hue},95%,55%,${alpha * 0.3})`);
          halo.addColorStop(1, `hsla(${p.hue},95%,50%,0)`);
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size*4, 0, Math.PI*2);
          ctx.fill();
          /* Solid core */
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
          ctx.fillStyle = `hsla(${p.hue},100%,${isLight?55:70}%,${alpha})`;
          ctx.fill();
        }

        if(elapsed < DURATION) raf = requestAnimationFrame(draw);
        else { ctx.clearRect(0,0,W,H); finish(); }
      };
      raf = requestAnimationFrame(draw);
    }

    /* Absolute safety: if raf fails entirely, ensure cleanup */
    const safety = setTimeout(finish, DURATION + 500);

    return ()=>{
      cancelAnimationFrame(raf);
      clearTimeout(safety);
      window.removeEventListener("resize", onResize);
    };
  },[type,isLight]);
  return <canvas ref={canvasRef} style={{position:"fixed",inset:0,zIndex:3000,pointerEvents:"none"}} />;
};

export default function InkwellApp() {
  const { user, authLoading, authError, signInWithEmail, signInWithPassword, signOut, loadFromCloud, saveToCloud, saveToCloudNow, flushToCloudKeepalive, hasSupabase } = useSupabaseSync();
  const [tasks,_setTasks]=useState([]);
  /* ── Auto-stamp updatedAt on user-mutated tasks ── */
  const setTasks = useCallback((updater) => {
    const ts = new Date().toISOString();
    _setTasks(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (!Array.isArray(next) || !Array.isArray(prev)) return next;
      const prevMap = new Map(prev.map(t => [t.id, t]));
      return next.map(t => {
        const old = prevMap.get(t.id);
        if (old === t) return t; /* unchanged reference — don't stamp */
        return { ...t, updatedAt: ts }; /* changed or new — stamp */
      });
    });
  }, []);
  /* Raw setter for cloud loads, init, undo/redo — preserves existing updatedAt */
  const setTasksRaw = _setTasks;

  /* ── Tombstone tracking for offline-safe deletions ── */
  const tombstonesRef = useRef(load(TOMBSTONES_KEY, []));
  const addTombstone = useCallback((id) => {
    const ts = new Date().toISOString();
    tombstonesRef.current = [...tombstonesRef.current.filter(t => t.id !== id), { id, deletedAt: ts }];
    save(TOMBSTONES_KEY, tombstonesRef.current);
  }, []);
  const addTombstones = useCallback((ids) => {
    const ts = new Date().toISOString();
    const idSet = new Set(ids);
    tombstonesRef.current = [
      ...tombstonesRef.current.filter(t => !idSet.has(t.id)),
      ...ids.map(id => ({ id, deletedAt: ts }))
    ];
    save(TOMBSTONES_KEY, tombstonesRef.current);
  }, []);

  /* ── Online/offline detection ── */
  const [isOnline,setIsOnline]=useState(typeof navigator!=="undefined"?navigator.onLine:true);
  const hasPendingSync=useRef(load(PENDING_SYNC_KEY, false));
  const [lists,setLists]=useState(DEFAULT_LISTS);
  const [archivedLists,setArchivedLists]=useState(()=>load("inkwell-archivedLists",[]));
  const [view,setView]=useState("today");
  const [selectedTask,setSelectedTask]=useState(null);
  const [showPhoto,setShowPhoto]=useState(false);
  const [scanResults,setScanResults]=useState(null);
  const [processing,setProcessing]=useState(false);
  const [scanError,setScanError]=useState(null);
  const [search,setSearch]=useState("");
  const [showSearch,setShowSearch]=useState(false);
  const [newTitle,setNewTitle]=useState("");
  const [newList,setNewList]=useState("");
  const [showNewList,setShowNewList]=useState(false);
  const [ready,setReady]=useState(false);
  const cloudSyncReady=useRef(false); /* true only after successful cloud load — prevents stale overwrites */
  const localDataVersion=useRef(null); /* ISO timestamp of last user-initiated data change */
  const [sidebar,setSidebar]=useState(true);
  const [toast,setToast]=useState(null);
  const [pendingCompleteId,setPendingCompleteId]=useState(null); /* task id awaiting subtask-complete confirmation */
  const flash=msg=>{setToast(msg);setTimeout(()=>setToast(null),3000);};
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
  const [showTips,setShowTips]=useState(()=>{if(typeof window==="undefined")return null;if(!localStorage.getItem("inkwell-welcomed")){localStorage.setItem("inkwell-welcomed","1");return "welcome";}return null;});
  const [listMenu,setListMenu]=useState(null); // {name, x, y}
  const [editingList,setEditingList]=useState(null);
  const [dragList,setDragList]=useState(null);
  const [dragListOver,setDragListOver]=useState(null);
  const [archiveOpen,setArchiveOpen]=useState(false);
  const [showViewCounts,setShowViewCounts]=useState(()=>load("inkwell-showViewCounts",true));
  const [showListCounts,setShowListCounts]=useState(()=>load("inkwell-showListCounts",true));
  const [confirmSubtaskComplete,setConfirmSubtaskComplete]=useState(()=>load("inkwell-confirmSubtaskComplete",true));
  const confirmSubRef=useRef(confirmSubtaskComplete);
  useEffect(()=>{confirmSubRef.current=confirmSubtaskComplete;},[confirmSubtaskComplete]);

  /* ═══ PAPER MODE — notebook-first. The app pins to Today; the only verbs are
     scan, check off, and snooze. Everything else (boards, lists, calendar,
     upcoming) is set aside for a deliberate weekly review session. ═══ */
  const [paperMode,setPaperMode]=useState(()=>load("inkwell-paperMode",false));
  const [reviewMode,setReviewMode]=useState(false); /* session-only escape hatch — never persisted */
  const paperUI = paperMode && !reviewMode;
  useEffect(()=>{save("inkwell-paperMode",paperMode);},[paperMode]);
  /* Pin to Today whenever paper restrictions (re)engage */
  useEffect(()=>{ if(paperMode && !reviewMode && view!=="today") setView("today"); },[paperMode,reviewMode]);
  /* Gentle anti-stickiness nudge after 5 minutes of paper-mode browsing */
  useEffect(()=>{
    if(!paperUI||!ready) return;
    const t=setTimeout(()=>{ setToast("🖋 Five minutes in the app — your notebook misses you"); setTimeout(()=>setToast(null),4000); },5*60*1000);
    return()=>clearTimeout(t);
  },[paperUI,ready]);
  const BUILD_VERSION = "2026.04.15-v1";
  const [darkMode,setDarkMode]=useState(()=>load("inkwell-darkMode",false));
  const [frostMode,setFrostMode]=useState(()=>load("inkwell-frostMode",false));
  useEffect(()=>{save("inkwell-frostMode",frostMode);},[frostMode]);
  useEffect(()=>{save("inkwell-archivedLists",archivedLists);},[archivedLists]);
  const [themeTransition,setThemeTransition]=useState(null); /* "snow" | "heat" | null */

  /* ═══ INKWELL GLOW-UP: new state ═══ */
  const { dyslexic, setDyslexic, textSize, setTextSize } = useA11yPrefs();
  const [quillMode, setQuillMode] = useState(false);
  const midnightActive = useMidnight();
  const [showCmd, setShowCmd] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [confettiTrigger, setConfettiTrigger] = useState(0);
  const completionStreakRef = useRef(0);
  const lastCompletionAtRef = useRef(0); /* for the end-of-day flourish */
  const undoToast = useUndoToast();
  const spatter = useInkSpatter();
  /* Auto dark mode — respect system preference if user hasn't flipped it explicitly */
  const darkModeExplicit = useRef(typeof window !== "undefined" && localStorage.getItem("inkwell-darkMode") != null);
  useEffect(() => {
    if (darkModeExplicit.current) return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDarkMode(mq.matches);
    const on = (e) => { if (!darkModeExplicit.current) setDarkMode(e.matches); };
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  /* Mark dark mode as explicit when user toggles it */
  const setDarkModeUser = useCallback((v) => { darkModeExplicit.current = true; setDarkMode(v); }, []);
  /* Konami → Quill mode */
  useKonami(() => {
    setQuillMode(q => {
      const next = !q;
      setToast(next ? "🪶 Quill mode engaged" : "Quill mode off");
      setTimeout(() => setToast(null), 2200);
      return next;
    });
  });
  /* ⌘K / Ctrl+K → Command palette */
  useEffect(() => {
    const onKey = (e) => {
      const isK = e.key === "k" || e.key === "K";
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        setShowCmd(s => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  /* Logo long-press — reveals changelog scroll */
  const longPressed = useRef(false);
  const logoLongHandlers = useLongPress(() => {
    longPressed.current = true;
    setShowChangelog(true);
  }, { ms: 600 });
  const onLogoClick = () => {
    if (longPressed.current) { longPressed.current = false; return; }
    if (themeTransition) return;
    setThemeTransition(frostMode ? "heat" : "snow");
    setFrostMode(f => !f);
    setTimeout(() => setThemeTransition(null), 5600);
  };
  const defaultQuickDates=[{label:"Tomorrow",offset:"tomorrow"},{label:"Next Monday",offset:"nextMonday"}];
  const [quickDates,setQuickDates]=useState(()=>load("inkwell-quickDates",defaultQuickDates));
  const [viewMode,setViewMode]=useState(()=>load("inkwell-todayMode","kanban")); /* "kanban" | "list" — applies to today/inbox/list views */
  const [todayListFilter,setTodayListFilter]=useState(()=>new Set(load("inkwell-todayListFilter",[])));
  const [showTodayFilter,setShowTodayFilter]=useState(false);
  const [sortBy,setSortBy]=useState("default"); /* default|priority|alpha|date|created */
  const [filterPriority,setFilterPriority]=useState("all"); /* all|high|medium|low */
  const [showSortMenu,setShowSortMenu]=useState(false);
  const [kanbanColumns, setKanbanColumns] = useState(() => {
    const saved = load("inkwell-kanbanCols", null);
    if (!saved || saved.length === 0) return null;
    /* Auto-expire: remove columns with dates before today, keep future ones */
    const today = todayStr();
    const fresh = saved.filter(c => !c.dateStr || c.dateStr >= today);
    return fresh.length > 0 ? fresh : null;
  });
  useEffect(() => { if (kanbanColumns) save("inkwell-kanbanCols", kanbanColumns); else localStorage.removeItem("inkwell-kanbanCols"); }, [kanbanColumns]);
  /* Live "today" tracker — updates when tab regains focus, on day rollover, or once per minute as safety */
  const [currentDateStr, setCurrentDateStr] = useState(()=>todayStr());
  useEffect(() => {
    const check = () => {
      const now = todayStr();
      setCurrentDateStr(prev => prev === now ? prev : now);
    };
    const onVis = () => { if (!document.hidden) check(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", check);
    /* Safety interval: every 60s check for day rollover */
    const iv = setInterval(check, 60000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", check);
      clearInterval(iv);
    };
  }, []);
  const activeKanbanCols = useMemo(() => {
    if (kanbanColumns && kanbanColumns.length > 0) {
      /* Filter out past columns every render — uses currentDateStr so re-runs on day rollover */
      const fresh = kanbanColumns.filter(c => !c.dateStr || c.dateStr >= currentDateStr);
      if (fresh.length > 0) return fresh;
    }
    /* Default: today + next 3 days — rebuilds when currentDateStr changes */
    const cols = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const ds = localDateStr(d);
      const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-IE", { weekday: "long" });
      cols.push({ id: `default-${i}`, name: label, dateStr: ds });
    }
    return cols;
  }, [kanbanColumns, currentDateStr]);
  const resetKanbanCols = useCallback(() => { setKanbanColumns(null); }, []);
  /* Auto-prune stale columns when tab regains focus (handles overnight) — persists the cleanup */
  useEffect(() => {
    const check = () => {
      if (document.hidden) return;
      setKanbanColumns(prev => {
        if (!prev || prev.length === 0) return prev;
        const today = todayStr();
        const fresh = prev.filter(c => !c.dateStr || c.dateStr >= today);
        if (fresh.length === prev.length) return prev; /* no change */
        return fresh.length > 0 ? fresh : null;
      });
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);
  useEffect(()=>{save("inkwell-showViewCounts",showViewCounts);},[showViewCounts]);
  useEffect(()=>{save("inkwell-showListCounts",showListCounts);},[showListCounts]);
  useEffect(()=>{save("inkwell-confirmSubtaskComplete",confirmSubtaskComplete);},[confirmSubtaskComplete]);
  useEffect(()=>{save("inkwell-darkMode",darkMode);},[darkMode]);
  useEffect(()=>{save("inkwell-quickDates",quickDates);},[quickDates]);
  useEffect(()=>{save("inkwell-todayMode",viewMode);},[viewMode]);
  useEffect(()=>{save("inkwell-todayListFilter",[...todayListFilter]);},[todayListFilter]);

  /* ── CLOUD-FIRST SYNC ──
     When logged in: cloud is always the source of truth.
     localStorage is a write-through cache for offline use.
     Cloud saves are gated by cloudSyncReady (only true after successful cloud load).
     Save effects are suppressed for 2s after any cloud load
     to prevent writing cloud data back to cloud. */
  const cloudLoadTimeRef = useRef(0); /* timestamp of last cloud load — save effects skip within 2s */
  const initializedUserRef = useRef(null); /* prevents token-refresh re-init */

  /* Helper: apply cloud data to state + localStorage cache (no updatedAt stamping) */
  const applyCloudData = useCallback((cloudData) => {
    cloudLoadTimeRef.current = Date.now(); /* mark cloud load time BEFORE setters */
    setTasksRaw(cloudData.tasks || []);
    setLists(cloudData.lists || DEFAULT_LISTS);
    if (cloudData.settings) {
      if (cloudData.settings.showViewCounts !== undefined) setShowViewCounts(cloudData.settings.showViewCounts);
      if (cloudData.settings.showListCounts !== undefined) setShowListCounts(cloudData.settings.showListCounts);
      if (cloudData.settings.confirmSubtaskComplete !== undefined) setConfirmSubtaskComplete(cloudData.settings.confirmSubtaskComplete);
      if (cloudData.settings.frostMode !== undefined) setFrostMode(cloudData.settings.frostMode);
      if (cloudData.settings.archivedLists !== undefined) setArchivedLists(cloudData.settings.archivedLists);
      if (cloudData.settings.darkMode !== undefined) setDarkMode(cloudData.settings.darkMode);
      if (cloudData.settings.quickDates !== undefined) setQuickDates(cloudData.settings.quickDates);
      if (cloudData.settings.paperMode !== undefined) setPaperMode(cloudData.settings.paperMode);
      if (cloudData.settings.kanbanColumns !== undefined) {
        /* Prune any past-date columns from cloud data */
        const today = todayStr();
        const cols = cloudData.settings.kanbanColumns;
        if (cols && Array.isArray(cols)) {
          const fresh = cols.filter(c => !c.dateStr || c.dateStr >= today);
          setKanbanColumns(fresh.length > 0 ? fresh : null);
        } else {
          setKanbanColumns(cols);
        }
      }
      /* Merge cloud tombstones into local tombstones */
      if (cloudData.settings._tombstones) {
        const cloudTombs = cloudData.settings._tombstones;
        const localTombs = tombstonesRef.current;
        const tombMap = new Map(localTombs.map(t => [t.id, t]));
        for (const ct of cloudTombs) {
          const existing = tombMap.get(ct.id);
          if (!existing || ct.deletedAt > existing.deletedAt) tombMap.set(ct.id, ct);
        }
        tombstonesRef.current = [...tombMap.values()];
        save(TOMBSTONES_KEY, tombstonesRef.current);
      }
    }
    /* Cache to localStorage for offline use (with timestamp) */
    save(TASKS_KEY, cloudData.tasks || []);
    save(LISTS_KEY, cloudData.lists || DEFAULT_LISTS);
    save("inkwell-data-ts", cloudData.updated_at || new Date().toISOString());
  }, [setTasksRaw]);

  useEffect(()=>{
    if(authLoading) return; /* wait for auth to resolve */
    const userId = user?.id || null;
    /* Skip re-init for same user (token refresh) — only re-init on actual user change */
    if(initializedUserRef.current === userId && ready) return;
    initializedUserRef.current = userId;

    const init = async () => {
      if (hasSupabase && user) {
        /* ── Logged in: load from cloud + merge with localStorage ── */
        const cloudData = await loadFromCloud();
        const localTasks = load(TASKS_KEY, []);
        const localLists = load(LISTS_KEY, DEFAULT_LISTS);
        const localTs = load("inkwell-data-ts", null);
        const hasPendingLocal = load(PENDING_SYNC_KEY, false);

        if (cloudData) {
          const cloudTs = cloudData.updated_at || "1970-01-01";
          const cloudTombs = cloudData.settings?._tombstones || [];

          if (hasPendingLocal || (localTs && localTs > cloudTs && localTasks.length > 0)) {
            /* Local data has unsynced changes — MERGE instead of overwrite */
            console.log("%c[Inkwell Sync] Merging local + cloud data","color:#d97706;font-weight:bold",
              "\n  localStorage:", localTs, "\n  cloud:", cloudTs, "\n  pending:", hasPendingLocal);
            const result = mergeTasks(localTasks, cloudData.tasks || [], tombstonesRef.current, cloudTombs);
            const mergedLists = mergeLists(localLists, cloudData.lists || DEFAULT_LISTS);

            setTasksRaw(result.tasks);
            setLists(mergedLists);
            tombstonesRef.current = result.tombstones;
            save(TOMBSTONES_KEY, result.tombstones);

            /* Apply cloud settings (they don't conflict — last-write-wins is fine for settings) */
            if (cloudData.settings) {
              if (cloudData.settings.showViewCounts !== undefined) setShowViewCounts(cloudData.settings.showViewCounts);
              if (cloudData.settings.showListCounts !== undefined) setShowListCounts(cloudData.settings.showListCounts);
      if (cloudData.settings.confirmSubtaskComplete !== undefined) setConfirmSubtaskComplete(cloudData.settings.confirmSubtaskComplete);
      if (cloudData.settings.frostMode !== undefined) setFrostMode(cloudData.settings.frostMode);
      if (cloudData.settings.archivedLists !== undefined) setArchivedLists(cloudData.settings.archivedLists);
              if (cloudData.settings.darkMode !== undefined) setDarkMode(cloudData.settings.darkMode);
              if (cloudData.settings.quickDates !== undefined) setQuickDates(cloudData.settings.quickDates);
              if (cloudData.settings.paperMode !== undefined) setPaperMode(cloudData.settings.paperMode);
              if (cloudData.settings.kanbanColumns !== undefined) {
                const today = todayStr();
                const cols = cloudData.settings.kanbanColumns;
                if (cols && Array.isArray(cols)) {
                  const fresh = cols.filter(c => !c.dateStr || c.dateStr >= today);
                  setKanbanColumns(fresh.length > 0 ? fresh : null);
                } else { setKanbanColumns(cols); }
              }
            }

            cloudLoadTimeRef.current = Date.now();
            cloudSyncReady.current = true;
            localDataVersion.current = new Date().toISOString();

            /* Save merged data to both localStorage and cloud */
            save(TASKS_KEY, result.tasks);
            save(LISTS_KEY, mergedLists);
            save("inkwell-data-ts", localDataVersion.current);
            save(PENDING_SYNC_KEY, false);
            hasPendingSync.current = false;

            const localSettings = {
              showViewCounts: load("inkwell-showViewCounts", true),
              showListCounts: load("inkwell-showListCounts", true),
              confirmSubtaskComplete: load("inkwell-confirmSubtaskComplete", true),
              darkMode: load("inkwell-darkMode", false),
              frostMode: load("inkwell-frostMode", false),
              archivedLists: load("inkwell-archivedLists", []),
              quickDates: load("inkwell-quickDates", defaultQuickDates),
              paperMode: load("inkwell-paperMode", false),
              kanbanColumns: null,
              _tombstones: result.tombstones
            };
            saveToCloudNow(result.tasks, mergedLists, localSettings);
          } else {
            /* Cloud is newer or same and no pending local changes — use cloud data (normal case) */
            applyCloudData(cloudData);
            cloudSyncReady.current = true;
            localDataVersion.current = cloudTs;
            save(PENDING_SYNC_KEY, false);
            hasPendingSync.current = false;
          }
        } else {
          /* Cloud load failed (network error / empty row / OFFLINE) — use localStorage.
             DO NOT enable cloud saves to prevent stale data from overwriting.
             Mark pending sync so next reconnection triggers a merge. */
          console.warn("[Inkwell Sync] Cloud load failed — using localStorage, cloud saves DISABLED until next successful sync");
          setTasksRaw(localTasks);
          setLists(localLists);
          cloudSyncReady.current = false; /* ← KEY: prevents stale overwrites */
          /* If we have tasks, mark pending so reconnect triggers merge */
          if (localTasks.length > 0) {
            hasPendingSync.current = true;
            save(PENDING_SYNC_KEY, true);
          }
        }
      } else {
        /* ── Not logged in: use localStorage only ── */
        setTasksRaw(load(TASKS_KEY, []));
        setLists(load(LISTS_KEY, DEFAULT_LISTS));
      }
      setReady(true);
    };
    init();
    console.log("%c Inkwell " + BUILD_VERSION + " ", "background:#d97706;color:white;font-weight:bold;border-radius:4px;padding:2px 8px;");
    const mob=window.innerWidth<768;setIsMobile(mob);if(mob)setSidebar(false);
    const fn=()=>{const m=window.innerWidth<768;setIsMobile(m);if(m)setSidebar(false);};
    window.addEventListener("resize",fn);
    /* Service worker: register + detect updates → force reload for fresh code */
    if("serviceWorker" in navigator){
      /* Force browser to check sw.js freshness every time (bypass HTTP cache) */
      navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).then(reg=>{
        reg.addEventListener("updatefound",()=>{
          const nw=reg.installing;
          if(!nw)return;
          nw.addEventListener("statechange",()=>{
            if(nw.state==="activated"&&navigator.serviceWorker.controller){
              /* New SW activated while we're running old code — reload to get fresh JS */
              window.location.reload();
            }
          });
        });
        /* Also proactively check for updates on every load */
        reg.update().catch(()=>{});
      }).catch(()=>{});
    }
    return()=>window.removeEventListener("resize",fn);
  },[user, hasSupabase, authLoading]);

  /* ── Merge-based sync function (used by tab-refocus AND reconnection) ── */
  const mergeSync = useCallback(async (source) => {
    if(!hasSupabase || !user || !ready) return;
    try {
      const cloudData = await loadFromCloud();
      if(!cloudData) return;

      /* Re-enable cloud saves if they were disabled */
      if(!cloudSyncReady.current) {
        console.log("%c[Inkwell Sync] Cloud reconnected — re-enabling cloud saves","color:#22c55e;font-weight:bold");
      }
      cloudSyncReady.current = true;

      const cloudTs = cloudData.updated_at || "1970-01-01";
      const localTs = localDataVersion.current || "1970-01-01";
      const hasPending = hasPendingSync.current;
      const cloudTombs = cloudData.settings?._tombstones || [];

      if (hasPending || localTs > cloudTs) {
        /* Local has unsynced changes — do a full merge */
        console.log(`%c[Inkwell Sync] Merge triggered (${source})`, "color:#d97706;font-weight:bold",
          "\n  local:", localTs, "\n  cloud:", cloudTs, "\n  pending:", hasPending);
        const localTasks = tasksRef.current;
        const localLists = listsRef.current;
        const result = mergeTasks(localTasks, cloudData.tasks || [], tombstonesRef.current, cloudTombs);
        const mergedLists = mergeLists(localLists, cloudData.lists || DEFAULT_LISTS);

        cloudLoadTimeRef.current = Date.now();
        setTasksRaw(result.tasks);
        setLists(mergedLists);
        tombstonesRef.current = result.tombstones;
        save(TOMBSTONES_KEY, result.tombstones);

        const mergeTs = new Date().toISOString();
        save(TASKS_KEY, result.tasks);
        save(LISTS_KEY, mergedLists);
        save("inkwell-data-ts", mergeTs);
        save(PENDING_SYNC_KEY, false);
        hasPendingSync.current = false;
        localDataVersion.current = mergeTs;

        /* Push merged result to cloud */
        const mergedSettings = { ...settingsRef.current, _tombstones: result.tombstones };
        saveToCloudNow(result.tasks, mergedLists, mergedSettings);

        /* Count changes for user feedback */
        const localSet = new Set(localTasks.map(t=>t.id));
        const cloudSet = new Set((cloudData.tasks||[]).map(t=>t.id));
        const newFromCloud = [...cloudSet].filter(id => !localSet.has(id)).length;
        if (newFromCloud > 0 || hasPending) {
          flash(hasPending ? "Changes synced ✓" : `Synced ${newFromCloud} new task${newFromCloud!==1?"s":""}`);
        }
      } else if (cloudTs > localTs) {
        /* Cloud is newer and we have no pending changes — apply cloud data */
        applyCloudData(cloudData);
        localDataVersion.current = cloudTs;
        save(PENDING_SYNC_KEY, false);
        hasPendingSync.current = false;
      }
      /* If timestamps are equal and no pending, nothing to do */
    } catch(e) { /* network error — keep local state */ }
  }, [user, hasSupabase, ready, loadFromCloud, applyCloudData, saveToCloudNow, flash]);

  /* ── Sync from cloud when tab regains focus ── */
  useEffect(()=>{
    if(!hasSupabase || !user) return;
    const syncOnFocus = () => {
      if(!document.hidden && ready) mergeSync("tab-focus");
    };
    document.addEventListener("visibilitychange", syncOnFocus);
    return () => document.removeEventListener("visibilitychange", syncOnFocus);
  },[user, hasSupabase, ready, mergeSync]);

  /* ── Online/offline detection + reconnection sync ── */
  useEffect(()=>{
    const onOnline = () => {
      setIsOnline(true);
      console.log("%c[Inkwell] Back online","color:#22c55e;font-weight:bold");
      /* Debounce reconnection to avoid rapid on/off/on */
      setTimeout(() => {
        if(navigator.onLine) mergeSync("reconnect");
      }, 1500);
    };
    const onOffline = () => {
      setIsOnline(false);
      console.log("%c[Inkwell] Offline","color:#ef4444;font-weight:bold");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  },[mergeSync]);

  /* ── Periodic sync retry — catches missed reconnect events & flaky wifi ── */
  useEffect(()=>{
    if(!hasSupabase || !user || !ready) return;
    const interval = setInterval(() => {
      if(navigator.onLine && hasPendingSync.current) {
        console.log("%c[Inkwell Sync] Periodic retry — pending changes found","color:#d97706");
        mergeSync("periodic-retry");
      }
    }, 30000); /* Check every 30 seconds */
    return () => clearInterval(interval);
  },[hasSupabase, user, ready, mergeSync]);

  /* ── Refs for latest values (prevent stale closures in save effects) ── */
  const tasksRef=useRef(tasks);const listsRef=useRef(lists);
  const settingsRef=useRef({showViewCounts,showListCounts,confirmSubtaskComplete,darkMode,frostMode,archivedLists,quickDates,paperMode,kanbanColumns});
  useEffect(()=>{tasksRef.current=tasks;},[tasks]);
  useEffect(()=>{listsRef.current=lists;},[lists]);
  useEffect(()=>{settingsRef.current={showViewCounts,showListCounts,confirmSubtaskComplete,darkMode,frostMode,archivedLists,quickDates,paperMode,kanbanColumns};},[showViewCounts,showListCounts,confirmSubtaskComplete,darkMode,frostMode,archivedLists,quickDates,paperMode,kanbanColumns]);

  /* ── Save on every USER edit ── */
  useEffect(()=>{
    if(!ready) return;
    if(Date.now() - cloudLoadTimeRef.current < 2000) return;
    save(TASKS_KEY,tasks);
    /* Update localStorage timestamp for cross-reload comparison */
    const ts = new Date().toISOString();
    save("inkwell-data-ts", ts);
    localDataVersion.current = ts;
    /* Only push to cloud if we've successfully loaded from cloud first AND we're online */
    if(cloudSyncReady.current && navigator.onLine) {
      const settings = { ...settingsRef.current, _tombstones: tombstonesRef.current };
      saveToCloud(tasks,listsRef.current,settings);
    } else if (hasSupabase && user) {
      /* Offline or not cloud-ready — mark pending sync for later merge */
      hasPendingSync.current = true;
      save(PENDING_SYNC_KEY, true);
    }
  },[tasks,ready]);
  useEffect(()=>{
    if(!ready) return;
    if(Date.now() - cloudLoadTimeRef.current < 2000) return;
    save(LISTS_KEY,lists);
    const ts = new Date().toISOString();
    save("inkwell-data-ts", ts);
    localDataVersion.current = ts;
    if(cloudSyncReady.current && navigator.onLine) {
      const settings = { ...settingsRef.current, _tombstones: tombstonesRef.current };
      saveToCloud(tasksRef.current,lists,settings);
    } else if (hasSupabase && user) {
      hasPendingSync.current = true;
      save(PENDING_SYNC_KEY, true);
    }
  },[lists,ready]);

  /* ── Save settings changes to cloud ── */
  useEffect(()=>{
    if(!ready) return;
    if(cloudSyncReady.current && navigator.onLine) {
      const settings = { ...({showViewCounts,showListCounts,confirmSubtaskComplete,darkMode,frostMode,archivedLists,quickDates,paperMode,kanbanColumns}), _tombstones: tombstonesRef.current };
      saveToCloud(tasksRef.current,listsRef.current,settings);
    }
  },[showViewCounts,showListCounts,confirmSubtaskComplete,darkMode,frostMode,archivedLists,quickDates,paperMode,kanbanColumns]);

  /* ── Flush to cloud on tab hide AND page unload ── */
  useEffect(()=>{
    const flushOnHide=()=>{
      if(document.hidden&&ready&&cloudSyncReady.current&&navigator.onLine){
        const settings = { ...settingsRef.current, _tombstones: tombstonesRef.current };
        saveToCloudNow(tasksRef.current,listsRef.current,settings);
      }
    };
    const flushOnUnload=()=>{
      if(!ready) return;
      /* ── SYNCHRONOUS localStorage backup (instant, survives any crash/reload) ── */
      try {
        save(TASKS_KEY, tasksRef.current);
        save(LISTS_KEY, listsRef.current);
        save(TOMBSTONES_KEY, tombstonesRef.current);
        save("inkwell-data-ts", new Date().toISOString());
      } catch(e) { /* best effort */ }
      /* ── ALSO send keepalive fetch if cloud sync is ready AND online ── */
      if(cloudSyncReady.current && navigator.onLine){
        const settings = { ...settingsRef.current, _tombstones: tombstonesRef.current };
        flushToCloudKeepalive(tasksRef.current,listsRef.current,settings);
      }
    };
    document.addEventListener("visibilitychange",flushOnHide);
    window.addEventListener("beforeunload",flushOnUnload);
    return()=>{document.removeEventListener("visibilitychange",flushOnHide);window.removeEventListener("beforeunload",flushOnUnload);};
  },[ready,saveToCloudNow,flushToCloudKeepalive]);
  useEffect(()=>{if(selectedTask){const u=tasks.find(t=>t.id===selectedTask.id);if(u)setSelectedTask(u);else setSelectedTask(null);}},[tasks]);

  /* ═══ UNDO / REDO ═══ */
  const historyRef = useRef({ stack: [], idx: -1, skip: false });
  useEffect(() => {
    if(!ready) return;
    const h = historyRef.current;
    if(h.skip) { h.skip = false; return; }
    /* Snapshot tasks — truncate any future states, push new */
    const snapshot = JSON.stringify(tasks);
    /* Dedupe: don't push if identical to current */
    if(h.idx >= 0 && h.stack[h.idx] === snapshot) return;
    h.stack = h.stack.slice(0, h.idx + 1);
    h.stack.push(snapshot);
    if(h.stack.length > 50) h.stack.shift(); /* cap memory */
    h.idx = h.stack.length - 1;
  }, [tasks, ready]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if(h.idx <= 0) return;
    h.idx--;
    h.skip = true;
    setTasksRaw(JSON.parse(h.stack[h.idx]));
    flash("Undone");
  }, []);
  const redo = useCallback(() => {
    const h = historyRef.current;
    if(h.idx >= h.stack.length - 1) return;
    h.idx++;
    h.skip = true;
    setTasksRaw(JSON.parse(h.stack[h.idx]));
    flash("Redone");
  }, []);

  /* Bulk operations */
  const bulkDelete=()=>{
    const ids=[...selectedIds];
    const snapshot=tasks.filter(t=>ids.includes(t.id));
    addTombstones(ids);
    setTasks(prev=>prev.filter(t=>!selectedIds.has(t.id)));
    setSelectedIds(new Set());
    setSelectedTask(null);
    undoToast.show(`Deleted ${ids.length} task${ids.length!==1?"s":""}`, () => {
      tombstonesRef.current = tombstonesRef.current.filter(x => !ids.includes(x.id));
      save(TOMBSTONES_KEY, tombstonesRef.current);
      setTasksRaw(prev => [...snapshot, ...prev]);
    });
  };
  const bulkMove=(listName)=>{setTasks(prev=>prev.map(t=>selectedIds.has(t.id)?{...t,list:listName}:t));flash(`Moved ${selectedIds.size} tasks to ${listName}`);setSelectedIds(new Set());};
  const bulkPriority=(p)=>{setTasks(prev=>prev.map(t=>selectedIds.has(t.id)?{...t,priority:p}:t));flash(`Set ${selectedIds.size} tasks to ${PRIORITY[p].label}`);setSelectedIds(new Set());};
  const bulkComplete=()=>{setTasks(prev=>prev.map(t=>{
    if(!selectedIds.has(t.id))return t;
    const subs=completeAllSubs(t.subtasks);
    if(t.recurrence){
      const r=t.recurrence;const newCount=(r.completedCount||0)+1;
      if(r.endAfter&&newCount>=r.endAfter)return{...t,completed:true,completedAt:new Date().toISOString(),subtasks:subs,recurrence:{...r,completedCount:newCount}};
      const nextDate=advanceRecurrenceDate(t.dueDate,r.frequency,r.interval||1);
      return{...t,completed:false,completedAt:null,dueDate:nextDate,subtasks:subs,recurrence:{...r,completedCount:newCount}};
    }
    return{...t,completed:true,completedAt:new Date().toISOString(),subtasks:subs};
  }));flash(`Completed ${selectedIds.size} tasks`);setSelectedIds(new Set());};





  const addTask=useCallback(data=>{
    const task={id:uid(),title:data.title||"Untitled",completed:data.completed||false,dueDate:data.dueDate||todayStr(),startDate:data.startDate||null,endDate:data.endDate||null,priority:data.priority||"none",list:data.list||(view.startsWith("list:")?view.replace("list:",""):"Inbox"),subtasks:data.subtasks||[],notes:data.notes||"",tags:data.tags||[],recurrence:data.recurrence||null,createdAt:new Date().toISOString(),completedAt:data.completed?new Date().toISOString():null};
    setTasks(prev=>[task,...prev]);return task;
  },[view]);

  const updateTask=useCallback(updated=>{setTasks(prev=>prev.map(t=>t.id===updated.id?updated:t));},[]);
  const [animatingTasks,setAnimatingTasks]=useState({}); /* {taskId: "complete"|"uncomplete"} */

  /* Smooth list reflow — View Transitions when available (rows carry a
     viewTransitionName), plain state update otherwise */
  const withReflow = useCallback((fn) => {
    try {
      if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        document.startViewTransition(fn);
        return;
      }
    } catch(e) {}
    fn();
  }, []);

  /* Helper: actually complete a task (and optionally all its subtasks) */
  const doCompleteTask = useCallback((id, withSubs) => {
    lastCompletionAtRef.current = Date.now();
    withReflow(()=>setTasks(prev=>prev.map(t=>{
      if(t.id!==id) return t;

      /* Recurring task logic */
      if(t.recurrence) {
        const r = t.recurrence;
        const newCount = (r.completedCount || 0) + 1;
        const subs = withSubs ? completeAllSubs(t.subtasks) : t.subtasks;
        if(r.endAfter && newCount >= r.endAfter) {
          return {...t, completed:true, completedAt:new Date().toISOString(), subtasks:subs, recurrence:{...r, completedCount:newCount}};
        }
        const nextDate = advanceRecurrenceDate(t.dueDate, r.frequency, r.interval || 1);
        return {...t, completed:false, completedAt:null, dueDate:nextDate, subtasks:subs, recurrence:{...r, completedCount:newCount}};
      }

      /* Normal task */
      return {...t, completed:true, completedAt:new Date().toISOString(), subtasks:withSubs ? completeAllSubs(t.subtasks) : t.subtasks};
    })));
    /* Animation */
    setAnimatingTasks(prev=>({...prev, [id]: "complete"}));
    setTimeout(()=>setAnimatingTasks(prev=>{const n={...prev};delete n[id];return n;}), 900);
    /* Flash for recurring */
    const task = tasks.find(t=>t.id===id);
    if(task?.recurrence) {
      const r = task.recurrence;
      const newCount = (r.completedCount||0)+1;
      flash(r.endAfter && newCount >= r.endAfter ? "All recurrences completed ✓" : "Done! Next occurrence scheduled →");
    }
    /* ── Streak + confetti easter egg — suppressed in Paper Mode (the reward
       for finishing tasks belongs on the page, not in the app) ── */
    if (!paperMode) {
      completionStreakRef.current += 1;
      if (completionStreakRef.current >= 10) {
        completionStreakRef.current = 0;
        setConfettiTrigger(n => n + 1);
        flash("✨ 10-task streak — magnificent!");
      }
    }
    /* Quill-mode ink spatter from element position */
    if (quillMode) {
      const el = document.querySelector(`[data-task-id="${id}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        spatter(r.left + r.width * 0.1, r.top + r.height / 2);
      }
    }
  },[tasks,flash,quillMode,spatter,paperMode,withReflow]);

  const toggleTask=useCallback(id=>{
    const task = tasks.find(t=>t.id===id);
    if(!task) return;

    const nowComplete = !task.completed;

    /* ── Uncompleting — always straightforward ── */
    if(!nowComplete) {
      withReflow(()=>setTasks(prev=>prev.map(t=>t.id!==id?t:{...t,completed:false,completedAt:null})));
      setAnimatingTasks(prev=>({...prev, [id]: "uncomplete"}));
      setTimeout(()=>setAnimatingTasks(prev=>{const n={...prev};delete n[id];return n;}), 900);
      return;
    }

    /* ── Completing — check for open subtasks ── */
    if(hasOpenSubs(task.subtasks)) {
      if(confirmSubRef.current) {
        /* Show confirmation modal */
        setPendingCompleteId(id);
        return;
      }
      /* Auto-complete all subtasks */
      doCompleteTask(id, true);
      return;
    }

    /* No open subtasks — complete normally */
    doCompleteTask(id, false);
  },[tasks,doCompleteTask,withReflow]);

  /* Modal handlers */
  const confirmPendingComplete = useCallback(()=>{
    if(pendingCompleteId) doCompleteTask(pendingCompleteId, true);
    setPendingCompleteId(null);
  },[pendingCompleteId,doCompleteTask]);
  const cancelPendingComplete = useCallback(()=>{
    setPendingCompleteId(null);
  },[]);
  const deleteTask=useCallback(id=>{
    const deleted=tasksRef.current.find(t=>t.id===id);
    addTombstone(id);
    setTasks(prev=>prev.filter(t=>t.id!==id));
    if(selectedTask?.id===id)setSelectedTask(null);
    if(deleted) undoToast.show(`Deleted "${deleted.title}"`, () => {
      tombstonesRef.current = tombstonesRef.current.filter(x => x.id !== id);
      save(TOMBSTONES_KEY, tombstonesRef.current);
      setTasksRaw(prev => [deleted, ...prev]);
    });
  },[selectedTask,addTombstone,undoToast]);

  /* Snooze — the single sanctioned "push it out" gesture. Stamps snoozedFrom
     so the task can show a "resurfaced" badge when its day arrives. */
  const snoozeTask=useCallback((task,dateStr)=>{
    setTasks(prev=>prev.map(t=>t.id===task.id?{...t,dueDate:dateStr,snoozedFrom:todayStr()}:t));
    flash(`💤 Snoozed until ${formatDate(dateStr)} — it'll be back on Today`);
  },[]);

  const renameList=useCallback((oldN,newN)=>{if(!newN.trim()||newN===oldN||lists.includes(newN))return;setLists(prev=>prev.map(l=>l===oldN?newN:l));setTasks(prev=>prev.map(t=>t.list===oldN?{...t,list:newN}:t));if(view===`list:${oldN}`)setView(`list:${newN}`);},[lists,view]);
  const deleteList=useCallback((name)=>{if(name==="Inbox")return;const ct=tasks.filter(t=>t.list===name).length;if(ct>0&&!confirm(`"${name}" has ${ct} task${ct>1?"s":""}. They'll be moved to Inbox. Continue?`))return;setTasks(prev=>prev.map(t=>t.list===name?{...t,list:"Inbox"}:t));setLists(prev=>prev.filter(l=>l!==name));if(view===`list:${name}`)setView("all");flash(`Deleted list "${name}"`);},[tasks,view,flash]);
  const archiveList=useCallback((name)=>{if(name==="Inbox")return;setLists(prev=>prev.filter(l=>l!==name));setArchivedLists(prev=>[...prev,name]);if(view===`list:${name}`)setView("all");flash(`Archived "${name}"`);},[view,flash]);
  const restoreList=useCallback((name)=>{setArchivedLists(prev=>prev.filter(l=>l!==name));setLists(prev=>[...prev,name]);flash(`Restored "${name}"`);},[flash]);
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
      /* Circular reference: promote the target subtask to a top-level task instead */
      if(isDescendant(dragTask.subtasks, overTask.id)){
        setTasks(prev=>{
          /* Find and extract the target subtask from the dragged task's tree */
          let sub = null;
          for(const t of prev){ sub = findSubById(t.subtasks, overTask.id); if(sub) break; }
          if(!sub){setDragTask(null);setDropTarget(null);return prev;}
          const cleaned = prev.map(t=>({...t, subtasks: removeSubById(t.subtasks||[], overTask.id)}));
          const promoted = {id:sub.id,title:sub.title,completed:sub.completed||false,dueDate:sub.dueDate||todayStr(),startDate:sub.startDate||null,endDate:sub.endDate||null,priority:sub.priority||"none",list:dragTask.list||"Inbox",subtasks:sub.subtasks||[],notes:sub.notes||"",tags:sub.tags||[],createdAt:new Date().toISOString(),completedAt:sub.completed?new Date().toISOString():null};
          return [promoted,...cleaned];
        });
        flash(`Promoted "${overTask.title}" to task`);setDragTask(null);setDropTarget(null);return;
      }
      if(isSubSource(src)){
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
      if(isSubSource(src)){
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
    if(tid&&(isSubSource(src))){
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

    if (dropType === "trash") {
      if (isSubSource(dragSource)) {
        setTasks(prev => prev.map(t => ({...t, subtasks: deleteSubById(t.subtasks||[], dragId)})));
        flash("Subtask deleted");
      } else {
        addTombstone(dragId);
        setTasks(prev => prev.filter(t => t.id !== dragId));
        if (selectedTask?.id === dragId) setSelectedTask(null);
        flash("Task deleted");
      }
      return;
    }

    if (dropType === "date" && dropValue) {
      if (isSubSource(dragSource)) {
        setTasks(prev => prev.map(t => {
          const found = findSubById(t.subtasks, dragId);
          if (!found) return t;
          /* If dropping back on parent's date, clear dueDate to re-nest */
          const newDate = t.dueDate === dropValue ? null : dropValue;
          return {...t, subtasks: updateSubById(t.subtasks, dragId, {dueDate: newDate})};
        }));
        flash((() => { for (const t of tasks) { if (findSubById(t.subtasks, dragId) && t.dueDate === dropValue) return "Subtask rejoined parent"; } return "Subtask due date updated"; })());
      } else {
        setTasks(prev => prev.map(t => t.id === dragId ? {...t, dueDate: dropValue} : t));
        flash(`Due date set to ${formatDate(dropValue)}`);
      }
    } else if (dropType === "list" && dropValue) {
      if (isSubSource(dragSource)) {
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
        /* Circular reference: promote the target subtask instead of blocking */
        const dragTask = tasks.find(t => t.id === dragId);
        if(dragTask && isDescendant(dragTask.subtasks, dropValue)){
          setTasks(prev=>{
            let sub = null;
            for(const t of prev){ sub = findSubById(t.subtasks, dropValue); if(sub) break; }
            if(!sub) return prev;
            const cleaned = prev.map(t=>({...t, subtasks: removeSubById(t.subtasks||[], dropValue)}));
            const promoted = {id:sub.id,title:sub.title,completed:sub.completed||false,dueDate:sub.dueDate||todayStr(),startDate:sub.startDate||null,endDate:sub.endDate||null,priority:sub.priority||"none",list:dragTask.list||"Inbox",subtasks:sub.subtasks||[],notes:sub.notes||"",tags:sub.tags||[],createdAt:new Date().toISOString(),completedAt:sub.completed?new Date().toISOString():null};
            return [promoted,...cleaned];
          });
          flash(`Promoted "${overTask.title}" to task`);return;
        }
        if (isSubSource(dragSource)) {
          const sub = (() => { let s = null; for (const t of tasks) { s = findSubById(t.subtasks, dragId); if (s) return s; } return null; })();
          if(sub && isDescendant(sub.subtasks, dropValue)){
            /* Subtask being dropped onto its own descendant — promote the descendant */
            setTasks(prev=>{
              let target = null;
              for(const t of prev){ target = findSubById(t.subtasks, dropValue); if(target) break; }
              if(!target) return prev;
              const cleaned = prev.map(t=>({...t, subtasks: removeSubById(t.subtasks||[], dropValue)}));
              const promoted = {id:target.id,title:target.title,completed:target.completed||false,dueDate:target.dueDate||todayStr(),startDate:target.startDate||null,endDate:target.endDate||null,priority:target.priority||"none",list:"Inbox",subtasks:target.subtasks||[],notes:target.notes||"",tags:target.tags||[],createdAt:new Date().toISOString(),completedAt:target.completed?new Date().toISOString():null};
              return [promoted,...cleaned];
            });
            flash(`Promoted to task`);return;
          }
          setTasks(prev => {
            let arr = prev.map(t => ({...t, subtasks: removeSubById(t.subtasks||[], dragId)}));
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


  const handleScan=async(b64,mt)=>{if(!navigator.onLine){setScanError("You're offline. Scanning requires an internet connection — try again when you're back online.");flash("⚠ Can't scan while offline");return;}setProcessing(true);setScanError(null);try{const res=await fetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({imageData:b64,mediaType:mt,existingTasks:tasks.map(t=>t.title),existingLists:lists,todayDate:todayStr()})});if(!res.ok){let errMsg="Scan failed ("+res.status+")";try{const err=await res.json();errMsg=err.error||errMsg;}catch(_){}throw new Error(errMsg);}const results=await res.json();setShowPhoto(false);setScanResults(results);}catch(e){const msg=e.message||"Unknown error";setScanError(msg);flash("⚠ "+msg);}setProcessing(false);};

  const confirmScan=items=>{let added=0,checked=0;const pageDate=scanResults?.page_date;const newCats=new Set();items.forEach(it=>{if(it.category?.trim()&&!lists.includes(it.category.trim()))newCats.add(it.category.trim());});if(newCats.size>0)setLists(prev=>[...prev,...Array.from(newCats)]);const all=[...lists,...Array.from(newCats)];
    /* Convert scanned subtask tree to app format */
    const convertSubs=(subs)=>(subs||[]).map(s=>({id:uid(),title:s.title,completed:s.completed||false,dueDate:null,startDate:null,endDate:null,priority:"none",notes:"",tags:[],subtasks:convertSubs(s.subtasks)}));
    items.forEach(item=>{if(item.is_duplicate_of){const ex=tasks.find(t=>t.title.toLowerCase().trim()===item.is_duplicate_of.toLowerCase().trim());if(ex&&item.completed&&!ex.completed){updateTask({...ex,completed:true,completedAt:new Date().toISOString()});checked++;return;}if(ex)return;}const tl=item.category&&all.includes(item.category.trim())?item.category.trim():"Inbox";addTask({title:item.title,completed:item.completed,dueDate:item.date||pageDate||todayStr(),list:tl,priority:item.priority==="high"?"high":"none",subtasks:convertSubs(item.subtasks)});added++;});
    setScanResults(null);const lm=newCats.size>0?`, created ${newCats.size} list${newCats.size!==1?"s":""}`:""
    flash(`✓ Added ${added} task${added!==1?"s":""}${checked?`, checked off ${checked}`:""}${lm}`);};

  const PRIO_ORDER={high:0,medium:1,low:2,none:3};
  const applySortFilter=useMemo(()=>{
    return (arr)=>{
      let f=filterPriority==="all"?arr:arr.filter(t=>(t.priority||"none")===filterPriority);
      const inc=f.filter(t=>!t.completed);
      const comp=f.filter(t=>t.completed);
      if(sortBy!=="default"){
        inc.sort((a,b)=>{
          if(sortBy==="priority") return (PRIO_ORDER[a.priority||"none"]??3)-(PRIO_ORDER[b.priority||"none"]??3);
          if(sortBy==="alpha") return (a.title||"").localeCompare(b.title||"");
          if(sortBy==="date") return (a.dueDate||"9999").localeCompare(b.dueDate||"9999");
          if(sortBy==="created") return (b.createdAt||"").localeCompare(a.createdAt||"");
          return 0;
        });
      }
      return [...inc,...comp.sort((a,b)=>(b.completedAt||"").localeCompare(a.completedAt||""))];
    };
  },[sortBy,filterPriority]);

  const filtered=useMemo(()=>{let f=tasks;
    /* Hide tasks from archived lists (unless explicitly viewing that list) */
    if(!view.startsWith("list:") || !archivedLists.includes(view.replace("list:","")))
      f=f.filter(t=>!archivedLists.includes(t.list));
    if(search){const q=search.toLowerCase();f=f.filter(t=>t.title.toLowerCase().includes(q)||(t.notes||"").toLowerCase().includes(q)||(t.tags||[]).some(tg=>tg.toLowerCase().includes(q)));}
    else{switch(view){case"today":f=f.filter(t=>t.dueDate===todayStr()||(!t.dueDate&&t.createdAt?.startsWith(todayStr()))||(paperMode&&!t.completed&&t.dueDate&&t.dueDate<todayStr()));break;case"overdue":f=f.filter(t=>!t.completed&&t.dueDate&&t.dueDate<todayStr());if(sortBy==="default")f.sort((a,b)=>(a.dueDate||"").localeCompare(b.dueDate||""));break;case"upcoming":f=f.filter(t=>!t.completed&&t.dueDate&&t.dueDate>=todayStr());if(sortBy==="default")f.sort((a,b)=>(a.dueDate||"").localeCompare(b.dueDate||""));break;case"all":break;case"completed":return applySortFilter(f.filter(t=>t.completed));case"inbox":f=f.filter(t=>t.list==="Inbox");break;default:if(view.startsWith("list:"))f=f.filter(t=>t.list===view.replace("list:",""));}}
    /* Today view: apply list multi-select filter if active */
    if(view==="today" && todayListFilter.size > 0){f=f.filter(t=>todayListFilter.has(t.list));}
    const result=applySortFilter(f);
    /* Surface subtasks with their own due dates in Today/Upcoming views */
    if(view==="today"||view==="upcoming"){
      const dated=collectDatedSubtasks(tasks);
      const surfaced=dated.filter(ds=>{
        if(ds.parentTask.dueDate===ds.sub.dueDate) return false;
        if(view==="today" && todayListFilter.size > 0 && !todayListFilter.has(ds.parentTask.list)) return false;
        if(view==="today") return ds.sub.dueDate===todayStr();
        return ds.sub.dueDate&&ds.sub.dueDate>=todayStr();
      }).map(ds=>({...ds.sub, _surfacedSub:true, _parentTask:ds.parentTask, _breadcrumb:ds.breadcrumb, list:ds.parentTask.list}));
      const firstCompleted=result.findIndex(t=>t.completed);
      const insertAt=firstCompleted===-1?result.length:firstCompleted;
      result.splice(insertAt,0,...surfaced);
    }
    return result;
  },[tasks,view,search,sortBy,filterPriority,applySortFilter,archivedLists,currentDateStr,todayListFilter,paperMode]);

  const overdueCount=useMemo(()=>tasks.filter(t=>!t.completed&&isOverdue(t.dueDate)&&!archivedLists.includes(t.list)).length,[tasks,archivedLists,currentDateStr]);
  /* Auto-redirect from overdue view when all tasks resolved */
  useEffect(()=>{if(view==="overdue"&&overdueCount===0)setView("today");},[view,overdueCount]);
  const todayCount=useMemo(()=>{
    /* Paper Mode carries overdue tasks forward into Today, so count them there too */
    const direct=tasks.filter(t=>!t.completed&&!archivedLists.includes(t.list)&&(t.dueDate===todayStr()||(paperMode&&t.dueDate&&t.dueDate<todayStr()))).length;
    const subs=collectDatedSubtasks(tasks).filter(ds=>ds.sub.dueDate===todayStr()&&ds.parentTask.dueDate!==todayStr()&&!archivedLists.includes(ds.parentTask.list)).length;
    return direct+subs;
  },[tasks,archivedLists,currentDateStr,paperMode]);

  /* ═══ End-of-day flourish — fires once per day when the last Today task
     is completed (guarded to a completion within the last 1.5s so passive
     count changes — day rollover, sync — never trigger it) ═══ */
  const [dayClosed,setDayClosed]=useState(false);
  const prevTodayCountRef=useRef(null);
  useEffect(()=>{
    const prev=prevTodayCountRef.current;
    prevTodayCountRef.current=todayCount;
    if(prev===null||!ready) return;
    if(prev>0&&todayCount===0&&Date.now()-lastCompletionAtRef.current<1500){
      if(load("inkwell-day-closed",null)===todayStr()) return; /* once per day */
      save("inkwell-day-closed",todayStr());
      if(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches){ flash("That's everything for today ✓"); return; }
      setDayClosed(true);
      setTimeout(()=>setDayClosed(false),3400);
    }
  },[todayCount,ready]);

  /* Keyboard shortcuts — must be after filtered/bulkDelete definitions */
  useEffect(()=>{const h=e=>{
    /* Undo/Redo — works even in inputs */
    if((e.metaKey||e.ctrlKey)&&e.key==="z"&&!e.shiftKey){e.preventDefault();undo();return;}
    if((e.metaKey||e.ctrlKey)&&e.key==="z"&&e.shiftKey){e.preventDefault();redo();return;}
    if((e.metaKey||e.ctrlKey)&&e.key==="y"){e.preventDefault();redo();return;}
    if(["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName))return;if(e.key==="n"&&!e.metaKey){e.preventDefault();document.getElementById("quick-add")?.focus();}if(e.key==="/"||((e.metaKey||e.ctrlKey)&&e.key==="f")){e.preventDefault();setShowSearch(true);}if(e.key==="b"&&!e.metaKey&&!e.ctrlKey){setSidebar(s=>!s);}if(e.key==="?")setShowShortcuts(s=>!s);if(e.key==="Escape"){setShowSearch(false);setSearch("");setSelectedTask(null);setShowShortcuts(false);setShowTips(null);setSelectedIds(new Set());}if(e.key==="a"&&(e.metaKey||e.ctrlKey)){e.preventDefault();setSelectedIds(new Set(filtered.map(t=>t.id)));}if((e.key==="Delete"||e.key==="Backspace")&&selectedIds.size>0&&!e.metaKey){bulkDelete();}};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);},[filtered,selectedIds,undo,redo]);
  const titles={today:"Today",overdue:"Overdue",upcoming:"Upcoming",all:"All Tasks",completed:"Completed",inbox:"Inbox",calendar:"Calendar"};
  const iconsMap={today:Icons.today,overdue:Icons.overdue,upcoming:Icons.upcoming,all:Icons.all,completed:Icons.done,inbox:Icons.inbox,calendar:Icons.calendar};
  const viewTitle=titles[view]||(view.startsWith("list:")?view.replace("list:",""):"Tasks");
  const viewIcon=iconsMap[view]||Icons.all;
  const selectView=v=>{setView(v);setSelectedTask(null);setSearch("");setShowSortMenu(false);if(isMobile)setSidebar(false);};

  /* Auth gate: show login if Supabase is configured but user isn't signed in */
  if (hasSupabase && authLoading) return <div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-display)",fontSize:22,color:"var(--muted)"}}>Loading...</div>;
  if (hasSupabase && !user) return <LoginScreen onSignIn={signInWithEmail} onSignInPassword={signInWithPassword} error={authError}/>;

  if(!ready)return<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-display)",fontSize:22,color:"var(--muted)"}}>Loading...</div>;

  return (
    <div className={`${frostMode?(darkMode?"theme-frost-dark":"theme-frost-light"):(darkMode?"theme-dark":"theme-light")}${quillMode?" quill-mode":""}${midnightActive?" midnight":""}${paperUI?" paper-journal":""}`} style={{height:"100dvh",display:"flex",overflow:"hidden",backgroundColor:"var(--bg)",backgroundImage:"var(--paper-noise)",color:"var(--ink)",fontFamily:"var(--font-body)"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&family=Source+Sans+3:wght@300;400;500;600;700&display=swap');
        :root{--font-display:'Fraunces','Playfair Display',Georgia,serif;--font-body:'Inter Tight','Source Sans 3',-apple-system,sans-serif;--font-mono:'JetBrains Mono',ui-monospace,Consolas,monospace;}
        .theme-light{--ink:#222941;--text:#464b63;--muted:#7b7968;--bg:#faf7f0;--surface:#f2ece0;--border:#e4ddd0;--border-light:#eee5d4;--active-bg:#fdf4e3;--accent:#a8642e;--accent-dark:#8a5426;--accent-bg:#fdf4e3;--accent2:#c98a45;--card:#fffcf5;--card-hover:#f7f1e3;--overlay:rgba(26,34,56,0.48);--danger-bg:#fbecec;--danger-border:#f2c7c7;--danger:#b85454;--success-bg:rgba(46,139,87,0.14);--shadow:rgba(26,34,56,0.08);--shadow-strong:rgba(26,34,56,0.16);--accent-a04:rgba(168,100,46,0.04);--accent-a06:rgba(168,100,46,0.06);--accent-a08:rgba(168,100,46,0.08);--accent-a10:rgba(168,100,46,0.1);--accent-a12:rgba(168,100,46,0.12);--accent-a15:rgba(168,100,46,0.15);--accent-a18:rgba(168,100,46,0.18);--accent-a20:rgba(168,100,46,0.2);--accent-a30:rgba(168,100,46,0.3);--depth0:#92400e;--depth1:#a16207;--depth2:#78350f;--depth3:#5b2d0c;--depth0-bg:rgba(168,100,46,0.06);--depth1-bg:rgba(194,125,44,0.07);--depth2-bg:rgba(202,138,4,0.06);--offline-bg:linear-gradient(90deg,#fef3c7,#fde68a);--offline-border:#b45309;--offline-text:#78350f;--paper-noise:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='7'/><feColorMatrix values='0 0 0 0 0.25  0 0 0 0 0.20  0 0 0 0 0.15  0 0 0 0.04 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");}
        .theme-dark{--ink:#f5efe1;--text:#d8cfbb;--muted:#9a8f77;--bg:#14110d;--surface:#1d1812;--border:#3a2f22;--border-light:#28211a;--active-bg:#3a2a12;--accent:#e0a24e;--accent-dark:#ecc069;--accent-bg:#3a2a12;--accent2:#ecc069;--card:#231d15;--card-hover:#14110d;--overlay:rgba(0,0,0,0.62);--danger-bg:#3a1616;--danger-border:#6b2424;--danger:#e39191;--success-bg:rgba(46,139,87,0.14);--shadow:rgba(0,0,0,0.4);--shadow-strong:rgba(0,0,0,0.55);--accent-a04:rgba(224,162,78,0.04);--accent-a06:rgba(224,162,78,0.06);--accent-a08:rgba(224,162,78,0.08);--accent-a10:rgba(224,162,78,0.1);--accent-a12:rgba(224,162,78,0.12);--accent-a15:rgba(224,162,78,0.15);--accent-a18:rgba(224,162,78,0.18);--accent-a20:rgba(224,162,78,0.2);--accent-a30:rgba(224,162,78,0.3);--depth0:#fbbf24;--depth1:#f59e0b;--depth2:#d97706;--depth3:#b45309;--depth0-bg:rgba(224,162,78,0.06);--depth1-bg:rgba(224,162,78,0.07);--depth2-bg:rgba(224,162,78,0.06);--offline-bg:linear-gradient(90deg,#3a2a12,#5b3a14);--offline-border:#f59e0b;--offline-text:#fbbf24;--paper-noise:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='7'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 0.85  0 0 0 0 0.6  0 0 0 0.04 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");}
        .theme-frost-light{--ink:#1e293b;--text:#334155;--muted:#7b8fa3;--bg:#f0f4f8;--surface:#e2eaf3;--border:#c8d6e5;--border-light:#dde7f0;--active-bg:#eff6ff;--accent:#6292d8;--accent-dark:#4a7bc4;--accent-bg:#eff6ff;--accent2:#57a9d4;--card:#ffffff;--card-hover:#f0f4f8;--overlay:rgba(15,30,55,0.45);--danger-bg:#fef2f2;--danger-border:#fecaca;--danger:#d97070;--success-bg:rgba(34,197,94,0.15);--shadow:rgba(0,0,0,0.06);--shadow-strong:rgba(15,30,55,0.14);--accent-a04:rgba(98,146,216,0.04);--accent-a06:rgba(98,146,216,0.06);--accent-a08:rgba(98,146,216,0.08);--accent-a10:rgba(98,146,216,0.1);--accent-a12:rgba(98,146,216,0.12);--accent-a15:rgba(98,146,216,0.15);--accent-a18:rgba(98,146,216,0.18);--accent-a20:rgba(98,146,216,0.2);--accent-a30:rgba(98,146,216,0.3);--depth0:#2563eb;--depth1:#1d4ed8;--depth2:#1e40af;--depth3:#1e3a8a;--depth0-bg:rgba(98,146,216,0.06);--depth1-bg:rgba(98,146,216,0.07);--depth2-bg:rgba(98,146,216,0.06);--offline-bg:linear-gradient(90deg,#dbeafe,#bfdbfe);--offline-border:#3b82f6;--offline-text:#1e40af;}
        .theme-frost-dark{--ink:#e2eaf3;--text:#b0c4d8;--muted:#6b839b;--bg:#0c1220;--surface:#131d2e;--border:#1e2d42;--border-light:#182538;--active-bg:rgba(98,146,216,0.1);--accent:#84aede;--accent-dark:#a8c6e8;--accent-bg:rgba(98,146,216,0.12);--accent2:#7cb8d9;--card:#111b2b;--card-hover:#0c1220;--overlay:rgba(4,8,18,0.7);--danger-bg:rgba(239,68,68,0.08);--danger-border:#7f1d1d;--danger:#f87171;--success-bg:rgba(34,197,94,0.12);--shadow:rgba(0,0,0,0.3);--shadow-strong:rgba(0,0,0,0.5);--accent-a04:rgba(132,174,222,0.04);--accent-a06:rgba(132,174,222,0.06);--accent-a08:rgba(132,174,222,0.08);--accent-a10:rgba(132,174,222,0.1);--accent-a12:rgba(132,174,222,0.12);--accent-a15:rgba(132,174,222,0.15);--accent-a18:rgba(132,174,222,0.18);--accent-a20:rgba(132,174,222,0.2);--accent-a30:rgba(132,174,222,0.3);--depth0:#93c5fd;--depth1:#60a5fa;--depth2:#3b82f6;--depth3:#2563eb;--depth0-bg:rgba(132,174,222,0.06);--depth1-bg:rgba(132,174,222,0.07);--depth2-bg:rgba(132,174,222,0.06);--offline-bg:linear-gradient(90deg,#131d2e,#1e2d42);--offline-border:#60a5fa;--offline-text:#93c5fd;}
        /* ═══ PAPER MODE — the full "journal on a wooden desk" scene lives in
           app/paper-mode.css, entirely scoped under .paper-journal. ═══ */
        *{box-sizing:border-box;margin:0;padding:0;font-family:var(--font-body);}
        html,body{height:100%;height:100dvh;overflow:hidden;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;color-scheme:${darkMode?"dark":"light"};}
        ::selection{background:var(--accent-a15);}
        .list-row:hover .list-menu-btn{opacity:1!important;}
        @keyframes fadeIn{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}
        @keyframes shimmerIn{0%{opacity:0;transform:scale(0.3) rotate(-30deg);filter:blur(4px)}50%{opacity:1;transform:scale(1.2) rotate(10deg);filter:blur(0)}100%{opacity:1;transform:scale(1) rotate(0deg);filter:blur(0)}}
        @keyframes frostGlow{0%,100%{filter:drop-shadow(0 0 3px rgba(132,174,222,0.4))}50%{filter:drop-shadow(0 0 8px rgba(132,174,222,0.7))}}
        @keyframes sunGlow{0%,100%{filter:drop-shadow(0 0 3px rgba(251,191,36,0.4))}50%{filter:drop-shadow(0 0 8px rgba(251,191,36,0.7))}}
        .logo-egg{overflow:hidden;}
        .logo-egg::after{content:"";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:16px;opacity:0;transition:opacity 0.15s;pointer-events:none;border-radius:10px;font-weight:400;font-family:system-ui;}
        .theme-light .logo-egg::after,.theme-dark .logo-egg::after{content:"❄";background:linear-gradient(135deg,#3b82f6,#38bdf8);}
        .theme-frost-light .logo-egg::after,.theme-frost-dark .logo-egg::after{content:"☀";background:linear-gradient(135deg,#d97706,#ea580c);}
        .logo-egg:hover::after{opacity:1;animation:shimmerIn 0.4s ease forwards;}
        .theme-light .logo-egg:hover::after,.theme-dark .logo-egg:hover::after{animation:shimmerIn 0.4s ease forwards, frostGlow 2s ease infinite 0.4s;}
        .theme-frost-light .logo-egg:hover::after,.theme-frost-dark .logo-egg:hover::after{animation:shimmerIn 0.4s ease forwards, sunGlow 2s ease infinite 0.4s;}
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
          15%{opacity:0.7;background:var(--accent-a18);transform:scale(1.01)}
          40%{background:var(--accent-a12);transform:scale(1)}
          100%{opacity:1;background:transparent;transform:scale(1)}
        }
        @keyframes checkPop{
          0%{transform:scale(1)}
          25%{transform:scale(0.82)}
          60%{transform:scale(1.25)}
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
          30%{transform:scale(1.03);opacity:0.8;background:var(--accent-a15)}
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
        ::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px;}
        input::placeholder,textarea::placeholder{color:var(--muted);}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes toastIn{0%{opacity:0;transform:translate(-50%,16px)}70%{opacity:1;transform:translate(-50%,-2px)}100%{opacity:1;transform:translate(-50%,0)}}
        button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
        @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important;}}
        [draggable]{user-select:none;}
        @media(max-width:768px){.sidebar{position:fixed!important;z-index:100!important;height:100dvh!important;}.detail-panel{position:fixed!important;right:0;top:0;height:100dvh!important;z-index:100;width:100%!important;max-width:100%!important;min-width:0!important;}.main-scroll{padding-bottom:calc(24px + env(safe-area-inset-bottom, 0px))!important;}}
      `}</style>

      {isMobile&&sidebar&&<div onClick={()=>setSidebar(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:99}}/>}

      {/* ═══ SIDEBAR ═══ */}
      <nav className="sidebar" aria-label="Navigation" style={{width:sidebar?264:0,...(isMobile?{position:"fixed",zIndex:100,height:"100dvh"}:{}),background:"var(--surface)",borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column",transition:"width 0.25s ease",overflow:"hidden",flexShrink:0}}>
        <div style={{padding:"20px 16px 12px",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
            <div onClick={onLogoClick} {...logoLongHandlers} role="button" tabIndex={0} aria-label="Inkwell logo — click to toggle theme, long-press for changelog" className="logo-egg" style={{width:34,height:34,borderRadius:10,background:frostMode?"linear-gradient(135deg,#3b82f6,#38bdf8)":"linear-gradient(135deg,#a8642e,#c98a45)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:700,color:"white",fontFamily:"var(--font-display)",cursor:"pointer",position:"relative",transition:"background 0.5s, box-shadow 0.3s, transform 0.15s",boxShadow:frostMode?"0 2px 12px rgba(98,146,216,0.3)":"0 2px 10px rgba(168,100,46,0.25)",overflow:"hidden",userSelect:"none"}}>I</div>
            <span style={{fontSize:20,fontWeight:700,fontFamily:"var(--font-display)",color:"var(--ink)",whiteSpace:"nowrap"}}>Inkwell</span>
          </div>
          <button onClick={()=>{setShowPhoto(true);if(isMobile)setSidebar(false);}} style={{width:"100%",padding:"11px 14px",borderRadius:"var(--radius-md)",border:"2px dashed var(--border)",background:"var(--accent-bg)",color:"var(--accent)",fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:10,transition:"all 0.2s",marginBottom:16,whiteSpace:"nowrap",fontFamily:"inherit"}}>{Icons.camera} Scan Notebook Page</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"0 8px"}}>
          {paperUI?(<>
            {/* ═══ PAPER MODE SIDEBAR — Today is the whole app ═══ */}
            <NavSection title="Today">
              <NavItem active={view==="today"} icon={Icons.today} label="Today" count={showViewCounts?todayCount:0}
                onClick={()=>selectView("today")} countColor={overdueCount>0?"var(--danger)":undefined}/>
            </NavSection>
            <div style={{padding:"0 4px",marginBottom:14}}>
              <button onClick={()=>{setReviewMode(true);flash("📖 Weekly review — the full app is open until you end it");}}
                style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text)",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",textAlign:"left",display:"flex",alignItems:"center",gap:8,transition:"all 0.15s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--accent)";e.currentTarget.style.color="var(--accent)";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.color="var(--text)";}}>
                📖 Weekly review →
              </button>
              <p style={{fontSize:11,color:"var(--muted)",lineHeight:1.6,margin:"10px 2px 0"}}>
                Plan on paper. Scan to record. Check off and snooze here — everything else waits for your weekly review.
              </p>
            </div>
          </>):(<>
          {paperMode&&reviewMode&&(
            <div style={{padding:"0 4px",marginBottom:12}}>
              <button onClick={()=>{setReviewMode(false);setView("today");flash("🖋 Review done — back to paper");}}
                style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"none",background:"linear-gradient(135deg,var(--accent),var(--accent2))",color:"white",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8,boxShadow:"0 2px 10px rgba(168,100,46,0.25)"}}>
                ✓ End weekly review
              </button>
            </div>
          )}
          <NavSection title="Views">
            {(()=>{
              const dateDrop=(dateStr,label)=>({
                onDragOver:e=>{e.preventDefault();e.dataTransfer.dropEffect="move";e.currentTarget.style.background="var(--accent)";e.currentTarget.style.color="white";e.currentTarget.style.transform="scale(1.02)";},
                onDragLeave:e=>{e.currentTarget.style.background="";e.currentTarget.style.color="";e.currentTarget.style.transform="";},
                onDrop:e=>{e.preventDefault();e.currentTarget.style.background="";e.currentTarget.style.color="";e.currentTarget.style.transform="";const tid=e.dataTransfer.getData("text/plain");if(!tid)return;const src=e.dataTransfer.getData("application/x-source");
                  if(isSubSource(src)){setTasks(prev=>prev.map(t=>{const found=findSubById(t.subtasks,tid);if(!found)return t;const newDate=t.dueDate===dateStr?null:dateStr;return{...t,subtasks:updateSubById(t.subtasks,tid,{dueDate:newDate})};}));flash(tasks.find(t=>findSubById(t.subtasks,tid))?.dueDate===dateStr?"Subtask rejoined parent":`Subtask due ${label}`);setIsDragging(false);}
                  else{const ids=selectedIds.size>1&&selectedIds.has(tid)?selectedIds:new Set([tid]);setTasks(prev=>prev.map(t=>ids.has(t.id)?{...t,dueDate:dateStr}:t));flash(`Set ${ids.size>1?ids.size+" tasks":"task"} to ${label}`);setSelectedIds(new Set());setIsDragging(false);}
                }
              });
              const baseViews=[
                {id:"upcoming",icon:Icons.upcoming,label:"Upcoming"},
                {id:"all",icon:Icons.all,label:"All Tasks",count:tasks.filter(t=>!t.completed&&!archivedLists.includes(t.list)).length},
                {id:"completed",icon:Icons.done,label:"Completed",count:tasks.filter(t=>t.completed&&!archivedLists.includes(t.list)).length},
                {id:"calendar",icon:Icons.calendar,label:"Calendar"},
              ];
              return (<>
                {/* Today — fans out into quick-date drop zones during drag */}
                <div {...dateDrop(todayStr(),"Today")} data-drop-type="date" data-drop-value={todayStr()}
                  style={isDragging?{background:"var(--accent-bg)",border:"2px dashed var(--accent)",borderRadius:10,padding:"2px 0",marginBottom:2,transition:"all 0.15s"}:{}}>
                  <NavItem active={view==="today"} icon={Icons.today} label={isDragging?<><span>Today</span><span style={{fontSize:11,opacity:0.6,fontWeight:400,marginLeft:4}}>— drop here</span></>:"Today"} count={showViewCounts?todayCount:0}
                    onClick={()=>selectView("today")} countColor={overdueCount>0?"var(--danger)":undefined}/>
                </div>
                {isDragging&&(<div style={{display:"flex",flexDirection:"column",gap:2,paddingLeft:12,marginBottom:2}}>
                  {quickDates.map((qd,qi)=>{const ds=resolveQuickDate(qd.offset);return(
                    <div key={qi} {...dateDrop(ds,qd.label)} data-drop-type="date" data-drop-value={ds}
                      style={{animation:`fanOut ${0.15+qi*0.05}s ease`,background:"var(--accent-bg)",border:"2px dashed var(--accent)",borderRadius:10,padding:"2px 4px",transition:"all 0.12s",cursor:"default"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 8px",fontSize:13,fontWeight:600,color:"var(--accent)",borderRadius:8}}>
                        <span style={{display:"flex",flexShrink:0}}>{Icons.calendar}</span>
                        <span style={{flex:1}}>{qd.label}</span>
                        <span style={{fontSize:11,fontWeight:400,color:"var(--muted)"}}>{formatDate(ds)}</span>
                      </div>
                    </div>);
                  })}
                </div>)}
                {overdueCount>0&&(
                  <NavItem active={view==="overdue"} icon={Icons.overdue} label="Overdue" count={showViewCounts?overdueCount:0}
                    onClick={()=>selectView("overdue")} countColor="var(--danger)" labelColor="var(--danger)" iconColor="var(--danger)"/>
                )}
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
                          style={{border:"none",outline:"none",background:"var(--accent-a10)",borderRadius:4,padding:"2px 6px",fontSize:14,fontWeight:view===lv?600:500,width:"100%",fontFamily:"inherit"}}/>
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
              <div style={{position:"fixed",left:listMenu.x,top:listMenu.y,background:"var(--card)",borderRadius:"var(--radius-md)",boxShadow:"var(--shadow-2)",border:"1px solid var(--border)",padding:4,zIndex:1000,minWidth:140,animation:"fadeIn 0.1s ease"}}>
                <button onClick={()=>{setEditingList(listMenu.name);setListMenu(null);}} style={{width:"100%",padding:"8px 12px",border:"none",background:"none",cursor:"pointer",fontSize:13,fontWeight:500,color:"var(--text)",textAlign:"left",borderRadius:6,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surface)"} onMouseLeave={e=>e.currentTarget.style.background="none"}>✏️ Rename</button>
                <button onClick={()=>{archiveList(listMenu.name);setListMenu(null);}} style={{width:"100%",padding:"8px 12px",border:"none",background:"none",cursor:"pointer",fontSize:13,fontWeight:500,color:"var(--text)",textAlign:"left",borderRadius:6,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surface)"} onMouseLeave={e=>e.currentTarget.style.background="none"}>📦 Archive</button>
                <button onClick={()=>{deleteList(listMenu.name);setListMenu(null);}} style={{width:"100%",padding:"8px 12px",border:"none",background:"none",cursor:"pointer",fontSize:13,fontWeight:500,color:"var(--danger)",textAlign:"left",borderRadius:6,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--danger-bg)"} onMouseLeave={e=>e.currentTarget.style.background="none"}>🗑 Delete list</button>
              </div>
            </>)}
            {showNewList&&(<div style={{padding:"4px 6px"}}><input autoFocus value={newList} onChange={e=>setNewList(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&newList.trim()&&!lists.includes(newList.trim())){setLists(p=>[...p,newList.trim()]);setNewList("");setShowNewList(false);}if(e.key==="Escape"){setShowNewList(false);setNewList("");}}}
              onBlur={()=>{setShowNewList(false);setNewList("");}} placeholder="List name..." style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid var(--accent)",fontSize:13,outline:"none",background:"var(--card)",fontFamily:"inherit"}}/></div>)}
          </NavSection>
          {/* ── Archive section (drag lists here or expand to restore) ── */}
          {(archivedLists.length>0||dragList)&&(
            <div style={{marginBottom:8,padding:"0 4px"}}>
              <div
                onDragOver={e=>{if(dragList){e.preventDefault();e.dataTransfer.dropEffect="move";e.currentTarget.style.background="var(--accent-a10)";e.currentTarget.style.borderColor="var(--accent)";}}}
                onDragLeave={e=>{e.currentTarget.style.background="";e.currentTarget.style.borderColor="var(--border)";}}
                onDrop={e=>{e.preventDefault();e.currentTarget.style.background="";e.currentTarget.style.borderColor="var(--border)";
                  if(dragList&&dragList!=="Inbox"){archiveList(dragList);setDragList(null);setDragListOver(null);}
                }}
                onClick={()=>{if(archivedLists.length>0)setArchiveOpen(!archiveOpen);}}
                style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,border:`1px dashed ${dragList?"var(--accent)":"var(--border)"}`,cursor:archivedLists.length>0?"pointer":"default",transition:"all 0.15s",background:dragList?"var(--accent-a06)":"transparent"}}>
                <span style={{fontSize:13,opacity:0.6}}>📦</span>
                <span style={{flex:1,fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8}}>Archive{archivedLists.length>0?` (${archivedLists.length})`:""}</span>
                {archivedLists.length>0&&<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{transition:"transform 0.2s",transform:archiveOpen?"rotate(180deg)":"rotate(0)"}}><polyline points="6 9 12 15 18 9"/></svg>}
              </div>
              {archiveOpen&&archivedLists.length>0&&(
                <div style={{padding:"4px 0 0",animation:"fanOut 0.2s ease"}}>
                  {archivedLists.map(al=>{
                    const ct=tasks.filter(t=>t.list===al).length;
                    return (
                      <div key={al} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:8,fontSize:13,color:"var(--muted)",transition:"background 0.1s"}}
                        onMouseEnter={e=>e.currentTarget.style.background="var(--surface)"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                        <span style={{width:8,height:8,borderRadius:"50%",background:"var(--border)",flexShrink:0,opacity:0.5}}/>
                        <span style={{flex:1,fontWeight:500}}>{al}</span>
                        {ct>0&&<span style={{fontSize:11,color:"var(--muted)",opacity:0.6}}>{ct}</span>}
                        <button onClick={e=>{e.stopPropagation();restoreList(al);}} title="Restore"
                          style={{background:"none",border:"none",cursor:"pointer",color:"var(--accent)",fontSize:11,fontWeight:600,padding:"2px 6px",borderRadius:4,fontFamily:"inherit",transition:"background 0.15s"}}
                          onMouseEnter={e=>e.currentTarget.style.background="var(--accent-a10)"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                          Restore
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          </>)}
        </div>
        {overdueCount>0&&view!=="overdue"&&!paperUI&&<button onClick={()=>selectView("overdue")} style={{margin:"0 8px 8px",padding:"10px 14px",borderRadius:10,background:"var(--danger-bg)",border:"1px solid var(--danger-border)",fontSize:13,color:"var(--danger)",fontWeight:600,flexShrink:0,cursor:"pointer",width:"calc(100% - 16px)",textAlign:"left",fontFamily:"inherit",transition:"background 0.15s"}}
          onMouseEnter={e=>e.currentTarget.style.background="var(--danger-border)"} onMouseLeave={e=>e.currentTarget.style.background="var(--danger-bg)"}>⚠ {overdueCount} overdue — view →</button>}
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
            {/* Online/offline indicator */}
            {hasSupabase && user && (
              <div title={isOnline ? (hasPendingSync.current ? "Pending sync" : "Synced") : "Offline — edits saved locally"}
                style={{display:"flex",alignItems:"center",gap:4,padding:"2px 6px",borderRadius:6,fontSize:11,color:isOnline?"var(--muted)":"var(--danger)",fontWeight:500,fontFamily:"inherit"}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:isOnline?(hasPendingSync.current?"#f59e0b":"#22c55e"):"#ef4444",boxShadow:isOnline?undefined:"0 0 4px rgba(239,68,68,0.4)",transition:"background 0.3s"}}/>
                {!isOnline && <span>Offline</span>}
              </div>
            )}
            <button onClick={()=>setShowTips("guide")} style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:4,display:"flex",borderRadius:6,transition:"color 0.15s"}} aria-label="Help guide" title="Help guide"
              onMouseEnter={e=>e.currentTarget.style.color="var(--accent)"}
              onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </button>
            <button onClick={()=>setShowSettings(true)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:4,display:"flex",borderRadius:6}} aria-label="Settings" title="Settings">{Icons.settings}</button>
          </div>
        </div>
      </nav>

      {/* ═══ MAIN ═══ */}
      <main id="main-content" style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
        {/* Offline banner */}
        {!isOnline && hasSupabase && user && (
          <div style={{padding:"8px 16px",background:"var(--offline-bg)",borderBottom:"1px solid var(--offline-border)",display:"flex",alignItems:"center",justifyContent:"center",gap:8,flexShrink:0,fontSize:13,color:"var(--offline-text)",fontWeight:500}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
            <span>You're offline — your edits are saved locally and will sync when you reconnect</span>
          </div>
        )}
        <header style={{padding:isMobile?"14px 16px":"14px 24px",borderBottom:"1px solid var(--border-light)",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <button onClick={()=>setSidebar(!sidebar)} title={sidebar?"Hide sidebar (B)":"Show sidebar (B)"} style={{background:"none",border:"none",cursor:"pointer",color:sidebar?"var(--muted)":"var(--accent)",padding:6,display:"flex",borderRadius:6,transition:"color 0.15s"}} aria-label="Toggle sidebar">{Icons.menu}</button>
          <div style={{flex:1,display:"flex",alignItems:"center",gap:10,minWidth:0}}>
            {!showSearch?(<>
              {view.startsWith("list:")?(<EditableText value={viewTitle} onSave={n=>renameList(viewTitle,n)} tag="h1" style={{fontSize:isMobile?20:22,fontFamily:"var(--font-display)",fontWeight:700,color:"var(--ink)"}}/>):(<h1 style={{margin:0,fontSize:isMobile?20:22,fontFamily:"var(--font-display)",fontWeight:700,color:view==="overdue"?"var(--danger)":"var(--ink)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{viewTitle}</h1>)}
              {view==="today"&&!isMobile&&<span className={paperUI?"font-hand":undefined} style={{fontSize:paperUI?18:13,color:"var(--muted)",whiteSpace:"nowrap"}}>{new Date().toLocaleDateString("en-IE",{weekday:"long",month:"long",day:"numeric"})}</span>}
              {paperUI&&<span title="Paper Mode — your notebook is the workspace, this is the record" style={{fontSize:10,fontWeight:700,color:"var(--accent)",background:"var(--accent-bg)",padding:"3px 9px",borderRadius:12,whiteSpace:"nowrap",letterSpacing:0.6,flexShrink:0}}>🖋 PAPER MODE</span>}
              {view==="overdue"&&<button onClick={()=>{const ot=tasks.filter(t=>!t.completed&&t.dueDate&&t.dueDate<todayStr());setTasks(prev=>prev.map(t=>(!t.completed&&t.dueDate&&t.dueDate<todayStr())?{...t,dueDate:todayStr()}:t));flash(`Moved ${ot.length} task${ot.length!==1?"s":""} to today`);setView("today");}}
                style={{padding:"6px 14px",borderRadius:8,border:"1px solid var(--danger-border)",background:"var(--danger-bg)",color:"var(--danger)",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",transition:"all 0.15s"}}
                onMouseEnter={e=>{e.currentTarget.style.background="var(--danger-border)"}} onMouseLeave={e=>{e.currentTarget.style.background="var(--danger-bg)"}}>
                → Move All to Today
              </button>}
            </>):(<input id="task-search" autoFocus value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Escape"){setShowSearch(false);setSearch("");}}} placeholder="Search tasks, tags..." style={{flex:1,padding:"10px 14px",borderRadius:"var(--radius-md)",border:"1px solid var(--border)",fontSize:15,outline:"none",background:"var(--card)",fontFamily:"inherit",minWidth:0}}/>)}
          </div>
          {paperUI&&<button onClick={()=>setShowPhoto(true)} style={{background:"var(--accent-bg)",border:"none",cursor:"pointer",color:"var(--accent)",padding:8,borderRadius:8,display:"flex",flexShrink:0}} aria-label="Scan notebook page" title="Scan notebook page">{Icons.camera}</button>}
          <button onClick={()=>{setShowSearch(!showSearch);if(showSearch)setSearch("");}} style={{background:showSearch?"var(--surface)":"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:8,borderRadius:8,display:"flex",flexShrink:0}} aria-label="Search">{Icons.search}</button>
          {view!=="calendar"&&(<div style={{position:"relative",flexShrink:0}}>
            <button onClick={()=>setShowSortMenu(!showSortMenu)}
              style={{background:showSortMenu||(sortBy!=="default"||filterPriority!=="all")?"var(--accent-bg)":"none",border:"none",cursor:"pointer",
                color:sortBy!=="default"||filterPriority!=="all"?"var(--accent)":"var(--muted)",padding:8,borderRadius:8,display:"flex",position:"relative"}}
              aria-label="Sort & Filter" title="Sort & Filter">
              {Icons.sort}
              {(sortBy!=="default"||filterPriority!=="all")&&<div style={{position:"absolute",top:4,right:4,width:6,height:6,borderRadius:3,background:"var(--accent)"}}/>}
            </button>
            {showSortMenu&&(<>
              <div style={{position:"fixed",inset:0,zIndex:1300}} onClick={()=>setShowSortMenu(false)}/>
              <div style={{position:"absolute",top:"100%",right:0,marginTop:6,background:"var(--card)",borderRadius:"var(--radius-md)",border:"1px solid var(--border)",boxShadow:"var(--shadow-2)",padding:8,zIndex:1301,minWidth:200}}>
                <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8,padding:"6px 10px 4px"}}>Sort by</div>
                {[["default","Default"],["priority","Priority"],["alpha","A → Z"],["date","Due Date"],["created","Newest First"]].map(([val,label])=>(
                  <button key={val} onClick={()=>{setSortBy(val);}} style={{width:"100%",padding:"8px 10px",border:"none",borderRadius:8,background:sortBy===val?"var(--accent-bg)":"transparent",
                    color:sortBy===val?"var(--accent)":"var(--text)",fontSize:13,fontWeight:sortBy===val?600:500,cursor:"pointer",textAlign:"left",fontFamily:"inherit",display:"block",transition:"background 0.1s"}}
                    onMouseEnter={e=>{if(sortBy!==val)e.currentTarget.style.background="var(--surface)";}} onMouseLeave={e=>{if(sortBy!==val)e.currentTarget.style.background="transparent";}}>
                    {label}
                  </button>
                ))}
                <div style={{height:1,background:"var(--border-light)",margin:"6px 4px"}}/>
                <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8,padding:"6px 10px 4px"}}>Filter priority</div>
                {[["all","All"],["high","High"],["medium","Medium"],["low","Low"]].map(([val,label])=>(
                  <button key={val} onClick={()=>{setFilterPriority(val);}} style={{width:"100%",padding:"8px 10px",border:"none",borderRadius:8,background:filterPriority===val?"var(--accent-bg)":"transparent",
                    color:filterPriority===val?"var(--accent)":"var(--text)",fontSize:13,fontWeight:filterPriority===val?600:500,cursor:"pointer",textAlign:"left",fontFamily:"inherit",display:"flex",alignItems:"center",gap:8,transition:"background 0.1s"}}
                    onMouseEnter={e=>{if(filterPriority!==val)e.currentTarget.style.background="var(--surface)";}} onMouseLeave={e=>{if(filterPriority!==val)e.currentTarget.style.background="transparent";}}>
                    {val!=="all"&&<div style={{width:8,height:8,borderRadius:4,background:PRIORITY[val].color,flexShrink:0}}/>}
                    {label}
                  </button>
                ))}
                {(sortBy!=="default"||filterPriority!=="all")&&(<>
                  <div style={{height:1,background:"var(--border-light)",margin:"6px 4px"}}/>
                  <button onClick={()=>{setSortBy("default");setFilterPriority("all");}} style={{width:"100%",padding:"8px 10px",border:"none",borderRadius:8,background:"transparent",
                    color:"var(--danger)",fontSize:13,fontWeight:500,cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"background 0.1s"}}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--danger-bg)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    Clear all
                  </button>
                </>)}
              </div>
            </>)}
          </div>)}
        </header>

        <div style={{flex:1,display:"flex",overflow:"hidden"}}>
          <div className="main-scroll" style={{flex:1,overflowY:"auto",padding:isMobile?"16px":"20px 24px"}}>
            {(() => {
              /* Compute whether current view supports kanban board mode */
              const boardEligible = view==="today" || view==="inbox" || view.startsWith("list:");
              const currentListName = view==="inbox" ? "Inbox" : view.startsWith("list:") ? view.replace("list:","") : null;
              /* Shared toolbar: Board/List toggle (if eligible) + Today filter button (if on Today) */
              const renderViewToolbar = () => !paperUI && boardEligible && (
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,flexShrink:0,flexWrap:"wrap"}}>
                  <div style={{display:"flex",background:"var(--surface)",borderRadius:8,padding:2,width:"fit-content"}}>
                    <button onClick={()=>setViewMode("kanban")} style={{padding:"5px 12px",borderRadius:6,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:viewMode==="kanban"?"var(--card)":"transparent",color:viewMode==="kanban"?"var(--ink)":"var(--muted)",boxShadow:viewMode==="kanban"?"0 1px 3px rgba(0,0,0,0.08)":"none",transition:"all 0.15s"}}>Board</button>
                    <button onClick={()=>setViewMode("list")} style={{padding:"5px 12px",borderRadius:6,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:viewMode==="list"?"var(--card)":"transparent",color:viewMode==="list"?"var(--ink)":"var(--muted)",boxShadow:viewMode==="list"?"0 1px 3px rgba(0,0,0,0.08)":"none",transition:"all 0.15s"}}>List</button>
                  </div>
                  {view==="today" && (
                    <div style={{position:"relative"}}>
                      <button onClick={()=>setShowTodayFilter(s=>!s)}
                        style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,border:`1px solid ${todayListFilter.size>0?"var(--accent)":"var(--border)"}`,background:todayListFilter.size>0?"var(--accent-a10)":"var(--card)",fontSize:12,fontWeight:600,color:todayListFilter.size>0?"var(--accent)":"var(--text)",cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}}
                        title="Filter by list">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                        {todayListFilter.size>0 ? `${todayListFilter.size} list${todayListFilter.size!==1?"s":""}` : "Filter"}
                        {todayListFilter.size>0 && <span onClick={e=>{e.stopPropagation();setTodayListFilter(new Set());}} style={{fontSize:14,lineHeight:1,opacity:0.7,marginLeft:2,cursor:"pointer"}} title="Clear filter">×</span>}
                      </button>
                      {showTodayFilter && (<>
                        <div style={{position:"fixed",inset:0,zIndex:999}} onClick={()=>setShowTodayFilter(false)}/>
                        <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,background:"var(--card)",borderRadius:"var(--radius-md)",boxShadow:"var(--shadow-2)",border:"1px solid var(--border)",padding:6,zIndex:1000,minWidth:200,maxHeight:340,overflowY:"auto",animation:"fadeIn 0.12s ease"}}>
                          <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8,padding:"6px 10px 4px"}}>Show tasks from</div>
                          {["Inbox",...lists.filter(l=>l!=="Inbox")].map(l=>{
                            const color = listAccentColor(l, lists);
                            const checked = todayListFilter.has(l);
                            return (
                              <div key={l} onClick={()=>{setTodayListFilter(prev=>{const n=new Set(prev);if(n.has(l))n.delete(l);else n.add(l);return n;});}}
                                style={{display:"flex",alignItems:"center",gap:9,padding:"7px 10px",borderRadius:6,cursor:"pointer",fontSize:13,color:"var(--text)",transition:"background 0.1s"}}
                                onMouseEnter={e=>e.currentTarget.style.background="var(--surface)"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                                <div style={{width:14,height:14,borderRadius:3,border:`1.5px solid ${checked?"var(--accent)":"var(--border)"}`,background:checked?"var(--accent)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.12s"}}>
                                  {checked && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                                </div>
                                <span style={{width:8,height:8,borderRadius:"50%",background:color||"var(--border)",flexShrink:0,opacity:color?1:0.4}}/>
                                <span style={{flex:1,fontWeight:checked?600:500}}>{l}</span>
                              </div>
                            );
                          })}
                          {todayListFilter.size>0 && (
                            <div style={{borderTop:"1px solid var(--border-light)",marginTop:4,paddingTop:4}}>
                              <button onClick={()=>{setTodayListFilter(new Set());setShowTodayFilter(false);}}
                                style={{width:"100%",padding:"7px 10px",border:"none",background:"none",cursor:"pointer",fontSize:12,fontWeight:600,color:"var(--muted)",textAlign:"left",borderRadius:6,fontFamily:"inherit"}}
                                onMouseEnter={e=>e.currentTarget.style.background="var(--surface)"} onMouseLeave={e=>e.currentTarget.style.background="none"}>Clear filter</button>
                            </div>
                          )}
                        </div>
                      </>)}
                    </div>
                  )}
                </div>
              );
              const inKanbanMode = boardEligible && viewMode==="kanban" && !paperUI;

              /* ═══ Paper Mode: the journal-on-a-desk scene replaces the list UI ═══ */
              if (paperUI) return (
                <div className="journal-desk">
                  <JournalView
                    tasks={filtered} lists={lists} searching={!!search}
                    dateLabel={new Date().toLocaleDateString("en-IE",{weekday:"long",month:"long",day:"numeric"})}
                    onToggle={toggleTask}
                    onSubToggle={(taskId,subId)=>{setTasks(prev=>prev.map(t=>t.id!==taskId?t:{...t,subtasks:updateSubById(t.subtasks,subId,{completed:!findSubById(t.subtasks,subId)?.completed,completedAt:!findSubById(t.subtasks,subId)?.completed?new Date().toISOString():null})}));}}
                    onSelect={t=>setSelectedTask(t)}
                    onSnooze={snoozeTask}
                    onAdd={title=>{const t=addTask({title:title});flash(`✓ Added "${t.title}"`);}}
                  />
                  <DeskPen/>
                </div>
              );

              return view==="calendar"?(<CalendarView tasks={tasks} onSelect={t=>setSelectedTask(t)} onUpdate={updateTask}/>):inKanbanMode?(<div style={{display:"flex",flexDirection:"column",height:"100%"}}>
              <div className="lift" style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"var(--card)",borderRadius:"var(--radius-lg)",border:"1px solid var(--border)",marginBottom:10,flexShrink:0}}>
                <span style={{color:"var(--accent)",flexShrink:0}}>{Icons.plus}</span>
                <input id="quick-add" value={newTitle} onChange={e=>setNewTitle(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newTitle.trim()){const t=addTask({title:newTitle.trim()});setNewTitle("");flash(`✓ Added "${t.title}"`);}}} placeholder="Add a task... (Enter) · defaults to today" style={{flex:1,border:"none",outline:"none",fontSize:15,color:"var(--ink)",background:"none",fontFamily:"inherit",minWidth:0}}/>
              </div>
              {renderViewToolbar()}
              <div style={{flex:1,minHeight:0}}><KanbanBoard key={`kb-${view}-${sortBy}-${filterPriority}`} tasks={tasks} columns={activeKanbanCols} onColumnsChange={setKanbanColumns} onResetColumns={kanbanColumns?resetKanbanCols:null} onSelect={t=>setSelectedTask(t)} onUpdate={updateTask} onToggle={toggleTask} onReorder={setTasks} onUpdateSubtask={(taskId,subId)=>{setTasks(prev=>prev.map(t=>t.id!==taskId?t:{...t,subtasks:updateSubById(t.subtasks,subId,{completed:!findSubById(t.subtasks,subId)?.completed,completedAt:!findSubById(t.subtasks,subId)?.completed?new Date().toISOString():null})}));}} onSubUpdate={(subId,changes)=>{setTasks(prev=>prev.map(t=>{const found=findSubById(t.subtasks,subId);if(!found)return t;return{...t,subtasks:updateSubById(t.subtasks,subId,changes)};}));}} flash={flash} setIsDragging={setIsDragging} animatingTasks={animatingTasks} sortBy={sortBy} filterPriority={filterPriority} lists={lists} scopeListName={currentListName} todayListFilter={view==="today"?todayListFilter:null}/></div>
            </div>):(<>
              {view!=="completed"&&view!=="overdue"&&(<div className="quick-add-card lift" style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"var(--card)",borderRadius:"var(--radius-lg)",border:"1px solid var(--border)",marginBottom:boardEligible?10:16}}>
                <span style={{color:"var(--accent)",flexShrink:0}}>{Icons.plus}</span>
                <input id="quick-add" value={newTitle} onChange={e=>setNewTitle(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newTitle.trim()){const t=addTask({title:newTitle.trim()});setNewTitle("");flash(`✓ Added "${t.title}"`);}}} placeholder="Add a task... (Enter) · defaults to today" style={{flex:1,border:"none",outline:"none",fontSize:15,color:"var(--ink)",background:"none",fontFamily:"inherit",minWidth:0}}/>
              </div>)}
              {view==="overdue"&&(
                <div style={{padding:"14px 16px",borderRadius:12,background:"var(--danger-bg)",border:"1px solid var(--danger-border)",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:20,flexShrink:0}}>⏰</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:600,color:"#991b1b"}}>These tasks are past due</div>
                    <div style={{fontSize:12,color:"var(--danger)",marginTop:2}}>Reschedule them or move everything to today</div>
                  </div>
                </div>
              )}
              {renderViewToolbar()}
              {filtered.length===0?(<EmptyState view={view} search={!!search} onGuide={()=>setShowTips("welcome")}/>):(
                <div role="list" aria-label="Tasks" style={view==="overdue"?{background:"var(--danger-bg)",borderRadius:"var(--radius-lg)",border:"1px solid var(--danger-border)",padding:"8px 10px"}:undefined}>
                  {filtered.map((task,i)=>{const prev=i>0?filtered[i-1]:null;const showSep=task.completed&&!task._surfacedSub&&prev&&!prev.completed;
                    /* Date group headers for overdue view */
                    const showDateHeader = view==="overdue" && (!prev || prev.dueDate !== task.dueDate);
                    if(task._surfacedSub) return(<div key={`sub-${task.id}`} role="listitem">
                      <SurfacedSubtaskRow task={task} onSelect={t=>setSelectedTask(t)} onToggleSub={(taskId,subId)=>{setTasks(prev=>prev.map(t=>t.id!==taskId?t:{...t,subtasks:updateSubById(t.subtasks,subId,{completed:!findSubById(t.subtasks,subId)?.completed,completedAt:!findSubById(t.subtasks,subId)?.completed?new Date().toISOString():null})}));}} view={view} lists={lists} animateState={animatingTasks[task.id]}/>
                    </div>);
                    return(<div key={task.id} role="listitem">
                      {showDateHeader&&(<div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 8px 6px",marginTop:i>0?6:0}}>
                        <span style={{fontSize:12,fontWeight:700,color:"var(--danger)"}}>{(() => {
                          const d = new Date(task.dueDate + "T00:00:00");
                          const diff = Math.floor((new Date(todayStr()+"T00:00:00") - d) / 86400000);
                          return `${d.toLocaleDateString("en-IE",{weekday:"short",month:"short",day:"numeric"})} — ${diff} day${diff!==1?"s":""} ago`;
                        })()}</span>
                        <div style={{height:1,flex:1,background:"#fecaca"}}/>
                        <button onClick={()=>{const count=filtered.filter(t=>t.dueDate===task.dueDate).length;setTasks(prev=>prev.map(t=>(!t.completed&&t.dueDate===task.dueDate)?{...t,dueDate:todayStr()}:t));flash(`Moved ${count} task${count!==1?"s":""} to today`);}}
                          style={{fontSize:11,fontWeight:600,color:"var(--danger)",background:"var(--card)",border:"1px solid var(--danger-border)",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>→ Today</button>
                      </div>)}
                      {showSep&&(<div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 12px 8px",marginTop:8}}><div style={{height:1,flex:1,background:"var(--border)"}}/><span style={{fontSize:12,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8}}>Completed</span><div style={{height:1,flex:1,background:"var(--border)"}}/></div>)}
                      <TaskRow task={task} isActive={selectedTask?.id===task.id} isSelected={selectedIds.has(task.id)} onSelect={handleTaskClick} onToggle={toggleTask} onUpdateTask={updateTask} onSnooze={snoozeTask} paperUI={paperUI} view={view} lists={lists} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} dropTarget={dropTarget?.id===task.id?dropTarget:null} animateState={animatingTasks[task.id]}/>
                    </div>);})}
                </div>
              )}
            </>);
            })()}
          </div>
          {selectedTask&&!isMobile&&<TaskDetail task={selectedTask} onUpdate={updateTask} onDelete={deleteTask} onClose={()=>setSelectedTask(null)} onToggle={toggleTask} lists={lists}/>}
        </div>
        {selectedTask&&isMobile&&(<div style={{position:"fixed",inset:0,background:"var(--overlay)",zIndex:100,display:"flex",justifyContent:"flex-end"}} onClick={()=>setSelectedTask(null)}><div onClick={e=>e.stopPropagation()} style={{width:"100%"}}><TaskDetail task={selectedTask} onUpdate={updateTask} onDelete={deleteTask} onClose={()=>setSelectedTask(null)} onToggle={toggleTask} lists={lists}/></div></div>)}
      </main>

      {showPhoto&&<PhotoModal onClose={()=>{setShowPhoto(false);setScanError(null);}} onProcess={handleScan} processing={processing} error={scanError}/>}
      {scanResults&&<ScanResultsModal results={scanResults} onConfirm={confirmScan} onClose={()=>setScanResults(null)} lists={lists}/>}
      {showTips&&<HelpGuideModal initialSection={showTips} onClose={()=>setShowTips(null)}/>}
      {showShortcuts&&(<Overlay onClose={()=>setShowShortcuts(false)}><h2 style={{fontSize:19,fontFamily:"var(--font-display)",marginBottom:16}}>Keyboard Shortcuts</h2>{[["N","New task"],["B","Toggle sidebar"],["/ or ⌘F","Search"],["⌘Z","Undo"],["⌘⇧Z","Redo"],["⌘A","Select all tasks"],["Shift+Click","Select range"],["⌘/Ctrl+Click","Toggle select"],["Delete","Delete selected"],["Esc","Clear selection / close"],["?","This help"],["Double-click","Edit any name"]].map(([k,d])=>(<div key={k} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:"1px solid var(--border-light)"}}><kbd style={{fontSize:12,fontWeight:600,background:"var(--surface)",padding:"3px 8px",borderRadius:6,border:"1px solid var(--border)",fontFamily:"inherit",minWidth:50,textAlign:"center"}}>{k}</kbd><span style={{fontSize:14,color:"var(--text)"}}>{d}</span></div>))}</Overlay>)}
      {showSettings&&(<Overlay onClose={()=>setShowSettings(false)}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
          <div style={{width:36,height:36,borderRadius:10,background:"var(--surface)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--muted)"}}>{Icons.settings}</div>
          <h2 style={{margin:0,fontSize:19,fontFamily:"var(--font-display)"}}>Settings</h2>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>
        <div style={{marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>Paper Mode</div>
          <ToggleRow label="🖋 Paper Mode" sublabel="Notebook-first. The app pins to Today: scan, check off, snooze. Unfinished tasks carry forward. Boards, lists and other views are saved for your weekly review." checked={paperMode} onChange={v=>{setPaperMode(v);setReviewMode(false);}}/>
          {paperMode&&(
            <div style={{padding:"10px 14px",background:"var(--accent-bg)",borderRadius:10,marginTop:10,fontSize:12,color:"var(--accent-dark)",lineHeight:1.6}}>
              <b>Tip:</b> write <b style={{fontFamily:"var(--font-mono)"}}>&gt;1w</b>, <b style={{fontFamily:"var(--font-mono)"}}>&gt;1m</b> or <b style={{fontFamily:"var(--font-mono)"}}>&gt;Fri</b> next to a task on paper and the next scan will snooze it for you. Open <b>Weekly review</b> from the sidebar for your deliberate planning session.
            </div>
          )}
          <div style={{padding:"10px 14px",background:"var(--surface)",borderRadius:10,marginTop:10,fontSize:12,color:"var(--text)",lineHeight:1.6}}>
            <b>📷 Inkwell Drop</b> — a scan-only mini app that installs separately, so app blockers (Brick, Screen Time…) can block Inkwell + Chrome but leave capture working. Open <a href="/capture" style={{color:"var(--accent)",fontWeight:600}}>/capture</a> in Chrome → menu → <b>Install app</b>, then leave "Drop" off your blocklist. You can also share photos straight to it from your camera roll.
          </div>
        </div>
        <div style={{marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>Appearance</div>
          <ToggleRow label="Dark Mode" sublabel="Switch to a dark colour scheme (auto-syncs with system if unset)" checked={darkMode} onChange={setDarkModeUser}/>
        </div>
        <div style={{marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>Accessibility</div>
          <ToggleRow label="Dyslexic-friendly font" sublabel="Use Atkinson Hyperlegible across the app" checked={dyslexic} onChange={setDyslexic}/>
          <div style={{padding:"14px 0",borderBottom:"1px solid var(--border-light)"}}>
            <div style={{fontSize:14,fontWeight:500,color:"var(--ink)",marginBottom:8}}>Text size</div>
            <div style={{display:"flex",gap:8}}>
              {[["sm","Small"],["md","Normal"],["lg","Large"],["xl","Huge"]].map(([k,label])=>(
                <button key={k} onClick={()=>setTextSize(k)}
                  style={{flex:1,padding:"8px 0",borderRadius:8,border:textSize===k?`2px solid var(--accent)`:"1px solid var(--border)",background:textSize===k?"var(--accent-a10)":"var(--card)",color:textSize===k?"var(--accent)":"var(--text)",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>Behavior</div>
          <ToggleRow label="Confirm subtask completion" sublabel="Ask before completing a task with open subtasks. When off, subtasks are completed automatically." checked={confirmSubtaskComplete} onChange={setConfirmSubtaskComplete}/>
        </div>
        <div style={{marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>Sidebar Display</div>
          <ToggleRow label="Show task counts on Views" sublabel="Today, All Tasks, Completed, etc." checked={showViewCounts} onChange={setShowViewCounts}/>
          <ToggleRow label="Show task counts on Lists" sublabel="Inbox, Work, Personal, etc." checked={showListCounts} onChange={setShowListCounts}/>
        </div>
        <div style={{marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>Quick Date Drop Zones</div>
          <div style={{fontSize:12,color:"var(--muted)",marginBottom:10}}>These appear when dragging tasks onto the sidebar. Drag a task to reschedule it quickly.</div>
          {quickDates.map((qd,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:"1px solid var(--border-light)"}}>
              <input value={qd.label} onChange={e=>{const n=[...quickDates];n[i]={...n[i],label:e.target.value};setQuickDates(n);}}
                style={{flex:1,padding:"6px 10px",borderRadius:8,border:"1px solid var(--border)",fontSize:13,background:"var(--surface)",color:"var(--ink)",fontFamily:"inherit",outline:"none"}} placeholder="Label"/>
              <select value={qd.offset} onChange={e=>{const n=[...quickDates];n[i]={...n[i],offset:e.target.value};setQuickDates(n);}}
                style={{padding:"6px 8px",borderRadius:8,border:"1px solid var(--border)",fontSize:12,background:"var(--surface)",color:"var(--ink)",fontFamily:"inherit",cursor:"pointer"}}>
                <option value="tomorrow">Tomorrow</option>
                <option value="+2">In 2 days</option>
                <option value="+3">In 3 days</option>
                <option value="+7">In 1 week</option>
                <option value="+14">In 2 weeks</option>
                <option value="next:1">Next Monday</option>
                <option value="next:2">Next Tuesday</option>
                <option value="next:3">Next Wednesday</option>
                <option value="next:4">Next Thursday</option>
                <option value="next:5">Next Friday</option>
                <option value="next:6">Next Saturday</option>
                <option value="next:0">Next Sunday</option>
              </select>
              <button onClick={()=>setQuickDates(prev=>prev.filter((_,j)=>j!==i))}
                style={{background:"none",border:"none",cursor:"pointer",color:"var(--danger)",padding:4,display:"flex",flexShrink:0}} title="Remove">{Icons.x}</button>
            </div>
          ))}
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <button onClick={()=>setQuickDates(prev=>[...prev,{label:"New Date",offset:"tomorrow"}])}
              style={{flex:1,padding:"8px 12px",borderRadius:8,border:"2px dashed var(--border)",background:"transparent",color:"var(--muted)",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--accent)";e.currentTarget.style.color="var(--accent)";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.color="var(--muted)";}}>
              + Add Quick Date
            </button>
            {JSON.stringify(quickDates)!==JSON.stringify(defaultQuickDates)&&(
              <button onClick={()=>setQuickDates(defaultQuickDates)}
                style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface)",color:"var(--muted)",fontSize:12,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                Reset
              </button>
            )}
          </div>
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
                style={{padding:"6px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card)",color:"var(--danger)",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
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
        </div>
        <div style={{textAlign:"center",padding:"8px 0 4px",fontSize:10,color:"var(--muted)",opacity:0.6}}>Inkwell {BUILD_VERSION}</div>
      </Overlay>)}
      {/* ═══ BULK ACTION BAR ═══ */}
      {selectedIds.size>1&&(
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"#292524",color:"#fafaf9",padding:"10px 16px",borderRadius:"var(--radius-lg)",fontSize:13,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.25)",animation:"toastIn 0.3s ease",zIndex:1500,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",justifyContent:"center",maxWidth:"calc(100vw - 24px)"}}>
          <span style={{opacity:0.7}}>{selectedIds.size} selected</span>
          <div style={{width:1,height:20,background:"rgba(255,255,255,0.2)"}}/>
          <select onChange={e=>{if(e.target.value)bulkMove(e.target.value);e.target.value="";}} defaultValue="" style={{background:"rgba(255,255,255,0.15)",border:"none",color:"white",borderRadius:6,padding:"5px 8px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            <option value="" disabled>Move to…</option>
            {lists.map(l=><option key={l} value={l} style={{color:"var(--ink)"}}>{l}</option>)}
          </select>
          <select onChange={e=>{if(e.target.value)bulkPriority(e.target.value);e.target.value="";}} defaultValue="" style={{background:"rgba(255,255,255,0.15)",border:"none",color:"white",borderRadius:6,padding:"5px 8px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            <option value="" disabled>Priority…</option>
            {Object.entries(PRIORITY).map(([k,v])=><option key={k} value={k} style={{color:"var(--ink)"}}>{v.label}</option>)}
          </select>
          <button onClick={bulkComplete} style={{background:"rgba(255,255,255,0.15)",border:"none",color:"white",borderRadius:6,padding:"5px 10px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>✓ Done</button>
          <input type="date" onChange={e=>{if(e.target.value)bulkDate(e.target.value);}} style={{background:"rgba(255,255,255,0.15)",border:"none",color:"white",borderRadius:6,padding:"4px 8px",fontSize:12,cursor:"pointer",fontFamily:"inherit",colorScheme:"dark"}} title="Set due date"/>
          <button onClick={bulkDelete} style={{background:"rgba(239,68,68,0.8)",border:"none",color:"white",borderRadius:6,padding:"5px 10px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Delete</button>
          <button onClick={()=>setSelectedIds(new Set())} style={{background:"none",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",padding:4,display:"flex"}}>{Icons.x}</button>
        </div>
      )}
      {/* Theme transition animation overlay */}
      {themeTransition&&<ThemeTransition type={themeTransition} isLight={!darkMode} onDone={()=>setThemeTransition(null)}/>}
      {/* ═══ GLOW-UP: command palette, changelog, confetti, midnight moon, undo toast ═══ */}
      <MidnightMoon show={midnightActive} />
      <ConfettiInk trigger={confettiTrigger} />
      <DayClosed show={dayClosed} />
      <ChangelogScroll open={showChangelog} onClose={() => setShowChangelog(false)} />
      {undoToast.render()}
      <CommandPalette open={showCmd} onClose={() => setShowCmd(false)} commands={(()=>{const all=[
        { id: "new-task", group: "Create", icon: Icons.plus, label: "New task", hint: "Focus the quick-add input",
          run: () => { const el = document.getElementById("quick-add"); el?.focus(); } },
        { id: "scan", group: "Create", icon: Icons.camera, label: "Scan notebook page", hint: "Open AI scanner",
          run: () => setShowPhoto(true) },
        { id: "today", group: "Views", icon: Icons.today, label: "Today", run: () => setView("today") },
        { id: "upcoming", group: "Views", icon: Icons.upcoming, label: "Upcoming", run: () => setView("upcoming") },
        { id: "all", group: "Views", icon: Icons.all, label: "All tasks", run: () => setView("all") },
        { id: "completed", group: "Views", icon: Icons.done, label: "Completed", run: () => setView("completed") },
        { id: "calendar", group: "Views", icon: Icons.calendar, label: "Calendar", run: () => setView("calendar") },
        ...lists.map(l => ({ id: `list-${l}`, group: "Lists", icon: Icons.hash || Icons.all, label: l, hint: `Jump to ${l}`, run: () => setView(`list:${l}`) })),
        { id: "search", group: "Find", icon: Icons.search, label: "Search tasks", hint: "Focus search",
          run: () => { setShowSearch(true); setTimeout(() => document.getElementById("task-search")?.focus(), 50); } },
        { id: "toggle-dark", group: "Appearance", icon: Icons.settings, label: darkMode ? "Switch to light mode" : "Switch to dark mode",
          run: () => setDarkModeUser(!darkMode) },
        { id: "toggle-dyslexic", group: "Accessibility", icon: Icons.settings, label: dyslexic ? "Turn off dyslexic font" : "Turn on dyslexic-friendly font",
          run: () => setDyslexic(!dyslexic) },
        { id: "text-lg", group: "Accessibility", icon: Icons.settings, label: "Text size — large", run: () => setTextSize("lg") },
        { id: "text-md", group: "Accessibility", icon: Icons.settings, label: "Text size — medium", run: () => setTextSize("md") },
        { id: "text-sm", group: "Accessibility", icon: Icons.settings, label: "Text size — small", run: () => setTextSize("sm") },
        { id: "paper-mode", group: "Modes", icon: Icons.note, label: paperMode ? "Turn off Paper Mode" : "Turn on Paper Mode (notebook-first)",
          run: () => { setPaperMode(p => !p); setReviewMode(false); } },
        ...(paperMode ? [{ id: "weekly-review", group: "Modes", icon: Icons.all, label: reviewMode ? "End weekly review" : "Start weekly review",
          run: () => setReviewMode(r => !r) }] : []),
        { id: "changelog", group: "About", icon: Icons.settings, label: "Open the Scroll (changelog)", run: () => setShowChangelog(true) },
        { id: "shortcuts", group: "About", icon: Icons.settings, label: "Keyboard shortcuts", run: () => setShowShortcuts(true) },
        { id: "settings", group: "About", icon: Icons.settings, label: "Settings", run: () => setShowSettings(true) },
        { id: "help", group: "About", icon: Icons.settings, label: "Help guide", run: () => setShowTips("welcome") },
      ];
      /* Paper Mode trims the palette to the sanctioned verbs */
      if(!paperUI) return all;
      const allowed=new Set(["new-task","scan","today","search","settings","help","shortcuts","paper-mode","weekly-review","toggle-dark","toggle-dyslexic"]);
      return all.filter(c=>allowed.has(c.id));
      })()} />
      {/* Subtask completion confirmation modal */}
      {pendingCompleteId&&(()=>{
        const pt=tasks.find(t=>t.id===pendingCompleteId);
        if(!pt)return null;
        const {total,done}=countSubs(pt.subtasks);
        const open=total-done;
        return (
          <div style={{position:"fixed",inset:0,background:"var(--overlay)",zIndex:2500,display:"flex",alignItems:"center",justifyContent:"center",padding:16,animation:"fadeIn 0.15s ease"}}
            onClick={cancelPendingComplete}>
            <div onClick={e=>e.stopPropagation()} style={{background:"var(--card)",borderRadius:"var(--radius-lg)",padding:"24px 28px",maxWidth:380,width:"100%",boxShadow:"var(--shadow-3)",animation:"toastIn 0.2s ease"}}>
              <div style={{fontSize:16,fontWeight:700,color:"var(--ink)",marginBottom:8,fontFamily:"var(--font-display)"}}>Complete all subtasks?</div>
              <div style={{fontSize:14,color:"var(--text)",lineHeight:1.5,marginBottom:20}}>
                <b>{pt.title}</b> has {open} open subtask{open!==1?"s":""}. Completing this task will mark {open===1?"it":"all of them"} as done too.
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={cancelPendingComplete}
                  style={{padding:"9px 18px",borderRadius:10,border:"1px solid var(--border)",background:"var(--surface)",color:"var(--text)",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"background 0.15s"}}>
                  Cancel
                </button>
                <button onClick={confirmPendingComplete}
                  style={{padding:"9px 18px",borderRadius:10,border:"none",background:"var(--accent)",color:"white",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"background 0.15s"}}>
                  Complete all
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {toast&&<div role="status" aria-live="polite" style={{position:"fixed",bottom:isDragging?84:24,left:"50%",transform:"translateX(-50%)",background:"var(--ink)",color:"var(--bg)",padding:"12px 24px",borderRadius:"var(--radius-lg)",fontSize:14,fontWeight:600,boxShadow:"0 10px 30px rgba(0,0,0,0.25)",animation:"toastIn 0.3s ease",zIndex:2000,whiteSpace:"nowrap",pointerEvents:"none",transition:"bottom 0.2s ease",fontFamily:"var(--font-body)"}}>{typeof toast==="string"?renderCoffee(toast):toast}</div>}
      {/* Trash drop zone — appears during any drag */}
      {isDragging&&(
        <div data-drop-type="trash"
          onDragOver={e=>{e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect="move";e.currentTarget.style.transform="translateX(-50%) scale(1.06)";e.currentTarget.style.background="var(--danger)";e.currentTarget.style.color="white";e.currentTarget.style.borderColor="var(--danger)";}}
          onDragLeave={e=>{e.currentTarget.style.transform="translateX(-50%) scale(1)";e.currentTarget.style.background="var(--danger-bg)";e.currentTarget.style.color="var(--danger)";e.currentTarget.style.borderColor="var(--danger-border)";}}
          onDrop={e=>{
            e.preventDefault();e.stopPropagation();e.currentTarget.style.transform="translateX(-50%) scale(1)";e.currentTarget.style.background="var(--danger-bg)";e.currentTarget.style.color="var(--danger)";
            const tid=e.dataTransfer.getData("text/plain");const src=e.dataTransfer.getData("application/x-source");
            if(!tid)return;
            if(isSubSource(src)){
              const snapshot=tasks;
              setTasks(prev=>prev.map(t=>({...t,subtasks:deleteSubById(t.subtasks||[],tid)})));
              undoToast.show("Subtask deleted", () => setTasksRaw(snapshot));
            }else{
              const deletedTask=tasks.find(t=>t.id===tid);
              addTombstone(tid);
              setTasks(prev=>prev.filter(t=>t.id!==tid));
              if(selectedTask?.id===tid)setSelectedTask(null);
              undoToast.show(`Deleted "${deletedTask?.title||"task"}"`, () => {
                tombstonesRef.current = tombstonesRef.current.filter(x => x.id !== tid);
                save(TOMBSTONES_KEY, tombstonesRef.current);
                if (deletedTask) setTasksRaw(prev => [deletedTask, ...prev]);
              });
            }
            setIsDragging(false);setSelectedIds(new Set());
          }}
          style={{position:"fixed",bottom:20,left:"50%",padding:"12px 28px",borderRadius:14,background:"var(--danger-bg)",border:"2px solid var(--danger-border)",display:"flex",alignItems:"center",justifyContent:"center",gap:8,color:"var(--danger)",zIndex:1400,animation:"trashPulse 2s ease infinite",transition:"background 0.15s, color 0.15s, border-color 0.15s, transform 0.15s",cursor:"default",boxShadow:"0 4px 20px rgba(239,68,68,0.2)",transform:"translateX(-50%)",fontSize:13,fontWeight:600,whiteSpace:"nowrap"}}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          Drop to delete
        </div>
      )}
      {/* Paper Mode: sunlight through a window pane, cast across the desk */}
      {paperUI&&<WindowLight/>}
    </div>
  );
}

function NavSection({title,action,children}){return(<div style={{marginBottom:14}}><div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,padding:"0 8px",marginBottom:4,display:"flex",alignItems:"center",justifyContent:"space-between"}}>{title}{action&&<button onClick={action} style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:0,display:"flex"}} aria-label={`Add ${title.toLowerCase()}`}>{Icons.plus}</button>}</div>{children}</div>);}
function NavItem({active,icon,label,count,onClick,countColor,labelColor,iconColor}){return(<button onClick={onClick} style={{width:"100%",padding:"8px 10px",borderRadius:"var(--radius-md)",border:"none",background:active?(labelColor?"var(--danger-bg)":"var(--active-bg)"):"transparent",color:active?"var(--ink)":"var(--text)",fontSize:14,fontWeight:active?600:500,cursor:"pointer",display:"flex",alignItems:"center",gap:10,textAlign:"left",transition:"all 0.12s",whiteSpace:"nowrap",fontFamily:"inherit"}}><span style={{display:"flex",flexShrink:0,color:iconColor||undefined}}>{icon}</span><span style={{flex:1,color:labelColor||undefined}}>{typeof label==="string"?label:label}</span>{count>0&&<span style={{fontSize:11,fontWeight:500,minWidth:18,textAlign:"right",color:countColor||"var(--muted)"}}>{count}</span>}</button>);}
