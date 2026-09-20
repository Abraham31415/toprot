import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.sample_size import router as sample_size_router
from app.generate.router import router as generate_router

app = FastAPI(title="ToProt Document Service")

allowed_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sample_size_router)
app.include_router(generate_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "toprot-document-service"}
