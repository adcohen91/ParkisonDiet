from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routes.email    import router as email_router
from routes.meal_plan import router as meal_plan_router

app = FastAPI(title="ParkinsonDiet")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(meal_plan_router)
app.include_router(email_router)

# Serve compiled frontend if it exists
_FRONTEND = Path(__file__).parent.parent / "frontend" / "dist"
if _FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND), html=True), name="static")
