import json
import re
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel

from config import get_settings

# ── Price floor rules (2025-2026 US retail) ───────────────────────────────────
# (name_keyword, qty_unit_keyword, min_price_per_unit)
# Rules are tried in order; first name+unit match wins.
# unit_keyword="" means apply as a total-price floor regardless of qty phrasing.
_PRICE_FLOOR_RULES: list[tuple[str, str, float]] = [
    # Proteins — most underpirced by LLM
    ("salmon",          "lb",     13.99),
    ("salmon",          "fillet", 13.99),
    ("shrimp",          "lb",     10.99),
    ("shrimp",          "bag",    11.99),
    ("chicken breast",  "lb",      6.49),
    ("chicken thigh",   "lb",      3.99),
    ("chicken",         "lb",      4.99),
    ("turkey breast",   "lb",      9.99),
    ("turkey",          "lb",      8.99),
    ("ground beef",     "lb",      7.49),
    ("beef",            "lb",      6.99),
    ("pork tenderloin", "lb",      6.49),
    ("pork",            "lb",      5.99),
    ("cod",             "lb",      8.99),
    ("tilapia",         "lb",      7.99),
    ("tuna",            "can",     2.29),
    ("bacon",           "lb",      6.99),
    ("sausage",         "lb",      5.99),
    # Dairy & eggs
    ("egg",             "dozen",   4.99),
    ("greek yogurt",    "",        5.99),  # total floor — any qty phrasing
    ("yogurt",          "",        5.49),
    ("cottage cheese",  "",        3.79),
    ("feta",            "",        4.99),
    ("cheddar",         "",        3.99),
    ("mozzarella",      "",        3.99),
    ("cheese",          "",        3.49),  # generic fallback
    ("cream cheese",    "",        3.29),
    ("butter",          "lb",      5.49),
    ("butter",          "stick",   1.37),
    ("milk",            "gallon",  4.29),
    ("sour cream",      "",        2.79),
    # Pantry & oils — package items: use total-price floor (""), never use "oz" as unit_kw
    # (oz in qty like "16 oz" would parse 16 as the count and multiply incorrectly)
    ("olive oil",       "",        9.49),
    ("quinoa",          "lb",      5.49),
    ("rolled oats",     "",        4.99),
    ("oats",            "",        4.99),
    ("bread",           "loaf",    4.49),
    ("tortilla",        "pack",    4.49),
    ("wrap",            "pack",    4.49),
    ("pasta",           "lb",      2.49),
    ("broth",           "carton",  3.49),
    ("broth",           "",        3.49),  # fallback — any qty phrasing
    ("coconut milk",    "can",     2.29),
    # Nuts, seeds, condiments — all package items, use total-price floor
    ("chia",            "",        5.99),
    ("flaxseed",        "lb",      4.99),  # if LLM uses lb: scale correctly
    ("flaxseed",        "",        4.99),  # if LLM uses oz: total floor, no scaling
    ("hemp seed",       "",        7.99),
    ("pumpkin seed",    "",        4.99),
    ("walnut",          "lb",      9.99),
    ("walnut",          "",        5.99),  # 8oz bag total floor
    ("almond butter",   "",        7.99),
    ("peanut butter",   "",        3.49),
    ("tahini",          "",        6.99),
    ("maple syrup",     "",        7.99),
    ("honey",           "",        5.99),
]


def _correct_price(name: str, qty: str, price: float) -> float:
    """Raise item price to the 2025-2026 market minimum if the LLM underpriced it."""
    name_l = name.lower()
    qty_l = qty.lower()
    for name_kw, unit_kw, min_floor in _PRICE_FLOOR_RULES:
        if name_kw not in name_l:
            continue
        if not unit_kw:
            # Total-price floor regardless of quantity
            return max(price, min_floor)
        if unit_kw in qty_l:
            # Per-unit floor — scale by the leading number in the qty string
            m = re.match(r"(\d+(?:\.\d+)?)", qty_l)
            qty_num = float(m.group(1)) if m else 1.0
            return max(price, round(min_floor * qty_num, 2))
    return price

