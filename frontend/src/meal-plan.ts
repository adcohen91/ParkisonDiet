const MEDICAL_DISCLAIMER = `
MEDICAL DISCLAIMER
The information provided by ADCRiskHorizon's ParkinsonDiet application is for general informational purposes only. We are not licensed medical professionals, registered dietitians, or nutritionists, and nothing in this application constitutes medical or nutritional advice. Always consult your physician, neurologist, or qualified healthcare provider before making any dietary changes related to Parkinson's disease management. By using ParkinsonDiet, you agree that ADCRiskHorizon assumes no liability for any outcomes resulting from the use of this application.`.trim()

// ══════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════

interface Meal      { name: string; description: string; tags: string[]; ingredients?: string[]; steps?: string[] }
interface Day       { date: string; day_num: number; day_name: string; breakfast: Meal; lunch: Meal; dinner: Meal }
interface Week      { label: string; days: Day[] }
interface ShopItem  { name: string; qty: string; price: number }
interface ShopCat   { category: string; items: ShopItem[] }
interface PlanResp  {
  month: string; year: number; start_date: string; end_date: string
  weeks: Week[]; shopping_list: ShopCat[]; estimated_total: number
  budget: number; over_budget: boolean; nutrition_note: string; has_dysautonomia: boolean
}

// ══════════════════════════════════════════════════════════
// State
// ══════════════════════════════════════════════════════════

interface WizardState {
  step: number
  age: number | null
  startDate: string
  endDate: string
  hasDysautonomia: boolean | null
  allergies: string[]
  excludedMeats: string[]
  isVegan: boolean
  budget: number
}

const state: WizardState = {
  step: 1,
  age: null,
  startDate: '',
  endDate: '',
  hasDysautonomia: null,
  allergies: [],
  excludedMeats: [],
  isVegan: false,
  budget: 100,
}

const TOTAL_STEPS = 6
const STEP_LABELS = ['Age', 'Dates', 'Dysautonomia', 'Allergies', 'Diet', 'Budget']
const ALLERGENS   = ['Dairy', 'Gluten / Wheat', 'Tree Nuts', 'Peanuts', 'Soy', 'Sesame', 'Shellfish', 'Fish']
const MEATS       = ['Beef', 'Pork', 'Poultry (chicken/turkey)', 'Fish / Seafood', 'Lamb / Goat', 'Game Meat']
const GREEN_TAGS  = new Set(['High Fiber', 'Plant-Based', 'Gut Health', 'Brain Health', 'Rich in Antioxidants'])

// calendar view state (-1 = not yet initialised)
let calYear  = -1
let calMonth = -1

// recipe registry — populated during results render
const mealRegistry = new Map<string, { meal: Meal; label: string }>()

// current plan — set when results are rendered, used by sendEmail
let currentPlan: PlanResp | null = null

// ══════════════════════════════════════════════════════════
// DOM refs
// ══════════════════════════════════════════════════════════

const wizardEl    = document.getElementById('wizard')!
const loadingEl   = document.getElementById('loading')!
const resultsEl   = document.getElementById('results')!
const stepCard    = document.getElementById('step-card')!
const btnBack     = document.getElementById('btn-back')   as HTMLButtonElement
const btnNext     = document.getElementById('btn-next')   as HTMLButtonElement
const progFill    = document.getElementById('progress-fill')!
const progLabels  = document.getElementById('progress-labels')!

// ══════════════════════════════════════════════════════════
// Progress bar
// ══════════════════════════════════════════════════════════

function updateProgress(): void {
  const pct = ((state.step - 1) / TOTAL_STEPS) * 100
  progFill.style.width = `${pct}%`
  progLabels.innerHTML = STEP_LABELS.map((l, i) => {
    const s = i + 1
    let cls = ''
    if (s < state.step) cls = 'done'
    else if (s === state.step) cls = 'active'
    return `<span class="progress-label ${cls}">${l}</span>`
  }).join('')

  btnBack.disabled = state.step === 1
  const isLast = state.step === TOTAL_STEPS
  btnNext.textContent = isLast ? '🌿 Generate My Plan' : 'Continue →'
  btnNext.className   = `btn-next${isLast ? ' is-generate' : ''}`
}

// ══════════════════════════════════════════════════════════
// Calendar helper
// ══════════════════════════════════════════════════════════

