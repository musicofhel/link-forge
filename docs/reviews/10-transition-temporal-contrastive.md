# Round 2: Transition Detection, Temporal Structure, Contrastive Learning (Expanded)
**Agent**: a28888f | **Round**: 2

## Search Coverage
90 search queries across 16 primary themes + 74 expanded terms. Out of 2,841 papers, 238 unique papers matched. Assessment below filters out domain-irrelevant matches and papers already identified in Round 1.

---

## CRITICAL FINDING: BOCPD Papers Exist in the Graph

The Round 1 conclusion of "ZERO changepoint/BOCPD papers" was **WRONG**. The graph contains **15+ changepoint detection papers**, including the foundational Adams & MacKay BOCPD paper (ForgeScore 0.92). Missed due to search strategy (vector-only search didn't surface keyword matches in keyConcepts arrays).

---

## Tier 1: BRANCH

**1. TS-CP2 (Contrastive Predictive Coding for Changepoints)** | Score: 0.88
**Verdict: BRANCH** -- Contrastive pre-training that learns transition-sensitive representations. Separates time-adjacent vs time-distant embeddings. Auxiliary objective for 16-token window.

**2. Temporal Fusion Transformer (TFT)** | Score: 0.92
**Verdict: BRANCH** -- Variable Selection Networks + Gated Residual Networks + interpretable multi-head attention. Your 4 auxiliary features benefit from explicit variable selection. Quantile regression loss built-in.

**3. Deep Learning for Multi-Scale Changepoint Detection (PRN)** | Score: 0.82
**Verdict: BRANCH** -- Pyramid RNN with Neural Wavelet Layer = trainable wavelet decomposition. Scale-invariant, detects changes at timescales not seen during training. Directly replaces fixed wavelet basis.

**4. Bayesian Online Changepoint Detection (Adams & MacKay)** | Score: 0.92
**Verdict: BRANCH** -- Foundational BOCPD. Run-length posterior as auxiliary feature = "how long since last regime started." Exactly the transition signal the model lacks. Low implementation complexity.

**5. CoST (Contrastive Disentangled Seasonal-Trend)** | Score: 0.88
**Verdict: BRANCH** -- Frequency-domain contrastive loss disentangles seasonal from trend. Causally justified for distribution shift robustness. Directly applicable to wavelet coefficients.

**6. Cyclical Focal Loss** | Score: 0.82
**Verdict: BRANCH** -- Cyclically varies gamma between easy-focus and hard-focus. Drop-in CE replacement. Very low implementation complexity.

**7. On Focal Loss for Class-Posterior Probability Estimation** | Score: 0.88
**Verdict: BRANCH** -- Focal loss NOT strictly proper. Psi_gamma transformation recovers true posteriors. Essential before adopting focal loss.

**8. ERAPS (Conformal for Time-Series)** | Score: 0.79
**Verdict: BRANCH** -- Calibrated prediction sets without exchangeability. Wrap classifier for abstention.

**9. Auxiliary Task Reweighting** | Score: 0.88
**Verdict: BRANCH** -- Automatic reweighting of auxiliary tasks via gradient alignment. If adding transition detection or run-length prediction as auxiliary tasks, this optimizes weighting vs main objective.

## Tier 2: REFERENCE

**10. ContiFormer** | Score: 0.92
Continuous-time attention via Neural ODE. Overkill for regular 16-token window.

**11. Stein Variational Online Changepoint Detection** | Score: 0.82
Extends BOCPD to non-exponential families. Reference for when simpler methods plateau.

**12. Robust and Scalable BOCPD (Dm-BOCD)** | Score: 0.88
Robust to outliers via generalized Bayesian posteriors. Important for fat-tailed financial returns.

**13. Online Changepoint Detection on a Budget** | Score: 0.78
O(L) constant-memory BOCPD. Production-ready variant.

**14. Neural Hawkes Process** | Score: 0.88
Continuous-time LSTM for self-modulating point processes. Reference for trade arrival features.

**15. Event-Based LOB Simulation under NHP** | Score: 0.62
NHP + LSTM for limit order book. Bridge to microstructure features.

**16. VNIbCReg** | Score: 0.72
VICReg + TNC neighboring invariance. Key insight: standard contrastive methods counterproductive for non-stationary time series.

**17. What Constitutes Good Contrastive Learning in TS Forecasting** | Score: 0.78
Key insight: end-to-end training (MSE + contrastive) outperforms two-stage pre-train-then-regress.

**18. TS2Vec-Ensemble** | Score: 0.62
TS2Vec alone fails on deterministic components. Fuses with sinusoidal time features.

**19. Ordinal Network Analysis** | Score: 0.82
Ordinal transition probabilities as low-cost feature for detecting structural changes.

**20. Order Patterns in Financial Time Series** | Score: 0.78
Up-down balance as change-point detector in financial data. Validated against Brownian null.

**21. CTTS (J.P. Morgan CNN-Transformer)** | Score: 0.78
Threshold predictions by 75th percentile of dominant-direction softmax for precision. Industry validation.

**22. FinTSBridge** | Score: 0.82
msIC and msIR metrics. Critical: MSE insufficient for financial series; naive last-value predictor achieves competitive MSE.

**23. Chaotic Financial TS (Takens + SOM + LSTM)** | Score: 0.78
Phase-space reconstruction + SOM clustering to separate predictable from chaotic segments.

**24. Wavelet Scattering for Jump Classification** | Score: 0.88
Unsupervised wavelet scattering for price jump classification.

**25. Curriculum Learning for Financial TS** | Score: 0.82
Curriculum via data augmentation for financial RL. Noise-to-signal decomposition.

**26-28.** CQR (0.88), AgACI (0.72), N-BEATS (0.92) — previously identified.

**29. WEITS** | Score: 0.82 — Learnable wavelet basis selection.

**30. Dominant Shuffle** | Score: 0.82
Frequency-domain data augmentation. Augment by shuffling top-k wavelet coefficients.

**31-40.** GluonTS/DeepAR (0.82), Learning-to-Rank (0.82), Ordinal Conformal (0.82), N3POM (0.87), Continuous-Time Attention (0.82), MST-former (0.82), TS Contrastive vs False Negatives (0.55), CPC for Anomaly Detection (0.78), Active Learning for Streams (0.78), Hierarchical Gaussian Filter (0.92).

## Strategic Recommendations (Ranked by Impact/Effort)

### Immediate Actions
1. **BOCPD run-length as auxiliary feature** (Paper #4) — ~50 lines, directly addresses transition blindness
2. **Cyclical Focal Loss** (Paper #6) — drop-in replacement, ~10 lines
3. **FinTSBridge metrics (msIC/msIR)** (Paper #22) — evaluation fix

### Short-Term Experiments
4. **End-to-end contrastive + CE training** (Paper #17 insight + Paper #5 CoST)
5. **TS-CP2-style auxiliary task** (Paper #1) — contrastive change-point detection head
6. **Ordinal classification loss** (Papers #33, #34)

### Medium-Term Architecture
7. **TFT-style variable selection** (Paper #2)
8. **Learnable wavelet basis** (Papers #3, #29)
9. **Curriculum on market regimes** (Paper #25)

## Gap Analysis

**Strong coverage**: Changepoint/BOCPD (15+), contrastive learning, Hawkes processes, focal loss, quantile regression, conformal prediction.

**Zero/near-zero coverage**: Mixture of Experts for TS, Mamba/S4 state space models, label smoothing, rotary/ALiBi positional encodings, TS data augmentation, Autoformer/FEDformer/Crossformer, diffusion models for TS, normalizing flows.
