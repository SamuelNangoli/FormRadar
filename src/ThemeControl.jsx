import React, {useEffect, useState} from "react";
import {Sun, Moon, Monitor} from "lucide-react";

const key = "formradar-theme";
function stored() {try {const v=localStorage.getItem(key);return ["light","dark"].includes(v)?v:"system";} catch {return "system";}}
function apply(theme) {
  document.documentElement.dataset.theme=theme;
  document.documentElement.style.colorScheme=theme;
  document.querySelector('meta[name="theme-color"]').content=theme==="dark"?"#11182C":"#FFFFFF";
  for(const id of ["favicon","fallback-icon","touch-icon","app-manifest"]){const node=document.getElementById(id);if(node)node.href=`/brand/${theme}/${node.dataset.file}`;}
}
export default function ThemeControl() {
  const [choice,setChoice]=useState(stored);
  const [theme,setTheme]=useState(()=>document.documentElement.dataset.theme||"light");
  useEffect(()=>{
    const media=matchMedia("(prefers-color-scheme: dark)");
    const update=()=>{const next=choice==="system"?(media.matches?"dark":"light"):choice;apply(next);setTheme(next);};
    update();media.addEventListener("change",update);
    const sync=e=>{if(e.key===key||e.key===null)setChoice(stored());};window.addEventListener("storage",sync);
    return()=>{media.removeEventListener("change",update);window.removeEventListener("storage",sync);};
  },[choice]);
  function choose(value){try{value==="system"?localStorage.removeItem(key):localStorage.setItem(key,value);}catch{}setChoice(value);}
  return <div className="theme-control" aria-label="Appearance">
    <button className="theme-toggle" role="switch" aria-checked={theme==="dark"} aria-label="Dark appearance" title={`Switch to ${theme==="dark"?"light":"dark"} mode`} onClick={()=>choose(theme==="dark"?"light":"dark")}>
      {theme==="dark"?<Moon size={16}/>:<Sun size={16}/>}<span>{theme==="dark"?"Dark":"Light"}</span>
    </button>
    <button className="theme-system" aria-label="Use device appearance" title="Use device appearance" aria-pressed={choice==="system"} onClick={()=>choose("system")}><Monitor size={16}/></button>
  </div>;
}
