# Round 2: Information Theory Ceiling + Feature Selection
**Agent**: a338096 | **Round**: 2

## Search Coverage
18 keyword searches across titles + descriptions. Covered: mutual information estimation, MINE/neural estimation, information bottleneck, Fano inequality, entropy rate, predictability, Bayes error rate, feature selection + MI, mRMR, HSIC, conditional MI, partial information decomposition, permutation entropy, sample entropy, Lyapunov exponent, predictive information, BOLT loss, channel capacity, variational information bounds, copula entropy, KSG estimators.

**Gaps**: No papers for permutation entropy, sample entropy, Lyapunov exponent, BOLT loss, MINE (Belghazi 2018), KSG estimator, or Xu et al. predictability=Bayes error. These remain external references from Round 1.

---

## Tier 1: BRANCH (Directly Actionable)

**1. CCMI: Classifier-based Conditional MI Estimation** | Score: 0.88
**Verdict: BRANCH** -- Estimates CMI via neural classifiers, scales to 100 dims (KSG fails at 5). 20 features well within range. Measures I(Y; X_wavelet | X_aux) — whether wavelet coefficients carry signal *beyond* aux features. If CMI ≈ 0, 64% comes almost entirely from aux features. Needs CGAN/CVAE for conditional samples.

**2. Rethinking Fano's Inequality in Ensemble Learning (ICML 2022)** | Score: 0.88
**Verdict: BRANCH** -- Decomposes ensemble performance via Fano into relevance + redundancy + combination loss. Apply to 20 experiments: where is the bottleneck — input information limits (relevance) or model composition (combination loss)?

**3. Generalizing the Fano Inequality Further (2025)** | Score: 0.52
**Verdict: BRANCH** -- Extends Fano to bounded loss transforms with explicit CVaR lower bounds. CE is bounded loss, so gives tighter P_error lower bound than vanilla Fano. If bound says P_error >= 0.35, then 64% is only 1 point above the floor.

**4. Rigorous IT Definition of Redundancy/Relevancy in Feature Selection** | Score: 0.88
**Verdict: BRANCH** -- PID framework decomposes joint MI into unique, redundant, and synergistic per feature. Identifies which wavelet coefficients carry *unique* information vs redundant with aux features. Iterative CMI-based forward selection algorithm.

**5. HOCMIM: High-Order CMI Maximization for Feature Selection** | Score: 0.88
**Verdict: BRANCH** -- Bottom-up CMI chain expansion captures high-order dependencies. Scales linearly with dependency order. 20-feature space is small enough. Tested against 18 methods on 20 benchmarks. Tells optimal feature subset. Filter-based, no model training needed.

**6. Sparse mRMR (SmRMR)** | Score: 0.87
**Verdict: BRANCH** -- Non-convex penalized mRMR with FDR control via knockoff filter. Answers "which of 16 wavelet delta features are noise?" with principled p-values. Comparable to HSIC-LASSO with fewer features.

**7. How Does Information Bottleneck Help Deep Learning** | Score: 0.92
**Verdict: BRANCH** -- First rigorous generalization bounds showing MI(input, hidden) controls generalization. If model's hidden representation captures nearly all MI(X,Y), 64% ceiling is fundamental. If MI(hidden,X) >> MI(hidden,Y), room to compress. Bound factors empirically predict generalization gaps.

## Tier 2: REFERENCE

**8. CMIFSI (CMI Feature Selection with Interactions)** | Score: 0.78
Explicitly models feature interactions. Outperforms mRMR, CMIM, CFS. Useful if HOCMIM/SmRMR suggest interaction effects.

**9. Cauchy-Schwarz IB for Regression (ICLR 2024)** | Score: 0.88
CS-IB avoids distributional assumptions. CS-divergence prediction term may be better training objective if reframing as regression.

**10. On Focal Loss for Class-Posterior Estimation** | Score: 0.88
Psi_gamma transform for calibrated posteriors. Cross-reference with focal loss reviews.

**11. Partial Information Decomposition for Continuous Variables** | Score: 0.88
Extends PID to continuous (wavelet coefficients are continuous). Needed for rigorous PID-based feature selection.

**12. Partial Entropy Decomposition** | Score: 0.88
MI combines redundant and synergistic entropy. Key insight: if wavelet features have high synergistic entropy, they must be used jointly — dropping any one kills signal. Could explain why single-feature MI looks low but model gets 64%.

**13. Novel Approach to PID (Blackwell Order)** | Score: 0.92
Most principled PID framework. Decision-theory connections.

**14. GENIE (Ensemble MI Estimation)** | Score: 0.88
Parametric 1/N convergence for mixed discrete-continuous MI estimation. Your exact setup (discrete Y, continuous X). More accurate than KSG for ceiling computation.

**15. Markov Chain Order Estimation with CMI** | Score: 0.82
CMI-based sequential hypothesis testing for Markov order. Could determine if 16 tokens is the right context window or if true order is much less.

**16. Specific Differential Entropy Rate** | Score: 0.82
State-dependent entropy rate (prediction difficulty by state). May reveal transitions are *fundamentally* less predictable, not a model deficiency.

**17. Predictability and Profitability (GP + Entropy)** | Score: 0.52
Lower entropy = more predictable = more profitable on NYSE. Calibration data for real stock entropy rates.

**18. mRMR for Functional Data** | Score: 0.82
Replaces MI with distance correlation; outperforms MI-based mRMR. Wavelet deltas are functional data — distance-correlation mRMR might work better.

**19. HSIC Bottleneck** | Score: 0.88
Alternative training signal implementing IB. Less relevant than direct feature selection.

**20. Conformal Prediction with Trust Scores** | Score: 0.55
Trust score measures deviation from Bayes optimal. Diagnostic for ceiling question.

## Tier 3: SKIP

Papers 21-36+: Algebraic geometry "Fano" papers (manifolds, not information theory), wireless channel capacity, optical communications, hyperspectral imaging, video analytics, continual learning, smart contracts, network pruning, quantum state discrimination, domain-specific mRMR applications.

---

## Summary: NEW Findings vs Round 1

Round 1 identified: MINE + Fano, BOLT loss, CCMI, sparse mRMR, Xu et al. predictability=Bayes error.

**6 new actionable papers:**
1. **Rethinking Fano in Ensemble Learning** — Fano analysis across 20 experiments
2. **Generalizing Fano Further** — Tighter CVaR bounds on misclassification
3. **HOCMIM** — Best-in-class filter feature selection, high-order dependencies
4. **Rigorous IT Redundancy/Relevancy** — PID-based unique vs redundant signal per feature
5. **IB Generalization Bounds** — Diagnose data ceiling vs model ceiling
6. **GENIE** — Parametric-rate MI estimator for mixed discrete-continuous case

## Recommended Implementation Order

1. **HOCMIM feature selection** (#5) — lowest cost, immediately shows which features to keep/drop
2. **GENIE MI estimation** (#14) — estimate I(X,Y) for ceiling computation
3. **Generalized Fano bound** (#3) — plug MI into P_error lower bound
4. **CCMI** (#1) — isolate wavelet signal from aux feature signal
5. **IB generalization bound** (#7) — diagnose model vs data ceiling
6. **SmRMR + knockoff** (#6) — FDR-controlled feature selection for comparison
7. **Rethinking Fano in ensembles** (#2) — analyze 20 experiments for information loss patterns
