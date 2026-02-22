# Round 2: Target Representation, Temporal Structure, Error Correction, Calibration
**Agent**: a55bde3 | **Round**: 2

## Theme 1: Target Representation

**1. Deep Huber Quantile Regression Networks (DHQRN)** | Score: 0.82
**Verdict: BRANCH** -- Generalizes both quantiles and expectiles via Huber quantile functional. Replace CE head with Huber quantile regression predicting tau={0.1, 0.25, 0.5, 0.75, 0.9}. Direction from median sign. Transition problem may improve because full conditional distribution modeled rather than ternary decision.

**2. Bayesian QRNN** | Score: 0.82
**Verdict: REFERENCE** -- Posterior uncertainty via asymmetric Laplace + Gibbs sampling. MCMC too slow. Use MC dropout or ensembles instead.

**3. BQN/DRN/HEN Comparison (Wind Gust Forecasting)** | Score: 0.82
**Verdict: BRANCH** -- BQN parameterizes full quantile function via Bernstein polynomials + CRPS loss. HEN is histogram estimation (close to CE approach but with more bins + CRPS). BQN naturally handles "flat is between up and down." Also try HEN with 20 bins + CRPS as direct swap.

**4. Smoothed Quantile Regression (conquer)** | Score: 0.88
**Verdict: SKIP** -- Linear quantile regression, not neural. Theoretical statistics paper.

**5. Quantile Risk Control (QRC)** | Score: 0.88
**Verdict: REFERENCE** -- Post-hoc evaluation framework. Use for model selection on tail risk, not training.

**6. Learning to Rank for Cross-Sectional Momentum** | Score: 0.82
**Verdict: BRANCH** -- Paradigm shift: replace per-instrument classification with pairwise ranking (RankNet). 3x Sharpe improvement. Only applies if trading cross-section of instruments.

## Theme 2: Temporal Structure

**7. N-BEATS** | Score: 0.92
**Verdict: REFERENCE** -- Doubly-residual stacking architecture. 16-token context too short for stacking to shine. Note residual idea if moving to regression.

**8. WEITS (Wavelet-Enhanced N-BEATS)** | Score: 0.82
**Verdict: BRANCH** -- Different model components specialize on different wavelet resolution levels independently before combining. Transition detection may improve because direction changes at different time scales have different signatures.

**9. WaveForM (DWT + GNN)** | Score: 0.82
**Verdict: REFERENCE** -- Reinforces per-resolution modeling. GNN only matters for multi-instrument.

**10. Wavelet Scattering for Jump Classification** | Score: 0.88
**Verdict: BRANCH** -- Wavelet scattering transform captures cross-scale nonlinear interactions. Translation-invariant, deterministic computation (kymatio library). Low-risk feature engineering change.
*NOTE: User reported FAILED in prior experiments (exp/wavelet-scattering). Skip.*

**11. N-BEATS + TDA (Topological Data Analysis)** | Score: 0.82
**Verdict: REFERENCE** -- Persistent homology features. Computational overhead likely prohibitive. Wavelet scattering gives similar structural info more cheaply.

**12. Wavelet Denoising + DTW** | Score: 0.58
**Verdict: SKIP** -- Superseded by existing wavelet approach.

## Theme 3: Learning from Mistakes

**13. Focal Loss (Lin et al.)** | Score: 0.82
**Verdict: BRANCH** -- Critical implementation check: (a) p_t = probability of *ground truth* class, (b) gamma=2.0, (c) alpha class weights for frequency imbalance. Correct implementation with alpha=[0.5, 0.25, 0.5] (up, flat, down) + gamma=2 is a 10-minute fix.
*NOTE: User reported focal loss FAILED in prior experiments. Check flat-bias diagnostic first.*

**14. Focal Loss for Class Imbalance (Canine RBC)** | Score: 0.55
**Verdict: SKIP** -- Application paper, no new insight.

