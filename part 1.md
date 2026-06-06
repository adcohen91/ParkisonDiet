# ParkinsonDiet — Session Part 1

## Session Summary

This document captures all work completed in Part 1 of the ParkinsonDiet development session.

---

## Issues Fixed

### 1. Budget Adherence (Critical)

**Problem:** Generated meal plans consistently exceeded the user's stated budget across all scenarios:
- Omnivore $150 → $241.35 (over)
- Vegan $60 → $85.90 (over)
- Omnivore $40 min → $87.61 (over)

**Root Causes:**
- A `max(40, ...)` floor prevented scaling from working at minimum budgets
- The `_omnivore_examples()` function said "VARIETY IS MANDATORY — beef, pork, chicken, turkey, fish" which conflicted with budget tier restrictions
- The vegan examples function had no budget awareness, allowing expensive pantry items (chia seeds, flaxseed, maple syrup) for any budget
- The LLM planned meals with diverse proteins but then omitted them from the shopping list (inconsistency)
- The LLM bought all 5 grain types simultaneously (bread + rice + oats + pasta + tortillas)

**Fix:**
- **Tiered budget scaling:** 0.60× for budgets ≤ $70 (more headroom), 0.68× for budgets > $70
- **Budget-aware diet examples:** `_omnivore_examples()`, `_vegan_examples()`, `_partial_excl_examples()` all take a `budget` parameter and restrict proteins/pantry accordingly:
  - Under $70: eggs + tuna only; no beef/pork/salmon/bacon
  - $70–$100: eggs + chicken thighs; no salmon/shrimp
  - $100–$175: 2–4 proteins, salmon OK, skip deli turkey/shrimp
  - Over $175: full flexibility
- **Shopping list consistency rule:** added to prompt — every meal's protein must appear in the shopping list; if you can't afford an ingredient, change the meal
- **Grain count limit:** "choose 1–2 grain bases — not all five simultaneously"
- **`over_budget` flag:** backend now returns `over_budget: true/false`; frontend shows a yellow warning note when the plan can't fit the stated budget

**Results after fix:**
| Scenario | Budget | Result | Status |
|---|---|---|---|
| Omnivore $40 | $40 | ~$32–38 | ✓ Under |
| Vegan $60 | $60 | ~$33–38 | ✓ Under |
| Omnivore excl. Beef $120 | $120 | ~$95–99 | ✓ Under |
| Omnivore $150 | $150 | ~$99–127 | ✓ Under |

---

### 2. Recipe Print / Save PDF Button

**Problem:** No way to print or save a recipe from the recipe modal.

**Fix:**
- Added **Print / Save PDF** (blue) and **Email Recipe** (green outlined) buttons to the bottom of every recipe card
- `@media print` CSS with `.print-recipe` body class hides everything except the recipe card; overlay, close button, and action buttons are suppressed for a clean printout
- `printRecipe()` adds the class, calls `window.print()`, then removes the class
- `emailRecipe()` builds a plain-text `mailto:` link pre-populated with the meal type, title, ingredients, and steps

---

### 3. Shopping List Print / Save PDF + Email Buttons

**Problem:** No way to print or share the shopping list.

**Fix:**
- Added **Print / Save PDF** and **Email Shopping List** buttons below the grand total row on the Shopping List page
- `@media print` CSS with `.print-shopping` body class shows only the shopping section (hides meal plan tab, email section, action buttons)
- `printShoppingList()` temporarily expands any collapsed categories, prints, then restores collapsed state
- `emailShoppingList()` builds a plain-text shopping list — respects user-checked (excluded) items — and opens a `mailto:` link

---

### 4. Email — Backend Endpoint Built (Pending SMTP Credentials)

**Problem:** The "Send by Email" page showed "Email sending requires SMTP configuration in .env" and the `/api/send-plan-email` endpoint did not exist.

**Work completed:**
- Created `backend/routes/email.py` with a full `/api/send-plan-email` POST endpoint using Python's `smtplib` (stdlib, no new packages)
- Generates both plain-text and HTML email versions of the complete meal plan + shopping list
- HTML email includes a styled header, daily meal table, categorised shopping list, and budget summary
- Added SMTP settings to `backend/config.py`: `smtp_host`, `smtp_port`, `smtp_user`, `smtp_password`, `email_from`
- Registered the router in `backend/main.py`
- Updated frontend `sendEmail()` to pass `{ email, plan }` (previously only sent `{ email }`)
- Added `currentPlan` module variable set when results render, used by `sendEmail()`
- Removed the warning note from the HTML; errors now surface inline in the UI
- Added SMTP config block to `.env` pre-filled for Gmail (`smtp.gmail.com:587`)

**Pending:** User needs to add `SMTP_PASSWORD` to `.env`. They are setting up `parkinson@adcriskhorizon.com` as the sending address. Once SMTP credentials are available, update `.env`:
```
SMTP_HOST=<host from provider>
SMTP_PORT=587
SMTP_USER=parkinson@adcriskhorizon.com
SMTP_PASSWORD=<password from provider>
EMAIL_FROM=ParkinsonDiet <parkinson@adcriskhorizon.com>
```
Then run `bash scripts/start_mac.sh` to rebuild.

---

## Files Modified

| File | Changes |
|---|---|
| `backend/routes/meal_plan.py` | Tiered budget scaling, budget-aware diet example functions, shopping list consistency rule, grain count limits, `over_budget` flag in response |
| `backend/routes/email.py` | **New file** — `/api/send-plan-email` endpoint, plain-text + HTML email builders |
| `backend/config.py` | Added SMTP settings fields |
| `backend/main.py` | Registered email router |
| `frontend/src/meal-plan.ts` | `currentPlan` variable, `printRecipe()` with body class, `emailRecipe()`, `printShoppingList()`, `emailShoppingList()`, updated `sendEmail()` with plan data + error handling, wired all new buttons |
| `frontend/index.html` | Recipe action buttons, shopping list action buttons, updated `@media print` CSS with class-based targeting, removed SMTP warning note, `budget-over-note` div, `over_budget` display |
| `.env` | Added SMTP config block |

---

## Docker

Application is built and running at `http://localhost:8000`.  
Admin panel at `http://localhost:8000/admin`.

To rebuild after any code change:
```bash
bash scripts/start_mac.sh
```

---

## Next Steps

1. **Email SMTP:** Add `SMTP_PASSWORD` for `parkinson@adcriskhorizon.com` to `.env` and rebuild Docker
2. **Testing:** Full end-to-end test of meal plan generation, recipe view, print/email for both recipe and shopping list
3. **Deploy to AWS** when ready for production
