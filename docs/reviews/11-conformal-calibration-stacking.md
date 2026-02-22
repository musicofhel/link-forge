# Round 2: Conformal Prediction, Calibration, Stacked Correction
**Agent**: a96c5e9 | **Round**: 2

## Search Coverage
17 primary + 10 secondary queries across 2,841 papers. ~55 unique papers surfaced across themes.

---

## Tier 1: BRANCH

**1. Ensemble CQR (EnCQR)** | Score: 0.88
**Verdict: BRANCH** -- **NEW.** Removes exchangeability requirement via bootstrap ensembles + leave-one-out theory. Directly handles nonstationary, heteroscedastic series. Narrower intervals than CQR or CP alone. Missing bridge between CQR and non-i.i.d. wavelet features.

**2. Uncertainty-Aware CQR (UACQR)** | Score: 0.88
**Verdict: BRANCH** -- **NEW.** Separates aleatoric vs epistemic uncertainty. UACQR-S scales by epistemic uncertainty (high at transitions!), UACQR-P uses calibrated percentiles. Epistemic uncertainty spikes = natural abstention signal.

**3. ERAPS (Conformal for Time-Series)** | Score: 0.79
**Verdict: BRANCH** -- *Previously identified.* Non-exchangeable coverage for time-series classification. Directly applicable to 3-class ordinal.

**4. Conformal for Ordinal Classification** | Score: 0.82
**Verdict: BRANCH** -- *Previously identified.* Contiguous prediction sets respect {down < flat < up}. FWER-controlled.

**5. Adaptive Conformal Predictions (ACI)** | Score: 0.72
**Verdict: BRANCH** -- **NEW emphasis.** Online learning + expert aggregation adapts to distribution shift. Tracks coverage drift at regime transitions.

**6. SelectiveNet** | Score: 0.55
**Verdict: BRANCH** -- **NEW.** End-to-end architecture with integrated reject option. Risk-coverage tradeoff as training objective. Moves abstention from post-hoc to learned.

**7. Quantile Risk Control (QRC)** | Score: 0.88
**Verdict: BRANCH** -- **NEW.** Distribution-free bounds on VaR, CVaR, spectral risk of loss. Shifts objective from "maximize accuracy" to "bound probability of catastrophic loss."

## Tier 2: REFERENCE

**8. Beyond Pinball Loss** | Score: 0.88
Pinball loss insufficient for calibration. Tunable calibration-sharpness tradeoff. CE baseline may be inherently miscalibrated.

**9. LCMQR (Localized Conformal Multi-Quantile)** | Score: 0.82
Kernel-based localization for group-conditional coverage. Could cluster wavelet regimes separately.

**10. ICQR (Improved CQR)** | Score: 0.82
Clusters by permutation importance, per-cluster conformal steps.

**11. On Focal Loss for Class-Posterior Estimation** | Score: 0.88
Focal loss NOT strictly proper. Psi_gamma correction essential.

**12. Revisiting Reweighted Risk** | Score: 0.82
Dual focal loss for simultaneous calibration + selective classification. AURC metric connection.

**13. Art of Abstention** | Score: 0.72
Error regularization for selective prediction. Pre-trained transformers improve confidence estimation.

**14. Cyclical Focal Loss** | Score: 0.82
Universal replacement for CE across balanced/imbalanced/long-tailed data.

**15. CQR (original)** | Score: 0.88 -- Previously identified. Foundation paper.

**16. CUQR (Unconditional QR)** | Score: 0.88
Recentered influence functions. "Relevance subgroups" concept maps to regime states.

**17. Training-Conditional Coverage** | Score: 0.88
Algorithmic stability implies training-conditional coverage (stronger than marginal).

**18. Conformal Policy Learning** | Score: 0.88
Conformal quantiles as *inputs* to switching policy. When set is large, switch to safe/abstain policy.

**19. Finding Competence Regions** | Score: 0.55
Learning-to-reject for OOD data. Proxy incompetence scores identify trust regions per market regime.

**20. BOCPD (Adams & MacKay)** | Score: 0.92
Run-length posterior as auxiliary feature for transition detection.

**21. Robust BOCPD (Dm-BOCD)** | Score: 0.88
Robust to outliers (financial fat tails), 10x faster than previous robust methods.

**22. Deep Learning Multi-Scale Changepoint (PRN)** | Score: 0.82
Neural Wavelet Layer + multi-scale RNN. Aligns with wavelet coefficient deltas.

**23. Sequential Changepoint Detection with Checkpoints** | Score: 0.88
DeepMind. Cached model checkpoints detect distributional shifts via GLR tests. Monitor model for drift.

**24. Distribution-Free Prediction Sets for Graphs** | Score: 0.82
Non-exchangeable conformal for graph-structured data. Coverage gap bounds under non-exchangeability.

## New vs First Review

**Biggest new finds:**
1. **EnCQR** — Most directly actionable. Solves exchangeability problem for time-series.
2. **UACQR** — Epistemic/aleatoric separation is key to "abstain at transitions."
3. **Changepoint cluster** (BOCPD + Dm-BOCD + PRN) — Entirely new axis. Detect transitions directly, use run-length as feature or gate.
4. **SelectiveNet** — End-to-end trained abstention.
5. **Focal loss theory cluster** — Psi_gamma correction mandatory for calibration.
6. **QRC** — "Bound probability of catastrophic loss" > "maximize accuracy."

## Recommended Implementation Sequence
1. **Ordinal Conformal + EnCQR bootstrap** — Abstain when prediction set > 1
2. **BOCPD/Dm-BOCD run-length** as 5th auxiliary feature — Transition detection
3. **Cyclical Focal Loss** + Psi_gamma correction — Calibrated posteriors
4. **UACQR epistemic/aleatoric decomposition** — Abstain on regime novelty
5. **SelectiveNet rejection head** — End-to-end risk-coverage optimization
6. **QRC** — Post-training tail loss bound
