# Round 1: Curriculum Learning, RL, Wavelet Representations
**Agent**: a46f4cb | **Round**: 1

## Theme 1: Curriculum Learning (thin coverage)

**1. Competence-based CL for NMT** (Platanios et al.) | Score: 0.62
**Verdict: BRANCH** -- Sort samples by difficulty (trend=easy, transitions=hard), anneal competence boundary. 1-2 days.

**2. SOAR (Meta-RL Curriculum)** | Score: 0.72
**Verdict: SKIP** -- Over-engineered. LLM teacher not needed when you can define difficulty analytically.

**3. AdA (DeepMind)** | Score: 0.92
**Verdict: REFERENCE** -- Frontier-based difficulty scheduling. Same principle as competence-based CL.

## Theme 2: RL for Trading (NO financial-specific RL papers)

**4. Kevin Murphy RL Monograph** | Score: 0.92
**Verdict: REFERENCE** -- Comprehensive reference but doesn't address financial RL challenges.

**5. MO-DCMAC (Multi-Objective RL)** | Score: 0.55
**Verdict: SKIP** -- Domain mismatch (infrastructure maintenance).

**GAP NOTE**: No papers on REINFORCE for trading, decision transformers for finance, reward-conditioned sequences. External literature suggests RL rarely beats well-tuned supervised methods for trading.

## Theme 3: Wavelets (richest coverage)

**6. Wavelet Scattering for Jump Classification** | Score: 0.88
**Verdict: BRANCH** -- Replace/augment wavelet deltas with scattering transform. `kymatio` library. 2-3 days.
*NOTE: User later reported this FAILED in prior experiments (exp/wavelet-scattering). Skip.*

**7. WaveForM (DWT + GNN)** | Score: 0.82
**Verdict: REFERENCE** -- Validates wavelet-domain modeling. GNN only relevant for multi-instrument.

**8. WEITS (Wavelet-Enhanced N-BEATS)** | Score: 0.82
**Verdict: REFERENCE** -- Multi-resolution forecasts, Haar vs Daubechies comparison.

**9. WaveLSFormer (Learnable Wavelet Transformer)** | Score: 0.55
**Verdict: BRANCH** -- Learnable wavelet filters = trainable 1D convolutions. 1-2 days.

**10. Electricity Price + Wavelet MRA** | Score: 0.82
**Verdict: SKIP** -- Auto-tuning idea superseded by learnable wavelets.

**11. Bitcoin + Wavelet Denoising** | Score: 0.62
**Verdict: REFERENCE** -- 63% accuracy at next-day matches your 64%. Signal-to-noise, not architecture, may be binding constraint.

**12. Phase Space Reconstruction + SOM** | Score: 0.78
**Verdict: BRANCH** -- Predictability gate using Lyapunov/Hurst. `nolds` library. 2-3 days.

**13. Ordinal Networks** | Score: 0.82
**Verdict: REFERENCE** -- Permutation entropy features. Lightweight auxiliary input.

**14. Focal Loss (Lin et al.)** | Score: 0.82
**Verdict: BRANCH** -- Swap CE for focal loss with gamma in {1,2,5}. One-line change. Try before curriculum learning.
*NOTE: User reported focal loss FAILED in prior experiments. Check flat-bias diagnostic before revisiting.*

**15. ShapeFormer (KDD 2024)** | Score: 0.88
**Verdict: REFERENCE** -- Class-specific shapelets. Compelling but overhead not justified vs simpler approaches.

## Priority Actions
1. Focal loss (hours) -- *blocked pending flat-bias check*
2. Wavelet scattering (2-3 days) -- *FAILED in prior experiments*
3. Predictability gate (2-3 days)
4. Competence-based curriculum (1-2 days)
5. Learnable wavelets (1-2 days)
