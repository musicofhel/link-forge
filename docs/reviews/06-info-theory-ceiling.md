# Round 1: Information-Theoretic Ceiling Analysis
**Agent**: af3822a | **Round**: 1

## Context
Core question: Is 64% near the theoretical ceiling, or is there room to improve?
If I(X; Y) is low, no model can beat a ceiling derived from Fano's inequality.

---

## Paper Assessments

### 1. MINE — Mutual Information Neural Estimation (Belghazi et al. 2018)
**Verdict: BRANCH** -- Most direct path. Estimate I(X;Y), plug into Fano. Bias concern (underestimates MI). 1-2 days.

### 2. Estimating MI via Classification Error (Zheng & Benjamini 2016)
**Verdict: BRANCH** -- Goes error→MI (reverse of Fano). Cross-validates MINE estimate. You already have a 64% classifier.

### 3. Equivalence Between Time Series Predictability and Bayes Error Rate (Xu et al. 2022)
**Verdict: BRANCH** -- HIGHEST PRIORITY. Proves the exact mapping from entropy rate to max achievable accuracy for time series.

### 4. Rethinking Fano's Inequality in Ensemble Learning (Morishita et al. 2022)
**Verdict: REFERENCE** -- Tightens Fano bounds for ensembles. Useful later.

### 5. Generalizations of Fano's Inequality (Sakai 2018)
**Verdict: REFERENCE** -- Renyi-based tighter bounds. Standard Fano adequate for K=3.

### 6. Arimoto-Renyi Conditional Entropy (Sason & Verdu 2017)
**Verdict: REFERENCE** -- Both upper AND lower bounds on Bayes error. Tightest possible ceiling range.

### 7. Predictability of Volatility Homogenised Financial TS (Fiedor & Trondrud 2014)
**Verdict: BRANCH** -- Someone already did entropy-rate predictability analysis for financial TS. Closest prior work.

### 8. CCMI — Classifier-Based Conditional MI Estimation (Mukherjee et al. 2019)
**Verdict: BRANCH** -- Estimates I(X;Y|Z). Answer: "given wavelets, how much do aux features add?" Handles conditional case MINE doesn't.

### 9. PID for Feature Selection (Wollstadt et al. 2021)
**Verdict: REFERENCE** -- PID decomposes unique/redundant/synergistic per feature. Computationally prohibitive for 20 features.

### 10. PIDF — Practical PID for Feature Selection (Westphal et al. 2024)
**Verdict: REFERENCE** -- More practical than #9 but CCMI is more direct.

### 11. Sparse mRMR (Naylor et al. 2025)
**Verdict: BRANCH** -- Quick experiment. mRMR on 20 features. GitHub available.

### 12. HSIC Bottleneck (Ma et al. 2019)
**Verdict: SKIP** -- HSIC is not MI, can't plug into Fano.

### 13-14. HSIC Sensitivity Maps, Post-Selection HSIC-Lasso
**Verdict: REFERENCE** -- Feature importance tools, not ceiling estimation.

### 15. CMI-based Contrastive Loss for Financial TS (Wu et al. 2020)
**Verdict: REFERENCE** -- CMI as training objective for financial TS. Model improvement, not ceiling.

### 16. Information Bottleneck and Deep Learning (Tishby & Zaslavsky 2015)
**Verdict: REFERENCE** -- Essential theory. Explains why MI determines ceiling.

### 17. BOLT — Universal Training to Achieve Bayes Optimal (2025)
**Verdict: BRANCH** -- Train with BOLT loss; converged accuracy IS the ceiling. No MI estimation needed. If BOLT gives 64%, that's your answer.

### 18. Ensemble Estimation of Information Divergence (Moon et al. 2016)
**Verdict: REFERENCE** -- Alternative Bayes error estimation path.

## Quick Decision Framework

Run MINE to get I(X; Y). Then:
- **I(X;Y) < 0.15 bits** → ceiling ~60-65%. 64% is near-optimal. Stop optimizing model, improve features.
- **I(X;Y) ~ 0.3-0.5 bits** → ceiling ~70-80%. Room to improve.
- **I(X;Y) > 0.6 bits** → ceiling above 85%. Model significantly underperforming.

Cross-validate with BOLT and CCMI.

## Priority Order
1. MINE (1-2 days)
2. Xu et al. Predictability = Bayes Error (1 day)
3. BOLT loss (1-2 days)
4. CCMI (1-2 days)
5. Sparse mRMR (0.5 day)