router = APIRouter()

_KNOWLEDGE_PATH = Path(__file__).parent.parent.parent / "knowledge" / "InitialDiet.md"


def _load_knowledge() -> str:
    if _KNOWLEDGE_PATH.exists():
        return _KNOWLEDGE_PATH.read_text(encoding="utf-8")
    return ""


def _strip_example_sections(knowledge: str) -> str:
    """Remove example-heavy sections (staple ingredients + recipe library) — leave nutritional guidance."""
    lines = knowledge.splitlines()
    result: list[str] = []
    skip = False
    for line in lines:
        if line.startswith("## Approved Staple Ingredients") or line.startswith("## Recipe Library"):
            skip = True
        elif line.startswith("## ") and skip:
            skip = False
        if not skip:
            result.append(line)
    return "\n".join(result)


def _vegan_examples(allergies: list[str], budget: float) -> str:
    has_nuts = "Tree Nuts" in allergies
    has_peanuts = "Peanuts" in allergies
    has_soy = "Soy" in allergies
    has_gluten = "Gluten / Wheat" in allergies
    has_sesame = "Sesame" in allergies

    soy_note = "No tofu/tempeh/miso/soy sauce — use chickpeas or white beans as protein instead." if has_soy else ""
    sesame_note = "No tahini or sesame products." if has_sesame else ""
    gluten_note = "Use rice, quinoa, or potato — no oat flour, barley, pasta, or bread." if has_gluten else ""

    base = (
        "CRITICAL — This user is fully VEGAN. Generate 100% plant-based meals with no animal products whatsoever.\n"
        "- Absolutely no meat, fish, dairy, or eggs in any form\n"
    )
    if soy_note:
        base += f"- {soy_note}\n"
    if sesame_note:
        base += f"- {sesame_note}\n"
    if gluten_note:
        base += f"- {gluten_note}\n"

    if budget < 70:
        # Frugal vegan: dried legumes, oats, rice, basic produce only
        return (
            base +
            f"Budget is ${budget:.0f} — tight. Use only affordable ingredients:\n"
            f"- Proteins: dried/canned lentils, canned beans (black beans, chickpeas) — NO tofu, no tempeh\n"
            f"- Grains: oats, brown rice, or pasta (choose 2). NO quinoa (too expensive).\n"
            f"- Produce: 4-5 basics only (spinach, carrots, broccoli, sweet potato, frozen peas). No berries, avocado.\n"
            f"- Pantry: NO chia seeds, NO flaxseed, NO maple syrup, NO tahini, NO nut butters, NO walnuts.\n"
            f"- Example breakfasts: oat porridge with banana, oatmeal with frozen fruit\n"
            f"- Example lunches: lentil soup, black bean rice bowl, chickpea wrap\n"
            f"- Example dinners: red lentil dal with rice, black bean tacos, chickpea vegetable stew"
        )
    elif budget < 120:
        nut_alt = "seeds (pumpkin, sunflower)" if (has_nuts or has_peanuts) else "peanut butter (affordable fat)"
        return (
            base +
            f"Budget is ${budget:.0f} — moderate. Use affordable plant protein and basic pantry:\n"
            f"- Proteins: lentils, canned beans, tofu (if soy allowed)\n"
            f"- Grains: oats, brown rice, pasta. Quinoa OK if small portion.\n"
            f"- Pantry fat: olive oil OR peanut butter — skip chia seeds, flaxseed, maple syrup, tahini, walnuts.\n"
            f"- Produce: seasonal basics + 1 fruit\n"
            f"- Example breakfasts: oat porridge with banana, peanut butter toast\n"
            f"- Example lunches: chickpea wrap, lentil soup, grain bowl\n"
            f"- Example dinners: lentil dal, vegetable curry, black bean tacos, stuffed peppers"
        )
    else:
        nut_alt = "seeds (pumpkin, sunflower, hemp)" if (has_nuts or has_peanuts) else "nuts and nut butters (tahini, almond butter)"
        return (
            base +
            f"- Use legumes (lentils, chickpeas, black beans, white beans) as primary protein\n"
            f"- Use {nut_alt} for healthy fats\n"
            f"- Pantry: olive oil, chia seeds, flaxseed, maple syrup are all OK\n"
            f"- Example breakfasts: oat porridge with fruit, chia pudding, smoothie bowl, avocado toast\n"
            f"- Example lunches: chickpea wrap, lentil soup, grain bowl with roasted vegetables\n"
            f"- Example dinners: lentil dal, vegetable curry, stuffed peppers, black bean tacos"
        )


