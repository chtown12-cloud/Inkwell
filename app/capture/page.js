"use client";
/* ═══════════════════════════════════════════════════════════════════════
   INKWELL DROP — capture-only mini-app at /capture

   One job: photograph a notebook page, extract tasks, record them. No
   lists, no boards, no browsing — designed to be exempted from app
   blockers (Brick etc.) while the full app stays blocked.

   Import is TRUSTED (no review screen): duplicates are skipped, completed
   duplicates get checked off, new categories become lists — anything the
   scan gets slightly wrong is fixed at the weekly review. Data goes to
   localStorage (shared with the main PWA via the common origin) and, when
   signed in, straight to the Supabase cloud row so other devices see it.
   ═══════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../../lib/supabase";

/* Mirrors of the main app's storage keys + helpers (kept tiny + local so
   this page stays self-contained and loads fast) */
const TASKS_KEY = "inkwell-tasks-v2";
const LISTS_KEY = "inkwell-lists-v2";
const PENDING_SYNC_KEY = "inkwell-pending-sync";
const DEFAULT_LISTS = ["Inbox", "Work", "Personal"];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const load = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
const save = (k, d) => { try { localStorage.setItem(k, JSON.stringify(d)); } catch {} };

/* Scanned subtask tree → app task shape */
const convertSubs = (subs) => (subs || []).map(s => ({
  id: uid(), title: s.title, completed: s.completed || false,
  dueDate: null, startDate: null, endDate: null,
  priority: "none", notes: "", tags: [], subtasks: convertSubs(s.subtasks),
}));

/* Downscale big camera photos before upload (same policy as the main app) */
const downscale = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onerror = () => reject(new Error("Couldn't read the photo"));
  r.onload = (e) => {
    const img = new Image();
    img.onerror = () => reject(new Error("That doesn't look like an image"));
    img.onload = () => {
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      if (scale >= 1 && file.size < 2.5 * 1024 * 1024) {
        resolve({ data: e.target.result.split(",")[1], mediaType: file.type || "image/jpeg" });
        return;
      }
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve({ data: c.toDataURL("image/jpeg", 0.85).split(",")[1], mediaType: "image/jpeg" });
    };
    img.src = e.target.result;
  };
  r.readAsDataURL(file);
});

