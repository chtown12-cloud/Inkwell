"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
   ═══════════════════════════════════════════════════════════════════════ */
const TASKS_KEY = "inkwell-tasks-v2";
const LISTS_KEY = "inkwell-lists-v2";
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const todayStr = () => new Date().toISOString().split("T")[0];

const PRIORITY = {
  none:   { color: "#94a3b8", label: "None" },
  low:    { color: "#38bdf8", label: "Low" },
  medium: { color: "#fb923c", label: "Medium" },
  high:   { color: "#f43f5e", label: "High" },
};

const DEFAULT_LISTS = ["Inbox", "Work", "Personal"];
const LIST_PALETTE = ["#64748b","#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6","#f97316","#6366f1"];

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

/* Recursive subtask helpers */
const countSubs = (subs) => { if(!subs?.length) return {total:0,done:0}; let t=0,d=0; for(const s of subs){t++;if(s.completed)d++;const c=countSubs(s.subtasks);t+=c.total;d+=c.done;} return{total:t,done:d}; };
const updateSubById = (subs, id, changes) => {
  if(!subs) return subs;
  return subs.map(s => s.id===id ? {...s,...changes} : {...s, subtasks: updateSubById(s.subtasks, id, changes)});
};
const removeSubById = (subs, id) => {
  if(!subs) return subs;
  return subs.filter(s=>s.id!==id).map(s=>({...s, subtasks: removeSubById(s.subtasks, id)}));
};
const addSubTo = (subs, parentId, newSub) => {
  if(!subs) return subs;
  return subs.map(s => s.id===parentId ? {...s, subtasks:[...(s.subtasks||[]), newSub]} : {...s, subtasks: addSubTo(s.subtasks, parentId, newSub)});
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
  tag:      <I size={14}><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></I>,
  duration: <I size={14}><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 00-.586-1.414L12 12l-4.414 4.414A2 2 0 007 17.828V22"/><path d="M7 2v4.172a2 2 0 00.586 1.414L12 12l4.414-4.414A2 2 0 0017 6.172V2"/></I>,
  keyboard: <I size={16}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></I>,
};

/* ═══════════════════════════════════════════════════════════════════════
   CHECKBOX
   ═══════════════════════════════════════════════════════════════════════ */
