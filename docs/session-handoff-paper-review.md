# Session Handoff: Academic Paper Review for Trading ML Model

**Date**: 2026-02-18/19
**Context**: Link Forge knowledge graph was populated with ~2,841 academic papers across 13 research themes. 13 review agents systematically assessed every paper against the trading model's specific problems. This document captures the findings and the agreed-upon next steps.

---

## Trading Model Context

- **Task**: Predict return quantile classes (up / down / flat) for financial time series
- **Architecture**: Transformer with 16-token context window of wavelet coefficient deltas + 4 auxiliary features
- **Baseline**: 64% directional accuracy on cross-entropy loss
- **Key weaknesses**:
  - **Transition blindness** — poor at predicting direction changes
  - **Flat-prediction bias** — model over-predicts the "flat" class
- **Prior work**: 20 experiments in ephemeral branches, only 3 showed promise
- **Known failed experiments**: wavelet scattering (exp/wavelet-scattering), focal loss (exp/focal-loss), ordinal loss (ordinal-loss, ordinal-network — "failed catastrophically with -21.9pp econ_dir")

---

## The Strategic Question

**Is 64% near the theoretical ceiling, or is there room to improve?**

If mutual information I(X; Y) between features and target is low, no model can beat ~64% (Fano's inequality for K=3). The ceiling analysis determines whether to invest in better features, better models, or just optimize the trading rule around the current model.

---

## Agreed Experiment Sequence

### Step 1: Diagnostic Checks (5 minutes each)

Before anything else, check two prior experiment branches:

1. **`exp/focal-loss`** — Check prediction distribution. Did focal loss also collapse to flat predictions? If yes, cyclical focal loss will too (same mechanism). If it maintained balanced predictions but didn't improve accuracy, the cyclical variant is worth trying.

2. **`ordinal-loss` / `ordinal-network`** — Check prediction distribution. The -21.9pp failure: was it flat-collapse or genuinely worse predictions? If flat-collapse, EMPL (a better ordinal loss) probably won't help. If balanced predictions with worse accuracy, the ordinal framing itself doesn't work.

### Step 2: Ceiling Analysis (1-2 days)

Run these in parallel:

- **MINE** (Mutual Information Neural Estimation, Belghazi et al. 2018) — Estimate I(X; Y), plug into Fano bound. NOT in the knowledge graph — source externally.
- **BOLT loss** (Tavasoli Naeini et al. 2025) — Train directly to Bayes-optimal accuracy. If it converges at 64%, that's the ceiling. NOT in the knowledge graph — source externally.

**Decision gate**:
- If I(X;Y) < 0.15 bits → ceiling is ~60-65%. 64% is near-optimal. **Improve features or optimize trading rules.**
- If I(X;Y) > 0.3 bits → ceiling is 70-80%+. **Model is underperforming, invest in architecture.**

### Step 3a: If Ceiling > 64% (Model is Bottleneck)

Test independently (they attack different bottlenecks):

**BOCPD run-length as auxiliary feature** (~50 lines, 1 day)
- Bayesian Online Changepoint Detection gives "time since last regime change"
- Structurally different signal from everything else — not derived from same price series
- Directly addresses transition blindness
- Papers: Adams & MacKay (foundational, 0.92), Dm-BOCD (robust to outliers, 0.88)

**MDN head** (Mixture Density Network, ~4 hours)
- Replace 3-class softmax with 3-5 component Gaussian mixture
- Predict full return distribution, derive direction from distribution mass
- Eliminates flat-bias structurally — no "flat" class to collapse into
- Loss is log-likelihood of actual return under predicted mixture
- Unifies prediction + confidence + magnitude in one output
- Paper: Bishop 1994 (0.92)

### Step 3b: If Ceiling ≈ 64% (Features are Bottleneck)

- **Conformal prediction wrapper** on CE baseline — trade less, win more
  - Ordinal conformal (respects down < flat < up ordering)
  - ERAPS variant for time-series non-exchangeability
  - Abstain when prediction set > 1 class → accuracy on taken trades could reach 75-80%+
- **Magnitude-based position sizing** from the current model's softmax probabilities
- **HOCMIM feature ranking** — filter-based, no training. Immediately tells you which features are noise.

### Step 4: Conformal Wrapper on Winner

Model-agnostic, post-hoc. Wrap whatever model wins with ordinal conformal prediction. Save for last — you want to wrap the best model.

---

## Complete BRANCH Candidate List (from 2,841-paper review)

### Loss Function
| Method | Effort | Status | Source |
|--------|--------|--------|--------|
| Cyclical Focal Loss | 30 min | **Blocked** — check exp/focal-loss flat-bias first | CFL paper (0.82) |
| Focal loss + Psi_gamma calibration | 2-3 hrs | **Blocked** — same check | "On Focal Loss" (0.88) |
| EMPL (Earth Mover's Pinball Loss) | 4-6 hrs | **Blocked** — check ordinal-loss flat-bias first | EMPL (0.88) |
| Arctan pinball loss | 2-3 hrs | For quantile regression targets | Arctan paper (0.82) |

### Target Representation
| Method | Effort | Status | Source |
|--------|--------|--------|--------|
| MDN head | 4 hrs | **Top priority if ceiling allows** | Bishop 1994 (0.92) |
| BQN (Bernstein Quantile Network) | Varies | Alternative to MDN | ML postprocessing paper (0.82) |
| N3POM ordinal regression | 6-8 hrs | **Blocked** — check ordinal-loss results | N3POM (0.87) |
| MCQRNN non-crossing quantiles | 6-10 hrs | If quantile regression works | MCQRNN (0.87) |
| IQN (Implicit Quantile Networks) | 8-12 hrs | Most expressive, most complex | IQN (0.92) |

### Feature Engineering
| Method | Effort | Status | Source |
|--------|--------|--------|--------|
| BOCPD run-length feature | 1 day | **Top priority if ceiling allows** | Adams & MacKay (0.92), Dm-BOCD (0.88) |
| HOCMIM feature ranking | Hours | Ready to run, no training | HOCMIM (0.88) |
| Sparse mRMR | 0.5 day | FDR-controlled feature selection | SmRMR (0.87) |
| Predictability gate (Lyapunov/Hurst) | 2-3 days | Abstain during chaotic regimes | Phase Space + SOM (0.78) |
| Wavelet scattering | 2-3 days | **FAILED** in prior experiments — skip | — |

### Architecture
| Method | Effort | Status | Source |
|--------|--------|--------|--------|
| Learnable wavelet filters | 1-2 days | Replace fixed wavelet bank | PRN Neural Wavelet Layer (0.82) |
| Multi-resolution stack specialization | 2-3 days | Per-scale attention | WEITS (0.82) |
| TFT variable selection | 2-3 days | Gated feature selection per timestep | TFT (0.92) |

### Training Strategy
| Method | Effort | Status | Source |
|--------|--------|--------|--------|
| Competence-based curriculum | 1-2 days | Sort by difficulty, anneal | CL for Financial TS (0.82) |
| DDAT difficulty-aware training | 1-2 days | Autoencoder reconstruction error as difficulty | DDAT (0.78) |
| End-to-end contrastive + CE | 2-3 days | CoST-style joint training | CoST (0.88) |

### Post-hoc / Calibration
| Method | Effort | Status | Source |
|--------|--------|--------|--------|
| Ordinal conformal + ERAPS | 1-2 days | **Endgame wrapper** — save for last | Ordinal Conformal (0.82), ERAPS (0.79) |
| EnCQR bootstrap ensemble | 2-3 days | Time-series conformal without i.i.d. | EnCQR (0.88) |
| SelectiveNet reject option | 3-5 days | End-to-end learned abstention | SelectiveNet (0.55) |

### Ceiling Analysis
| Method | Effort | Status | Source |
|--------|--------|--------|--------|
| MINE | 1-2 days | **NOT in graph** — source externally | Belghazi et al. 2018 |
| BOLT loss | 1-2 days | **NOT in graph** — source externally | Tavasoli Naeini et al. 2025 |
| CCMI feature decomposition | 1-2 days | In graph | CCMI (0.88) |
| GENIE MI estimator | 1-2 days | In graph, best for mixed discrete/continuous | GENIE (0.88) |
| HOCMIM | Hours | Filter-based feature ranking | HOCMIM (0.88) |

---

## Key Gaps in the Knowledge Graph

These topics had ZERO papers across 2,841:

- Fractional differencing (Lopez de Prado Ch.5 — critical for first-differencing info loss)
- MODWT / dual-tree complex wavelets
- Mamba / S4 state space models
- Label smoothing
- CRPS / proper scoring rules
- Normalizing flows for time series
- Rotary / ALiBi positional encodings
- MINE, BOLT loss, Xu et al. predictability=Bayes error

---

## Evaluation Improvements

- **FinTSBridge msIC/msIR metrics** — temporal correlation stability. A naive last-value predictor can match on MSE but score near-zero on msIC. Your 64% directional accuracy may be hiding correlation instability.

---

## Link Forge Infrastructure Notes

- `scripts/search-papers.ts` searches arXiv, Semantic Scholar, OpenAlex → downloads PDFs → enqueues into SQLite processing queue
- Processor supports parallel workers via `PROCESSOR_WORKERS=N` env var (added during this session)
- Two MCP server bugs were found and fixed (need `npm run build` + restart):
  - `src/graph/search.ts`: hybridSearch() parallel queries on same session → sequential
  - `src/mcp/tools/browse.ts` + `recent.ts`: float LIMIT → Math.round()
- Build may fail on `src/sync/` imports if sync module not fully integrated
