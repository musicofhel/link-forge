# Round 1: Contrastive Learning for Time Series
**Agent**: a55d4f0 | **Round**: 1

## Context
Idea: contrastive pre-training to learn representations that distinguish "pre-reversal" from "pre-continuation" windows.

---

## Paper Assessments

### 1. TS2Vec — Towards Universal Representation of Time Series
**arXiv**: 2106.10466 | **Code**: github.com/yuezhihan/ts2vec
Hierarchical contrastive learning with timestamp masking + random cropping. Dilated CNN encoder.
- Transitions: Partially (multi-scale, handles distribution shifts)
- 16 tokens: Needs depth reduction (10 dilation blocks too many)
- **Verdict: BRANCH** -- Most directly applicable. Pre-train on unlabeled windows, linear probe for classification.

### 2. CPC — Contrastive Predictive Coding
**arXiv**: 1807.03748
Encodes observations, GRU autoregressive model, InfoNCE loss predicting future latents.
- Transitions: WEAK -- continuation-biased objective. TNC experiments show CPC gets 70.26% vs TNC's 97.52% on regime changes.
- **Verdict: REFERENCE** -- Foundational but optimizes for continuations (your strength, not weakness).

### 3. SimCLR Applied to Time Series
Augment-encode-contrast at instance level. NT-Xent loss.
- Transitions: NO -- discards temporal context entirely.
- **Verdict: SKIP** -- Treats each window independently, ignores what happens after.

### 4. TNC — Temporal Neighborhood Coding
**arXiv**: 2106.00750 | **Code**: github.com/sanatonek/TNC_representation_learning
Neighborhoods via ADF stationarity test. PU-learning weighted negatives.
- Transitions: YES explicitly. Designed for non-stationary regime detection. 97.52% on regime changes.
- 16 tokens: Tested with delta=4.
- **Verdict: BRANCH** -- Most conceptually aligned. Define neighborhoods using trend regimes. Transition-boundary windows get distinct representations.

### 5. CoST — Contrastive Learning of Disentangled Seasonal-Trend
**arXiv**: 2202.01575 | **Code**: github.com/salesforce/CoST
Frequency-domain + time-domain contrastive losses. Causal disentanglement.
- Transitions: Partially (trend/seasonal disentanglement)
- 16 tokens: Marginal (poor resolution, only 4 AR experts, 9 frequency bins)
- **Verdict: REFERENCE** -- Attractive at h=64+, marginal at h=16.

### 6. SVDCL — Noise-robust Contrastive Learning for Critical Transitions
**arXiv**: 2512.12523
SVD-decomposed weights for transition/tipping point detection in dynamical systems.
- Transitions: YES, but detects WHERE transitions occur, not predicts WHETHER one is coming.
- **Verdict: REFERENCE** -- Conceptually strong but needs substantial adaptation.

### 7. Contrastive Learning of Asset Embeddings
**arXiv**: 2407.18645
Per-asset embeddings from return history. Sector classification, portfolio hedging.
- Transitions: NO -- cross-asset similarity, not temporal.
- **Verdict: REFERENCE** -- Only financial contrastive paper found. Different problem.

## Summary

| Paper | Transitions? | 16 tokens? | Verdict |
|-------|-------------|-----------|---------|
| TS2Vec | Partially | Needs mod | **BRANCH** |
| CPC | No (continuation-biased) | Yes | REFERENCE |
| SimCLR | No | Yes | SKIP |
| TNC | Yes explicitly | Yes (delta=4 tested) | **BRANCH** |
| CoST | Partially | Marginal | REFERENCE |
| SVDCL | Yes (detection, not prediction) | Depends | REFERENCE |
| Asset Embeddings | No | N/A | REFERENCE |

## Recommended Order
1. **TNC** -- most aligned, works with short windows
2. **TS2Vec** -- most robust general-purpose
