# Round 1: Quantile Regression Deep Dive
**Agent**: a414682 | **Round**: 1

## 20 Papers Assessed — Key Findings

### Top BRANCH Candidates

**1. Deep Huber Quantile Regression Networks (DHQRN)** | Score: 0.82
Most directly actionable. Generalizes both quantile and expectile regression via Huber quantile functional. Robust to fat-tailed returns. Near-direct loss swap: keep same network, replace CE with Huber quantile loss, output tau={0.25, 0.5, 0.75}. **HIGH priority.**

**2. Smoothed Quantile Regression (conquer)** | Score: 0.88
Replaces non-differentiable check function with twice-differentiable convex surrogate. Better gradient signal. Complementary to DHQRN. **HIGH priority.**

**3. BQN from Wind Gust Forecasting** | Score: 0.82
Bernstein Quantile Network: non-crossing quantiles by construction via Bernstein polynomial monotonicity. CRPS loss. Systematically compared against histogram estimation (your CE approach). **HIGH priority.**

**4. CQR + AgACI** | Score: 0.88 + 0.72
Conformalized Quantile Regression for calibrated intervals. AgACI handles time-series non-exchangeability. MAPIE library for implementation. **MEDIUM priority -- post-hoc calibration layer.**

**5. Ordinal Conformal Prediction** | Score: 0.82
Alternative path: keep classification, add ordinal-aware conformal calibration. **MEDIUM priority.**

### REFERENCE Papers
- Bayesian QRNN (0.82) -- posterior uncertainty but MCMC too slow
- Extremal Quantile Regression (0.82) -- tails, not median classification
- Adaptive Prediction Intervals for Deep Nets (0.72) -- CQR bridge paper
- Quantile Risk Control (0.88) -- model selection framework
- Training-Conditional Coverage (0.88) -- use split conformal
- ERAPS (0.79) -- time-series conformal for classification path
- Loss Function Survey (0.78) -- reference
- Time Series Forecasting Book (0.88) -- forecastability analysis

### SKIP
- Quantile Hedging (0.88) -- derivatives hedging theory
- Instrumental Variable QR (0.82) -- causal inference
- Conditional Mode Estimation (0.82) -- too theoretical

## Recommended Path
1. **Phase 1 (loss swap)**: DHQRN or conquer loss. Predict tau={0.25, 0.5, 0.75}. Direction from median sign.
2. **Phase 2 (non-crossing)**: BQN output layer if crossing observed.
3. **Phase 3 (calibration)**: CQR + AgACI via MAPIE.
4. **Phase 0 (sanity check)**: Forecastability analysis first.