def _omnivore_examples(allergies: list[str], budget: float) -> str:
    has_dairy = "Dairy" in allergies
    has_gluten = "Gluten / Wheat" in allergies
    has_eggs = "Eggs" in allergies

    egg_note = (
        "NO eggs in any form — use meat or smoked fish as breakfast protein instead"
        if has_eggs
        else "eggs at breakfast every opportunity (scrambled, omelette, poached, fried)"
    )
    bread_note = (
        "use rice, quinoa, potato, or corn tortillas — NO bread, pasta, flour wraps, or soy sauce"
        if has_gluten
        else "whole grain bread, wraps, and pasta"
    )

    # Budget-aware protein instructions prevent the LLM from planning expensive ingredients it can't afford
    if budget < 70:
        # Ultra-frugal: eggs + tuna only
        egg_note_tight = "" if not has_eggs else " (eggs excluded — use tuna only)"
        return (
            f"CRITICAL — This user is NOT vegan. Budget is ${budget:.0f} — very tight.\n"
            f"ALLOWED PROTEINS: eggs{egg_note_tight} + 1-2 cans of tuna ONLY.\n"
            f"NO beef, NO pork, NO chicken, NO turkey, NO salmon, NO shrimp, NO bacon, NO deli meat.\n"
            f"Design all 9 meals around eggs and tuna:\n"
            f"- Breakfasts: scrambled eggs, omelette with vegetables, egg toast\n"
            f"- Lunches: tuna salad wrap, tuna with crackers, egg salad sandwich\n"
            f"- Dinners: egg fried rice, tuna pasta, vegetable frittata, tuna and rice bowl\n"
            f"- Starch: {bread_note}\n"
            f"- Dairy: {'NO dairy — allergy' if has_dairy else 'cottage cheese is OK if budget allows'}\n"
            f"- Do NOT generate vegan or plant-based meals"
        )
    elif budget < 100:
        # Frugal: eggs + chicken thighs
        return (
            f"CRITICAL — This user is NOT vegan. Budget is ${budget:.0f} — frugal.\n"
            f"ALLOWED PROTEINS: eggs + chicken thighs (1-2 lb total) + optionally 1 can tuna.\n"
            f"NO salmon, NO shrimp, NO beef, NO pork tenderloin, NO turkey breast, NO bacon.\n"
            f"- Breakfasts: scrambled eggs, omelette, egg sandwich\n"
            f"- Lunches: tuna salad (if tuna included), chicken salad, egg salad sandwich\n"
            f"- Dinners: chicken thighs with rice, chicken soup, egg fried rice\n"
            f"- Starch: {bread_note}\n"
            f"- Do NOT generate vegan or plant-based meals"
        )
    else:
        # Standard/premium: full variety
        dairy_note = (
            "NO dairy in any form (no milk, cheese, yogurt, butter, cream, whey)"
            if has_dairy
            else "dairy (milk, cheese, yogurt, butter) freely"
        )
        lunch_examples = (
            "grilled chicken rice bowl, tuna over greens, chicken soup with rice, turkey lettuce cups"
            if has_gluten
            else "grilled chicken salad, tuna wrap, turkey sandwich, chicken soup"
        )
        dinner_examples = (
            "beef stew, baked salmon, pork chops, roasted chicken, ground beef tacos, "
            "cod with vegetables, turkey meatballs, pork tenderloin"
        )
        if budget >= 175:
            dinner_examples += ", shrimp stir-fry, lamb chops"
        grain_limit = "Choose 1–2 grain bases (e.g., bread + rice — not bread AND rice AND oats AND pasta AND tortillas)."
        return (
            f"CRITICAL — This user is NOT vegan. Generate meals that prominently feature animal protein:\n"
            f"- Use {dairy_note}\n"
            f"- Include {egg_note}\n"
            f"- Starch: {bread_note}. {grain_limit}\n"
            f"- VARIETY IS MANDATORY: rotate proteins across days — beef one dinner, pork another, fish another.\n"
            f"  Do NOT use chicken or fish for every meal.\n"
            f"- Example breakfasts (rotate): scrambled eggs, bacon and eggs, omelette with ham, smoked salmon on toast, cottage cheese bowl\n"
            f"- Example lunches (rotate): {lunch_examples}, beef chili, pork fried rice, BLT\n"
            f"- Example dinners (rotate each day): {dinner_examples}\n"
            f"- Do NOT repeat the same protein two days in a row\n"
            f"- Do NOT generate vegan or plant-based meals"
        )


