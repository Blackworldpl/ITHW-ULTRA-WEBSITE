'use client';
import {standardFieldGroups,type StandardFields} from '@/shared/asset-fields';

export function StandardFieldEditor({value,onChange}:{value:StandardFields;onChange:(fields:StandardFields)=>void}){
  return <section className="standard-field-editor">
    <h3>Pola formularza urządzenia</h3><p className="help-note">Włącz pola potrzebne w tej kategorii. Nazwa, kategoria, status i Asset ID pozostają dostępne. Wyłączenie pola zachowuje dotychczasowe dane; odbiorca jest zawsze wymagany przy wydaniu sprzętu.</p>
    <div className="standard-field-groups">{standardFieldGroups.map(group=>{
      const enabled=group.fields.every(([key])=>value[key]!==false);
      return <fieldset key={group.label}><legend>{group.label}</legend><label className="field-toggle group-toggle"><span>Cały blok</span><input type="checkbox" role="switch" aria-label={`${group.label} — cały blok`} checked={enabled} onChange={event=>onChange({...value,...Object.fromEntries(group.fields.map(([key])=>[key,event.target.checked]))})}/></label>
        {group.fields.map(([key,label])=><label className="field-toggle" key={key}><span>{label}</span><input type="checkbox" role="switch" aria-label={`Pole: ${label}`} checked={value[key]!==false} onChange={event=>onChange({...value,[key]:event.target.checked})}/></label>)}
      </fieldset>;
    })}</div>
  </section>;
}