const Checkbox = ({checked, onChange, priority="none", size=20}) => (
  <button onClick={e=>{e.stopPropagation();onChange(!checked);}}
    aria-label={checked?"Mark incomplete":"Mark complete"} role="checkbox" aria-checked={checked}
    style={{width:size,height:size,borderRadius:6,flexShrink:0,padding:0,
      border:`2px solid ${checked?PRIORITY[priority].color:(priority!=="none"?PRIORITY[priority].color:"#cbd5e1")}`,
      background:checked?PRIORITY[priority].color:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s ease"}}>
    {checked && <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
  </button>
);

/* ═══════════════════════════════════════════════════════════════════════
   EDITABLE TEXT (double-click to rename lists, headers, etc)
   ═══════════════════════════════════════════════════════════════════════ */
const EditableText = ({value, onSave, style={}, tag:Tag="span"}) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const ref = useRef(null);
  useEffect(()=>{setText(value);},[value]);
  useEffect(()=>{if(editing&&ref.current){ref.current.focus();ref.current.select();}},[editing]);
  if(!editing) return <Tag onDoubleClick={()=>setEditing(true)} title="Double-click to rename" style={{...style,cursor:"default"}}>{value}</Tag>;
  return <input ref={ref} value={text} onChange={e=>setText(e.target.value)}
    onBlur={()=>{if(text.trim()&&text.trim()!==value)onSave(text.trim());setEditing(false);}}
    onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape"){setText(value);setEditing(false);}}}
    style={{border:"none",outline:"none",background:"rgba(37,99,235,0.08)",borderRadius:4,padding:"2px 6px",fontFamily:"inherit",...style}} />;
};

/* ═══════════════════════════════════════════════════════════════════════
   SHARED UI
   ═══════════════════════════════════════════════════════════════════════ */
const Overlay = ({onClose,children,wide}) => (
  <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.45)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,animation:"fadeIn 0.2s ease",padding:16}} onClick={onClose} role="dialog" aria-modal="true">
    <div onClick={e=>e.stopPropagation()} style={{background:"var(--bg)",borderRadius:20,padding:28,width:"100%",maxWidth:wide?560:500,boxShadow:"0 25px 60px rgba(0,0,0,0.25)",position:"relative",display:"flex",flexDirection:"column",maxHeight:"90vh"}}>
      <button onClick={onClose} style={{position:"absolute",top:16,right:16,background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:4}} aria-label="Close">{Icons.x}</button>
      {children}
    </div>
  </div>
);
const Btn = ({children,variant="primary",...p}) => (
  <button {...p} style={{flex:1,padding:"12px 16px",borderRadius:12,border:variant==="secondary"?"1px solid var(--border)":"none",background:variant==="secondary"?"white":"linear-gradient(135deg,#1e40af,#7c3aed)",color:variant==="secondary"?"var(--text)":"white",fontSize:14,fontWeight:600,cursor:p.disabled?"wait":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"inherit",opacity:p.disabled?0.6:1,...(p.style||{})}}>{children}</button>
);
const IconBtn = ({children,...p}) => (<button {...p} style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:6,borderRadius:6,display:"flex",...(p.style||{})}}>{children}</button>);
const Spinner = () => <div style={{width:16,height:16,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"white",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>;
const Field = ({label,children}) => (<div style={{marginBottom:18}}><label style={{fontSize:11,fontWeight:700,color:"var(--muted)",display:"block",marginBottom:7,textTransform:"uppercase",letterSpacing:0.8}}>{label}</label>{children}</div>);
const fieldInput = {width:"100%",padding:"10px 12px",borderRadius:10,border:"1px solid var(--border)",fontSize:14,color:"var(--text)",background:"white",fontFamily:"inherit",boxSizing:"border-box",outline:"none"};

/* ═══════════════════════════════════════════════════════════════════════
   RECURSIVE SUBTASK TREE (infinite nesting)
   ═══════════════════════════════════════════════════════════════════════ */
const SubtaskTree = ({subtasks, onUpdate, depth=0, compact=false}) => {
  const [openIds, setOpenIds] = useState({});
  const [addingTo, setAddingTo] = useState(null);
  const [addText, setAddText] = useState("");
  const toggle = id => setOpenIds(p=>({...p,[id]:!p[id]}));
  if(!subtasks?.length && !compact) return null;
  const indent = compact ? 0 : Math.min(depth * 20, 60);
  return (
    <div style={{paddingLeft:indent}}>
      {(subtasks||[]).map(sub => {
        const childCount = countSubs(sub.subtasks);
        const hasChildren = (sub.subtasks||[]).length > 0;
        const isOpen = openIds[sub.id];
        return (
          <div key={sub.id}>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:compact?"6px 0":"4px 0",fontSize:compact?14:13}}>
              <Checkbox checked={sub.completed} size={compact?16:15} onChange={c=>onUpdate(updateSubById(null,sub.id,{completed:c}),sub.id,{completed:c})}/>
              <span style={{flex:1,color:sub.completed?"var(--muted)":"var(--text)",textDecoration:sub.completed?"line-through":"none",minWidth:0}}>{sub.title}</span>
              {hasChildren && (
                <button onClick={()=>toggle(sub.id)} style={{background:"none",border:"none",cursor:"pointer",padding:2,color:"var(--muted)",display:"flex",alignItems:"center",gap:2,fontSize:11,fontFamily:"inherit"}}>
                  {childCount.done}/{childCount.total}
                  <span style={{transform:isOpen?"rotate(0)":"rotate(-90deg)",transition:"transform 0.15s",display:"flex"}}>{Icons.chevD}</span>
                </button>
              )}
              {compact && (
                <button onClick={()=>{setAddingTo(addingTo===sub.id?null:sub.id);setAddText("");}} style={{background:"none",border:"none",cursor:"pointer",padding:2,color:"var(--muted)",display:"flex",fontSize:11}} title="Add sub-subtask">
                  {Icons.plus}
                </button>
              )}
              {compact && <IconBtn onClick={()=>onUpdate(null,sub.id,null,"remove")} aria-label="Remove subtask">{Icons.x}</IconBtn>}
            </div>
            {/* Inline add for this subtask's children */}
            {compact && addingTo===sub.id && (
              <div style={{paddingLeft:20,paddingBottom:4}}>
                <input autoFocus value={addText} onChange={e=>setAddText(e.target.value)} placeholder="Add nested subtask..."
                  onKeyDown={e=>{if(e.key==="Enter"&&addText.trim()){onUpdate(null,sub.id,{id:uid(),title:addText.trim(),completed:false,subtasks:[]},"add");setAddText("");setAddingTo(null);}if(e.key==="Escape"){setAddingTo(null);setAddText("");}}}
                  onBlur={()=>{setAddingTo(null);setAddText("");}}
                  style={{width:"100%",padding:"6px 10px",borderRadius:8,border:"1px solid var(--accent)",fontSize:13,outline:"none",background:"white",fontFamily:"inherit"}}/>
              </div>
            )}
            {/* Recursive children */}
            {hasChildren && isOpen && (
              <SubtaskTree subtasks={sub.subtasks} onUpdate={onUpdate} depth={depth+1} compact={compact}/>
            )}
          </div>
        );
      })}
    </div>
  );
};
const calNav = {background:"none",border:"1px solid var(--border)",borderRadius:8,padding:"8px 12px",cursor:"pointer",color:"var(--text)",display:"flex"};

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
        <div style={{width:40,height:40,borderRadius:12,background:"linear-gradient(135deg,#1e40af,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",color:"white"}}>{Icons.camera}</div>
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
   SCAN RESULTS MODAL (editable names + list dropdowns)
   ═══════════════════════════════════════════════════════════════════════ */
