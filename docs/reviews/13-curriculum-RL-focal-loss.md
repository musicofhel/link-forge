# Round 2: Learning from Mistakes, Curriculum Learning, RL for Trading
**Agent**: abe0d16 | **Round**: 2

## Search Coverage
17 keyword searches across 2,841 papers. Covered: curriculum learning, self-paced learning, focal loss, OHEM, boosted residual learning, meta-learning/MAML, learning to reweight, RL trading, direct policy learning, reward shaping, sequence-level training, anti-curriculum, difficulty-aware training, class imbalance, cost-sensitive learning, sample weighting, hard negative mining, distributional RL, Sharpe ratio + RL.

---

## Theme 1: Curriculum Learning & Self-Paced Learning

**1. Curriculum Learning & Imitation Learning for Financial Time-Series** | Score: 0.82
**Verdict: BRANCH** -- **Most relevant paper in the entire graph for this theme.** CL on financial TS with RL. Data-augmentation curriculum + oracle-based policy distillation. CL significantly improves out-of-sample performance. Adapt: order training windows by transition density (easy=pure trend, hard=multiple direction changes).

**2. ScreenerNet (Learned Self-Paced CL)** | Score: 0.78
**Verdict: REFERENCE** -- Attachable NN learns soft sample weights. Compatible with Prioritized Experience Replay. But adds second network. Start simpler.

**3. Optimization Framework for Task Sequencing in CL** | Score: 0.78
**Verdict: REFERENCE** -- Multiple CL objectives: jumpstart, cumulative regret, asymptotic quality. Over-engineered for current stage.

**4. Dynamic Difficulty Awareness Training (DDAT)** | Score: 0.78
**Verdict: BRANCH** -- Integrates sample-level difficulty into sequence-based NNs. Use autoencoder reconstruction error on wavelet-delta sequences as difficulty signal. Transition windows naturally have higher reconstruction error. Principled, automated way to upweight transitions without hand-labeling.

**5. Causal-Paced DRL (CP-DRL)** | Score: 0.82
**Verdict: SKIP** -- Causal SCM machinery is overkill. Ensemble disagreement idea captured simpler by DDAT.

**6. Contrastive Curriculum for TS Foundation Models** | Score: 0.62
**Verdict: REFERENCE** -- Contrastive + curriculum for TS. Not using foundation models.

**7. Anti-Curriculum for Medical Imaging** | Score: 0.58
**Verdict: REFERENCE** -- Hard-first fights confirmation bias. Worth testing: train on transition-heavy windows first, then add easy trend windows. May address flat prediction bias.

## Theme 2: Focal Loss & Hard Example Mining

**8. Cyclical Focal Loss (CFL)** | Score: 0.82
**Verdict: BRANCH** -- **Superior alternative to static focal loss.** `gamma(epoch) = gamma_max * sin(pi * epoch / total_epochs)`. Prevents overfitting to hard examples. Try BEFORE static focal loss.
*NOTE: User wants flat-bias diagnostic checked before any focal loss experiment.*

**9. On Focal Loss for Class-Posterior Probability Estimation** | Score: 0.88
**Verdict: BRANCH** -- Focal loss NOT strictly proper. Must apply Psi_gamma transformation to get calibrated probabilities. Without correction, trading signals from softmax are systematically biased.

**10. Adversarial Focal Loss** | Score: 0.78
**Verdict: SKIP** -- Adversarial training adds instability. ScreenerNet is simpler.

**11. Using Focal Loss to Fight Shallow Heuristics** | Score: 0.68
**Verdict: REFERENCE** -- **WARNING**: Focal loss alone may not solve transition problem. Fails on genuinely hard samples. May need focal + curriculum (CFL) or focal + sample reweighting.

**12. Revisiting Reweighted Risk (AURC, Focal, Inverse Focal)** | Score: 0.82
**Verdict: REFERENCE** -- Inverse focal loss can improve calibration.

**13. S-OHEM (Stratified Online Hard Example Mining)** | Score: 0.52
**Verdict: REFERENCE** -- Stratification: weight loss differently for different quantile classes.