def _partial_excl_examples(allergies: list[str], budget: float) -> str:
    has_dairy = "Dairy" in allergies
    has_eggs = "Eggs" in allergies

    dairy_note = (
        "NO dairy — dairy allergy"
        if has_dairy
        else "eggs and dairy (milk, cheese, yogurt) are OK"
    )
    egg_note = "" if not has_eggs else " No eggs — egg allergy."
    gluten_note = " Use rice, quinoa, or potato as starch — no flour wraps, bread, pasta, or soy sauce." if "Gluten / Wheat" in allergies else ""

    if budget < 100:
        return (
            f"CRITICAL — This user has specific meat exclusions. Respect them strictly.\n"
            f"Budget is ${budget:.0f} — tight. Use affordable permitted proteins only: "
            f"eggs + chicken thighs + 1 can tuna (if fish allowed). No salmon, shrimp, or premium cuts.\n"
            f"- Include {dairy_note} unless in allergy list.{egg_note}{gluten_note}\n"
            f"- Do NOT use tofu or legume-only dishes as the main protein — this is an omnivore diet\n"
            f"- Do NOT generate vegan or plant-based meals"
        )
    if budget < 175:
        return (
            f"CRITICAL — This user has specific meat exclusions. Respect them strictly.\n"
            f"Budget is ${budget:.0f}. Choose 2–3 proteins from the permitted list only (not all of them):\n"
            f"  Good choices: chicken thighs/breast, pork chops (1 lb), eggs, salmon (1 lb max), canned tuna.\n"
            f"  Skip: deli turkey breast, multiple chicken cuts, shrimp (too expensive for budget).\n"
            f"- Grain: choose 1 base (bread OR rice — not both AND oats AND pasta).\n"
            f"- Include {dairy_note} — max 2 dairy items.{egg_note}{gluten_note}\n"
            f"- VARIETY: different protein at each dinner — no protein repeated two nights in a row\n"
            f"- Do NOT use tofu, tempeh, or legume-only dishes as the main protein — this is an omnivore diet\n"
            f"- Do NOT generate vegan or plant-based meals"
        )
    return (
        f"CRITICAL — This user has specific meat exclusions. Respect them strictly and use all other animal proteins freely:\n"
        f"- The excluded items listed above must NOT appear in any form (not even as ingredients or garnish)\n"
        f"- ALL OTHER animal proteins are REQUIRED — rotate through all permitted ones, not just chicken and fish\n"
        f"- Include {dairy_note} unless in allergy list.{egg_note}{gluten_note}\n"
        f"- VARIETY: spread permitted proteins across days — no protein two days in a row at dinner\n"
        f"- Do NOT use tofu, tempeh, or legume-only dishes as the main protein — this is an omnivore diet\n"
        f"- Do NOT generate vegan or plant-based meals"
    )


