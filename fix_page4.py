filepath = "/Users/nmantha/Desktop/GR Research/cinna-backup/frontend/app/harvest-readiness/page.tsx"
with open(filepath, "r") as f:
    content = f.read()

# We need to replace the current form block
start_marker = '<div className="bg-white p-6 md:p-8 rounded-2xl border border-gray-100 shadow-sm mt-8 mb-8">'
end_marker = '</div>\n</div>' # The end of the form block, before {result && ( ... )}

start_idx = content.find(start_marker)

# Find the end of this block by finding the end of the CDD footer
cdd_footer_marker = '<div className="bg-red-50 text-red-700 text-xs font-medium py-2 px-3 rounded text-center border border-red-100">Dec – Feb / Jun (Low)</div>\n    </div>\n  </div>\n</div>'
end_idx = content.find(cdd_footer_marker, start_idx) + len(cdd_footer_marker)

new_form_jsx = """<div className="bg-white p-6 md:p-8 rounded-2xl border border-gray-100 shadow-sm mt-8 mb-8">
  <h2 className="text-lg font-bold text-gray-900 mb-6">Enter Harvest Readiness Data</h2>
  
  <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
    <InputField label="PLANT ID" name="plant_id" onChange={handleInputChange} type="text" value={String(formData.plant_id)}/>
    <InputField label="AGE (MONTHS)" name="age_months" onChange={handleInputChange} type="number" value={String(formData.age_months)}/>
    <InputField label="GROWTH RATE (%)" name="growthRate" onChange={handleInputChange} type="number" value={String(formData.growthRate)}/>
    <InputField label="BARK THICKNESS (MM)" name="barkThickness" onChange={handleInputChange} type="number" value={String(formData.barkThickness)}/>
    
    <InputField label="BARK QUALITY (%)" name="barkQuality" onChange={handleInputChange} type="number" value={String(formData.barkQuality)}/>
    <InputField label="MATURITY LEVEL (%)" name="maturityLevel" onChange={handleInputChange} type="number" value={String(formData.maturityLevel)}/>
    <InputField label="HEALTH STATUS (%)" name="healthStatus" onChange={handleInputChange} type="number" value={String(formData.healthStatus)}/>
    
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">DISEASE STATUS</label>
      <select name="diseaseStatus" value={formData.diseaseStatus} onChange={handleInputChange} className="input-field">
        <option value="Healthy">Healthy</option>
        <option value="Mild Issue">Mild Issue</option>
        <option value="Severe">Severe</option>
      </select>
    </div>

    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">CURRENT MONTH</label>
      <select name="currentMonth" value={formData.currentMonth} onChange={handleInputChange} className="input-field">
        {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map(m => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>

    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">OUTER BARK COLOR (CDD)</label>
      <select name="barkColor" value={formData.barkColor} onChange={handleInputChange} className="input-field">
        <option value="brown">Fully Brown (Mature)</option>
        <option value="greenish">Greenish (Immature)</option>
      </select>
    </div>

    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">NEW SHOOTS / FLOWERS (CDD)</label>
      <select name="newShoots" value={formData.newShoots} onChange={handleInputChange} className="input-field">
        <option value="no">No — Safe to Harvest</option>
        <option value="yes">Yes — Do Not Harvest</option>
      </select>
    </div>

    <InputField label="RECENT RAINFALL INDEX (0=DRY, 100=WET)" name="rainfall_index" onChange={handleInputChange} type="number" value={String(formData.rainfall_index)}/>
    
    <InputField label="OUTER BARK BROWNING (%)" name="bark_browning_percent" onChange={handleInputChange} type="number" value={String(formData.bark_browning_percent)}/>
    
    <div className="md:col-span-2">
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">Phenological Stage</label>
      <select name="phenology_stage" value={formData.phenology_stage} onChange={handleInputChange} className="input-field">
        <option value={0}>0 — Red Flush / New Shoots (Improper)</option>
        <option value={1}>1 — Flowering / Fruiting (Improper)</option>
        <option value={2}>2 — Mature Dark Green Leaves (Optimal)</option>
      </select>
    </div>
  </div>

  <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 mt-8">
    <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase">Recommended Harvest Seasons (CDD — Sri Lanka)</h3>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="bg-emerald-50 text-emerald-700 text-xs font-medium py-2 px-3 rounded text-center border border-emerald-100">March – May (Primary)</div>
      <div className="bg-emerald-50 text-emerald-700 text-xs font-medium py-2 px-3 rounded text-center border border-emerald-100">July – September (Secondary)</div>
      <div className="bg-amber-50 text-amber-700 text-xs font-medium py-2 px-3 rounded text-center border border-amber-100">Oct – Nov (Limited)</div>
      <div className="bg-red-50 text-red-700 text-xs font-medium py-2 px-3 rounded text-center border border-red-100">Dec – Feb / Jun (Low)</div>
    </div>
  </div>
</div>"""

if start_idx != -1 and end_idx != -1:
    content = content[:start_idx] + new_form_jsx + content[end_idx:]

with open(filepath, "w") as f:
    f.write(content)
print("Finished rewriting")