export default function CapturePage() {
  const [phase, setPhase] = useState("idle"); /* idle | working | done | error */
  const [msg, setMsg] = useState("");
  const [pages, setPages] = useState(0);
  const inputRef = useRef(null);
  const busyRef = useRef(false);

  const processFile = useCallback(async (file) => {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setPhase("working"); setMsg("Reading your page…");
    try {
      /* 1. Current data — cloud row when signed in, else the shared localStorage */
      let cloudUser = null, base = null;
      if (supabase) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            cloudUser = session.user;
            const { data } = await supabase.from("user_data").select("tasks, lists").eq("user_id", session.user.id).single();
            if (data) base = { tasks: data.tasks || [], lists: data.lists || DEFAULT_LISTS };
          }
        } catch (e) { /* offline / no row — fall through to localStorage */ }
      }
      if (!base) base = { tasks: load(TASKS_KEY, []), lists: load(LISTS_KEY, DEFAULT_LISTS) };

      /* 2. Scan */
      const { data: imageData, mediaType } = await downscale(file);
      setMsg("Extracting your handwriting…");
      const res = await fetch("/api/scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageData, mediaType, todayDate: todayStr(),
          existingTasks: base.tasks.map(t => t.title),
          existingLists: base.lists,
        }),
      });
      if (!res.ok) { let m = "Scan failed (" + res.status + ")"; try { const e = await res.json(); m = e.error || m; } catch {} throw new Error(m); }
      const results = await res.json();

      /* 3. Trusted import — same rules as the main app's confirm step */
      const now = () => new Date().toISOString();
      const pageDate = results.page_date;
      let tasks = [...base.tasks], lists = [...base.lists];
      let added = 0, checked = 0, skipped = 0;
      for (const item of (results.items || [])) {
        if (item.is_duplicate_of) {
          const ex = tasks.find(t => t.title.toLowerCase().trim() === item.is_duplicate_of.toLowerCase().trim());
          if (ex && item.completed && !ex.completed) {
            tasks = tasks.map(t => t.id === ex.id ? { ...t, completed: true, completedAt: now(), updatedAt: now() } : t);
            checked++; continue;
          }
          if (ex) { skipped++; continue; }
        }
        const cat = item.category?.trim();
        if (cat && !lists.includes(cat)) lists.push(cat);
        tasks.unshift({
          id: uid(), title: item.title || "Untitled", completed: item.completed || false,
          dueDate: item.date || pageDate || todayStr(), startDate: null, endDate: null,
          priority: item.priority === "high" ? "high" : "none",
          list: cat && lists.includes(cat) ? cat : "Inbox",
          subtasks: convertSubs(item.subtasks), notes: "", tags: [], recurrence: null,
          createdAt: now(), completedAt: item.completed ? now() : null, updatedAt: now(),
        });
        added++;
      }

      /* 4. Persist — localStorage always (shared with the main PWA);
         cloud when signed in, else flag pending so the main app merges */
      save(TASKS_KEY, tasks);
      save(LISTS_KEY, lists);
      save("inkwell-data-ts", now());
      if (cloudUser && tasks.length > 0) {
        const { error } = await supabase.from("user_data")
          .upsert({ user_id: cloudUser.id, tasks, lists, updated_at: now() }, { onConflict: "user_id" });
        if (error) save(PENDING_SYNC_KEY, true);
        else save(PENDING_SYNC_KEY, false);
      } else if (supabase) {
        save(PENDING_SYNC_KEY, true);
      }

      setPages(p => p + 1);
      setPhase("done");
      setMsg(`${added} task${added !== 1 ? "s" : ""} recorded${checked ? ` · ${checked} checked off` : ""}${skipped ? ` · ${skipped} already in` : ""}`);
    } catch (e) {
      setPhase("error"); setMsg(e.message || "Something went wrong — try another photo");
    }
    busyRef.current = false;
  }, []);

  /* Shared-photo pickup (Web Share Target) + service worker registration */
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
    }
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("shared");
    if (!shared) return;
    window.history.replaceState({}, "", "/capture");
    if (shared === "1") {
      (async () => {
        try {
          const cache = await caches.open("inkwell-shared");
          const resp = await cache.match("/__shared-photo");
          if (resp) {
            const blob = await resp.blob();
            await cache.delete("/__shared-photo");
            processFile(new File([blob], "shared.jpg", { type: blob.type || "image/jpeg" }));
          } else {
            setPhase("error"); setMsg("Couldn't find the shared photo — try sharing it again.");
          }
        } catch (e) {
          setPhase("error"); setMsg("Couldn't read the shared photo — try sharing it again.");
        }
      })();
    } else {
      setPhase("error"); setMsg("Sharing wasn't ready yet — it works from the next try. Share the photo again.");
    }
  }, [processFile]);

  const working = phase === "working";
  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      background: "linear-gradient(105deg,#9a6b3e 0%,#8a5a33 40%,#7b4d29 100%)", fontFamily: "'Kalam','Caveat',cursive" }}>
      <div style={{ width: "100%", maxWidth: 420, padding: "38px 30px 44px", textAlign: "center", color: "#33271a",
        background: "#f6efdd", backgroundImage: "radial-gradient(circle, rgba(120,96,58,0.28) 1px, transparent 1.45px)",
        backgroundSize: "19px 19px", borderRadius: "4px 14px 14px 4px",
        boxShadow: "0 22px 50px rgba(38,22,6,0.45), inset 12px 0 20px -16px rgba(46,30,10,0.45)" }}>
        <h1 style={{ fontFamily: "'Caveat','Kalam',cursive", fontWeight: 700, fontSize: 38, lineHeight: 1, margin: 0 }}>Inkwell Drop</h1>
        <div style={{ fontSize: 14, color: "#8f7d5f", margin: "8px 0 30px" }}>scan a page · nothing else</div>

        {working ? (
          <div style={{ padding: "26px 0 30px" }} role="status" aria-live="polite">
            <div style={{ width: 26, height: 26, margin: "0 auto 14px", border: "3px solid rgba(141,107,52,0.25)",
              borderTopColor: "#8d6b34", borderRadius: "50%", animation: "dropSpin 0.8s linear infinite" }}/>
            <div style={{ fontFamily: "'Caveat',cursive", fontSize: 23 }}>{msg}</div>
          </div>
        ) : (
          <>
            {phase === "done" && <div role="status" style={{ fontFamily: "'Caveat',cursive", fontSize: 24, color: "#4a6741", marginBottom: 18 }}>✓ {msg}</div>}
            {phase === "error" && <div role="alert" style={{ fontFamily: "'Caveat',cursive", fontSize: 21, color: "#a33d2f", marginBottom: 18 }}>✗ {msg}</div>}
            <button onClick={() => inputRef.current?.click()}
              style={{ width: "100%", padding: "18px 20px", borderRadius: 14, border: "2px solid #8d6b34",
                background: "rgba(141,107,52,0.1)", color: "#6f5326", fontFamily: "'Kalam',cursive",
                fontSize: 19, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center",
                justifyContent: "center", gap: 10 }}>
              📷 {phase === "done" ? "Scan another page" : "Scan a notebook page"}
            </button>
            {phase === "done" && (
              <div style={{ fontSize: 13.5, color: "#8f7d5f", marginTop: 18, lineHeight: 1.5 }}>
                All recorded{pages > 1 ? ` — ${pages} pages this sitting` : ""}. You can put the phone down now. 🖋
              </div>
            )}
            {phase === "idle" && (
              <div style={{ fontSize: 13, color: "#8f7d5f", marginTop: 18, lineHeight: 1.6 }}>
                Tip: you can also share a photo straight here from your camera roll — Share → <b>Drop</b>.
              </div>
            )}
          </>
        )}
        <input ref={inputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ""; }}/>
        <style>{`@keyframes dropSpin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );
}
