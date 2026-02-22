# Round 2: Wavelet Representations, Cross-Asset Information, Feature Engineering
**Agent**: a5be6bc | **Round**: 2

## Search Coverage
30+ Cypher queries targeting all 17 requested keywords plus supplementary terms (Koopman, changepoint, phase space, Lyapunov, Hurst, regime, entropy, reflexivity, quantile, contrastive time series, spectral, cross-market, direction change, Takens embedding).

## Confirmed Gaps (Still ZERO Papers)

| Keyword | Notes |
|---------|-------|
| Fractional differencing | No hits on any variant |
| MODWT / maximal overlap discrete wavelet | 0 |
| Dual-tree complex wavelet | 0 |
| Lifting scheme wavelet | 0 |
| Wavelet packet decomposition | 0 |
| Stock2Vec | No asset embedding papers |
| GNN + financial (explicit) | WaveForM uses GNN but for general MTS |
| Temporal graph attention | 0 |

---

## Tier 1: NEW High-Relevance Discoveries

**1. WaveForM (AAAI 2023)** | Score: 0.82
**Verdict: BRANCH** -- DWT + learned global graph structure for inter-variable (cross-asset) dependencies at multiple wavelet resolutions. Self-adaptive adjacency matrix. Outperforms transformer baselines. Exactly the architecture for cross-asset lead-lag in wavelet domain.

**2. PRN: Pyramid Recurrent Neural Networks** | Score: 0.82
**Verdict: BRANCH** -- Neural Wavelet Layer (NWL) = trainable wavelet decomposition. Detects both abrupt AND gradual changepoints. Scale-invariant: generalizes to unseen timescales. Directly replaces fixed wavelet basis.

**3. FinTSBridge (ICLR 2025 workshop)** | Score: 0.82
**Verdict: BRANCH** -- msIC and msIR metrics capture temporal correlation stability. Shows MSE is meaningless for financial utility. Key finding: "financial-specific preprocessing that enhances stationarity while preserving inter-variable relationships is critical."

**4. Information Flow Analysis (EPU)** | Score: 0.72
**Verdict: REFERENCE** -- Effective transfer entropy (ETE) with sliding windows for dynamic causal relationships. Generalizes Granger causality to nonlinear. EPU/trade/FX domain less relevant than equities.

**5. GC-STCL (Granger Causality + Spatial-Temporal Contrastive)** | Score: 0.78
**Verdict: REFERENCE** -- Granger causality constructs directed causal graphs between channels. Contrastive learning on causal graph. Applied to EEG, transferable to cross-asset.

**6. Online Detection of Continuous Changes** | Score: 0.82
**Verdict: REFERENCE** -- O(N) online algorithm for gradual parameter shifts. Tested on market data; detects crash symptoms earlier than conventional detectors.

**7. TS-CP2** | Score: 0.88
**Verdict: REFERENCE** -- Self-supervised CPD. 79% F1 improvement over handcrafted. Complementary transition signal.

**8. Phase Space Reconstruction + SOM** | Score: 0.78
**Verdict: REFERENCE** -- Detects predictable vs chaotic segments. Hurst index and Lyapunov exponent. "Detects transitions from ordered to chaotic regimes."

**9. Ordinal Networks** | Score: 0.82
**Verdict: REFERENCE** -- Bandt-Pompe symbolization estimates Hurst exponents robustly. Transition probability matrix from ordinal patterns as compact auxiliary feature.

**10. Order Patterns in Financial TS** | Score: 0.78
**Verdict: REFERENCE** -- Up-down balance as most effective order parameter for change-point detection. "Order self-similarity" has implications for 16-token context window design.

**11. Koopman Learning Guide** | Score: 0.82
**Verdict: SKIP** -- Theoretically relevant but implementation complexity very high. No financial application shown.

**12. Specific Differential Entropy Rate** | Score: 0.82
**Verdict: REFERENCE** -- State-dependent entropy rate reveals how prediction difficulty varies across states. Auxiliary diagnostic.

**13-16.** EnCQR (0.88), CoST (0.88), TNC (0.88), Mastering Modern TS Forecasting (0.88) — supporting references.

## Tier 2: Previously Identified (Confirmed)

| # | Paper | Score | Verdict |
|---|-------|-------|---------|
| 17 | Wavelet Scattering for Jump Classification | 0.88 | BRANCH (confirmed) |
| 18 | WEITS (Wavelet-Enhanced N-BEATS) | 0.82 | REFERENCE |
| 19 | WaveLSFormer (Learnable Wavelet Transformer) | 0.55 | BRANCH (low score, URL-only) |
| 20-23 | Wavelet+DTW, DRL+DWT, Bitcoin+Wavelet, Electricity+Wavelet | 0.58-0.82 | SKIP |

## Key NEW Findings vs Round 1

### 1. WaveForM is the most important new discovery
Addresses two themes simultaneously: wavelet-domain features AND cross-asset dependency modeling. Self-adaptive adjacency matrix learns which assets are related at each wavelet resolution.

### 2. Neural Wavelet Layer (PRN) fills "learnable wavelet" gap differently than WaveLSFormer
More general architecture component — drop-in trainable wavelet decomposition. Specifically designed for detecting gradual changepoints (the transition problem).

### 3. FinTSBridge changes evaluation
msIC/msIR metrics critical. 64% directional accuracy may hide correlation instability. Naive last-value predictors achieve competitive MSE but near-zero correlation.

### 4. Transfer entropy has some coverage, but not financial-specific
Two papers provide methodology. Neither applied to equities but patterns transferable.

### 5. Ordinal patterns are a lightweight win
Up-down balance and ordinal transition probabilities: cheap, robust auxiliary features.

### 6. Fractional differencing gap is confirmed and critical
Zero papers in 2,841. Lopez de Prado's "Advances in Financial ML" remains external reference.

## Recommended Priority Actions

**BRANCH (Implement/Experiment):**
1. **WaveForM architecture** — DWT + learned graph for multi-asset wavelet features
2. **Neural Wavelet Layer from PRN** — Replace fixed wavelet with trainable NWL
3. **FinTSBridge metrics** — Add msIC and msIR immediately

**REFERENCE (Read for Methodology):**
4. Ordinal network features — Low-cost auxiliary features
5. Transfer entropy (ETE) — Cross-asset feature selection tool
6. Online continuous change detection — Transition pre-filter
7. EnCQR — Conformal calibration for quantile predictions

**EXTERNAL (Not in Graph, Must Acquire):**
- Fractional differencing (Lopez de Prado)
- MODWT, dual-tree complex wavelet, wavelet packet decomposition
- Stock2Vec / asset embedding methods