function renderCalendar(): string {
  const today    = new Date(); today.setHours(0, 0, 0, 0)
  const firstDay = new Date(calYear, calMonth, 1)
  const lastDay  = new Date(calYear, calMonth + 1, 0)
  const start    = new Date(firstDay)
  const dow      = start.getDay() // 0=Sun
  const daysInMonth = lastDay.getDate()

  const DOWS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
  const monthName = firstDay.toLocaleString('default', { month: 'long', year: 'numeric' })

  let cells = ''
  for (let i = 0; i < dow; i++) cells += `<div class="cal-day cal-empty"></div>`

  const sDate = state.startDate ? new Date(state.startDate + 'T00:00:00') : null
  const eDate = state.endDate   ? new Date(state.endDate   + 'T00:00:00') : null

  for (let d = 1; d <= daysInMonth; d++) {
    const cur = new Date(calYear, calMonth, d)
    const iso = cur.toISOString().slice(0, 10)
    const isPast  = cur < today
    const isStart = sDate && iso === state.startDate
    const isEnd   = eDate && iso === state.endDate
    const isRange = sDate && eDate && cur > sDate && cur < eDate
    const isToday = iso === today.toISOString().slice(0, 10)

    let cls = 'cal-day'
    if (isPast)    cls += ' cal-past'
    if (isToday)   cls += ' cal-today'
    if (isStart)   cls += ' cal-start'
    if (isEnd)     cls += ' cal-end'
    if (isRange)   cls += ' cal-in-range'

    cells += `<div class="${cls}" data-date="${iso}">${d}</div>`
  }

  return `
    <div class="calendar-wrap">
      <div class="cal-header">
        <button class="cal-nav" id="cal-prev" type="button">‹</button>
        <span class="cal-month">${monthName}</span>
        <button class="cal-nav" id="cal-next" type="button">›</button>
      </div>
      <div class="cal-grid">
        ${DOWS.map(d => `<div class="cal-dow">${d}</div>`).join('')}
        ${cells}
      </div>
    </div>`
}

function attachCalendarEvents(): void {
  document.getElementById('cal-prev')?.addEventListener('click', () => {
    calMonth--
    if (calMonth < 0) { calMonth = 11; calYear-- }
    refreshDateStep()
  })
  document.getElementById('cal-next')?.addEventListener('click', () => {
    calMonth++
    if (calMonth > 11) { calMonth = 0; calYear++ }
    refreshDateStep()
  })
  document.querySelectorAll('.cal-day:not(.cal-empty):not(.cal-past)').forEach(el => {
    el.addEventListener('click', () => {
      const iso = (el as HTMLElement).dataset.date!
      if (!state.startDate || (state.startDate && state.endDate)) {
        state.startDate = iso; state.endDate = ''
      } else {
        if (iso < state.startDate) {
          state.endDate = state.startDate; state.startDate = iso
        } else {
          state.endDate = iso
        }
      }
      const si = document.getElementById('date-start') as HTMLInputElement | null
      const ei = document.getElementById('date-end')   as HTMLInputElement | null
      if (si) si.value = state.startDate
      if (ei) ei.value = state.endDate
      updateRangeSummary()
      // re-render calendar only
      const cw = document.querySelector('.calendar-wrap')
      if (cw) cw.outerHTML  // no-op; let refreshDateStep handle it
      refreshDateStep()
    })
  })
}

