import React from "react";
export default function SeasonSelect({resource,value,onChange,demo}) {
  const data=resource.data?.data;
  return <div className="season-control">
    <label>Season<select aria-label="Season" disabled={demo||resource.loading&&!data} value={value} onChange={e=>onChange(e.target.value)}>
      <option value="">Current season{data?.current?.label?` · ${data.current.label}`:""}</option>
      {(data?.seasons||[]).filter(s=>!s.current).map(s=><option key={s.year} value={s.year}>{s.label}</option>)}
    </select></label>
    <small>{demo?"Demo uses synthetic current fixtures.":resource.error?"Season list unavailable. Refresh data to retry.":resource.loading?"Checking seasons…":"Recent seasons listed by the feed. Account access is checked when opened."}</small>
  </div>;
}
