# Round 1: Batch 2 — Conformal, Quantile, BQN, MAPIE
**Agent**: afe9c7c | **Round**: 1

## Paper Assessments (10 papers)

### 1. ERAPS (Conformal for Time Series)
**Forge Score**: 0.79 | **Verdict: REFERENCE** -- Non-exchangeable coverage theory. Prediction sets too coarse for 3-class.

### 2. Ordinal Conformal Prediction
**Forge Score**: 0.82 | **Verdict: BRANCH** -- Contiguous ordinal sets, abstention at transitions. 1-2 day implementation.

### 3. Online Learning for Distribution-Free Prediction
**Forge Score**: 0.82 | **Verdict: REFERENCE** -- Linear predictor limits applicability.

### 4. Training-Conditional Coverage
**Forge Score**: 0.88 | **Verdict: REFERENCE** -- Use split conformal, not jackknife+/CV+.

### 5. MAPIE Library
**Forge Score**: 0.75 | **Verdict: BRANCH** -- EnbPI for time series + sklearn wrapper. Fastest conformal path.

### 6. Wind Gust Forecasting (BQN/DRN/HEN comparison)
**Forge Score**: 0.82 | **Verdict: BRANCH** -- BQN output head + CRPS loss directly attacks flat bias. Benchmarked against histogram estimation (equivalent to your CE approach).

### 7. Conditional Mode Estimation from Quantile Regression
**Forge Score**: 0.82 | **Verdict: REFERENCE** -- Mode extraction useful after implementing BQN.

### 8. Quantile Risk Control
**Forge Score**: 0.88 | **Verdict: REFERENCE** -- Model selection, not training.

### 9. Gradient Boosting (Friedman)
**Forge Score**: 0.95 | **Verdict: SKIP** -- Foundational, already absorbed.

### 10. Stan Probabilistic Programming
**Forge Score**: 0.92 | **Verdict: SKIP** -- Wrong tool for neural net classification.

## Recommended Priority
1. **BQN + CRPS loss** (Paper 6) -- highest expected impact
2. **MAPIE/EnbPI** (Paper 5) -- fastest to implement
3. **Ordinal conformal** (Paper 2) -- highest theoretical fit
