# Round 1: Changepoint/Transition Detection
**Agent**: a69a1eb | **Round**: 1

## EXECUTIVE SUMMARY

**The knowledge graph contains ZERO papers directly on changepoint detection, BOCPD, structural breaks, or multi-task learning with auxiliary transition heads.** However, several tangentially relevant papers were found.

NOTE: This finding was CORRECTED in Round 2 (report 10-transition-temporal-contrastive.md) which found 15+ changepoint papers including the foundational Adams & MacKay BOCPD (0.92).

---

## Papers Found

### 1. "Detecting Predictable Segments in Chaotic Financial Time Series" (PSR + SOM)
- **Forge Score**: 0.78 | **Category**: Quantitative Finance
- Key Concepts: phase-space-reconstruction, takens-embedding, lyapunov-exponent, SOM, LSTM
- **Verdict: REFERENCE** -- Core idea (some segments predictable, others chaotic) is relevant. Lyapunov exponent as local predictability signal.

### 2. "Ordinal Networks for Time Series"
- **Forge Score**: 0.82 | **Category**: Time Series Analysis
- Key Concepts: bandt-pompe-symbolization, permutation-entropy, transition-probabilities
- **Verdict: BRANCH** -- Permutation entropy in sliding window is fast, simple regime change signal. Add as input feature. 1-2 days.

### 3. "Wavelet Scattering Coefficients for Stock Jump Classification"
- **Forge Score**: 0.88 | **Category**: Market Microstructure
- Key Concepts: wavelet-scattering, reflexivity, jump-detection-z-score, co-jump-contagion
- **Verdict: BRANCH** -- Jump detection z-score as auxiliary target. Add binary head: "will a >2 sigma move occur in next K bars?" 20-line code change.

### 4. "TDA Features for Financial Time Series Forecasting with N-BEATS"
- **Forge Score**: 0.82 | **Category**: Quantitative Finance
- **Verdict: REFERENCE** -- Persistent entropy could signal topological changes. But overhead of TDA computation may not justify gain vs simpler approaches.

### 5. "Mastering Modern Time Series Forecasting" (book)
- **Forge Score**: 0.88
- **Verdict: REFERENCE** -- Forecastability analysis framework (entropy + Lyapunov) provides theoretical basis for when model should/shouldn't predict.

### 6. "Cohomology Theory for Financial Statistical Mechanics"
- **Verdict: SKIP** -- Extremely theoretical (knot topology, Yang-Mills). Not implementable.

### 7. "Structural Regime-Switching Model"
- **Verdict: SKIP** -- Institutional/political regime switching, not financial time series.

### 8. ERAPS, Learning to Rank, N-BEATS
- **Verdict: REFERENCE** for all -- tangentially relevant.

---

## Critical Gap: Papers to Acquire

| Priority | Paper | Why |
|----------|-------|-----|
| P0 | Adams & MacKay (2007) "Bayesian Online Changepoint Detection" | Foundational BOCPD |
| P0 | Knoblauch & Damoulas (2020) Neural BOCPD | Learned hazard functions |
| P0 | De Ryck et al. (2021) Autoencoder changepoint detection | Neural auxiliary head |
| P1 | TS-CP2 (Deldari et al. 2021) | Self-supervised contrastive changepoint |
| P1 | Ruder (2017) Multi-Task Learning overview | Auxiliary head design |
| P2 | Hamilton (1989) Markov-switching model | Classic econometric approach |

## Recommended Actions

1. **Permutation entropy sliding window** (1-2 days) -- zero architecture change
2. **Jump z-score auxiliary target** (1-2 days) -- 20-line code change
3. **Acquire and implement BOCPD** (3-5 days) -- ~100 lines of Python
4. **Local Lyapunov exponent as feature** (medium effort)