function updateRangeSummary(): void {
  const box    = document.getElementById('range-summary')
  const errEl  = document.getElementById('date-error')
  if (errEl) errEl.style.display = 'none'
  if (!box) return

  if (!state.startDate) {
    box.innerHTML = '<span class="range-count">Click a day to set your start date.</span>'
    btnNext.disabled = true
    return
  }
  if (!state.endDate) {
    box.innerHTML = '<span class="range-count">Now click your end date.</span>'
    btnNext.disabled = true
    return
  }
  const s = new Date(state.startDate + 'T00:00:00')
  const e = new Date(state.endDate   + 'T00:00:00')
  const n = Math.round((e.getTime() - s.getTime()) / 86400000) + 1
  if (n > 31) {
    box.innerHTML = `<span class="range-warn">⚠ ${n} days selected — please keep it to 31 days or fewer.</span>`
    btnNext.disabled = true
  } else {
    box.innerHTML = `<span class="range-count">${n} day${n === 1 ? '' : 's'} selected</span> · ${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    btnNext.disabled = false
  }
}

function refreshDateStep(): void {
  const calHtml = renderCalendar()
  const existingCal = stepCard.querySelector('.calendar-wrap')
  if (existingCal) {
    const tmp = document.createElement('div')
    tmp.innerHTML = calHtml
    existingCal.replaceWith(tmp.firstElementChild!)
    attachCalendarEvents()
    updateRangeSummary()
  }
}

// ══════════════════════════════════════════════════════════
// Step renders
// ══════════════════════════════════════════════════════════

function renderStep1(): string {
  return `
    <div class="step-num">Step 1 of 6</div>
    <div class="step-title">How old are you?</div>
    <div class="step-desc">We tailor nutritional advice to your age group.</div>
    <div class="field">
      <label class="field-label" for="age-input">Age</label>
      <input class="field-input" type="number" id="age-input" min="18" max="110"
             placeholder="e.g. 65" value="${state.age ?? ''}" />
      <div class="field-hint">Enter a number between 18 and 110.</div>
      <div class="field-error" id="age-error">Please enter a valid age (18–110).</div>
    </div>`
}

function renderStep2(): string {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  calYear  = calYear  >= 0 ? calYear  : today.getFullYear()
  calMonth = calMonth >= 0 ? calMonth : today.getMonth()

  return `
    <div class="step-num">Step 2 of 6</div>
    <div class="step-title">Select your meal plan dates</div>
    <div class="step-desc">Choose a start and end date. Plans can cover up to 31 days. Click a day in the calendar below, then click another to set the range.</div>
    <div class="date-row">
      <div class="field">
        <label class="field-label" for="date-start">Start date</label>
        <input class="field-input" type="date" id="date-start" value="${state.startDate}" />
      </div>
      <div class="field">
        <label class="field-label" for="date-end">End date</label>
        <input class="field-input" type="date" id="date-end" value="${state.endDate}" />
      </div>
    </div>
    <div class="range-summary" id="range-summary">Click a day to set your start date.</div>
    <div class="field-error" id="date-error" style="display:none;margin-top:8px;"></div>
    ${renderCalendar()}`
}

function renderStep3(): string {
  const yes = state.hasDysautonomia === true
  const no  = state.hasDysautonomia === false
  return `
    <div class="step-num">Step 3 of 6</div>
    <div class="step-title">Do you have Parkinson's Dysautonomia?</div>
    <div class="step-desc">Dysautonomia affects the autonomic nervous system — blood pressure, digestion, and temperature regulation. We adjust your plan if so.</div>
    <div class="radio-cards">
      <div class="radio-card">
        <input type="radio" name="dys" id="dys-yes" value="yes" ${yes ? 'checked' : ''}>
        <label for="dys-yes">
          <span class="rc-icon">✅</span>
          <span class="rc-label">Yes, I have it</span>
          <span class="rc-desc">Adjust plan for Dysautonomia</span>
        </label>
      </div>
      <div class="radio-card">
        <input type="radio" name="dys" id="dys-no" value="no" ${no ? 'checked' : ''}>
        <label for="dys-no">
          <span class="rc-icon">🔵</span>
          <span class="rc-label">No / Not sure</span>
          <span class="rc-desc">Standard Parkinson's plan</span>
        </label>
      </div>
    </div>
    <div class="field-error" id="dys-error" style="display:none;margin-top:12px;">Please select an option.</div>`
}

function renderStep4(): string {
  return `
    <div class="step-num">Step 4 of 6</div>
    <div class="step-title">Any food allergies?</div>
    <div class="step-desc">Select everything you must avoid. These ingredients will be excluded from all recipes.</div>
    <div class="check-grid">
      ${ALLERGENS.map(a => {
        const id  = 'al-' + a.replace(/[^a-z]/gi, '-').toLowerCase()
        const chk = state.allergies.includes(a) ? 'checked' : ''
        return `<div class="check-item">
          <input type="checkbox" id="${id}" data-allergen="${a}" ${chk}>
          <label for="${id}">${a}</label>
        </div>`
      }).join('')}
    </div>
    <p class="field-hint" style="margin-top:14px;">Leave blank if you have no known allergies.</p>`
}

function renderStep5(): string {
  return `
    <div class="step-num">Step 5 of 6</div>
    <div class="step-title">Dietary preferences</div>
    <div class="step-desc">Tell us which meats you'd like excluded from your plan.</div>
    <label class="vegan-toggle${state.isVegan ? ' active' : ''}" id="vegan-toggle">
      <input type="checkbox" id="vegan-cb" ${state.isVegan ? 'checked' : ''}>
      <div>
        <div class="vt-text">🌱 I am fully vegan</div>
        <div class="vt-sub">Excludes all animal products</div>
      </div>
    </label>
    <hr class="check-divider">
    <p class="field-hint" style="margin-bottom:12px;">Or select specific meats to exclude:</p>
    <div class="check-grid" id="meat-checks">
      ${MEATS.map(m => {
        const id  = 'mt-' + m.replace(/[^a-z]/gi, '-').toLowerCase()
        const chk = state.excludedMeats.includes(m) ? 'checked' : ''
        const dis = state.isVegan ? 'disabled' : ''
        return `<div class="check-item">
          <input type="checkbox" id="${id}" data-meat="${m}" ${chk} ${dis}>
          <label for="${id}" style="${state.isVegan ? 'opacity:.4' : ''}">${m}</label>
        </div>`
      }).join('')}
    </div>`
}

function renderStep6(): string {
  const b = state.budget
  return `
    <div class="step-num">Step 6 of 6</div>
    <div class="step-title">What's your budget?</div>
    <div class="step-desc">We'll keep your shopping list within this amount for the entire plan period.</div>
    <div class="budget-display" id="budget-display">$${b}</div>
    <div class="budget-label-sub">Total grocery budget for the plan period</div>
    <input type="range" id="budget-slider" min="40" max="1000" step="10" value="${Math.min(b, 1000)}">
    <div class="budget-marks"><span>$40</span><span>$250</span><span>$500</span><span>$750</span><span>$1,000</span></div>
    <div class="field" style="margin-top:20px;">
      <label class="field-label" for="budget-input">Or type an amount</label>
      <input class="field-input" type="number" id="budget-input" min="40" max="1000" value="${b}" />
    </div>`
}

// ══════════════════════════════════════════════════════════
// Step lifecycle
// ══════════════════════════════════════════════════════════

function renderCurrentStep(): void {
  const renderers: Record<number, () => string> = {
    1: renderStep1, 2: renderStep2, 3: renderStep3,
    4: renderStep4, 5: renderStep5, 6: renderStep6,
  }
  stepCard.innerHTML = renderers[state.step]?.() ?? ''
  attachStepEvents()
  updateProgress()
}

function attachStepEvents(): void {
  if (state.step === 1) {
    document.getElementById('age-input')?.addEventListener('input', e => {
      state.age = parseInt((e.target as HTMLInputElement).value) || null
    })
  }

  if (state.step === 2) {
    attachCalendarEvents()
    updateRangeSummary()

    const si = document.getElementById('date-start') as HTMLInputElement
    const ei = document.getElementById('date-end')   as HTMLInputElement

    si?.addEventListener('change', () => {
      state.startDate = si.value
      if (state.endDate && state.endDate < state.startDate) state.endDate = ''
      if (ei) ei.value = state.endDate
      updateRangeSummary(); refreshDateStep()
    })
    ei?.addEventListener('change', () => {
      if (!state.startDate) { state.startDate = ei.value; state.endDate = ''; if (si) si.value = state.startDate; return }
      if (ei.value < state.startDate) {
        state.endDate = state.startDate; state.startDate = ei.value
        if (si) si.value = state.startDate; ei.value = state.endDate
      } else {
        state.endDate = ei.value
      }
      updateRangeSummary(); refreshDateStep()
    })
  }

  if (state.step === 3) {
    document.querySelectorAll<HTMLInputElement>('input[name="dys"]').forEach(r => {
      r.addEventListener('change', () => {
        state.hasDysautonomia = r.value === 'yes'
      })
    })
  }

  if (state.step === 4) {
    document.querySelectorAll<HTMLInputElement>('[data-allergen]').forEach(cb => {
      cb.addEventListener('change', () => {
        const a = cb.dataset.allergen!
        if (cb.checked) { if (!state.allergies.includes(a)) state.allergies.push(a) }
        else { state.allergies = state.allergies.filter(x => x !== a) }
      })
    })
  }

  if (state.step === 5) {
    const veganCb = document.getElementById('vegan-cb') as HTMLInputElement
    const toggle  = document.getElementById('vegan-toggle')!

    veganCb?.addEventListener('change', () => {
      state.isVegan = veganCb.checked
      toggle.classList.toggle('active', state.isVegan)
      renderCurrentStep()
    })

    document.querySelectorAll<HTMLInputElement>('[data-meat]').forEach(cb => {
      cb.addEventListener('change', () => {
        const m = cb.dataset.meat!
        if (cb.checked) { if (!state.excludedMeats.includes(m)) state.excludedMeats.push(m) }
        else { state.excludedMeats = state.excludedMeats.filter(x => x !== m) }
      })
    })
  }

  if (state.step === 6) {
    const slider = document.getElementById('budget-slider') as HTMLInputElement
    const inp    = document.getElementById('budget-input')  as HTMLInputElement
    const disp   = document.getElementById('budget-display')!

    const syncBudget = (v: number, writeInp = true) => {
      state.budget     = v
      disp.textContent = `$${v}`
      slider.value     = String(v)
      if (writeInp) inp.value = String(v)
    }

    slider?.addEventListener('input', () => syncBudget(Number(slider.value)))
    inp?.addEventListener('input', () => {
      const raw = inp.value
      if (raw === '') return                        // let the user clear the field
      const num = Number(raw)
      if (isNaN(num)) return                       // ignore non-numeric keystrokes
      const v = Math.min(Math.max(num, 40), 1000)
      syncBudget(v, false)                         // update state/slider/display but don't overwrite inp
    })
    inp?.addEventListener('blur', () => {
      const v = Math.min(Math.max(Number(inp.value) || state.budget, 40), 1000)
      syncBudget(v)                                // normalise on focus loss
    })
  }
}

// ══════════════════════════════════════════════════════════
// Validation
// ══════════════════════════════════════════════════════════

function validateStep(): boolean {
  const show = (id: string, msg?: string) => {
    const el = document.getElementById(id)
    if (el) { el.style.display = 'block'; if (msg) el.textContent = msg }
  }

  if (state.step === 1) {
    if (!state.age || state.age < 18 || state.age > 110) { show('age-error'); return false }
  }
  if (state.step === 2) {
    if (!state.startDate || !state.endDate) { show('date-error', 'Please select both a start and end date.'); return false }
    const n = Math.round((new Date(state.endDate + 'T00:00:00').getTime() - new Date(state.startDate + 'T00:00:00').getTime()) / 86400000) + 1
    if (n > 31) { return false }
  }
  if (state.step === 3 && state.hasDysautonomia === null) { show('dys-error'); return false }
  return true
}

// ══════════════════════════════════════════════════════════
// Navigation
// ══════════════════════════════════════════════════════════

btnBack.addEventListener('click', () => {
  if (state.step > 1) { state.step--; renderCurrentStep() }
})

btnNext.addEventListener('click', async () => {
  if (!validateStep()) return
  if (state.step < TOTAL_STEPS) {
    state.step++; renderCurrentStep()
  } else {
    await generatePlan()
  }
})

// ══════════════════════════════════════════════════════════
// Generate
// ══════════════════════════════════════════════════════════

async function generatePlan(): Promise<void> {
  wizardEl.style.display  = 'none'
  loadingEl.style.display = 'flex'

  const n = Math.round(
    (new Date(state.endDate + 'T00:00:00').getTime() - new Date(state.startDate + 'T00:00:00').getTime()) / 86400000
  ) + 1
  ;(document.getElementById('loading-sub') as HTMLElement).textContent =
    `Generating ${n} days of personalised meals — this takes about 15–30 seconds.`

  try {
    const res = await fetch('/api/generate-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        age:           state.age,
        start_date:    state.startDate,
        end_date:      state.endDate,
        has_dysautonomia: state.hasDysautonomia,
        allergies:     state.allergies,
        excluded_meats: state.isVegan ? MEATS : state.excludedMeats,
        is_vegan:      state.isVegan,
        budget:        state.budget,
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || `Server error ${res.status}`)
    }

    const plan: PlanResp = await res.json()
    loadingEl.style.display = 'none'
    renderResults(plan)
  } catch (err) {
    loadingEl.style.display = 'none'
    wizardEl.style.display  = 'flex'
    alert(`Could not generate plan: ${err instanceof Error ? err.message : err}\n\nCheck your API key in .env and try again.`)
  }
}

// ══════════════════════════════════════════════════════════
// Results rendering
// ══════════════════════════════════════════════════════════

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderMeal(meal: Meal, label: string, icon: string, key: string): string {
  mealRegistry.set(key, { meal, label })
  const tags = (meal.tags || []).map(t =>
    `<span class="tag${GREEN_TAGS.has(t) ? ' green' : ''}">${esc(t)}</span>`
  ).join('')
  return `
    <div class="meal meal--clickable" data-recipe="${key}">
      <div class="meal-label">${icon} ${label}</div>
      <div class="meal-name">${esc(meal.name)}</div>
      <div class="meal-desc">${esc(meal.description)}</div>
      <div class="meal-tags">${tags}</div>
      <div class="recipe-hint">View recipe →</div>
    </div>`
}

function renderRecipeBody(meal: Meal): void {
  const ings  = (meal.ingredients || []).map(i => `<li>${esc(i)}</li>`).join('')
  const steps = (meal.steps || []).map((s, i) =>
    `<li><span class="step-num">${i + 1}</span><span>${esc(s)}</span></li>`
  ).join('')
  ;(document.getElementById('recipe-body') as HTMLElement).innerHTML =
    (ings  ? `<p class="recipe-section-label">Ingredients</p><ul class="recipe-ingredients">${ings}</ul>` : '') +
    (steps ? `<p class="recipe-section-label">Preparation</p><ol class="recipe-steps">${steps}</ol>` : '') ||
    '<p style="color:var(--muted);font-size:0.9rem">Recipe not available.</p>'
  ;(document.getElementById('recipe-actions') as HTMLElement).style.display = 'flex'
}

async function showRecipe(key: string): Promise<void> {
  const entry = mealRegistry.get(key)
  if (!entry) return
  const { meal, label } = entry

  ;(document.getElementById('recipe-type')  as HTMLElement).textContent = label
  ;(document.getElementById('recipe-title') as HTMLElement).textContent = meal.name
  ;(document.getElementById('recipe-modal') as HTMLElement).style.display = 'flex'
  document.body.style.overflow = 'hidden'

  if (meal.ingredients !== undefined) {
    renderRecipeBody(meal)
    return
  }

  ;(document.getElementById('recipe-body') as HTMLElement).innerHTML =
    '<p style="color:var(--muted);font-size:0.9rem">Loading recipe…</p>'

  try {
    const dietStr = state.isVegan
      ? 'fully vegan — no meat, poultry, fish, dairy, or eggs'
      : state.excludedMeats.length > 0
        ? `omnivore excluding: ${state.excludedMeats.join(', ')} — all other meats, fish, poultry, dairy, and eggs are permitted`
        : 'balanced omnivore — meat, fish, poultry, dairy, and eggs are all permitted and encouraged'
    const res = await fetch('/api/recipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meal_name:   meal.name,
        description: meal.description,
        diet:        dietStr,
        allergies:   state.allergies,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      meal.ingredients = data.ingredients ?? []
      meal.steps       = data.steps       ?? []
    } else {
      meal.ingredients = []
      meal.steps       = []
    }
  } catch {
    meal.ingredients = []
    meal.steps       = []
  }

  renderRecipeBody(meal)
}

function hideRecipe(): void {
  ;(document.getElementById('recipe-modal') as HTMLElement).style.display = 'none'
  ;(document.getElementById('recipe-actions') as HTMLElement).style.display = 'none'
  document.body.style.overflow = ''
}

function getDisclaimerNode(): Node | null {
  const tpl = document.getElementById('disclaimer-template') as HTMLTemplateElement | null
  return tpl ? tpl.content.cloneNode(true) : null
}

function getAuthorFooterNode(): Node | null {
  const tpl = document.getElementById('print-author-template') as HTMLTemplateElement | null
  return tpl ? tpl.content.cloneNode(true) : null
}

function printRecipe(): void {
  const card = document.getElementById('recipe-card')
  const disc = getDisclaimerNode()
  const auth = getAuthorFooterNode()
  if (card && disc) card.appendChild(disc)
  if (auth) document.body.appendChild(auth)
  const recipeName = (document.getElementById('recipe-title') as HTMLElement | null)?.textContent?.trim() || 'Recipe'
  const prevTitle = document.title
  document.title = recipeName
  document.body.classList.add('print-recipe')
  window.print()
  document.body.classList.remove('print-recipe')
  document.title = prevTitle
  if (card) card.querySelector('.disclaimer-print')?.remove()
  document.body.querySelector('.print-author-footer')?.remove()
}

function emailRecipe(): void {
  const title = (document.getElementById('recipe-title') as HTMLElement).textContent?.trim() || ''
  const type  = (document.getElementById('recipe-type')  as HTMLElement).textContent?.trim() || ''

  const ings = Array.from(
    document.querySelectorAll<HTMLElement>('#recipe-body .recipe-ingredients li')
  ).map(li => `  • ${li.textContent?.trim()}`).join('\n')

  const steps = Array.from(
    document.querySelectorAll<HTMLElement>('#recipe-body .recipe-steps li')
  ).map((li, i) => {
    const text = li.querySelector<HTMLElement>('span:last-child')?.textContent?.trim() || ''
    return `  ${i + 1}. ${text}`
  }).join('\n')

  const body = [
    `${type ? type + ': ' : ''}${title}`,
    '',
    ings  ? `Ingredients:\n${ings}`  : '',
    steps ? `\nPreparation:\n${steps}` : '',
    '',
    'Aaron D. Cohen',
    'parkinsonslife.com',
    '',
    '— Sent from ParkinsonDiet',
    '',
    '─'.repeat(60),
    MEDICAL_DISCLAIMER,
  ].filter(Boolean).join('\n')

  const href = `mailto:?subject=${encodeURIComponent(`Recipe: ${title}`)}&body=${encodeURIComponent(body)}`
  window.location.href = href
}

function printShoppingList(): void {
  // Expand all sections so everything is visible when printed
  document.querySelectorAll<HTMLElement>('#shop-list-container .shop-items').forEach(el => {
    el.dataset.printHidden = el.style.display === 'none' ? '1' : '0'
    el.style.display = 'block'
  })
  const shopContainer = document.getElementById('shop-list-container')
  const disc = getDisclaimerNode()
  const auth = getAuthorFooterNode()
  if (shopContainer && disc) shopContainer.after(disc)
  if (auth) document.body.appendChild(auth)
  const prevTitle = document.title
  document.title = 'shoppinglist'
  document.body.classList.add('print-shopping')
  window.print()
  document.body.classList.remove('print-shopping')
  document.title = prevTitle
  document.querySelector('#shopping .disclaimer-print')?.remove()
  document.body.querySelector('.print-author-footer')?.remove()
  // Restore collapsed state
  document.querySelectorAll<HTMLElement>('#shop-list-container .shop-items').forEach(el => {
    if (el.dataset.printHidden === '1') el.style.display = 'none'
    delete el.dataset.printHidden
  })
}

function emailShoppingList(): void {
  if (!currentPlan) return
  const month  = currentPlan.month
  const year   = currentPlan.year
  const budget = currentPlan.budget
  const total  = currentPlan.estimated_total

  const lines: string[] = [`SHOPPING LIST — ${month} ${year}`, '']

  currentPlan.shopping_list.forEach(cat => {
    lines.push(cat.category.toUpperCase())
    // Reflect any user-excluded (checked) items
    const checked = new Set<string>()
    document.querySelectorAll<HTMLInputElement>('#shop-list-container input[type="checkbox"]:checked')
      .forEach(cb => checked.add(cb.id))

    cat.items.forEach((item, ii) => {
      const catIdx = currentPlan!.shopping_list.indexOf(cat)
      const cbId   = `si-${catIdx}-${ii}`
      if (!checked.has(cbId)) {
        lines.push(`  [ ] ${item.name}  (${item.qty})  $${item.price.toFixed(2)}`)
      }
    })
    lines.push('')
  })

  lines.push(`Budget: $${budget.toFixed(0)}   Estimated Total: ~$${total.toFixed(0)}`)
  lines.push('')
  lines.push('Aaron D. Cohen')
  lines.push('parkinsonslife.com')
  lines.push('')
  lines.push('— Sent from ParkinsonDiet')
  lines.push('')
  lines.push('─'.repeat(60))
  lines.push(MEDICAL_DISCLAIMER)

  const subject = encodeURIComponent(`Shopping List — ${month} ${year}`)
  const body    = encodeURIComponent(lines.join('\n'))
  window.location.href = `mailto:?subject=${subject}&body=${body}`
}

function renderDay(day: Day): string {
  const d          = new Date(day.date + 'T00:00:00')
  const dayOfMonth = d.getDate()
  const monthName  = d.toLocaleString('en-US', { month: 'long' })
  return `
    <div class="day-card">
      <div class="day-header">
        <div class="day-num">${dayOfMonth}</div>
        <div><div class="day-name">${monthName} ${dayOfMonth} &middot; ${esc(day.day_name)}</div></div>
      </div>
      <div class="meals">
        ${renderMeal(day.breakfast, 'Breakfast', '☀️', `${day.date}-breakfast`)}
        ${renderMeal(day.lunch,     'Lunch',     '🥗', `${day.date}-lunch`)}
        ${renderMeal(day.dinner,    'Dinner',    '🌙', `${day.date}-dinner`)}
      </div>
    </div>`
}

function renderResults(plan: PlanResp): void {
  currentPlan = plan
  resultsEl.style.display = 'block'

  const sDay = new Date(plan.start_date + 'T00:00:00').getDate()
  const eDay = new Date(plan.end_date   + 'T00:00:00').getDate()

  ;(document.getElementById('r-title') as HTMLElement).textContent = `Your ${plan.month} Meal Plan`
  ;(document.getElementById('r-sub') as HTMLElement).textContent =
    `${plan.month} ${sDay}–${eDay}`

  // Badges — reflect actual user selections
  const badges: string[] = ["Parkinson's Friendly"]
  if (state.age) badges.push(`Age ${state.age}`)
  if (state.isVegan) {
    badges.push('Vegan')
  } else if (state.excludedMeats.length === MEATS.length) {
    badges.push('Meat-Free')
  } else {
    for (const m of state.excludedMeats) {
      const label = m.replace(/\s*\(.*?\)/, '').replace(' / ', '/').trim()
      badges.push(`No ${label}`)
    }
  }
  const allergenLabels: Record<string, string> = {
    'Dairy':          'Dairy-Free',
    'Gluten / Wheat': 'Gluten-Free',
    'Tree Nuts':      'Tree Nut-Free',
    'Peanuts':        'Peanut-Free',
    'Soy':            'Soy-Free',
    'Sesame':         'Sesame-Free',
    'Shellfish':      'Shellfish-Free',
    'Fish':           'Fish-Free',
  }
  for (const a of state.allergies) badges.push(allergenLabels[a] ?? `No ${a}`)
  if (plan.has_dysautonomia) badges.push('Dysautonomia Adjusted')
  ;(document.getElementById('r-badges') as HTMLElement).innerHTML =
    badges.map(b => `<span class="badge">${b}</span>`).join('')

  // Health note
  ;(document.getElementById('r-health-note') as HTMLElement).innerHTML =
    `<strong>Your personalised plan:</strong> ${esc(plan.nutrition_note || 'Tailored for Parkinson\'s health with high antioxidants, fibre, and anti-inflammatory nutrients.')}`

  // Week tabs
  const weekTabsEl  = document.getElementById('week-tabs')!
  const weekGridsEl = document.getElementById('week-grids')!
  weekTabsEl.innerHTML  = plan.weeks.map((w, i) =>
    `<button class="week-tab${i === 0 ? ' active' : ''}" data-week="${i}">${esc(w.label)}</button>`
  ).join('')
  weekGridsEl.innerHTML = plan.weeks.map((w, i) => `
    <div id="week${i}" class="week-grid${i === 0 ? ' active' : ''}">
      ${w.days.map(d => renderDay(d)).join('')}
    </div>`).join('')

  weekTabsEl.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('[data-week]') as HTMLElement | null
    if (!btn) return
    const idx = Number(btn.dataset.week)
    document.querySelectorAll('.week-tab').forEach((el, i)  => el.classList.toggle('active', i === idx))
    document.querySelectorAll('.week-grid').forEach((el, i) => el.classList.toggle('active', i === idx))
  })

  // Shopping list
  ;(document.getElementById('r-budget-total') as HTMLElement).textContent = `$${plan.budget.toFixed(0)}`
  ;(document.getElementById('r-est-total')    as HTMLElement).textContent = plan.estimated_total ? `~$${plan.estimated_total.toFixed(0)}` : '$—'
  ;(document.getElementById('r-grand-total')  as HTMLElement).textContent = plan.estimated_total ? `~$${plan.estimated_total.toFixed(0)}` : '$—'

  const budgetNote = document.getElementById('budget-over-note')
  if (budgetNote) {
    if (plan.over_budget) {
      budgetNote.textContent = `Note: This is the most affordable plan we could build. Actual cost (~$${plan.estimated_total.toFixed(0)}) exceeds your $${plan.budget.toFixed(0)} budget — consider increasing your budget or shortening the plan period.`
      budgetNote.style.display = 'block'
    } else {
      budgetNote.style.display = 'none'
    }
  }

  const shopContainer = document.getElementById('shop-list-container')!
  if (plan.shopping_list?.length) {
    shopContainer.innerHTML = plan.shopping_list.map((sec, si) => `
      <div class="shop-section">
        <div class="shop-head" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
          <span>${esc(sec.category)}</span>
          <span id="sec-total-${si}" style="font-size:0.8rem;color:var(--muted)">$${sec.items.reduce((s, i) => s + i.price, 0).toFixed(2)}</span>
        </div>
        <div class="shop-items">
          ${sec.items.map((item, ii) => `
            <div class="shop-item">
              <input type="checkbox" id="si-${si}-${ii}" data-price="${item.price}" data-section="${si}">
              <label for="si-${si}-${ii}">${esc(item.name)} <span style="color:var(--muted);font-size:0.8rem">(${esc(item.qty)})</span></label>
              <span class="shop-price">$${item.price.toFixed(2)}</span>
            </div>`).join('')}
        </div>
      </div>`).join('')

    const recalcShopTotal = (): void => {
      // Update each section subtotal
      plan.shopping_list.forEach((_sec, si) => {
        let secTotal = 0
        shopContainer.querySelectorAll<HTMLInputElement>(`input[data-section="${si}"]`).forEach(cb => {
          if (!cb.checked) secTotal += parseFloat(cb.dataset.price ?? '0')
        })
        const el = document.getElementById(`sec-total-${si}`)
        if (el) el.textContent = `$${secTotal.toFixed(2)}`
      })

      // Update grand total
      let grandTotal = 0
      shopContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-price]').forEach(cb => {
        cb.nextElementSibling!.className = cb.checked ? 'checked' : ''
        if (!cb.checked) grandTotal += parseFloat(cb.dataset.price ?? '0')
      })
      const fmt = `~$${grandTotal.toFixed(0)}`
      ;(document.getElementById('r-est-total')   as HTMLElement).textContent = fmt
      ;(document.getElementById('r-grand-total') as HTMLElement).textContent = fmt
    }

    shopContainer.addEventListener('change', e => {
      if ((e.target as HTMLElement).matches('input[type="checkbox"][data-price]')) recalcShopTotal()
    })
  } else {
    shopContainer.innerHTML = '<p style="color:var(--muted);font-size:0.9rem;padding:12px 0;">Shopping list is being compiled…</p>'
  }

  // Section nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = (btn as HTMLElement).dataset.section!
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.plan-section').forEach(s => s.classList.remove('active'))
      btn.classList.add('active')
      document.getElementById(target)?.classList.add('active')
    })
  })

  // Email
  document.getElementById('email-btn')?.addEventListener('click', sendEmail)
}

function buildPlanEmailBody(plan: PlanResp): string {
  const lines: string[] = []
  lines.push(`YOUR PARKINSONDIET MEAL PLAN — ${plan.month} ${plan.year}`)
  lines.push('='.repeat(50))
  lines.push('')

  for (const week of plan.weeks) {
    lines.push(week.label)
    lines.push('-'.repeat(30))
    for (const day of week.days) {
      lines.push(`\n${day.day_name}  ${day.date}`)
      lines.push(`  Breakfast: ${day.breakfast.name}`)
      lines.push(`  Lunch:     ${day.lunch.name}`)
      lines.push(`  Dinner:    ${day.dinner.name}`)
    }
    lines.push('')
  }

  lines.push('SHOPPING LIST')
  lines.push('='.repeat(50))
  for (const cat of plan.shopping_list) {
    lines.push(`\n${cat.category.toUpperCase()}`)
    for (const item of cat.items) {
      lines.push(`  [ ] ${item.name}  ${item.qty}  $${item.price.toFixed(2)}`)
    }
  }
  lines.push('')
  lines.push(`Estimated Total: ~$${plan.estimated_total.toFixed(0)}  |  Your Budget: $${plan.budget.toFixed(0)}`)
  lines.push('')
  lines.push('Aaron D. Cohen')
  lines.push('parkinsonslife.com')
  lines.push('')
  lines.push('— Sent from ParkinsonDiet')
  lines.push('')
  lines.push('-'.repeat(60))
  lines.push(MEDICAL_DISCLAIMER)
  return lines.join('\n')
}

function sendEmail(): void {
  if (!currentPlan) return
  const subject = encodeURIComponent(`Your ParkinsonDiet Meal Plan — ${currentPlan.month} ${currentPlan.year}`)
  const body    = encodeURIComponent(buildPlanEmailBody(currentPlan))
  window.location.href = `mailto:?subject=${subject}&body=${body}`
}

// ══════════════════════════════════════════════════════════
// Start over
// ══════════════════════════════════════════════════════════

;(window as any).startOver = () => {
  state.step = 1; state.age = null
  state.startDate = ''; state.endDate = ''
  state.hasDysautonomia = null; state.allergies = []
  state.excludedMeats = []; state.isVegan = false; state.budget = 100
  calYear = -1; calMonth = -1

  mealRegistry.clear()
  resultsEl.style.display = 'none'
  wizardEl.style.display  = 'flex'
  renderCurrentStep()
}

// ══════════════════════════════════════════════════════════
// Init
// ══════════════════════════════════════════════════════════

// Modal event listeners (attached once at startup)
document.getElementById('recipe-close')?.addEventListener('click', hideRecipe)
document.getElementById('recipe-overlay')?.addEventListener('click', hideRecipe)
document.getElementById('recipe-print')?.addEventListener('click', printRecipe)
document.getElementById('recipe-email-btn')?.addEventListener('click', emailRecipe)
document.getElementById('shop-print')?.addEventListener('click', printShoppingList)
document.getElementById('shop-email')?.addEventListener('click', emailShoppingList)
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideRecipe() })
resultsEl.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest('[data-recipe]') as HTMLElement | null
  if (el?.dataset.recipe) showRecipe(el.dataset.recipe)
})

renderCurrentStep()