def _week_label(start: date, end: date) -> str:
    if start.month == end.month:
        return f"{start.strftime('%b')} {start.day}–{end.day}"
    return f"{start.strftime('%b')} {start.day} – {end.strftime('%b')} {end.day}"


def _group_weeks(days: list[dict], start: date, end: date) -> list[dict]:
    weeks: list[dict] = []
    week_start = start
    week_num = 1
    while week_start <= end:
        week_end = min(week_start + timedelta(days=6), end)
        week_days = [
            d for d in days
            if week_start.isoformat() <= d["date"] <= week_end.isoformat()
        ]
        if week_days:
            weeks.append({
                "label": f"Week {week_num} ({_week_label(week_start, week_end)})",
                "days": week_days,
            })
        week_start = week_end + timedelta(days=1)
        week_num += 1
    return weeks


def _build_prompt(req: "PlanRequest", knowledge: str) -> str:
    start = date.fromisoformat(req.start_date)
    end = date.fromisoformat(req.end_date)
    num_days = (end - start).days + 1

    date_list: list[str] = []
    cur = start
    while cur <= end:
        date_list.append(f'{cur.isoformat()} ({cur.strftime("%A")})')
        cur += timedelta(days=1)

    _ALLERGY_EXPANSIONS: dict[str, str] = {
        "Dairy":         "Dairy (milk, cheese, yogurt, butter, cream, whey, casein)",
        "Gluten / Wheat":"Gluten/Wheat (bread, pasta, flour, soy sauce, most wraps)",
        "Tree Nuts":     "Tree Nuts (almonds, cashews, walnuts, pecans, pistachios)",
        "Peanuts":       "Peanuts (and peanut butter)",
        "Soy":           "Soy (tofu, edamame, miso, tamari, soy sauce)",
        "Sesame":        "Sesame (tahini, sesame oil, sesame seeds)",
        "Shellfish":     "Shellfish (shrimp, crab, lobster, scallops, clams, mussels, oysters)",
        "Fish":          "Fish (salmon, tuna, cod, tilapia, and all fish)",
    }
    allergy_str = (
        "; ".join(_ALLERGY_EXPANSIONS.get(a, a) for a in req.allergies)
        if req.allergies else "none"
    )
    _MEAT_EXPANSIONS: dict[str, str] = {
        "Beef":      "Beef (steak, ground beef, roast beef, veal, corned beef)",
        "Pork":      "Pork (pork chops, ham, bacon, sausage, prosciutto, lard)",
        "Chicken":   "Chicken (chicken breast, thighs, wings, rotisserie)",
        "Turkey":    "Turkey (turkey breast, ground turkey, deli turkey)",
        "Lamb":      "Lamb (lamb chops, ground lamb, mutton)",
        "Duck":      "Duck and other poultry besides chicken and turkey",
        "Shellfish": "Shellfish (shrimp, prawns, crab, lobster, scallops, clams, mussels, oysters)",
        "Fish":      "Fish (salmon, tuna, cod, tilapia, halibut, bass, trout, and all finned fish)",
    }
    kb = _strip_example_sections(knowledge)  # always strip the recipe library to prevent allergen/bias issues
    if req.is_vegan:
        diet_str = "FULLY VEGAN — absolutely no meat, poultry, fish, dairy, eggs, or any animal products"
        diet_examples = _vegan_examples(req.allergies, req.budget)
    elif req.excluded_meats:
        excluded_expanded = "; ".join(
            _MEAT_EXPANSIONS.get(m, m) for m in req.excluded_meats
        )
        diet_str = (
            f"OMNIVORE with exclusions — these MUST NOT appear in any form: {excluded_expanded}. "
            f"All other meats, fish, poultry, dairy, and eggs are REQUIRED and encouraged."
        )
        diet_examples = _partial_excl_examples(req.allergies, req.budget)
    else:
        diet_str = (
            "OMNIVORE — meat, fish, poultry, dairy, and eggs are all permitted and expected. "
            "Do NOT produce vegan or plant-based meals. Use animal protein as the primary protein source."
        )
        diet_examples = _omnivore_examples(req.allergies, req.budget)

    dysautonomia_note = (
        "YES — emphasise smaller portions, easy-to-digest meals, and add snack ideas between meals."
        if req.has_dysautonomia
        else "No."
    )

    # Scale the target budget to leave headroom for server-side price corrections.
    # Tight budgets need more headroom (price corrections are proportionally larger);
    # larger budgets need less (LLM prices bigger items more accurately).
    if req.budget <= 70:
        budget_target = max(25, round(req.budget * 0.60))   # 40% headroom for tight budgets
    else:
        budget_target = max(48, round(req.budget * 0.68))   # 32% headroom for larger budgets

    return f"""You are a specialist Parkinson's disease dietitian generating a personalised meal plan.

╔══════════════════════════════════════════════════════╗
║  DIET (HIGHEST PRIORITY — OVERRIDES EVERYTHING)      ║
╚══════════════════════════════════════════════════════╝
{diet_str}
Allergies (must not appear in any form): {allergy_str}

{diet_examples}

=== USER PROFILE ===
Age: {req.age}
Date range: {start.strftime("%B %d, %Y")} to {end.strftime("%B %d, %Y")} ({num_days} days)
Budget: ${req.budget:.0f} USD for the entire period
Dysautonomia: {dysautonomia_note}

=== NUTRITIONAL KNOWLEDGE BASE ===
{kb}
=== END KNOWLEDGE BASE ===

=== TASK ===
Generate a complete daily meal plan covering every date listed. Include breakfast, lunch, and dinner for each day.
The meals MUST reflect the diet specification above — re-read it before writing each meal.

Also generate a categorised shopping list for all meals combined.

PRICING RULES — critical, read before assigning any price:
1. Grocery prices have risen sharply since 2022 due to inflation. Use 2025-2026 US retail prices ONLY.
   Do NOT use pre-2023 price levels — they are outdated by 25-40%.
2. TARGET BUDGET FOR THIS PLAN: ${budget_target:.0f}. Shopping list total MUST be at or under this amount.
   Keep a running total as you add items. Stop adding items once you hit ${budget_target:.0f}.
   If your total approaches the limit, skip optional pantry items (sauces, condiments, premium seeds).
3. Each item's "price" field = cost of the exact quantity listed at 2025-2026 retail.
   Example: qty "1.5 lbs chicken thighs" → 1.5 × $4.99 = $7.49.
4. The "estimated_total" in the JSON MUST equal the arithmetic sum of all item prices.
5. Before finalising: sum all prices. If the sum exceeds ${budget_target:.0f}, remove the most expensive items.

MANDATORY MINIMUM PRICES (2025-2026, major US chains):
  eggs, 1 dozen large:          $4.99  (egg prices have doubled since 2022 — never price below $4.50)
  chicken breast, 1 lb:         $6.99  (boneless/skinless — never below $5.99)
  chicken thighs, 1 lb:         $4.99  (bone-in — never below $3.99)
  ground beef, 1 lb:            $7.49  (85/15 — never below $6.49)
  salmon fillet, 1 lb:          $14.99 (fresh/frozen — never below $12.99)
  shrimp, 1 lb frozen:          $11.99 (never below $9.99)
  cod/tilapia, 1 lb:            $9.99  (never below $7.99)
  canned tuna, 5 oz can:        $2.49  (never below $1.99)
  deli turkey breast, 1 lb:     $10.99 (never below $8.99)
  pork tenderloin, 1 lb:        $6.99  (never below $5.99)
  bacon, 1 lb package:          $7.99  (never below $6.49)
  milk, 1 gallon:               $4.49  (never below $3.99)
  Greek yogurt, 32 oz tub:      $6.99  (never below $5.99)
  cottage cheese, 16 oz:        $4.29  (never below $3.49)
  cheddar cheese, 8 oz block:   $4.99  (never below $3.99)
  feta cheese, 8 oz crumbled:   $5.99  (never below $4.99)
  butter, 1 lb / 4 sticks:      $5.99  (never below $4.99)
  olive oil, 16 oz bottle:      $11.99 (never below $8.99)
  rolled oats, 42 oz canister:  $5.99  (never below $4.99)
  quinoa, 1 lb bag:             $6.49  (never below $4.99)
  whole grain bread, 1 loaf:    $4.99  (never below $3.99)
  tortillas/wraps, pack of 8:   $4.99  (never below $3.99)
  pasta, 1 lb box:              $2.99  (never below $1.99)
  canned beans, 15 oz:          $1.49  (never below $1.25)
  broth, 32 oz carton:          $3.99  (never below $2.99)
  coconut milk, 13.5 oz can:    $2.79  (never below $1.99)
  spinach/greens, 5 oz bag:     $4.49  (never below $3.49)
  broccoli, 1 head:             $3.49  (never below $2.49)
  mushrooms, 8 oz cremini:      $3.99  (never below $2.99)
  berries/blueberries, 1 pint:  $5.49  (never below $3.99)
  avocado, 1 each:              $1.79  (never below $1.29)
  sweet potato, 1 lb:           $1.99  (never below $1.49)
  walnuts, 8 oz:                $7.99  (never below $5.99)
  almond butter, 16 oz:         $9.99  (never below $7.99)
  chia seeds, 12 oz:            $7.99  (never below $5.99)
  ground flaxseed, 16 oz:       $6.49  (never below $4.99)
  tahini, 16 oz:                $8.99  (never below $6.99)
  maple syrup, 8 oz:            $9.99  (never below $7.99)

SHOPPING LIST CONSISTENCY (critical — meals and list must match exactly):
The shopping list MUST include every purchasable ingredient for every meal planned. Go meal by meal:
  - Every protein (beef, chicken, pork, fish, bacon, eggs) — never omit a protein you cooked
  - Every dairy product (yogurt, cheese, cottage cheese, milk, cream cheese, butter)
  - Every fresh produce item (vegetables, fruits, berries, avocado)
  - Every grain/starch (bread, tortillas/wraps, pasta, rice, oats, quinoa)
  - Every canned good (beans, tuna, broth, coconut milk, tomatoes)
Examples: "Omelette with Mushrooms" → mushrooms must be in the list.
          "Greek Yogurt with Berries" → Greek yogurt AND berries must be in the list.
          "Ground Beef Tacos" → ground beef AND tortillas must be in the list.
Assume the user has only: salt, pepper, garlic powder, and basic dry spices. Everything else is on the list.
If you cannot afford an ingredient, change that meal to a cheaper alternative — never plan a meal whose key ingredients are absent.

Return ONLY valid JSON in EXACTLY this schema (no markdown, no explanation):
{{
  "days": [
    {{
      "date": "YYYY-MM-DD",
      "day_num": <integer>,
      "day_name": "<weekday>",
      "breakfast": {{"name": "...", "description": "...", "tags": ["..."]}},
      "lunch":     {{"name": "...", "description": "...", "tags": ["..."]}},
      "dinner":    {{"name": "...", "description": "...", "tags": ["..."]}}
    }}
  ],
  "shopping_list": [
    {{
      "category": "...",
      "items": [
        {{"name": "...", "qty": "...", "price": 0.00}}
      ]
    }}
  ],
  "estimated_total": 0.00,
  "nutrition_note": "2-3 sentence summary of how this plan supports Parkinson's health."
}}

Dates to cover ({num_days} days):
{chr(10).join(date_list)}"""


