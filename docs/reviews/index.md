# Paper Review Reports Index

**Generated**: 2026-02-18/19
**Source**: 2,841 papers in Link Forge knowledge graph
**Target**: Trading ML model (quantile classifier, 64% directional accuracy, 16-token wavelet deltas)
**Summary**: See `docs/session-handoff-paper-review.md` for condensed findings and agreed experiment sequence

## Round 1 (preliminary — first ~50 papers processed)

| File | Theme | Key BRANCH Candidates |
|------|-------|-----------------------|
| `01-batch1-conformal-quantile.md` | Conformal prediction, quantile risk, gradient boosting | Ordinal conformal, ERAPS, smoothed quantile, QRC |
| `02-batch2-conformal-quantile-BQN.md` | Conformal prediction, BQN/CRPS, MAPIE | BQN + CRPS loss, MAPIE/EnbPI, ordinal conformal |
| `03-quantile-regression-pinball.md` | Quantile regression — DHQRN, conquer, BQN, CQR | DHQRN (Huber quantile), smoothed pinball, BQN, CQR + AgACI |
| `04-changepoint-transition.md` | Changepoint/transition detection | Permutation entropy feature, jump z-score aux head. NOTE: Found ZERO changepoint papers (corrected in Round 2) |
| `05-contrastive-learning.md` | Contrastive learning for time series | TNC (regime-aware), TS2Vec (general-purpose) |
| `06-info-theory-ceiling.md` | Information-theoretic ceiling analysis | MINE + Fano, BOLT loss, CCMI, Xu et al. predictability=Bayes error |
| `07-curriculum-RL-wavelet-r1.md` | Curriculum learning, RL, wavelet representations | Focal loss, wavelet scattering, predictability gate, competence-based curriculum |

## Round 2 (full graph — all 2,841 papers)

| File | Theme | Key BRANCH Candidates |
|------|-------|-----------------------|
| `08-target-temporal-error-correction.md` | Target repr, temporal structure, mistakes, stacking | Ordinal conformal + ERAPS, focal loss fix, BQN/CRPS, curriculum |
| `09-quantile-distributional.md` | Quantile/distributional targets (comprehensive) | MDN head, EMPL, focal+Psi_gamma, IQN, MCQRNN, N3POM, CVaR |
| `10-transition-temporal-contrastive.md` | Transitions, temporal, contrastive (comprehensive) | TS-CP2, TFT, PRN NWL, BOCPD, CoST, cyclical focal, aux reweighting. Corrected R1: found 15+ changepoint papers |
| `11-conformal-calibration-stacking.md` | Conformal, calibration, stacked correction | EnCQR, UACQR, ACI, SelectiveNet, QRC |
| `12-wavelet-cross-asset-features.md` | Wavelets, fractional differencing, cross-asset | WaveForM, PRN NWL, FinTSBridge. Gaps: fractional differencing, MODWT (all ZERO) |
| `13-curriculum-RL-focal-loss.md` | Curriculum learning, RL, focal loss variants | Cyclical focal loss, Psi_gamma, DDAT, CL for financial TS. Bonus: 2 MCP bugs fixed |
| `14-info-theory-feature-selection.md` | Info theory ceiling, feature selection | CCMI, Rethinking Fano, generalized Fano, HOCMIM, SmRMR, IB bounds |
