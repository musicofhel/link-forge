# Round 2: Quantile Regression & Distributional Target Representation
**Agent**: a539b3a | **Round**: 2

## Search Coverage
60+ keyword searches across 1,559 ingested papers. Covered: quantile regression, pinball loss, distributional RL, IQN, expectile regression, MDN, histogram loss, categorical distributional, CRPS, Bernstein quantile, non-crossing quantile, asymmetric loss, probabilistic forecasting, ordinal regression, focal loss, change point detection, conformal prediction, heteroscedastic uncertainty, risk measures, and more.

**Notable gaps**: No papers for CRPS loss, normalizing flows, energy score, proper scoring rules, label smoothing, soft labels, survival analysis, temperature scaling, or beta distributions.

---

## Tier 1: Previously Identified (Confirmed)

| # | Paper | Score | Verdict |
|---|-------|-------|---------|
| 1 | DHQRN | 0.82 | BRANCH |
| 2 | BQN (wind gust) | 0.82 | BRANCH |
| 3 | conquer (smoothed QR) | 0.88 | BRANCH |
| 4 | CQR (conformalized QR) | 0.88 | BRANCH |

## Tier 2: New Findings — Distributional Targets & Quantile Methods

**5. Mixture Density Networks (Bishop, 1994)** | Score: 0.92
**Verdict: BRANCH** -- MDN outputs Gaussian mixture for full conditional return distribution. Replace CE with mixture NLL. 3-5 components (mean, variance, mixing weight each). **~4 hours implementation.** PyTorch has all primitives.

**6. Earth Mover's Pinball Loss (EMPL)** | Score: 0.88
**Verdict: BRANCH** -- Combines optimal transport with pinball loss for histogram-valued regression. Your 3-class output IS a histogram. Replace CE with EMPL for ordinal-aware training (up > flat > down). **~4-6 hours.**

**7. Beyond Pinball Loss: Calibrated UQ** | Score: 0.88
**Verdict: BRANCH** -- Pinball loss produces miscalibrated but overly sharp predictions. Tunable calibration-sharpness loss. Flat-bias could be calibration problem. **~6-8 hours.**

**8. Implicit Quantile Networks (IQN)** | Score: 0.92
**Verdict: BRANCH** -- Learns full continuous quantile function. Map tau through embedding network concatenated with features. Distribution shape changes before mode does → transition detection. **~8-12 hours.** Requires reparameterization layer.

**9. MCQRNN (Non-Crossing Quantile NN)** | Score: 0.87
**Verdict: BRANCH** -- Guarantees non-crossing quantiles through architectural monotonicity. Estimate quantiles at tau=0.33, 0.67 to define up/down/flat boundaries. **~6-10 hours.**

**10. QR-DQN (Distributional RL with Quantile Regression)** | Score: 0.92
**Verdict: REFERENCE** -- Huber quantile regression loss as drop-in replacement for pinball loss (smoother gradients). ~1 hour change.

**11. Arctan Pinball Loss** | Score: 0.82
**Verdict: BRANCH** -- Smooth approximation of pinball with well-defined second derivatives. Better gradient flow. **~2-3 hours** — just a loss swap.

**12. C51 Theory (Categorical Distributional RL)** | Score: 0.88
**Verdict: REFERENCE** -- Validates replacing 3 softmax classes with finer categorical distribution (e.g., 51 bins) under Cramer distance.

**13. Risk-Averse Natural Gas Futures Trading (Distributional RL)** | Score: 0.82
**Verdict: BRANCH** -- Only paper applying distributional RL (C51, QR-DQN, IQN) to actual trading. CVaR-based risk-averse training. CVaR-from-distribution idea is ~4 hour add-on to any distributional approach.

## Tier 3: New Findings — Loss Function & Calibration

**14. On Focal Loss for Class-Posterior Probability Estimation** | Score: 0.88
**Verdict: BRANCH** -- Focal loss is classification-calibrated but NOT strictly proper. Psi_gamma transformation recovers true posteriors. **~2-3 hours** drop-in + post-hoc calibration.

**15. Cyclical Focal Loss (CFL)** | Score: 0.82
**Verdict: REFERENCE** -- Cyclically varies focus. Interesting for curriculum effect. Lower priority than Psi_gamma correction.

**16. N3POM (Neural Non-Proportional Odds Model)** | Score: 0.87
**Verdict: BRANCH** -- Ordinal regression via cumulative probabilities P(Y <= k) with guaranteed monotonicity. Reframes classification as ordinal regression. **~6-8 hours.**

**17. Conformal for Ordinal Classification** | Score: 0.82
**Verdict: REFERENCE** -- Post-hoc uncertainty add-on after implementing ordinal approach.

**18. Expectile Regression GRU** | Score: 0.52
**Verdict: REFERENCE** -- Directly relevant domain but DHQRN covers expectile angle more rigorously.

**19. On the Pitfalls of Heteroscedastic Uncertainty (beta-NLL)** | Score: 0.72
**Verdict: REFERENCE** -- beta-NLL prevents variance collapse in heteroscedastic NNs. Background for MDN implementation.

## Tier 4: Conformal & Prediction Intervals

**20-26.** EnCQR (0.88), UACQR (0.88), JANET (0.88), DualAQD (0.88), ICQR (0.82), LCMQR (0.82), CUQR (0.88)
**Verdicts: REFERENCE/SKIP** -- Post-processing wrappers. EnCQR and UACQR most relevant if adopting quantile regression.

## Prioritized BRANCH Candidates (New Findings, Ranked by Impact/Hour)

| Priority | Paper | Hours | Why |
|----------|-------|-------|-----|
| **P1** | Focal Loss + Psi_gamma (#14) | 2-3 | Lowest-effort, highest-signal test for flat-bias |
| **P2** | MDN Head (#5) | 4 | Full return distribution, transition detection via shape |
| **P3** | EMPL Loss (#6) | 4-6 | Ordinal-aware histogram loss respecting up > flat > down |
| **P4** | Arctan Pinball Loss (#11) | 2-3 | Better gradient flow if switching to quantile targets |
| **P5** | N3POM Ordinal NN (#16) | 6-8 | Full ordinal regression reframe |
| **P6** | MCQRNN (#9) | 6-10 | Rigorous non-crossing quantile boundaries |
| **P7** | IQN (#8) | 8-12 | Most expressive, highest ceiling, highest complexity |
| **P8** | Beyond Pinball Loss (#7) | 6-8 | Calibration fix for quantile approaches |
| **P9** | CVaR from Distribution (#13) | 4 | Asymmetric trading decisions from any distributional output |

## Strategic Recommendations

**Quick Wins (Day 1):**
1. Focal loss + Psi_gamma (P1)
2. Arctan pinball loss (P4) — reframe as quantile regression at tau=0.33, 0.67
3. MDN head (P2) — distributional output captures transitions

**Deeper Dives (Day 2-3):**
4. EMPL loss (P3) — ordinal-aware histogram loss
5. N3POM ordinal regression (P5) — full architectural reframe
6. MCQRNN (P6) — rigorous non-crossing quantile boundaries

**Knowledge Graph Gaps to Fill:**
- CRPS loss, normalizing flows, label smoothing, temperature scaling, soft target papers
