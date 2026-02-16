"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
   ═══════════════════════════════════════════════════════════════════ */
const STORAGE_KEY = "inkwell-tasks";
const LISTS_KEY = "inkwell-lists";

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const PRIORITY = {
  none:   { color: "#a8a29e", label: "None" },
  low:    { color: "#60a5fa", label: "Low" },
  medium: { color: "#fbbf24", label: "Medium" },
  high:   { color: "#f87171", label: "High" },
};

const DEFAULT_LISTS = ["Inbox", "Work", "Personal"];

const LIST_COLORS = {
  Inbox: "#78716c", Work: "#3b82f6", Personal: "#10b981",
};

const todayStr = () => new Date().toISOString().split("T")[0];

const formatDate = (d) => {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (date.getTime() === today.getTime()) return "Today";
  if (date.getTime() === tomorrow.getTime()) return "Tomorrow";
  if (date.getTime() === yesterday.getTime()) return "Yesterday";
  return date.toLocaleDateString("en-IE", {
    month: "short", day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
};

const isOverdue = (d) => {
  if (!d) return false;
  return new Date(d + "T23:59:59") < new Date();
};

const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};

const save = (key, data) => {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
};

/* ═══════════════════════════════════════════════════════════════════
   SVG ICONS
   ═══════════════════════════════════════════════════════════════════ */
const I = ({ children, size = 18, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
    strokeLinejoin="round" {...p}>{children}</svg>
);
const Icons = {
  inbox:    <I><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></I>,
  today:    <I><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></I>,
  upcoming: <I><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></I>,
  all:      <I><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></I>,
  done:     <I><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></I>,
  calendar: <I><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></I>,
  camera:   <I><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></I>,
  plus:     <I><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></I>,
  chevL:    <I size={16}><polyline points="15 18 9 12 15 6"/></I>,
  chevR:    <I size={16}><polyline points="9 18 15 12 9 6"/></I>,
  x:        <I size={16}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></I>,
  trash:    <I size={16}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></I>,
  flag:     <I size={14}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/></I>,
  upload:   <I><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></I>,
  search:   <I size={18}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></I>,
  menu:     <I size={22}><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></I>,
  subtask:  <I size={14}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></I>,
  note:     <I size={14}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></I>,
  sparkle:  <I size={16}><path d="M12 2L14.5 9.5 22 12 14.5 14.5 12 22 9.5 14.5 2 12 9.5 9.5z"/></I>,
  list:     <I size={14}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></I>,
  grip:     <I size={14}><circle cx="9" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="19" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="19" r="1" fill="currentColor" stroke="none"/></I>,
  sun:      <I size={16}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></I>,
};

/* ═══════════════════════════════════════════════════════════════════
   CHECKBOX
   ═══════════════════════════════════════════════════════════════════ */
const Checkbox = ({ checked, onChange, priority = "none", size = 20 }) => (
  <button onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
    aria-label={checked ? "Mark incomplete" : "Mark complete"}
    style={{
      width: size, height: size, borderRadius: 6, flexShrink: 0,
      border: `2px solid ${checked ? PRIORITY[priority].color : (priority !== "none" ? PRIORITY[priority].color : "#d6d3d1")}`,
      background: checked ? PRIORITY[priority].color : "transparent",
      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.2s ease", padding: 0,
    }}>
    {checked && (
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    )}
  </button>
);

/* ═══════════════════════════════════════════════════════════════════
   PHOTO UPLOAD MODAL
   ═══════════════════════════════════════════════════════════════════ */
const PhotoUploadModal = ({ onClose, onProcess, processing }) => {
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const [fileData, setFileData] = useState(null);
  const [mediaType, setMediaType] = useState("image/jpeg");
  const inputRef = useRef(null);

  const handleFile = (file) => {
    if (!file?.type.startsWith("image/")) return;
    setMediaType(file.type);
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target.result);
      setFileData(e.target.result.split(",")[1]);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(28,25,23,0.55)",
      backdropFilter: "blur(8px)", display: "flex", alignItems: "center",
      justifyContent: "center", zIndex: 1000, animation: "fadeIn 0.2s ease",
      padding: 16,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#faf9f7", borderRadius: 20, padding: "28px 28px 24px",
        width: "100%", maxWidth: 500,
        boxShadow: "0 25px 60px rgba(0,0,0,0.3)", position: "relative",
      }}>
        <button onClick={onClose} style={{
          position: "absolute", top: 16, right: 16, background: "none",
          border: "none", cursor: "pointer", color: "#78716c", padding: 4,
        }}>{Icons.x}</button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: "linear-gradient(135deg, #d97706, #ea580c)",
            display: "flex", alignItems: "center", justifyContent: "center", color: "white",
          }}>{Icons.camera}</div>
          <div>
            <h2 style={{ margin: 0, fontSize: 19, fontFamily: "'Playfair Display', serif", color: "#1c1917" }}>
              Scan Notebook Page
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: "#78716c" }}>
              AI extracts and syncs your handwritten to-dos
            </p>
          </div>
        </div>

        {!preview ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? "#d97706" : "#d6d3d1"}`,
              borderRadius: 16, padding: "44px 24px", textAlign: "center",
              cursor: "pointer",
              background: dragOver ? "#fffbeb" : "#faf8f5",
              transition: "all 0.2s ease",
            }}>
            <div style={{ marginBottom: 14, color: dragOver ? "#d97706" : "#a8a29e" }}>{Icons.upload}</div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#44403c" }}>
              Drop your notebook photo here
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "#a8a29e" }}>
              or tap to browse • JPG, PNG, HEIC
            </p>
            <input ref={inputRef} type="file" accept="image/*" capture="environment"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files[0])} />
          </div>
        ) : (
          <div>
            <div style={{
              borderRadius: 12, overflow: "hidden", marginBottom: 16,
              border: "1px solid #e7e5e4", maxHeight: 280,
            }}>
              <img src={preview} alt="Preview"
                style={{ width: "100%", display: "block", objectFit: "contain", maxHeight: 280 }} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setPreview(null); setFileData(null); }}
                style={{
                  flex: 1, padding: "12px 16px", borderRadius: 12,
                  border: "1px solid #d6d3d1", background: "white",
                  color: "#44403c", fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}>
                Change Photo
              </button>
              <button onClick={() => onProcess(fileData, mediaType)} disabled={processing}
                style={{
                  flex: 1, padding: "12px 16px", borderRadius: 12, border: "none",
                  background: processing ? "#a8a29e" : "linear-gradient(135deg, #d97706, #ea580c)",
                  color: "white", fontSize: 14, fontWeight: 600,
                  cursor: processing ? "wait" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}>
                {processing ? (
                  <>
                    <div style={{
                      width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "white", borderRadius: "50%",
                      animation: "spin 0.8s linear infinite",
                    }}/>
                    Scanning...
                  </>
                ) : (
                  <>{Icons.sparkle} Extract To-dos</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   SCAN RESULTS MODAL
   ═══════════════════════════════════════════════════════════════════ */
const ScanResultsModal = ({ results, onConfirm, onClose }) => {
  const [selected, setSelected] = useState(() => results.items.map((_, i) => i));
  const toggle = (i) => setSelected((p) => p.includes(i) ? p.filter((x) => x !== i) : [...p, i]);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(28,25,23,0.55)",
      backdropFilter: "blur(8px)", display: "flex", alignItems: "center",
      justifyContent: "center", zIndex: 1000, padding: 16,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#faf9f7", borderRadius: 20, padding: "28px",
        width: "100%", maxWidth: 500, maxHeight: "80vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ color: "#d97706" }}>{Icons.sparkle}</span>
          <h2 style={{ margin: 0, fontSize: 19, fontFamily: "'Playfair Display', serif" }}>
            Found {results.items.length} Item{results.items.length !== 1 ? "s" : ""}
          </h2>
        </div>
        <p style={{ fontSize: 13, color: "#78716c", margin: "0 0 16px" }}>
          Deselect any items you don't want to add.
        </p>

        {results.page_date && (
          <div style={{
            padding: "8px 12px", background: "#fffbeb", borderRadius: 8,
            marginBottom: 14, fontSize: 13, color: "#92400e",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            {Icons.calendar} Page dated {formatDate(results.page_date)}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", marginBottom: 20 }}>
          {results.items.map((item, idx) => (
            <div key={idx} onClick={() => toggle(idx)} style={{
              display: "flex", alignItems: "flex-start", gap: 12,
              padding: "12px 8px", borderBottom: "1px solid #f5f5f4",
              cursor: "pointer", opacity: selected.includes(idx) ? 1 : 0.35,
              transition: "opacity 0.15s ease",
            }}>
              <Checkbox checked={selected.includes(idx)} onChange={() => toggle(idx)} />
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 14, color: "#1c1917", fontWeight: 500,
                  textDecoration: item.completed ? "line-through" : "none",
                }}>
                  {item.title}
                  {item.completed && (
                    <span style={{
                      marginLeft: 8, fontSize: 11, background: "#dcfce7",
                      color: "#166534", padding: "2px 8px", borderRadius: 4, fontWeight: 600,
                    }}>DONE</span>
                  )}
                </div>
                {item.is_duplicate_of && (
                  <div style={{ fontSize: 12, color: "#d97706", marginTop: 4, fontWeight: 500 }}>
                    ↻ Matches existing: "{item.is_duplicate_of}"
                  </div>
                )}
                {item.category && (
                  <div style={{ fontSize: 12, color: "#78716c", marginTop: 2 }}>
                    📁 {item.category}
                  </div>
                )}
                {!item.date && !results.page_date && (
                  <div style={{ fontSize: 12, color: "#c084fc", marginTop: 2, fontWeight: 500 }}>
                    ⏳ No date — will be flagged
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "12px", borderRadius: 12, border: "1px solid #d6d3d1",
            background: "white", fontSize: 14, fontWeight: 600, cursor: "pointer", color: "#44403c",
          }}>Cancel</button>
          <button onClick={() => onConfirm(results.items.filter((_, i) => selected.includes(i)))}
            style={{
              flex: 1, padding: "12px", borderRadius: 12, border: "none",
              background: "linear-gradient(135deg, #d97706, #ea580c)",
              color: "white", fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>
            Add {selected.length} Task{selected.length !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   TASK DETAIL PANEL
   ═══════════════════════════════════════════════════════════════════ */
const TaskDetail = ({ task, onUpdate, onDelete, onClose, lists }) => {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes || "");
  const [newSub, setNewSub] = useState("");

  useEffect(() => { setTitle(task.title); setNotes(task.notes || ""); }, [task.id]);
  const up = (c) => onUpdate({ ...task, ...c });

  return (
    <div className="detail-panel" style={{
      width: 360, borderLeft: "1px solid #e7e5e4", background: "#faf9f7",
      display: "flex", flexDirection: "column", height: "100%", flexShrink: 0,
      animation: "slideIn 0.2s ease",
    }}>
      {/* Header */}
      <div style={{
        padding: "18px 22px", borderBottom: "1px solid #e7e5e4",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: "#a8a29e",
          textTransform: "uppercase", letterSpacing: 1.2,
        }}>Details</span>
        <div style={{ display: "flex", gap: 2 }}>
          <button onClick={() => onDelete(task.id)} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#d6d3d1", padding: 6, borderRadius: 6, display: "flex",
          }} title="Delete task">{Icons.trash}</button>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#a8a29e", padding: 6, borderRadius: 6, display: "flex",
          }}>{Icons.x}</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}>
        {/* Completed toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <Checkbox checked={task.completed} priority={task.priority}
            onChange={(c) => up({ completed: c, completedAt: c ? new Date().toISOString() : null })} />
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && up({ title: title.trim() })}
            onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
            style={{
              flex: 1, border: "none", background: "none", fontSize: 18,
              fontFamily: "'Playfair Display', serif", fontWeight: 700,
              color: task.completed ? "#a8a29e" : "#1c1917",
              textDecoration: task.completed ? "line-through" : "none",
              outline: "none", padding: 0,
            }} />
        </div>

        {/* Due Date */}
        <Field label="Due Date">
          <input type="date" value={task.dueDate || ""}
            onChange={(e) => up({ dueDate: e.target.value || null })}
            style={fieldInputStyle} />
        </Field>

        {/* Priority */}
        <Field label="Priority">
          <div style={{ display: "flex", gap: 6 }}>
            {Object.entries(PRIORITY).map(([key, { color, label }]) => (
              <button key={key} onClick={() => up({ priority: key })}
                style={{
                  flex: 1, padding: "8px 2px", borderRadius: 8, fontSize: 12,
                  fontWeight: 600, cursor: "pointer", transition: "all 0.15s ease",
                  border: task.priority === key ? `2px solid ${color}` : "1px solid #e7e5e4",
                  background: task.priority === key ? `${color}15` : "white",
                  color: task.priority === key ? color : "#78716c",
                }}>{label}</button>
            ))}
          </div>
        </Field>

        {/* List */}
        <Field label="List">
          <select value={task.list} onChange={(e) => up({ list: e.target.value })}
            style={{ ...fieldInputStyle, cursor: "pointer", appearance: "none", WebkitAppearance: "none" }}>
            {lists.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>

        {/* Subtasks */}
        <Field label={`Subtasks (${(task.subtasks||[]).filter(s=>s.completed).length}/${(task.subtasks||[]).length})`}>
          {(task.subtasks || []).length > 0 && (
            <div style={{
              background: "white", borderRadius: 10, border: "1px solid #e7e5e4",
              overflow: "hidden", marginBottom: 8,
            }}>
              {(task.subtasks || []).map((sub) => (
                <div key={sub.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderBottom: "1px solid #f5f5f4",
                }}>
                  <Checkbox checked={sub.completed} size={16}
                    onChange={(c) => {
                      const subs = (task.subtasks||[]).map(s => s.id === sub.id ? {...s, completed: c} : s);
                      up({ subtasks: subs });
                    }} />
                  <span style={{
                    flex: 1, fontSize: 14,
                    color: sub.completed ? "#a8a29e" : "#44403c",
                    textDecoration: sub.completed ? "line-through" : "none",
                  }}>{sub.title}</span>
                  <button onClick={() => up({ subtasks: (task.subtasks||[]).filter(s => s.id !== sub.id) })}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "#d6d3d1", padding: 2, display: "flex",
                    }}>{Icons.x}</button>
                </div>
              ))}
            </div>
          )}
          <input value={newSub} onChange={(e) => setNewSub(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newSub.trim()) {
                up({ subtasks: [...(task.subtasks||[]), { id: uid(), title: newSub.trim(), completed: false }] });
                setNewSub("");
              }
            }}
            placeholder="Add subtask, press Enter..."
            style={{ ...fieldInputStyle, fontSize: 13 }} />
        </Field>

        {/* Notes */}
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            onBlur={() => up({ notes })} placeholder="Add notes..."
            rows={4} style={{
              ...fieldInputStyle, resize: "vertical", fontFamily: "inherit",
              minHeight: 80,
            }} />
        </Field>

        {/* Metadata */}
        {task.createdAt && (
          <div style={{ fontSize: 12, color: "#a8a29e", marginTop: 12, paddingTop: 12, borderTop: "1px solid #f5f5f4" }}>
            Created {new Date(task.createdAt).toLocaleDateString("en-IE", { month: "short", day: "numeric", year: "numeric" })}
            {task.completedAt && (
              <> · Completed {new Date(task.completedAt).toLocaleDateString("en-IE", { month: "short", day: "numeric" })}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 20 }}>
    <label style={{
      fontSize: 11, fontWeight: 700, color: "#a8a29e", display: "block",
      marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8,
    }}>{label}</label>
    {children}
  </div>
);

const fieldInputStyle = {
  width: "100%", padding: "10px 12px", borderRadius: 10,
  border: "1px solid #e7e5e4", fontSize: 14, color: "#44403c",
  background: "white", fontFamily: "inherit", boxSizing: "border-box",
  outline: "none",
};

/* ═══════════════════════════════════════════════════════════════════
   CALENDAR VIEW
   ═══════════════════════════════════════════════════════════════════ */
const CalendarView = ({ tasks, onSelect }) => {
  const [cur, setCur] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const y = cur.getFullYear(), m = cur.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const first = (new Date(y, m, 1).getDay() + 6) % 7; // Mon=0
  const td = todayStr();

  const byDate = useMemo(() => {
    const map = {};
    tasks.forEach(t => { if (t.dueDate) { (map[t.dueDate] ||= []).push(t); } });
    return map;
  }, [tasks]);

  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <button onClick={() => setCur(new Date(y, m - 1, 1))} style={calNavBtn}>{Icons.chevL}</button>
        <h2 style={{ margin: 0, fontSize: 20, fontFamily: "'Playfair Display', serif", color: "#1c1917" }}>
          {cur.toLocaleDateString("en-IE", { month: "long", year: "numeric" })}
        </h2>
        <button onClick={() => setCur(new Date(y, m + 1, 1))} style={calNavBtn}>{Icons.chevR}</button>
      </div>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1,
        background: "#e7e5e4", borderRadius: 14, overflow: "hidden", border: "1px solid #e7e5e4",
      }}>
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
          <div key={d} style={{
            background: "#f5f5f4", padding: "8px 4px", textAlign: "center",
            fontSize: 11, fontWeight: 700, color: "#a8a29e", textTransform: "uppercase",
            letterSpacing: 0.5,
          }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          const ds = day ? `${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}` : null;
          const dt = ds ? byDate[ds] || [] : [];
          const isT = ds === td;
          return (
            <div key={i} style={{
              background: isT ? "#fffbeb" : "#faf9f7",
              minHeight: 80, padding: 5, fontSize: 12,
            }}>
              {day && (<>
                <div style={{
                  fontSize: 12, fontWeight: isT ? 800 : 500,
                  width: isT ? 24 : "auto", height: isT ? 24 : "auto",
                  borderRadius: "50%", display: isT ? "flex" : "block",
                  alignItems: "center", justifyContent: "center",
                  background: isT ? "#d97706" : "none",
                  color: isT ? "white" : "#44403c", marginBottom: 3,
                }}>{day}</div>
                {dt.slice(0, 3).map(t => (
                  <div key={t.id} onClick={() => onSelect(t)} style={{
                    fontSize: 10, padding: "2px 4px", borderRadius: 3,
                    marginBottom: 2, cursor: "pointer", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500,
                    background: t.completed ? "#f5f5f4" : `${PRIORITY[t.priority].color}15`,
                    color: t.completed ? "#a8a29e" : "#44403c",
                    textDecoration: t.completed ? "line-through" : "none",
                    borderLeft: `2px solid ${PRIORITY[t.priority].color}`,
                  }}>{t.title}</div>
                ))}
                {dt.length > 3 && <div style={{ fontSize: 10, color: "#a8a29e", paddingLeft: 4 }}>+{dt.length - 3}</div>}
              </>)}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const calNavBtn = {
  background: "none", border: "1px solid #e7e5e4", borderRadius: 8,
  padding: "8px 12px", cursor: "pointer", color: "#44403c", display: "flex",
};

/* ═══════════════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════════════ */
export default function InkwellApp() {
  const [tasks, setTasks] = useState([]);
  const [lists, setLists] = useState(DEFAULT_LISTS);
  const [view, setView] = useState("today");
  const [selectedTask, setSelectedTask] = useState(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newList, setNewList] = useState("");
  const [showNewList, setShowNewList] = useState(false);
  const [ready, setReady] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [toast, setToast] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  // Init
  useEffect(() => {
    setTasks(load(STORAGE_KEY, []));
    setLists(load(LISTS_KEY, DEFAULT_LISTS));
    setReady(true);
    setIsMobile(window.innerWidth < 768);
    if (window.innerWidth < 768) setSidebar(false);

    const onResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth < 768) setSidebar(false);
    };
    window.addEventListener("resize", onResize);

    // Register service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Persist
  useEffect(() => { if (ready) save(STORAGE_KEY, tasks); }, [tasks, ready]);
  useEffect(() => { if (ready) save(LISTS_KEY, lists); }, [lists, ready]);

  // Keep selected task in sync
  useEffect(() => {
    if (selectedTask) {
      const updated = tasks.find(t => t.id === selectedTask.id);
      if (updated) setSelectedTask(updated);
      else setSelectedTask(null);
    }
  }, [tasks]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // ── Task CRUD ──────────────────────────────────────────────────────
  const addTask = useCallback((data) => {
    const task = {
      id: uid(),
      title: data.title || "Untitled",
      completed: data.completed || false,
      dueDate: data.dueDate || null,
      priority: data.priority || "none",
      list: data.list || (view.startsWith("list:") ? view.replace("list:", "") : "Inbox"),
      subtasks: data.subtasks || [],
      notes: data.notes || "",
      createdAt: new Date().toISOString(),
      completedAt: data.completed ? new Date().toISOString() : null,
    };
    setTasks(prev => [task, ...prev]);
    return task;
  }, [view]);

  const updateTask = useCallback((updated) => {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
  }, []);

  const toggleTask = useCallback((id) => {
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, completed: !t.completed, completedAt: !t.completed ? new Date().toISOString() : null } : t
    ));
  }, []);

  const deleteTask = useCallback((id) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    if (selectedTask?.id === id) setSelectedTask(null);
  }, [selectedTask]);

  // ── Photo scanning ─────────────────────────────────────────────────
  const handleScan = async (base64, mediaType) => {
    setProcessing(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageData: base64,
          mediaType,
          existingTasks: tasks.map(t => t.title),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Scan failed");
      }
      const results = await res.json();
      setShowPhoto(false);
      setScanResults(results);
    } catch (e) {
      flash("⚠ " + (e.message || "Failed to process photo"));
    }
    setProcessing(false);
  };

  const confirmScan = (items) => {
    let added = 0, checked = 0;
    const pageDate = scanResults?.page_date;

    // Collect all unique categories from scanned items and auto-create lists
    const newCategories = new Set();
    items.forEach(item => {
      if (item.category && item.category.trim()) {
        const cat = item.category.trim();
        if (!lists.includes(cat)) newCategories.add(cat);
      }
    });
    if (newCategories.size > 0) {
      setLists(prev => [...prev, ...Array.from(newCategories)]);
    }

    // Use the updated lists (current + new) for assignment
    const allLists = [...lists, ...Array.from(newCategories)];

    items.forEach(item => {
      if (item.is_duplicate_of) {
        const existing = tasks.find(t =>
          t.title.toLowerCase().trim() === item.is_duplicate_of.toLowerCase().trim()
        );
        if (existing && item.completed && !existing.completed) {
          updateTask({ ...existing, completed: true, completedAt: new Date().toISOString() });
          checked++;
          return;
        }
        if (existing) return;
      }

      // Assign to the scanned category list (auto-created above if needed)
      const targetList = item.category && allLists.includes(item.category.trim())
        ? item.category.trim()
        : "Inbox";

      addTask({
        title: item.title,
        completed: item.completed,
        dueDate: item.date || pageDate || null,
        list: targetList,
      });
      added++;
    });

    setScanResults(null);
    const listMsg = newCategories.size > 0 ? `, created ${newCategories.size} list${newCategories.size !== 1 ? "s" : ""}` : "";
    flash(`✓ Added ${added} task${added !== 1 ? "s" : ""}${checked ? `, checked off ${checked}` : ""}${listMsg}`);
  };

  // ── Filtered tasks ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let f = tasks;
    if (search) {
      const q = search.toLowerCase();
      return f.filter(t => t.title.toLowerCase().includes(q) || (t.notes||"").toLowerCase().includes(q));
    }
    switch (view) {
      case "today":
        f = f.filter(t => !t.completed && (t.dueDate === todayStr() || (!t.dueDate && t.createdAt?.startsWith(todayStr()))));
        break;
      case "upcoming":
        f = f.filter(t => !t.completed && t.dueDate && t.dueDate >= todayStr());
        f.sort((a, b) => (a.dueDate||"").localeCompare(b.dueDate||""));
        break;
      case "all":
        f = f.filter(t => !t.completed);
        break;
      case "completed":
        f = f.filter(t => t.completed);
        f.sort((a, b) => (b.completedAt||"").localeCompare(a.completedAt||""));
        break;
      case "inbox":
        f = f.filter(t => !t.completed && t.list === "Inbox");
        break;
      default:
        if (view.startsWith("list:")) {
          f = f.filter(t => !t.completed && t.list === view.replace("list:", ""));
        }
    }
    return f;
  }, [tasks, view, search]);

  // ── Counts ─────────────────────────────────────────────────────────
  const overdueCount = useMemo(() => tasks.filter(t => !t.completed && isOverdue(t.dueDate)).length, [tasks]);
  const todayCount = useMemo(() => tasks.filter(t => !t.completed && (t.dueDate === todayStr() || (!t.dueDate && t.createdAt?.startsWith(todayStr())))).length, [tasks]);

  const titles = {
    today: "Today", upcoming: "Upcoming", all: "All Tasks",
    completed: "Completed", inbox: "Inbox", calendar: "Calendar",
  };
  const icons = {
    today: Icons.today, upcoming: Icons.upcoming, all: Icons.all,
    completed: Icons.done, inbox: Icons.inbox, calendar: Icons.calendar,
  };
  const viewTitle = titles[view] || (view.startsWith("list:") ? view.replace("list:", "") : "Tasks");
  const viewIcon = icons[view] || Icons.list;

  const selectView = (v) => {
    setView(v);
    setSelectedTask(null);
    setSearch("");
    if (isMobile) setSidebar(false);
  };

  if (!ready) return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Playfair Display', serif", fontSize: 22, color: "#a8a29e" }}>
      Loading...
    </div>
  );

  return (
    <div style={{ height: "100vh", display: "flex", overflow: "hidden" }}>

      {/* ── Mobile sidebar overlay ── */}
      {isMobile && sidebar && (
        <div onClick={() => setSidebar(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 99 }} />
      )}

      {/* ═══ SIDEBAR ═══ */}
      <div className="sidebar" style={{
        width: sidebar ? 260 : 0,
        ...(isMobile ? { position: "fixed", zIndex: 100, height: "100vh" } : {}),
        background: "#f5f4f1", borderRight: "1px solid #e7e5e4",
        display: "flex", flexDirection: "column",
        transition: "width 0.25s ease", overflow: "hidden", flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: "22px 18px 14px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "linear-gradient(135deg, #d97706, #ea580c)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, fontWeight: 800, color: "white",
              fontFamily: "'Playfair Display', serif",
            }}>I</div>
            <span style={{
              fontSize: 20, fontWeight: 700,
              fontFamily: "'Playfair Display', serif",
              color: "#1c1917", whiteSpace: "nowrap",
            }}>Inkwell</span>
          </div>

          {/* Scan button */}
          <button onClick={() => { setShowPhoto(true); if (isMobile) setSidebar(false); }}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 12,
              border: "2px dashed #d6d3d1",
              background: "rgba(217,119,6,0.05)",
              color: "#d97706", fontSize: 13, fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
              transition: "all 0.2s ease", marginBottom: 18, whiteSpace: "nowrap",
            }}>
            {Icons.camera} Scan Notebook Page
          </button>
        </div>

        {/* Nav */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 10px" }}>
          <NavSection title="Smart Lists">
            {[
              { id: "today", icon: Icons.today, label: "Today", count: todayCount },
              { id: "upcoming", icon: Icons.upcoming, label: "Upcoming" },
              { id: "all", icon: Icons.all, label: "All Tasks", count: tasks.filter(t => !t.completed).length },
              { id: "completed", icon: Icons.done, label: "Completed", count: tasks.filter(t => t.completed).length },
              { id: "calendar", icon: Icons.calendar, label: "Calendar" },
            ].map(({ id, icon, label, count }) => (
              <NavItem key={id} active={view === id} icon={icon} label={label}
                count={count} onClick={() => selectView(id)}
                countColor={id === "today" && overdueCount > 0 ? "#dc2626" : undefined} />
            ))}
          </NavSection>

          <NavSection title="Lists" action={() => setShowNewList(true)}>
            {lists.map(l => {
              const lv = l === "Inbox" ? "inbox" : `list:${l}`;
              return (
                <NavItem key={l} active={view === lv} label={l}
                  count={tasks.filter(t => !t.completed && t.list === l).length}
                  onClick={() => selectView(lv)}
                  icon={<span style={{
                    width: 8, height: 8, borderRadius: "50%", display: "inline-block",
                    background: LIST_COLORS[l] || "#d97706",
                  }}/>} />
              );
            })}
            {showNewList && (
              <div style={{ padding: "4px 6px" }}>
                <input autoFocus value={newList}
                  onChange={(e) => setNewList(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newList.trim() && !lists.includes(newList.trim())) {
                      setLists(p => [...p, newList.trim()]);
                      setNewList(""); setShowNewList(false);
                    }
                    if (e.key === "Escape") { setShowNewList(false); setNewList(""); }
                  }}
                  onBlur={() => { setShowNewList(false); setNewList(""); }}
                  placeholder="List name..."
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: 8,
                    border: "1px solid #d97706", fontSize: 13, outline: "none",
                    background: "white", fontFamily: "inherit",
                  }} />
              </div>
            )}
          </NavSection>
        </div>

        {overdueCount > 0 && (
          <div style={{
            margin: "0 10px 10px", padding: "10px 14px", borderRadius: 10,
            background: "#fef2f2", border: "1px solid #fecaca",
            fontSize: 13, color: "#dc2626", fontWeight: 600,
          }}>⚠ {overdueCount} overdue task{overdueCount !== 1 ? "s" : ""}</div>
        )}
      </div>

      {/* ═══ MAIN ═══ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header */}
        <div style={{
          padding: isMobile ? "14px 16px" : "14px 26px",
          borderBottom: "1px solid #e7e5e4",
          display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
        }}>
          <button onClick={() => setSidebar(!sidebar)} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#78716c", padding: 4, display: "flex",
          }}>{Icons.menu}</button>

          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {!showSearch ? (<>
              <span style={{ color: "#d97706", flexShrink: 0 }}>{viewIcon}</span>
              <h1 style={{
                margin: 0, fontSize: isMobile ? 20 : 22,
                fontFamily: "'Playfair Display', serif",
                fontWeight: 700, color: "#1c1917",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{viewTitle}</h1>
              {view === "today" && !isMobile && (
                <span style={{ fontSize: 13, color: "#a8a29e" }}>
                  {new Date().toLocaleDateString("en-IE", { weekday: "long", month: "long", day: "numeric" })}
                </span>
              )}
            </>) : (
              <input autoFocus value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setShowSearch(false); setSearch(""); } }}
                placeholder="Search tasks..."
                style={{
                  flex: 1, padding: "10px 14px", borderRadius: 12,
                  border: "1px solid #e7e5e4", fontSize: 15, outline: "none",
                  background: "white", fontFamily: "inherit", minWidth: 0,
                }} />
            )}
          </div>

          <button onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearch(""); }}
            style={{
              background: showSearch ? "#e7e5e4" : "none",
              border: "none", cursor: "pointer", color: "#78716c",
              padding: 8, borderRadius: 8, display: "flex", flexShrink: 0,
            }}>{Icons.search}</button>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "16px" : "20px 26px" }}>

            {view === "calendar" ? (
              <CalendarView tasks={tasks} onSelect={t => setSelectedTask(t)} />
            ) : (<>
              {/* Quick add */}
              {view !== "completed" && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", background: "white", borderRadius: 14,
                  border: "1px solid #e7e5e4", marginBottom: 16,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}>
                  <span style={{ color: "#d97706", flexShrink: 0 }}>{Icons.plus}</span>
                  <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newTitle.trim()) {
                        const t = addTask({ title: newTitle.trim(), dueDate: view === "today" ? todayStr() : null });
                        setNewTitle("");
                        flash(`✓ Added "${t.title}"`);
                      }
                    }}
                    placeholder="Add a task... (press Enter)"
                    style={{
                      flex: 1, border: "none", outline: "none", fontSize: 15,
                      color: "#1c1917", background: "none", fontFamily: "inherit",
                      minWidth: 0,
                    }} />
                </div>
              )}

              {/* Empty state */}
              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "50px 20px", color: "#a8a29e" }}>
                  <div style={{ fontSize: 44, marginBottom: 14, opacity: 0.4 }}>
                    {view === "completed" ? "🎉" : view === "today" ? "☀️" : search ? "🔍" : "📋"}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                    {view === "completed" ? "No completed tasks yet" :
                      search ? "No matching tasks" : "All clear!"}
                  </div>
                  <div style={{ fontSize: 14 }}>
                    {view === "completed" ? "Complete some tasks to see them here" :
                      search ? "Try a different search" : "Add a task above or scan a notebook page"}
                  </div>
                </div>
              ) : (
                /* Task list */
                <div>
                  {filtered.map((task, i) => {
                    const overdue = !task.completed && isOverdue(task.dueDate);
                    const subDone = (task.subtasks||[]).filter(s => s.completed).length;
                    const subTotal = (task.subtasks||[]).length;
                    const active = selectedTask?.id === task.id;

                    return (
                      <div key={task.id} onClick={() => setSelectedTask(task)}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: 12,
                          padding: "12px 14px", borderRadius: 12, marginBottom: 2,
                          background: active ? "#f5f5f4" : "transparent",
                          cursor: "pointer", transition: "background 0.15s ease",
                          animation: `slideUp 0.2s ease ${Math.min(i * 0.02, 0.3)}s both`,
                        }}>
                        <div style={{ paddingTop: 2 }}>
                          <Checkbox checked={task.completed} priority={task.priority}
                            onChange={() => toggleTask(task.id)} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 15, fontWeight: 500, lineHeight: 1.4,
                            color: task.completed ? "#a8a29e" : "#1c1917",
                            textDecoration: task.completed ? "line-through" : "none",
                            marginBottom: 3,
                          }}>{task.title}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            {task.dueDate ? (
                              <span style={{
                                fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 3,
                                color: overdue ? "#dc2626" : task.dueDate === todayStr() ? "#d97706" : "#78716c",
                              }}>{Icons.calendar} {formatDate(task.dueDate)}</span>
                            ) : !task.completed && (
                              <span style={{
                                fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 3,
                                color: "#c084fc", background: "#faf5ff",
                                padding: "1px 8px", borderRadius: 4, border: "1px solid #e9d5ff",
                              }}>{Icons.calendar} No date</span>
                            )}
                            {task.priority !== "none" && (
                              <span style={{
                                fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 3,
                                color: PRIORITY[task.priority].color,
                              }}>{Icons.flag} {PRIORITY[task.priority].label}</span>
                            )}
                            {subTotal > 0 && (
                              <span style={{
                                fontSize: 12, display: "flex", alignItems: "center", gap: 3,
                                color: subDone === subTotal ? "#16a34a" : "#a8a29e",
                              }}>{Icons.subtask} {subDone}/{subTotal}</span>
                            )}
                            {task.notes && (
                              <span style={{ color: "#d6d3d1", display: "flex" }}>{Icons.note}</span>
                            )}
                            {!view.startsWith("list:") && view !== "inbox" && (
                              <span style={{
                                fontSize: 11, color: "#a8a29e", background: "#f5f5f4",
                                padding: "1px 7px", borderRadius: 4,
                              }}>{task.list}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>)}
          </div>

          {/* Detail panel */}
          {selectedTask && !isMobile && (
            <TaskDetail task={selectedTask} onUpdate={updateTask}
              onDelete={deleteTask} onClose={() => setSelectedTask(null)} lists={lists} />
          )}
        </div>

        {/* Mobile detail panel as modal */}
        {selectedTask && isMobile && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(28,25,23,0.4)",
            zIndex: 100, display: "flex", justifyContent: "flex-end",
          }} onClick={() => setSelectedTask(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 400 }}>
              <TaskDetail task={selectedTask} onUpdate={updateTask}
                onDelete={deleteTask} onClose={() => setSelectedTask(null)} lists={lists} />
            </div>
          </div>
        )}
      </div>

      {/* ═══ MODALS ═══ */}
      {showPhoto && (
        <PhotoUploadModal onClose={() => setShowPhoto(false)}
          onProcess={handleScan} processing={processing} />
      )}
      {scanResults && (
        <ScanResultsModal results={scanResults}
          onConfirm={confirmScan} onClose={() => setScanResults(null)} />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%",
          transform: "translateX(-50%)", background: "#1c1917",
          color: "white", padding: "12px 24px", borderRadius: 12,
          fontSize: 14, fontWeight: 600,
          boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          animation: "toastIn 0.3s ease", zIndex: 2000,
          whiteSpace: "nowrap",
        }}>{toast}</div>
      )}
    </div>
  );
}

/* ── Sidebar nav helpers ──────────────────────────────────────────── */
function NavSection({ title, action, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: "#a8a29e",
        textTransform: "uppercase", letterSpacing: 1,
        padding: "0 8px", marginBottom: 4,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        {title}
        {action && (
          <button onClick={action} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#a8a29e", padding: 0, display: "flex",
          }}>{Icons.plus}</button>
        )}
      </div>
      {children}
    </div>
  );
}

function NavItem({ active, icon, label, count, onClick, countColor }) {
  return (
    <button onClick={onClick} style={{
      width: "100%", padding: "9px 10px", borderRadius: 10, border: "none",
      background: active ? "#e7e5e4" : "transparent",
      color: active ? "#1c1917" : "#57534e",
      fontSize: 14, fontWeight: active ? 600 : 500,
      cursor: "pointer", display: "flex", alignItems: "center",
      gap: 10, textAlign: "left",
      transition: "all 0.12s ease", whiteSpace: "nowrap",
    }}>
      <span style={{ display: "flex", flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {count > 0 && (
        <span style={{
          fontSize: 12, fontWeight: 700, minWidth: 18, textAlign: "right",
          color: countColor || "#a8a29e",
        }}>{count}</span>
      )}
    </button>
  );
}