**15. Cost-Sensitive Decision Tree Ensembles** | Score: 0.55
**Verdict: REFERENCE** -- Asymmetric cost idea: weight transition samples 2-3x more than continuation samples.

**16. Competence-Based Curriculum Learning for NMT** | Score: 0.62
**Verdict: BRANCH** -- Score samples by difficulty (transitions=hard), progressively shift from easy to uniform/hard-biased sampling. Orthogonal to loss function.

**17. SOAR (Meta-RL Curriculum)** | Score: 0.72
**Verdict: SKIP** -- Over-engineered. Simple competence-based curriculum achieves same goal.

**18. Dynamic Meta-Learning for Failure Prediction** | Score: 0.55
**Verdict: SKIP** -- Better addressed under stacked correction.

**19. DeepMind AdA** | Score: 0.92
**Verdict: SKIP** -- Domain mismatch too large. Curriculum principle already captured by #16.

## Theme 4: Stacked Correction / Calibration

**20. A Gentle Introduction to Conformal Prediction** | Score: 0.88
**Verdict: BRANCH** -- Wrap classifier with split conformal prediction. At each step, compute conformal prediction set at 90% coverage. Singleton set → trade. Multi-class set → abstain. Dramatically improves accuracy of trades actually taken.

**21. ERAPS (Conformal for Time-Series)** | Score: 0.79
**Verdict: BRANCH** -- Extends conformal to non-exchangeable time series. Handles temporal dependence. Use instead of naive split conformal. Coverage guarantees weaker but honest.

**22. AgACI (Adaptive Conformal)** | Score: 0.72
**Verdict: REFERENCE** -- Regression counterpart to ERAPS. Hold for if switching to quantile regression target.

**23. EnbPI (Ensemble Bootstrap Conformal)** | Score: 0.72
**Verdict: REFERENCE** -- Redundant with AgACI.

**24. Conformal for Market Makers** | Score: 0.55
**Verdict: REFERENCE** -- Precedent citation for conformal in finance. No new technique.

**25. Training-Conditional Coverage** | Score: 0.88
**Verdict: REFERENCE** -- Confirms split conformal is the right baseline choice.

**26. Conformal for Ordinal Classification** | Score: 0.82
**Verdict: BRANCH** -- Your up/flat/down classes ARE ordinal. Never produces {up, down} (skipping flat), only contiguous sets. {flat, up} = "positive or neutral" → actionable for position sizing.

**27. Conformal with Selection-Conditional Coverage** | Score: 0.55
**Verdict: REFERENCE** -- Important if pre-filtering before trading. Standard conformal suffices if trading all signals.

**28. Calibration After Bootstrap** | Score: 0.72
**Verdict: REFERENCE** -- Pragmatic alternative to conformal: ensemble disagreement as uncertainty signal.

**29. Bayesian Confidence Calibration** | Score: 0.72
**Verdict: REFERENCE** -- Regime-change detection via calibration distribution widening.

**30. Post-hoc g-Layers** | Score: 0.55
**Verdict: REFERENCE** -- Simpler alternatives (temperature/Platt scaling) usually sufficient.

**31. Smooth Isotonic Regression** | Score: 0.62
**Verdict: SKIP** -- Standard calibration techniques sufficient for 3-class.

**32. Bitcoin + Stacked Deep Learners + Wavelet** | Score: 0.62
**Verdict: REFERENCE** -- Stacking architecture worth noting, paper quality low.

## Priority Actions
1. **Ordinal conformal prediction** (Papers 20, 21, 26) — highest-impact low-effort
2. **BQN + CRPS loss** (Paper 3) — eliminates arbitrary class boundaries
3. **Focal loss fix** (Paper 13) — blocked on flat-bias check
4. **WEITS multi-resolution stacks** (Paper 8) — model architecture
5. **Curriculum learning** (Paper 16) — orthogonal to loss changes