def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def _get_client(key: str) -> tuple[AsyncOpenAI, str]:
    s = get_settings()
    base_url = (
        "https://openrouter.ai/api/v1"
        if key.startswith("sk-or-")
        else "https://api.openai.com/v1"
    )
    model = s.model
    if not key.startswith("sk-or-") and model.startswith("openai/"):
        model = model[len("openai/"):]
    return AsyncOpenAI(base_url=base_url, api_key=key), model


# ── Request model ──────────────────────────────────────────────────────────────

class PlanRequest(BaseModel):
    age: int
    start_date: str
    end_date: str
    has_dysautonomia: bool = False
    allergies: list[str] = []
    excluded_meats: list[str] = []
    is_vegan: bool = False
    budget: float = 100.0


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/api/generate-plan")
async def generate_plan(body: PlanRequest):
    s = get_settings()
    key = s.openrouter_api_key
    if not key:
        raise HTTPException(500, "OPENROUTER_API_KEY not configured")

    start = date.fromisoformat(body.start_date)
    end = date.fromisoformat(body.end_date)
    if end < start:
        raise HTTPException(400, "end_date must be on or after start_date")
    if (end - start).days > 30:
        raise HTTPException(400, "Date range may not exceed 31 days")

    knowledge = _load_knowledge()
    client, model = _get_client(key)

    try:
        response = await client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a Parkinson's disease nutrition specialist. "
                        "You always respond with valid JSON only, exactly as instructed."
                    ),
                },
                {"role": "user", "content": _build_prompt(body, knowledge)},
            ],
            max_completion_tokens=8000,
            temperature=0.6,
        )
        raw = response.choices[0].message.content or ""
    except Exception as exc:
        raise HTTPException(502, f"LLM request failed: {exc}") from exc

    try:
        plan_data = _extract_json(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(502, f"LLM returned invalid JSON: {exc}") from exc

    days: list[dict] = plan_data.get("days", [])
    if not days:
        raise HTTPException(502, "LLM returned no meal data")

    shopping_list = plan_data.get("shopping_list", [])

    # Correct LLM's systematically outdated prices to 2025-2026 market rates
    for cat in shopping_list:
        for item in cat.get("items", []):
            item["price"] = _correct_price(
                item.get("name", ""), item.get("qty", ""), float(item.get("price", 0))
            )

    # Always compute the total server-side so it matches the corrected item prices
    calculated_total = round(
        sum(item.get("price", 0) for cat in shopping_list for item in cat.get("items", [])),
        2,
    )

    return {
        "month": start.strftime("%B"),
        "year": start.year,
        "start_date": body.start_date,
        "end_date": body.end_date,
        "weeks": _group_weeks(days, start, end),
        "shopping_list": shopping_list,
        "estimated_total": calculated_total,
        "budget": body.budget,
        "over_budget": calculated_total > body.budget,
        "nutrition_note": plan_data.get("nutrition_note", ""),
        "has_dysautonomia": body.has_dysautonomia,
    }


class RecipeRequest(BaseModel):
    meal_name: str
    description: str
    diet: str = ""
    allergies: list[str] = []


@router.post("/api/recipe")
async def get_recipe(body: RecipeRequest):
    s = get_settings()
    key = s.openrouter_api_key
    if not key:
        raise HTTPException(500, "OPENROUTER_API_KEY not configured")

    client, model = _get_client(key)
    allergy_str = ", ".join(body.allergies) if body.allergies else "none"
    diet_line = body.diet or "balanced omnivore — use meat, fish, dairy, and eggs as appropriate"
    prompt = f"""You are a Parkinson's disease dietitian. Generate a concise recipe for this meal.

Meal: {body.meal_name}
Description: {body.description}
Diet: {diet_line}
Allergies (must not appear): {allergy_str}

Return ONLY valid JSON:
{{
  "ingredients": ["qty + ingredient", "..."],
  "steps": ["step 1", "..."]
}}

Include 4-6 ingredients with quantities and 3-5 clear preparation steps."""

    try:
        response = await client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a Parkinson's disease nutrition specialist. Respond with valid JSON only."},
                {"role": "user", "content": prompt},
            ],
            max_completion_tokens=600,
            temperature=0.7,
        )
        raw = response.choices[0].message.content or ""
    except Exception as exc:
        raise HTTPException(502, f"LLM request failed: {exc}") from exc

    try:
        data = _extract_json(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(502, f"LLM returned invalid JSON: {exc}") from exc

    return {
        "ingredients": data.get("ingredients", []),
        "steps": data.get("steps", []),
    }