## Theme 3: Meta-Learning & Reweighting

**14. Alpha MAML** | Score: 0.72
**Verdict: SKIP** -- MAML requires episode-based training. Not worth restructuring.

**15. ML-PIP / VERSA** | Score: 0.88
**Verdict: SKIP** -- Too far from classification architecture.

**16. Auxiliary Task Reweighting** | Score: 0.88
**Verdict: REFERENCE** -- Gradient-matching for optimal auxiliary task weighting. Frame 4 aux features as tasks, learn weights. Second-order optimization.

## Theme 4: RL for Trading (NEW — previously "no papers")

**17. Learning to Trade via Direct RL (Moody & Saffell, 2001)** | Score: 0.72
**Verdict: REFERENCE** -- Foundational. Differential Sharpe ratio as reward signal. Could use as auxiliary loss alongside CE even without full RL.

**18. Deep RL Ensemble Stock Trading** | Score: 0.82
**Verdict: REFERENCE** -- PPO/A2C/DDPG ensemble with Sharpe-based switching. Turbulence index triggers conservative behavior during regime changes. Turbulence metric is portable: use to upweight transition samples.

**19. Deep RL for Optimal Stopping (DDQN, C51, IQN)** | Score: 0.82
**Verdict: REFERENCE** -- Distributional RL for financial optimal stopping. IQN + LSTM. Optimal stopping IS a transition problem.

**20. Model-based DRL Portfolio + GAN** | Score: 0.82
**Verdict: SKIP** -- GAN augmentation for transitions noted, but too heavy.

## Theme 5: Sequence-Level Training

**22. MIXER (Sequence Level Training with RNNs)** | Score: 0.88
**Verdict: REFERENCE** -- Addresses exposure bias. REINFORCE-based correction. Only relevant if model is autoregressive at inference.

## Theme 6: Difficulty-Aware & Cost-Sensitive

**23. DA-DPO (Difficulty-Aware Preference Optimization)** | Score: 0.82
**Verdict: REFERENCE** -- Distribution-aware voting for difficulty estimation. Use ensemble disagreement across 20 experiments to identify genuinely hard vs noisy samples.

**24. Cost-Sensitive DBN** | Score: 0.55
**Verdict: SKIP** -- Deep Belief Networks dated. Auto-cost idea captured by focal loss.

## Theme 7: Quantile & Distributional Methods (Bonus)

**25-27.** QR-DQN (0.92), IQN (0.92), MCQRNN (0.87) — REFERENCE. Already covered in dedicated quantile review.

---

## Key NEW Findings vs Round 1

1. **RL-for-Trading papers EXIST** (4 found). Round 1 said "no RL-for-trading papers."
2. **Cyclical Focal Loss** is superior to static focal loss and simpler than competence-based curriculum.
3. **Focal loss calibration gap** (Psi_gamma) is critical: focal loss outputs are NOT probabilities.
4. **DDAT** provides principled, automated difficulty metric for time series.
5. **Anti-curriculum** (hard-first) worth testing against flat prediction bias.

## MCP Server Bugs Found (Incidental)

1. **`src/graph/search.ts`**: `hybridSearch()` ran `vectorSearch()` + `keywordSearch()` in `Promise.all()` on same Neo4j session → "session with open transaction" error. Fix: run sequentially.
2. **`src/mcp/tools/browse.ts`** + **`src/mcp/tools/recent.ts`**: MCP SDK passes `limit` as float, Neo4j needs integer. Fix: `Math.round()`.

Requires `npm run build` + MCP restart. Build may fail on `src/sync/` imports.

## Priority Actions (BRANCH, Ranked)

1. **Cyclical Focal Loss** — ~30 min. Drop-in with built-in curriculum. *Blocked on flat-bias check.*
2. **Focal Loss Calibration (Psi_gamma)** — implement WITH #1
3. **DDAT: Difficulty-Aware Training** — autoencoder reconstruction error as difficulty signal
4. **CL for Financial TS** — order windows by transition density (easy→hard)
