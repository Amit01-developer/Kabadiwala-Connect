# ♻️ Kabadiwala Connect

### Digitalizing E-Waste Collection & Recycling

**Kabadiwala Connect** is an offline-first e-waste management platform that connects **informal e-waste collectors with verified recyclers** through transparent pricing, smart matching, QR-based traceability, digital payments, and AI-assisted analytics.

---

## 🚀 Key Features

* 👤 **Role-Based Platform** — Collector, Recycler & Admin workflows
* 📸 **E-Waste Collection** — Image, material, weight, condition & notes
* 🤖 **AI Classification** — EfficientNetB0-based material classification
* 💰 **Transparent Pricing** — Rate-history-based price estimation with optional XGBoost refinement
* 📍 **Smart Recycler Matching** — Material, pickup/drop-off and location-based matching
* 📱 **Offline-First PWA** — IndexedDB-based offline collection & automatic synchronization
* 🔐 **QR Traceability** — Unique lot IDs and QR-based handover verification
* 💳 **Digital Payments** — Payment records and collector earnings ledger
* 🚨 **Anomaly Detection** — Median/MAD-based transaction monitoring
* 📊 **Admin Dashboard** — Recycler verification, rate management, data review & analytics

---

# 🔄 Complete Workflow

```text
User Registration
       ↓
Role Identification
       ↓
E-Waste Capture
       ↓
Image + Material + Weight + Condition
       ↓
AI Classification
       ↓
Price Estimation
       ↓
Verified Recycler Matching
       ↓
Pickup / Drop-off Scheduling
       ↓
Lot ID + QR Generation
       ↓
Material Handover & Verification
       ↓
Final Weight + Price
       ↓
Digital Payment
       ↓
Collector Earnings Ledger
       ↓
Admin Validation
       ↓
Analytics & Anomaly Detection
       ↓
Verified Dataset
       ↓
AI/ML Model Improvement
```

---

# 🤖 AI/ML Pipeline

### Material Classification

```text
E-Waste Image
     ↓
OpenCV Preprocessing
     ↓
EfficientNetB0
     ↓
Material Classification
     ↓
Collector / Recycler Validation
     ↓
Admin-Verified Dataset
```

### Price Prediction

```text
Verified Transactions
        ↓
Feature Engineering
        ↓
XGBoost
        ↓
Predicted Value
        ↓
Bounded by Current Market Rate
```

> AI models are optional. If a trained model is unavailable, the platform falls back to manual material selection and rule-based pricing instead of generating unsupported predictions.

---

# 📍 Smart Recycler Matching

```text
Collection Request
       ↓
Material & Collection Mode
       ↓
Verified Recycler Filter
       ↓
Distance Calculation
       ↓
Nearby Suitable Recyclers
       ↓
Collector Selection
```

Supports **PostGIS-based geographic matching** or Haversine distance calculation.

---

# 📴 Offline-First Pipeline

```text
Create Collection
       ↓
Internet Available?
   ↙           ↘
 YES            NO
  ↓              ↓
API           IndexedDB
  ↓              ↓
Database      Sync Queue
                 ↓
          Internet Restored
                 ↓
          Automatic Sync
```

---

# 🏗️ System Architecture

```text
        React PWA
            │
            ▼
        FastAPI
            │
    ┌───────┼────────┐
    ▼       ▼        ▼
 PostgreSQL Redis   AWS S3
 / SQLite
    │
    ▼
  PostGIS
    │
    └────── AI/ML ──────┐
             │           │
       EfficientNet    XGBoost
       Classification  Pricing
```

---

# 🛠️ Tech Stack

| Layer      | Technologies                                |
| ---------- | ------------------------------------------- |
| Frontend   | React, TypeScript, Vite, PWA                |
| Backend    | Python, FastAPI, Pydantic                   |
| Database   | SQLite / PostgreSQL                         |
| Geo        | PostGIS                                     |
| Storage    | Local Storage / AWS S3                      |
| Cache      | Redis                                       |
| AI/ML      | TensorFlow, EfficientNetB0, OpenCV, XGBoost |
| Maps       | OpenStreetMap                               |
| Deployment | Docker, Docker Compose, Nginx               |

---

# 📁 Project Structure

```text
Kabadiwala-Connect/
├── backend/
│   ├── app/
│   ├── migrations/
│   ├── ml/
│   ├── scripts/
│   └── tests/
│
├── frontend/
│   ├── src/
│   └── public/
│
├── docs/
├── docker-compose.yml
├── .env.example
└── README.md
```

---

# ⚙️ Quick Start

### Backend

```bash
cd backend
python -m venv .venv
pip install -r requirements-dev.txt
alembic upgrade head
python -m uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Application:

```text
http://localhost:5173
```

API Docs:

```text
http://127.0.0.1:8000/docs
```

### Docker

```bash
docker compose up --build -d
```

---

# 📊 Core Data Flow

```text
Collection
    ↓
Verification
    ↓
Handover
    ↓
Payment
    ↓
Analytics
    ↓
Validated Data
    ↓
AI/ML
    ↓
Continuous Improvement
```

---

# 🔮 Future Scope

* Real-time market prices
* Advanced e-waste image recognition
* Route optimization
* Carbon-footprint tracking
* Advanced fraud detection
* Multilingual & voice support
* Large-scale cloud deployment

---

## ♻️ Kabadiwala Connect

**Digitize → Connect → Track → Verify → Pay → Analyze → Improve**

> Building a transparent digital bridge between informal e-waste collection and the formal recycling ecosystem.