const ScanResultsModal = ({results,onConfirm,onClose,lists}) => {
  const [items,setItems]=useState(()=>results.items.map((it,i)=>({...it,_selected:true,_id:i})));
  const [newListInputs,setNewListInputs]=useState({});
  const [localLists,setLocalLists]=useState([]);
  const allLists = [...lists, ...localLists.filter(l=>!lists.includes(l))];
  const updateItem=(idx,changes)=>setItems(prev=>prev.map((it,i)=>i===idx?{...it,...changes}:it));
  const toggle=idx=>updateItem(idx,{_selected:!items[idx]._selected});
  const selected=items.filter(it=>it._selected);
  const addNewList = (idx, name) => {
    if(!name.trim()) return;
    const n = name.trim();
    if(!localLists.includes(n) && !lists.includes(n)) setLocalLists(prev=>[...prev, n]);
    updateItem(idx, {category: n});
    setNewListInputs(p=>({...p,[idx]:false}));
  };
  return (
    <Overlay onClose={onClose} wide>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
        <span style={{color:"var(--accent)"}}>{Icons.sparkle}</span>
        <h2 style={{margin:0,fontSize:19,fontFamily:"var(--font-display)"}}>Found {items.length} Item{items.length!==1?"s":""}</h2>
      </div>
      <p style={{fontSize:13,color:"var(--muted)",margin:"0 0 16px"}}>Edit task names or reassign lists before adding.</p>
      {results.page_date&&(<div style={{padding:"8px 12px",background:"var(--accent-bg)",borderRadius:8,marginBottom:14,fontSize:13,color:"var(--accent-dark)",display:"flex",alignItems:"center",gap:6}}>{Icons.calendar} Page dated {formatDate(results.page_date)}</div>)}
      <div style={{flex:1,overflowY:"auto",marginBottom:20,maxHeight:"50vh"}}>
        {items.map((item,idx)=>(
          <div key={idx} style={{padding:"12px 8px",borderBottom:"1px solid var(--border-light)",opacity:item._selected?1:0.3,transition:"opacity 0.15s"}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <div style={{paddingTop:2}}><Checkbox checked={item._selected} onChange={()=>toggle(idx)}/></div>
              <div style={{flex:1,minWidth:0}}>
                <input value={item.title} onChange={e=>updateItem(idx,{title:e.target.value})}
                  style={{width:"100%",border:"1px solid transparent",borderRadius:6,padding:"4px 8px",fontSize:14,fontWeight:500,color:"var(--ink)",background:"transparent",outline:"none",fontFamily:"inherit",boxSizing:"border-box",textDecoration:item.completed?"line-through":"none"}}
                  onFocus={e=>{e.target.style.borderColor="var(--accent)";e.target.style.background="white";}}
                  onBlur={e=>{e.target.style.borderColor="transparent";e.target.style.background="transparent";}}/>
                <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4,paddingLeft:8,flexWrap:"wrap"}}>
                  <select value={item.category||""} onChange={e=>{const v=e.target.value;if(v==="__new__"){setNewListInputs(p=>({...p,[idx]:true}));return;}updateItem(idx,{category:v||null});}}
                    style={{fontSize:12,padding:"2px 6px",borderRadius:4,border:"1px solid var(--border)",background:"white",color:"var(--text)",cursor:"pointer",fontFamily:"inherit"}}>
                    <option value="">Inbox</option>
                    {allLists.filter(l=>l!=="Inbox").map(l=><option key={l} value={l}>{l}</option>)}
                    <option value="__new__">+ New list...</option>
                  </select>
                  {newListInputs[idx]&&(<input autoFocus placeholder="List name..." style={{fontSize:12,padding:"2px 6px",borderRadius:4,border:"1px solid var(--accent)",width:100,outline:"none",fontFamily:"inherit"}}
                    onKeyDown={e=>{if(e.key==="Enter"){addNewList(idx,e.target.value);}if(e.key==="Escape")setNewListInputs(p=>({...p,[idx]:false}));}}
                    onBlur={e=>{if(e.target.value.trim())addNewList(idx,e.target.value);else setNewListInputs(p=>({...p,[idx]:false}));}}/>)}
                  {item.completed&&<span style={{fontSize:11,background:"#dcfce7",color:"#166534",padding:"1px 7px",borderRadius:4,fontWeight:600}}>DONE</span>}
                  {item.is_duplicate_of&&<span style={{fontSize:11,color:"#d97706",fontWeight:500}}>↻ matches &quot;{item.is_duplicate_of}&quot;</span>}
                  {!item.date&&!results.page_date&&<span style={{fontSize:11,color:"#a78bfa",fontWeight:500}}>defaults to today</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:10,flexShrink:0}}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={()=>onConfirm(selected)}>Add {selected.length} Task{selected.length!==1?"s":""}</Btn>
      </div>
    </Overlay>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   TASK DETAIL PANEL
   ═══════════════════════════════════════════════════════════════════════ */
const TaskDetail = ({task,onUpdate,onDelete,onClose,lists}) => {
  const [title,setTitle]=useState(task.title);
  const [notes,setNotes]=useState(task.notes||"");
  const [newSub,setNewSub]=useState("");
  const [newTag,setNewTag]=useState("");
  useEffect(()=>{setTitle(task.title);setNotes(task.notes||"");},[task.id]);
  const up=c=>onUpdate({...task,...c});
  const durationDays = task.startDate&&task.endDate ? Math.max(1,Math.ceil((new Date(task.endDate)-new Date(task.startDate))/(86400000))) : null;
  return (
    <div className="detail-panel" role="complementary" aria-label="Task details"
      style={{width:380,borderLeft:"1px solid var(--border)",background:"var(--bg)",display:"flex",flexDirection:"column",height:"100%",flexShrink:0,animation:"slideIn 0.2s ease"}}>
      <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1.2}}>Task Details</span>
        <div style={{display:"flex",gap:2}}>
          <IconBtn onClick={()=>onDelete(task.id)} title="Delete" aria-label="Delete task">{Icons.trash}</IconBtn>
          <IconBtn onClick={onClose} aria-label="Close">{Icons.x}</IconBtn>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"18px 20px"}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:20}}>
          <div style={{paddingTop:4}}><Checkbox checked={task.completed} priority={task.priority} onChange={c=>up({completed:c,completedAt:c?new Date().toISOString():null})}/></div>
          <textarea value={title} onChange={e=>setTitle(e.target.value)} rows={1} onBlur={()=>title.trim()&&up({title:title.trim()})} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.target.blur();}}}
            style={{flex:1,border:"none",background:"none",fontSize:18,fontFamily:"var(--font-display)",fontWeight:700,color:task.completed?"var(--muted)":"var(--ink)",textDecoration:task.completed?"line-through":"none",outline:"none",padding:0,resize:"none",lineHeight:1.3,overflow:"hidden"}}/>
        </div>
        <Field label="Due Date"><input type="date" value={task.dueDate||""} onChange={e=>up({dueDate:e.target.value||null})} style={fieldInput}/></Field>
        <Field label="Duration (Start → End)">
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input type="date" value={task.startDate||""} onChange={e=>up({startDate:e.target.value||null})} style={{...fieldInput,flex:1}}/>
            <span style={{color:"var(--muted)",fontSize:13,flexShrink:0}}>→</span>
            <input type="date" value={task.endDate||""} onChange={e=>up({endDate:e.target.value||null})} style={{...fieldInput,flex:1}}/>
          </div>
          {durationDays&&<div style={{fontSize:12,color:"var(--muted)",marginTop:6}}>{durationDays} day{durationDays!==1?"s":""}</div>}
        </Field>
        <Field label="Priority">
          <div style={{display:"flex",gap:6}}>
            {Object.entries(PRIORITY).map(([k,{color,label}])=>(
              <button key={k} onClick={()=>up({priority:k})} style={{flex:1,padding:"8px 2px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s",border:task.priority===k?`2px solid ${color}`:"1px solid var(--border)",background:task.priority===k?`${color}12`:"white",color:task.priority===k?color:"var(--muted)"}}>{label}</button>
            ))}
          </div>
        </Field>
        <Field label="List">
          <select value={task.list} onChange={e=>up({list:e.target.value})} style={{...fieldInput,cursor:"pointer",appearance:"none",WebkitAppearance:"none"}}>
            {lists.map(l=><option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Tags">
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
            {(task.tags||[]).map(t=>(
              <span key={t} style={{fontSize:12,padding:"2px 8px",borderRadius:12,background:"var(--accent-bg)",color:"var(--accent-dark)",display:"flex",alignItems:"center",gap:4,fontWeight:500}}>
                #{t}<button onClick={()=>up({tags:(task.tags||[]).filter(x=>x!==t)})} style={{background:"none",border:"none",cursor:"pointer",color:"var(--accent)",padding:0,fontSize:14,lineHeight:1}}>×</button>
              </span>
            ))}
          </div>
          <input value={newTag} onChange={e=>setNewTag(e.target.value)} placeholder="Add tag, press Enter..."
            onKeyDown={e=>{if(e.key==="Enter"&&newTag.trim()){const tag=newTag.trim().replace(/^#/,"");if(!(task.tags||[]).includes(tag))up({tags:[...(task.tags||[]),tag]});setNewTag("");}}}
            style={{...fieldInput,fontSize:13}}/>
        </Field>
        <Field label={`Subtasks (${countSubs(task.subtasks).done}/${countSubs(task.subtasks).total})`}>
          {(task.subtasks||[]).length>0&&(
            <div style={{background:"white",borderRadius:10,border:"1px solid var(--border)",overflow:"hidden",marginBottom:8,padding:"6px 12px"}}>
              <SubtaskTree subtasks={task.subtasks} compact={true} onUpdate={(_, targetId, changes, action)=>{
                if(action==="remove") up({subtasks: removeSubById(task.subtasks, targetId)});
                else if(action==="add") up({subtasks: addSubTo(task.subtasks, targetId, changes)});
                else up({subtasks: updateSubById(task.subtasks, targetId, changes)});
              }}/>
            </div>
          )}
          <input value={newSub} onChange={e=>setNewSub(e.target.value)} placeholder="Add subtask, press Enter..."
            onKeyDown={e=>{if(e.key==="Enter"&&newSub.trim()){up({subtasks:[...(task.subtasks||[]),{id:uid(),title:newSub.trim(),completed:false,subtasks:[]}]});setNewSub("");}}}
            style={{...fieldInput,fontSize:13}}/>
        </Field>
        <Field label="Notes"><textarea value={notes} onChange={e=>setNotes(e.target.value)} onBlur={()=>up({notes})} placeholder="Add notes..." rows={4} style={{...fieldInput,resize:"vertical",minHeight:80,fontFamily:"inherit"}}/></Field>
        {task.createdAt&&<div style={{fontSize:12,color:"var(--muted)",marginTop:8,paddingTop:12,borderTop:"1px solid var(--border-light)"}}>Created {new Date(task.createdAt).toLocaleDateString("en-IE",{month:"short",day:"numeric",year:"numeric"})}{task.completedAt&&<> · Done {new Date(task.completedAt).toLocaleDateString("en-IE",{month:"short",day:"numeric"})}</>}</div>}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   CALENDAR VIEW
   ═══════════════════════════════════════════════════════════════════════ */
const CalendarView = ({tasks,onSelect}) => {
  const [cur,setCur]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1);});
  const y=cur.getFullYear(),m=cur.getMonth();
  const days=new Date(y,m+1,0).getDate();
  const first=(new Date(y,m,1).getDay()+6)%7;
  const td=todayStr();
  const byDate=useMemo(()=>{const map={};tasks.forEach(t=>{if(t.dueDate)(map[t.dueDate]||=[]).push(t);});return map;},[tasks]);
  const cells=[];for(let i=0;i<first;i++)cells.push(null);for(let d=1;d<=days;d++)cells.push(d);
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <button onClick={()=>setCur(new Date(y,m-1,1))} style={calNav}>{Icons.chevL}</button>
        <h2 style={{margin:0,fontSize:20,fontFamily:"var(--font-display)",color:"var(--ink)"}}>{cur.toLocaleDateString("en-IE",{month:"long",year:"numeric"})}</h2>
        <button onClick={()=>setCur(new Date(y,m+1,1))} style={calNav}>{Icons.chevR}</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1,background:"var(--border)",borderRadius:14,overflow:"hidden",border:"1px solid var(--border)"}}>
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>(<div key={d} style={{background:"var(--surface)",padding:"8px 4px",textAlign:"center",fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.5}}>{d}</div>))}
        {cells.map((day,i)=>{const ds=day?`${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`:null;const dt=ds?byDate[ds]||[]:[];const isT=ds===td;
          return (<div key={i} style={{background:isT?"var(--accent-bg)":"var(--bg)",minHeight:80,padding:5}}>
            {day&&(<><div style={{fontSize:12,fontWeight:isT?800:500,width:isT?24:"auto",height:isT?24:"auto",borderRadius:"50%",display:isT?"flex":"block",alignItems:"center",justifyContent:"center",background:isT?"var(--accent)":"none",color:isT?"white":"var(--text)",marginBottom:3}}>{day}</div>
              {dt.slice(0,3).map(t=>(<div key={t.id} onClick={()=>onSelect(t)} style={{fontSize:10,padding:"2px 4px",borderRadius:3,marginBottom:2,cursor:"pointer",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:500,background:t.completed?"var(--surface)":`${PRIORITY[t.priority].color}12`,color:t.completed?"var(--muted)":"var(--text)",textDecoration:t.completed?"line-through":"none",borderLeft:`2px solid ${PRIORITY[t.priority].color}`}}>{t.title}</div>))}
              {dt.length>3&&<div style={{fontSize:10,color:"var(--muted)",paddingLeft:4}}>+{dt.length-3}</div>}</>)}
          </div>);})}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   TASK ROW (drag handle, collapsible subtasks, completed → faded)
   ═══════════════════════════════════════════════════════════════════════ */
