filepath = "/Users/nmantha/Desktop/GR Research/cinna-backup/frontend/app/harvest-readiness/page.tsx"
with open(filepath, "r") as f:
    content = f.read()

# 1. DELETE the split layout section
split_layout_start = '<div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">'
# The split layout ends exactly before </div>\n      </div>\n    \n    </ProtectedRoute>
# Let's use string slicing
start_idx = content.find(split_layout_start)
if start_idx != -1:
    end_marker = '</div>\n        </div>\n      </div>\n    \n    </ProtectedRoute>'
    end_idx = content.find(end_marker, start_idx)
    if end_idx != -1:
        # Delete it completely
        content = content[:start_idx] + content[end_idx:]

# 2. REPLACE the form block
# Find the start of the form
form_start_marker = '<section className="card p-6">\n            <h3 className="mb-5 text-base font-semibold text-slate-900">\n              Enter Harvest Readiness\n              Data\n            </h3>'
# Sometimes the line breaks are slightly different, let's just find the generic start
form_start_marker = '<section className="card p-6">'

# We need to find the specific section that has "Enter Harvest Readiness Data"
idx = content.find("Enter Harvest Readiness\n              Data")
if idx == -1:
    idx = content.find("Enter Harvest Readiness Data")

# Find the section tag just before this text
section_start = content.rfind('<section className="card p-6">', 0, idx)

# Find the end of this section. It ends where the CDD Warnings start or result block starts.
# In the original file, it ended with:
#                 </span>
#               </div>
#             </div>
#           </section>
# Let's search for this exact sequence
section_end_marker = '</span>\n              </div>\n            </div>\n          </section>'
section_end = content.find(section_end_marker, section_start) + len(section_end_marker)

new_form_jsx = """<div className="bg-white p-6 md:p-8 rounded-2xl border border-gray-100 shadow-sm mt-8 mb-8">
  <h2 className="text-lg font-bold text-gray-900 mb-6">Enter Harvest Readiness Data</h2>
  
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
    <InputField label="PLANT ID" name="plant_id" onChange={handleInputChange} type="text" value={String(formData.plant_id)}/>
    <InputField label="AGE (MONTHS)" name="age_months" onChange={handleInputChange} type="number" value={String(formData.age_months)}/>
    <InputField label="RECENT RAINFALL INDEX (0=DRY, 100=WET)" name="rainfall_index" onChange={handleInputChange} type="number" value={String(formData.rainfall_index)}/>
    <InputField label="OUTER BARK BROWNING (%)" name="bark_browning_percent" onChange={handleInputChange} type="number" value={String(formData.bark_browning_percent)}/>
    
    <div className="md:col-span-2">
      <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase">
        Phenological Stage
      </label>
      <select 
        name="phenology_stage" 
        value={formData.phenology_stage} 
        onChange={handleInputChange} 
        className="w-full border border-gray-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white text-gray-900"
      >
        <option value={0}>0 — Red Flush / New Shoots (Improper)</option>
        <option value={1}>1 — Flowering / Fruiting (Improper)</option>
        <option value={2}>2 — Mature Dark Green Leaves (Optimal)</option>
      </select>
    </div>
  </div>

  {/* Restore the original Seasonal guidance footer inside the card */}
  <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
    <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase">Recommended Harvest Seasons (CDD — Sri Lanka)</h3>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="bg-emerald-50 text-emerald-700 text-xs font-medium py-2 px-3 rounded text-center border border-emerald-100">March – May (Primary)</div>
      <div className="bg-emerald-50 text-emerald-700 text-xs font-medium py-2 px-3 rounded text-center border border-emerald-100">July – September (Secondary)</div>
      <div className="bg-amber-50 text-amber-700 text-xs font-medium py-2 px-3 rounded text-center border border-amber-100">Oct – Nov (Limited)</div>
      <div className="bg-red-50 text-red-700 text-xs font-medium py-2 px-3 rounded text-center border border-red-100">Dec – Feb / Jun (Low)</div>
    </div>
  </div>
</div>"""

if section_start != -1 and section_end != -1:
    content = content[:section_start] + new_form_jsx + content[section_end:]

with open(filepath, "w") as f:
    f.write(content)
print("Finished rewriting")
