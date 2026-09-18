"""Stateless API for Subscription Killer Proxy.

No uploaded file, transaction, signature, or account identifier is persisted by this service.
The deployment must also disable request-body logging and configure infrastructure log redaction.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
import os
import re
import secrets
from datetime import datetime, timezone
from typing import Annotated, Literal

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from PyPDF2 import PdfReader
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.lib import colors

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if origin.strip()]

app = FastAPI(title="Subscription Killer Proxy API", version="1.0.0", docs_url="/docs", redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)

SUBSCRIPTION_TERMS = re.compile(
    r"(?i)\b(netflix|spotify|adobe|gym|subscription|sub\b|premium|amazon|wsj|new york times|nyt|club|monthly|annual|yearly|membership|hulu|disney|dropbox|icloud|canva|notion|figma|patreon|audible|peloton|classpass|youtube)\b"
)
AMOUNT_PATTERN = re.compile(r"(?<![A-Za-z])(?:USD\s*)?\$?\s*(\d{1,4}(?:,\d{3})?(?:\.\d{2})?)(?!\d)")
DATE_PATTERN = re.compile(r"\b(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{1,2}-\d{1,2})\b")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Transaction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    merchant: str = Field(min_length=1, max_length=120)
    amount: float = Field(gt=0, lt=1_000_000)
    date: str = Field(default="Unknown", max_length=32)
    cadence: Literal["Monthly", "Annual", "Recurring", "Unknown"] = "Recurring"
    confidence: int = Field(ge=0, le=100)
    source: Literal["csv", "pdf", "text"]


class ParseResponse(BaseModel):
    transactions: list[Transaction]
    detected_count: int
    retention: Literal["in-memory-only"] = "in-memory-only"


class CancellationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_name: str = Field(min_length=2, max_length=160)
    signature_data_url: str = Field(min_length=30, max_length=2_000_000)
    merchant_name: str = Field(min_length=1, max_length=160)
    account_id: str = Field(min_length=1, max_length=200)
    account_email: str = Field(min_length=3, max_length=254)
    jurisdiction: str = Field(default="United States", min_length=2, max_length=100)

    @field_validator("account_email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if not EMAIL_PATTERN.fullmatch(value.strip()):
            raise ValueError("account_email must be a valid email address")
        return value.strip()

    @field_validator("signature_data_url")
    @classmethod
    def validate_signature(cls, value: str) -> str:
        if not value.startswith("data:image/png;base64,"):
            raise ValueError("signature_data_url must be a PNG data URL")
        return value


class DispatchItem(BaseModel):
    merchant_name: str
    status: Literal["prepared"]
    delivery_channel: Literal["merchant-endpoint-pending"]
    receipt_id: str
    document_sha256: str


def _clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _merchant_from_line(line: str) -> str:
    without_date = DATE_PATTERN.sub("", line)
    without_amount = AMOUNT_PATTERN.sub("", without_date)
    merchant = re.sub(r"[^A-Za-z0-9&.'+ -]", " ", without_amount)
    merchant = _clean_text(merchant).strip(" -:|,")
    return merchant[:120] or "Detected merchant"


def _parse_lines(text: str, source: Literal["csv", "pdf", "text"]) -> list[Transaction]:
    results: list[Transaction] = []
    seen: set[tuple[str, float]] = set()
    for line in text.splitlines():
        normalized = _clean_text(line)
        if not normalized:
            continue
        amount_match = AMOUNT_PATTERN.search(normalized)
        term_match = SUBSCRIPTION_TERMS.search(normalized)
        if not amount_match or not term_match:
            continue
        amount = float(amount_match.group(1).replace(",", ""))
        merchant = _merchant_from_line(normalized)
        key = (merchant.lower(), amount)
        if key in seen:
            continue
        seen.add(key)
        cadence: Literal["Monthly", "Annual", "Recurring", "Unknown"] = "Recurring"
        lower = normalized.lower()
        if any(word in lower for word in ("monthly", "month", "sub")):
            cadence = "Monthly"
        elif any(word in lower for word in ("annual", "yearly", "year")):
            cadence = "Annual"
        confidence = 96 if term_match.group(0).lower() in {"netflix", "spotify", "adobe", "amazon"} else 84
        results.append(Transaction(merchant=merchant, amount=amount, date=DATE_PATTERN.search(normalized).group(0) if DATE_PATTERN.search(normalized) else "Unknown", cadence=cadence, confidence=confidence, source=source))
    return results


def _extract_pdf(buffer: io.BytesIO) -> str:
    reader = PdfReader(buffer)
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_csv(buffer: io.BytesIO) -> str:
    buffer.seek(0)
    frame = pd.read_csv(buffer, dtype=str, on_bad_lines="skip")
    return "\n".join(" | ".join(_clean_text(value) for value in row) for row in frame.fillna("").values.tolist())


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "retention": "in-memory-only"}


@app.post("/api/parse-statement", response_model=ParseResponse)
async def parse_statement(file: Annotated[UploadFile, File(...)]) -> ParseResponse:
    filename = (file.filename or "").lower()
    if not filename.endswith((".csv", ".pdf")):
        raise HTTPException(status_code=415, detail="Only CSV and PDF statements are supported")
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Statement exceeds the maximum allowed size")
    buffer = io.BytesIO(raw)
    try:
        if filename.endswith(".pdf"):
            text = _extract_pdf(buffer)
            source: Literal["csv", "pdf", "text"] = "pdf"
        else:
            text = _extract_csv(buffer)
            source = "csv"
        transactions = _parse_lines(text, source)
        return ParseResponse(transactions=transactions, detected_count=len(transactions))
    except (ValueError, pd.errors.ParserError) as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse statement: {exc}") from exc
    finally:
        raw = b""
        buffer.close()
        await file.close()


@app.post("/api/parse-text", response_model=ParseResponse)
async def parse_text(payload: dict[str, str]) -> ParseResponse:
    text = payload.get("text", "")
    if not text or len(text) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=422, detail="Transaction log is empty or too large")
    return ParseResponse(transactions=_parse_lines(text, "text"), detected_count=len(_parse_lines(text, "text")))


def _signature_bytes(data_url: str) -> bytes:
    encoded = data_url.removeprefix("data:image/png;base64,")
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=422, detail="Invalid signature data") from exc
    if not decoded or len(decoded) > 1_500_000:
        raise HTTPException(status_code=422, detail="Signature data is invalid or too large")
    return decoded


@app.post("/api/generate-pdf")
def generate_pdf(payload: CancellationRequest) -> Response:
    signature = _signature_bytes(payload.signature_data_url)
    if len(signature) < 100:
        raise HTTPException(status_code=422, detail="Signature is empty")
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=LETTER, rightMargin=0.75 * inch, leftMargin=0.75 * inch, topMargin=0.7 * inch, bottomMargin=0.7 * inch)
    styles = getSampleStyleSheet()
    title = styles["Title"]
    title.textColor = colors.HexColor("#173b36")
    body = styles["BodyText"]
    body.leading = 16
    story = [
        Paragraph("NOTICE OF CANCELLATION AND REVOCATION OF BILLING AUTHORIZATION", title),
        Spacer(1, 20),
        Paragraph(f"Date: {datetime.now(timezone.utc).strftime('%B %d, %Y')}", body),
        Spacer(1, 14),
        Paragraph(f"To: {payload.merchant_name}", body),
        Paragraph("Customer service / billing department", body),
        Spacer(1, 18),
        Paragraph(f"I, {payload.customer_name}, hereby request immediate cancellation of my subscription and revoke authorization for future recurring billing associated with the account identified below. This notice is directed to the merchant named above and applies only to my account with that merchant.", body),
        Spacer(1, 12),
        Paragraph(f"Account email: {payload.account_email}", body),
        Paragraph(f"Account or contract ID: {payload.account_id}", body),
        Spacer(1, 12),
        Paragraph("Subscription Killer Proxy is designated by the undersigned as a limited proxy solely to transmit this cancellation request. No authority is granted to access funds, make purchases, alter account credentials, or perform any other action. Please confirm the effective cancellation date and cessation of future charges in writing.", body),
        Spacer(1, 12),
        Paragraph(f"Jurisdiction selected by signer: {payload.jurisdiction}. This notice is intended to express the signer’s revocation and cancellation request; legal effect may vary by jurisdiction and merchant terms.", body),
        Spacer(1, 28),
        Table([[Paragraph("Authorized signature", body), Paragraph("Customer name", body)], [Image(io.BytesIO(signature), width=2.4 * inch, height=0.7 * inch), Paragraph(payload.customer_name, body)]], colWidths=[3.3 * inch, 3.3 * inch], style=TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.HexColor("#9bb5ac")), ("TOPPADDING", (0, 0), (-1, -1), 8)])),
    ]
    document.build(story)
    pdf = output.getvalue()
    signature = b""
    output.close()
    document_hash = hashlib.sha256(pdf).hexdigest()
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="cancellation-{secrets.token_hex(8)}.pdf"', "Cache-Control": "no-store", "X-Document-SHA256": document_hash})