const TaskRow = ({task,isActive,onSelect,onToggle,onUpdateTask,onDragStart,onDragOver,onDrop,onDragEnd,view,lists}) => {
  const [subsOpen,setSubsOpen]=useState(false);
  const overdue=!task.completed&&isOverdue(task.dueDate);
  const {total:subTotal,done:subDone}=countSubs(task.subtasks);
  const hasDuration=task.startDate&&task.endDate;
  return (
    <div draggable onDragStart={e=>onDragStart(e,task)} onDragOver={e=>onDragOver(e,task)} onDrop={e=>onDrop(e,task)} onDragEnd={onDragEnd}
      style={{marginBottom:2,borderRadius:12,background:isActive?"var(--active-bg)":"transparent",transition:"background 0.15s,opacity 0.3s",opacity:task.completed?0.45:1}}>
      <div onClick={()=>onSelect(task)} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"11px 12px",cursor:"pointer"}}>
        <div style={{paddingTop:3,cursor:"grab",color:"var(--border)",touchAction:"none"}} onMouseDown={e=>e.stopPropagation()}>{Icons.grip}</div>
        <div style={{paddingTop:2}}><Checkbox checked={task.completed} priority={task.priority} onChange={()=>onToggle(task.id)}/></div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:15,fontWeight:task.completed?400:500,lineHeight:1.4,color:task.completed?"var(--muted)":"var(--ink)",textDecoration:task.completed?"line-through":"none",marginBottom:3}}>{task.title}</div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            {task.dueDate?(<span style={{fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:3,color:overdue?"#ef4444":task.dueDate===todayStr()?"var(--accent)":"var(--muted)"}}>{Icons.calendar} {formatDate(task.dueDate)}</span>):(!task.completed&&<span style={{fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:3,color:"#a78bfa",background:"#f5f3ff",padding:"1px 7px",borderRadius:4,border:"1px solid #ede9fe"}}>{Icons.calendar} No date</span>)}
            {hasDuration&&<span style={{fontSize:11,display:"flex",alignItems:"center",gap:3,color:"var(--muted)"}}>{Icons.duration} {formatDate(task.startDate)}–{formatDate(task.endDate)}</span>}
            {task.priority!=="none"&&<span style={{fontSize:11,fontWeight:700,display:"flex",alignItems:"center",gap:3,color:PRIORITY[task.priority].color}}>{Icons.flag} {PRIORITY[task.priority].label}</span>}
            {subTotal>0&&(<button onClick={e=>{e.stopPropagation();setSubsOpen(!subsOpen);}} style={{fontSize:12,display:"flex",alignItems:"center",gap:3,color:subDone===subTotal?"#16a34a":"var(--muted)",background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"inherit"}}>{Icons.subtask} {subDone}/{subTotal} <span style={{transform:subsOpen?"rotate(0)":"rotate(-90deg)",transition:"transform 0.15s",display:"flex"}}>{Icons.chevD}</span></button>)}
            {(task.tags||[]).map(t=><span key={t} style={{fontSize:11,color:"var(--accent)",fontWeight:500}}>#{t}</span>)}
            {task.notes&&<span style={{color:"#cbd5e1",display:"flex"}}>{Icons.note}</span>}
            {!view.startsWith("list:")&&view!=="inbox"&&<span style={{fontSize:11,color:"var(--muted)",background:"var(--surface)",padding:"1px 7px",borderRadius:4}}>{task.list}</span>}
          </div>
        </div>
      </div>
      {subsOpen&&subTotal>0&&(
        <div style={{paddingLeft:52,paddingBottom:8,paddingRight:12}}>
          <SubtaskTree subtasks={task.subtasks} onUpdate={(_, targetId, changes, action)=>{
            if(action==="remove") onUpdateTask({...task, subtasks: removeSubById(task.subtasks, targetId)});
            else if(action==="add") onUpdateTask({...task, subtasks: addSubTo(task.subtasks, targetId, changes)});
            else onUpdateTask({...task, subtasks: updateSubById(task.subtasks, targetId, changes)});
          }}/>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════════════════ */
export default function InkwellApp() {
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
  const [showShortcuts,setShowShortcuts]=useState(false);

  useEffect(()=>{setTasks(load(TASKS_KEY,[]));setLists(load(LISTS_KEY,DEFAULT_LISTS));setReady(true);const mob=window.innerWidth<768;setIsMobile(mob);if(mob)setSidebar(false);const fn=()=>{const m=window.innerWidth<768;setIsMobile(m);if(m)setSidebar(false);};window.addEventListener("resize",fn);if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});return()=>window.removeEventListener("resize",fn);},[]);
  useEffect(()=>{if(ready)save(TASKS_KEY,tasks);},[tasks,ready]);
  useEffect(()=>{if(ready)save(LISTS_KEY,lists);},[lists,ready]);
  useEffect(()=>{if(selectedTask){const u=tasks.find(t=>t.id===selectedTask.id);if(u)setSelectedTask(u);else setSelectedTask(null);}},[tasks]);
  useEffect(()=>{const h=e=>{if(["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName))return;if(e.key==="n"&&!e.metaKey){e.preventDefault();document.getElementById("quick-add")?.focus();}if(e.key==="/"||((e.metaKey||e.ctrlKey)&&e.key==="f")){e.preventDefault();setShowSearch(true);}if(e.key==="?")setShowShortcuts(s=>!s);if(e.key==="Escape"){setShowSearch(false);setSearch("");setSelectedTask(null);setShowShortcuts(false);}};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);},[]);

  const flash=msg=>{setToast(msg);setTimeout(()=>setToast(null),3000);};

  const addTask=useCallback(data=>{
    const task={id:uid(),title:data.title||"Untitled",completed:data.completed||false,dueDate:data.dueDate||todayStr(),startDate:data.startDate||null,endDate:data.endDate||null,priority:data.priority||"none",list:data.list||(view.startsWith("list:")?view.replace("list:",""):"Inbox"),subtasks:data.subtasks||[],notes:data.notes||"",tags:data.tags||[],createdAt:new Date().toISOString(),completedAt:data.completed?new Date().toISOString():null};
    setTasks(prev=>[task,...prev]);return task;
  },[view]);

  const updateTask=useCallback(updated=>{setTasks(prev=>prev.map(t=>t.id===updated.id?updated:t));},[]);
  const toggleTask=useCallback(id=>{setTasks(prev=>prev.map(t=>t.id===id?{...t,completed:!t.completed,completedAt:!t.completed?new Date().toISOString():null}:t));},[]);
  const deleteTask=useCallback(id=>{setTasks(prev=>prev.filter(t=>t.id!==id));if(selectedTask?.id===id)setSelectedTask(null);},[selectedTask]);

  const renameList=useCallback((oldN,newN)=>{if(!newN.trim()||newN===oldN||lists.includes(newN))return;setLists(prev=>prev.map(l=>l===oldN?newN:l));setTasks(prev=>prev.map(t=>t.list===oldN?{...t,list:newN}:t));if(view===`list:${oldN}`)setView(`list:${newN}`);},[lists,view]);

  const onDragStart=(e,task)=>{setDragTask(task);e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",task.id);};
  const onDragOver=(e)=>{e.preventDefault();e.dataTransfer.dropEffect="move";};
  const onDrop=(e,overTask)=>{e.preventDefault();if(!dragTask||dragTask.id===overTask.id)return;setTasks(prev=>{const w=prev.filter(t=>t.id!==dragTask.id);const idx=w.findIndex(t=>t.id===overTask.id);w.splice(idx,0,{...dragTask,list:overTask.list});return w;});setDragTask(null);};
  const onDragEnd=()=>setDragTask(null);
  const onListDrop=(e,listName)=>{e.preventDefault();const tid=e.dataTransfer.getData("text/plain");if(tid){setTasks(prev=>prev.map(t=>t.id===tid?{...t,list:listName}:t));flash(`Moved to ${listName}`);}};

  const handleScan=async(b64,mt)=>{setProcessing(true);try{const res=await fetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({imageData:b64,mediaType:mt,existingTasks:tasks.map(t=>t.title)})});if(!res.ok){const err=await res.json();throw new Error(err.error||"Scan failed");}const results=await res.json();setShowPhoto(false);setScanResults(results);}catch(e){flash("⚠ "+(e.message||"Failed"));}setProcessing(false);};

  const confirmScan=items=>{let added=0,checked=0;const pageDate=scanResults?.page_date;const newCats=new Set();items.forEach(it=>{if(it.category?.trim()&&!lists.includes(it.category.trim()))newCats.add(it.category.trim());});if(newCats.size>0)setLists(prev=>[...prev,...Array.from(newCats)]);const all=[...lists,...Array.from(newCats)];
    items.forEach(item=>{if(item.is_duplicate_of){const ex=tasks.find(t=>t.title.toLowerCase().trim()===item.is_duplicate_of.toLowerCase().trim());if(ex&&item.completed&&!ex.completed){updateTask({...ex,completed:true,completedAt:new Date().toISOString()});checked++;return;}if(ex)return;}const tl=item.category&&all.includes(item.category.trim())?item.category.trim():"Inbox";addTask({title:item.title,completed:item.completed,dueDate:item.date||pageDate||todayStr(),list:tl});added++;});
    setScanResults(null);const lm=newCats.size>0?`, created ${newCats.size} list${newCats.size!==1?"s":""}`:""
    flash(`✓ Added ${added} task${added!==1?"s":""}${checked?`, checked off ${checked}`:""}${lm}`);};

  const filtered=useMemo(()=>{let f=tasks;
    if(search){const q=search.toLowerCase();f=f.filter(t=>t.title.toLowerCase().includes(q)||(t.notes||"").toLowerCase().includes(q)||(t.tags||[]).some(tg=>tg.toLowerCase().includes(q)));}
    else{switch(view){case"today":f=f.filter(t=>t.dueDate===todayStr()||(!t.dueDate&&t.createdAt?.startsWith(todayStr())));break;case"upcoming":f=f.filter(t=>!t.completed&&t.dueDate&&t.dueDate>=todayStr());f.sort((a,b)=>(a.dueDate||"").localeCompare(b.dueDate||""));break;case"all":break;case"completed":return f.filter(t=>t.completed).sort((a,b)=>(b.completedAt||"").localeCompare(a.completedAt||""));case"inbox":f=f.filter(t=>t.list==="Inbox");break;default:if(view.startsWith("list:"))f=f.filter(t=>t.list===view.replace("list:",""));}}
    return[...f.filter(t=>!t.completed),...f.filter(t=>t.completed)];
  },[tasks,view,search]);

  const overdueCount=useMemo(()=>tasks.filter(t=>!t.completed&&isOverdue(t.dueDate)).length,[tasks]);
  const todayCount=useMemo(()=>tasks.filter(t=>!t.completed&&t.dueDate===todayStr()).length,[tasks]);
  const titles={today:"Today",upcoming:"Upcoming",all:"All Tasks",completed:"Completed",inbox:"Inbox",calendar:"Calendar"};
  const iconsMap={today:Icons.today,upcoming:Icons.upcoming,all:Icons.all,completed:Icons.done,inbox:Icons.inbox,calendar:Icons.calendar};
  const viewTitle=titles[view]||(view.startsWith("list:")?view.replace("list:",""):"Tasks");
  const viewIcon=iconsMap[view]||Icons.all;
  const selectView=v=>{setView(v);setSelectedTask(null);setSearch("");if(isMobile)setSidebar(false);};

  if(!ready)return<div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-display)",fontSize:22,color:"var(--muted)"}}>Loading...</div>;

  return (
    <div style={{height:"100vh",display:"flex",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700;9..144,800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        :root{--font-display:'Fraunces',Georgia,serif;--font-body:'DM Sans',-apple-system,sans-serif;--ink:#0f172a;--text:#334155;--muted:#94a3b8;--bg:#f8fafc;--surface:#f1f5f9;--border:#e2e8f0;--border-light:#f1f5f9;--active-bg:#eff6ff;--accent:#2563eb;--accent-dark:#1e40af;--accent-bg:#eff6ff;--accent2:#7c3aed;}
        *{box-sizing:border-box;margin:0;padding:0;font-family:var(--font-body);}
        html,body{height:100%;overflow:hidden;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;}
        ::selection{background:rgba(37,99,235,0.15);}
        ::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px;}
        input::placeholder,textarea::placeholder{color:#94a3b8;}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes toastIn{from{opacity:0;transform:translate(-50%,20px)}to{opacity:1;transform:translate(-50%,0)}}
        button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
        [draggable]{user-select:none;}
        @media(max-width:768px){.sidebar{position:fixed!important;z-index:100!important;height:100vh!important;}.detail-panel{position:fixed!important;right:0;top:0;height:100vh!important;z-index:100;width:100%!important;max-width:420px;}}
      `}</style>

      {isMobile&&sidebar&&<div onClick={()=>setSidebar(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:99}}/>}

      {/* SIDEBAR */}
      <nav className="sidebar" aria-label="Navigation" style={{width:sidebar?264:0,...(isMobile?{position:"fixed",zIndex:100,height:"100vh"}:{}),background:"#f1f5f9",borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column",transition:"width 0.25s ease",overflow:"hidden",flexShrink:0}}>
        <div style={{padding:"20px 16px 12px",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
            <div style={{width:34,height:34,borderRadius:10,background:"linear-gradient(135deg,#1e40af,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:800,color:"white",fontFamily:"var(--font-display)"}}>I</div>
            <span style={{fontSize:20,fontWeight:700,fontFamily:"var(--font-display)",color:"var(--ink)",whiteSpace:"nowrap"}}>Inkwell</span>
          </div>
          <button onClick={()=>{setShowPhoto(true);if(isMobile)setSidebar(false);}} style={{width:"100%",padding:"11px 14px",borderRadius:12,border:"2px dashed #cbd5e1",background:"rgba(37,99,235,0.04)",color:"var(--accent)",fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:10,transition:"all 0.2s",marginBottom:16,whiteSpace:"nowrap",fontFamily:"inherit"}}>{Icons.camera} Scan Notebook Page</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"0 8px"}}>
          <NavSection title="Views">
            {[{id:"today",icon:Icons.today,label:"Today",count:todayCount},{id:"upcoming",icon:Icons.upcoming,label:"Upcoming"},{id:"all",icon:Icons.all,label:"All Tasks",count:tasks.filter(t=>!t.completed).length},{id:"completed",icon:Icons.done,label:"Completed",count:tasks.filter(t=>t.completed).length},{id:"calendar",icon:Icons.calendar,label:"Calendar"}].map(({id,icon,label,count})=>(
              <NavItem key={id} active={view===id} icon={icon} label={label} count={count} onClick={()=>selectView(id)} countColor={id==="today"&&overdueCount>0?"#ef4444":undefined}/>
            ))}
          </NavSection>
          <NavSection title="Lists" action={()=>setShowNewList(true)}>
            {lists.map(l=>{const lv=l==="Inbox"?"inbox":`list:${l}`;const color=getListColor(l,lists);return(
              <div key={l} onDragOver={e=>e.preventDefault()} onDrop={e=>onListDrop(e,l)}>
                <NavItem active={view===lv} count={tasks.filter(t=>!t.completed&&t.list===l).length} onClick={()=>selectView(lv)}
                  icon={<span style={{width:8,height:8,borderRadius:"50%",display:"inline-block",background:color,flexShrink:0}}/>}
                  label={<EditableText value={l} onSave={n=>renameList(l,n)} style={{fontSize:14,fontWeight:view===lv?600:500,color:view===lv?"var(--ink)":"var(--text)"}}/>}/>
              </div>);})}
            {showNewList&&(<div style={{padding:"4px 6px"}}><input autoFocus value={newList} onChange={e=>setNewList(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&newList.trim()&&!lists.includes(newList.trim())){setLists(p=>[...p,newList.trim()]);setNewList("");setShowNewList(false);}if(e.key==="Escape"){setShowNewList(false);setNewList("");}}}
              onBlur={()=>{setShowNewList(false);setNewList("");}} placeholder="List name..." style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid var(--accent)",fontSize:13,outline:"none",background:"white",fontFamily:"inherit"}}/></div>)}
          </NavSection>
        </div>
        {overdueCount>0&&<div style={{margin:"0 8px 8px",padding:"10px 14px",borderRadius:10,background:"#fef2f2",border:"1px solid #fecaca",fontSize:13,color:"#ef4444",fontWeight:600}}>⚠ {overdueCount} overdue</div>}
        <div style={{padding:"8px 16px 12px",borderTop:"1px solid var(--border)"}}><button onClick={()=>setShowShortcuts(true)} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"var(--muted)",display:"flex",alignItems:"center",gap:6,fontFamily:"inherit",padding:0}}>{Icons.keyboard} Press ? for shortcuts</button></div>
      </nav>

      {/* MAIN */}
      <main style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
        <header style={{padding:isMobile?"14px 16px":"14px 24px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <button onClick={()=>setSidebar(!sidebar)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:4,display:"flex"}} aria-label="Toggle sidebar">{Icons.menu}</button>
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
            {view==="calendar"?(<CalendarView tasks={tasks} onSelect={t=>setSelectedTask(t)}/>):(<>
              {view!=="completed"&&(<div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"white",borderRadius:14,border:"1px solid var(--border)",marginBottom:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <span style={{color:"var(--accent)",flexShrink:0}}>{Icons.plus}</span>
                <input id="quick-add" value={newTitle} onChange={e=>setNewTitle(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newTitle.trim()){const t=addTask({title:newTitle.trim()});setNewTitle("");flash(`✓ Added "${t.title}"`);}}} placeholder="Add a task... (Enter) · defaults to today" style={{flex:1,border:"none",outline:"none",fontSize:15,color:"var(--ink)",background:"none",fontFamily:"inherit",minWidth:0}}/>
              </div>)}

              {filtered.length===0?(<div style={{textAlign:"center",padding:"50px 20px",color:"var(--muted)"}}><div style={{fontSize:44,marginBottom:14,opacity:0.4}}>{view==="completed"?"🎉":view==="today"?"☀️":search?"🔍":"📋"}</div><div style={{fontSize:16,fontWeight:600,marginBottom:4}}>{view==="completed"?"No completed tasks yet":search?"No matching tasks":"All clear!"}</div><div style={{fontSize:14}}>Add a task above or scan a notebook page</div></div>):(
                <div role="list" aria-label="Tasks">
                  {filtered.map((task,i)=>{const prev=i>0?filtered[i-1]:null;const showSep=task.completed&&prev&&!prev.completed;
                    return(<div key={task.id} role="listitem">
                      {showSep&&(<div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 12px 8px",marginTop:8}}><div style={{height:1,flex:1,background:"var(--border)"}}/><span style={{fontSize:12,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8}}>Completed</span><div style={{height:1,flex:1,background:"var(--border)"}}/></div>)}
                      <TaskRow task={task} isActive={selectedTask?.id===task.id} onSelect={t=>setSelectedTask(t)} onToggle={toggleTask} onUpdateTask={updateTask} view={view} lists={lists} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd}/>
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
      {showShortcuts&&(<Overlay onClose={()=>setShowShortcuts(false)}><h2 style={{fontSize:19,fontFamily:"var(--font-display)",marginBottom:16}}>Keyboard Shortcuts</h2>{[["N","New task"],["/ or ⌘F","Search"],["Esc","Close panel"],["?","This help"],["Double-click","Rename list"]].map(([k,d])=>(<div key={k} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:"1px solid var(--border-light)"}}><kbd style={{fontSize:12,fontWeight:600,background:"var(--surface)",padding:"3px 8px",borderRadius:6,border:"1px solid var(--border)",fontFamily:"inherit",minWidth:50,textAlign:"center"}}>{k}</kbd><span style={{fontSize:14,color:"var(--text)"}}>{d}</span></div>))}</Overlay>)}
      {toast&&<div role="status" aria-live="polite" style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"var(--ink)",color:"white",padding:"12px 24px",borderRadius:12,fontSize:14,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.2)",animation:"toastIn 0.3s ease",zIndex:2000,whiteSpace:"nowrap"}}>{toast}</div>}
    </div>
  );
}

function NavSection({title,action,children}){return(<div style={{marginBottom:14}}><div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,padding:"0 8px",marginBottom:4,display:"flex",alignItems:"center",justifyContent:"space-between"}}>{title}{action&&<button onClick={action} style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",padding:0,display:"flex"}} aria-label={`Add ${title.toLowerCase()}`}>{Icons.plus}</button>}</div>{children}</div>);}
function NavItem({active,icon,label,count,onClick,countColor}){return(<button onClick={onClick} style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"none",background:active?"#dbeafe":"transparent",color:active?"var(--ink)":"var(--text)",fontSize:14,fontWeight:active?600:500,cursor:"pointer",display:"flex",alignItems:"center",gap:10,textAlign:"left",transition:"all 0.12s",whiteSpace:"nowrap",fontFamily:"inherit"}}><span style={{display:"flex",flexShrink:0}}>{icon}</span><span style={{flex:1}}>{typeof label==="string"?label:label}</span>{count>0&&<span style={{fontSize:12,fontWeight:700,minWidth:18,textAlign:"right",color:countColor||"var(--muted)"}}>{count}</span>}</button>);}
