import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import get_settings

router = APIRouter()


class EmailRequest(BaseModel):
    email: str
    plan: dict


def _build_plain(plan: dict) -> str:
    lines: list[str] = []
    month = plan.get("month", "")
    year  = plan.get("year", "")
    lines.append(f"YOUR PARKINSONDIET MEAL PLAN — {month} {year}")
    lines.append("=" * 50)
    lines.append("")

    for week in plan.get("weeks", []):
        lines.append(week.get("label", ""))
        lines.append("-" * 30)
        for day in week.get("days", []):
            lines.append(f"\n{day.get('day_name', '')} {day.get('date', '')}")
            for slot in ("breakfast", "lunch", "dinner"):
                meal = day.get(slot, {})
                label = slot.capitalize()
                lines.append(f"  {label}: {meal.get('name', '')}")
        lines.append("")

    lines.append("SHOPPING LIST")
    lines.append("=" * 50)
    for cat in plan.get("shopping_list", []):
        lines.append(f"\n{cat.get('category', '').upper()}")
        for item in cat.get("items", []):
            lines.append(f"  [ ] {item.get('name', '')}  {item.get('qty', '')}  ${item.get('price', 0):.2f}")
    lines.append("")
    total = plan.get("estimated_total", 0)
    budget = plan.get("budget", 0)
    lines.append(f"Estimated Total: ~${total:.0f}  |  Your Budget: ${budget:.0f}")
    lines.append("")
    lines.append("—")
    lines.append("Sent from ParkinsonDiet — personalised nutrition for Parkinson's health.")
    return "\n".join(lines)


def _build_html(plan: dict) -> str:
    month  = plan.get("month", "")
    year   = plan.get("year", "")
    total  = plan.get("estimated_total", 0)
    budget = plan.get("budget", 0)

    meal_rows = ""
    for week in plan.get("weeks", []):
        meal_rows += f'<tr><td colspan="4" style="padding:12px 0 4px;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b8f71">{week.get("label","")}</td></tr>'
        for day in week.get("days", []):
            b = day.get("breakfast", {}).get("name", "")
            l = day.get("lunch",     {}).get("name", "")
            d = day.get("dinner",    {}).get("name", "")
            label = f'{day.get("day_name","")} <span style="color:#aaa;font-weight:400">{day.get("date","")}</span>'
            meal_rows += f"""
            <tr>
              <td style="padding:8px 12px 8px 0;font-size:0.82rem;font-weight:600;color:#2c3e2d;white-space:nowrap">{label}</td>
              <td style="padding:8px 12px;font-size:0.82rem;color:#444;border-left:1px solid #eee">{b}</td>
              <td style="padding:8px 12px;font-size:0.82rem;color:#444;border-left:1px solid #eee">{l}</td>
              <td style="padding:8px 12px;font-size:0.82rem;color:#444;border-left:1px solid #eee">{d}</td>
            </tr>"""

    shop_rows = ""
    for cat in plan.get("shopping_list", []):
        shop_rows += f'<tr><td colspan="3" style="padding:10px 0 4px;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b8f71">{cat.get("category","")}</td></tr>'
        for item in cat.get("items", []):
            shop_rows += f"""
            <tr>
              <td style="padding:5px 0;font-size:0.82rem;color:#333">&#9744; {item.get("name","")}</td>
              <td style="padding:5px 12px;font-size:0.82rem;color:#888">{item.get("qty","")}</td>
              <td style="padding:5px 0;font-size:0.82rem;color:#333;text-align:right">${item.get("price",0):.2f}</td>
            </tr>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f5ee;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:640px;margin:0 auto;padding:24px 16px">

  <!-- Header -->
  <div style="background:#2c3e2d;border-radius:12px 12px 0 0;padding:28px 32px;text-align:center">
    <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#a8c5aa;margin-bottom:6px">ParkinsonDiet</div>
    <div style="font-size:1.6rem;font-weight:700;color:#ffffff;font-family:Georgia,serif">Your {month} {year} Meal Plan</div>
  </div>

  <!-- Meals -->
  <div style="background:#fff;padding:28px 32px;border-left:1px solid #e8e0d0;border-right:1px solid #e8e0d0">
    <div style="font-size:1rem;font-weight:700;color:#2c3e2d;margin-bottom:16px">Daily Meals</div>
    <table style="width:100%;border-collapse:collapse">
      <tr style="border-bottom:2px solid #2c3e2d">
        <th style="text-align:left;padding:0 12px 8px 0;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888">Day</th>
        <th style="text-align:left;padding:0 12px 8px;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;border-left:1px solid #eee">Breakfast</th>
        <th style="text-align:left;padding:0 12px 8px;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;border-left:1px solid #eee">Lunch</th>
        <th style="text-align:left;padding:0 0 8px 12px;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;border-left:1px solid #eee">Dinner</th>
      </tr>
      {meal_rows}
    </table>
  </div>

  <!-- Shopping List -->
  <div style="background:#fff;padding:28px 32px;margin-top:2px;border-left:1px solid #e8e0d0;border-right:1px solid #e8e0d0">
    <div style="font-size:1rem;font-weight:700;color:#2c3e2d;margin-bottom:16px">Shopping List</div>
    <table style="width:100%;border-collapse:collapse">
      {shop_rows}
    </table>
    <div style="margin-top:16px;padding-top:12px;border-top:2px solid #2c3e2d;display:flex;justify-content:space-between">
      <span style="font-size:0.85rem;color:#888">Your Budget: <strong style="color:#2c3e2d">${budget:.0f}</strong></span>
      <span style="font-size:0.85rem;color:#888">Estimated Total: <strong style="color:#6b8f71">~${total:.0f}</strong></span>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#2c3e2d;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center">
    <div style="font-size:0.75rem;color:#a8c5aa">Sent from ParkinsonDiet — personalised nutrition for Parkinson&rsquo;s health.</div>
  </div>

</div>
</body>
</html>"""


@router.post("/api/send-plan-email")
async def send_plan_email(body: EmailRequest):
    s = get_settings()
    if not s.smtp_user or not s.smtp_password:
        raise HTTPException(503, "Email sending is not configured on this server.")

    from_addr = s.email_from or s.smtp_user
    subject   = f"Your ParkinsonDiet Meal Plan — {body.plan.get('month','')} {body.plan.get('year','')}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = from_addr
    msg["To"]      = body.email

    msg.attach(MIMEText(_build_plain(body.plan), "plain"))
    msg.attach(MIMEText(_build_html(body.plan),  "html"))

    try:
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.login(s.smtp_user, s.smtp_password)
            server.sendmail(from_addr, body.email, msg.as_string())
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(502, "SMTP authentication failed — check SMTP_USER and SMTP_PASSWORD in .env")
    except Exception as exc:
        raise HTTPException(502, f"Failed to send email: {exc}")

    return {"ok": True}
