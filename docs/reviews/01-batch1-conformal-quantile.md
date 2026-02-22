# Round 1: Initial Batch — Conformal, Quantile, Misc
**Agent**: a6cf98f | **Round**: 1

## Paper Review: Academic Papers for Trading ML Project

### Project Context Recap
- Predicts return quantile classes (up/down/flat) for financial time series
- 64% directional accuracy on cross-entropy baseline
- 16-token context window of wavelet coefficient deltas + 4 auxiliary features
- Struggles with transitions (direction changes); flat prediction bias
- 20 experiments run, only 3 showed promise
- Goal: identify which research directions deserve an ephemeral branch

---

### Paper 1: "Extremal Quantile Regression: An Overview"
**Category:** Quantitative Finance | **Forge Score:** 0.82 | **Difficulty:** Academic
**Verdict: REFERENCE** -- Useful background on quantile regression theory, but extremal tail estimation is not the bottleneck.

### Paper 2: "Smoothed Quantile Regression with Large-Scale Inference"
**Category:** Statistics & Quantile Regression | **Forge Score:** 0.88
**Verdict: BRANCH** -- The smoothed quantile loss could replace cross-entropy as the training objective, potentially addressing the flat prediction bias.

### Paper 3: "Quantile Risk Control: A Flexible Framework for Bounding the Probability of High-Loss"
**Category:** Machine Learning | **Forge Score:** 0.88
**Verdict: BRANCH** -- Implement QRC as a model selection criterion across the 20 experiment variants. Bound CVaR of directional error, not just accuracy.

### Paper 4: "Quantile Hedging in a Semi-Static Market with Model Uncertainty"
**Category:** Quantitative Finance | **Forge Score:** 0.88
**Verdict: SKIP** -- Pure mathematical finance paper about options hedging under model ambiguity.

### Paper 5: "Distribution-free Conformal Prediction for Ordinal Classification"
**Category:** Statistics & Machine Learning | **Forge Score:** 0.82
**Verdict: BRANCH** -- High priority. Wrap the existing CE model's softmax outputs in ordinal conformal prediction sets. Contiguous sets exploit down<flat<up ordering. Prediction set size signals transitions.

### Paper 6: "A Gentle Introduction to Conformal Prediction and Distribution-Free Uncertainty"
**Category:** Machine Learning | **Forge Score:** 0.88
**Verdict: REFERENCE** -- Essential implementation reference for any conformal prediction branch.

### Paper 7: "Online Learning for Distribution-Free Prediction"
**Category:** Machine Learning | **Forge Score:** 0.82
**Verdict: REFERENCE** -- Online conformal calibration concept is useful background.

### Paper 8: "Conformal Prediction Set for Time-Series" (ERAPS)
**Category:** Machine Learning | **Forge Score:** 0.79
**Verdict: BRANCH** -- Pair with ordinal conformal. ERAPS handles non-exchangeability of time series data. Ensemble approach could wrap multiple experiment variants.

### Paper 9: "Training-conditional Coverage for Distribution-Free Predictive Inference"
**Category:** Statistical Machine Learning | **Forge Score:** 0.88
**Verdict: REFERENCE** -- Use split conformal (not jackknife+/CV+) for trading model.

### Paper 10: "Greedy Function Approximation: A Gradient Boosting Machine" (Friedman 2001)
**Category:** Machine Learning | **Forge Score:** 0.95
**Verdict: REFERENCE** -- Foundational but already absorbed into ecosystem.

### Paper 11: "Human-Timescale Adaptation in an Open-Ended Task Space" (AdA)
**Category:** AI Research | **Forge Score:** 0.92
**Verdict: REFERENCE** -- Automated curriculum concept is transferable but implementation is not.

### Paper 12: "ARLBench: Flexible and Efficient Benchmarking for HPO in RL"
**Category:** Machine Learning | **Forge Score:** 0.82
**Verdict: SKIP** -- RL-specific benchmarking, not applicable.

## Recommended Branch Priority

1. **Ordinal Conformal Prediction Sets** (Papers 5 + 8 + 9) -- ERAPS + ordinal + split conformal
2. **Smoothed Quantile Loss** (Paper 2) -- Replace CE with smoothed pinball
3. **QRC Model Selection** (Paper 3) -- Compare 20 experiments on CVaR, not just accuracy
