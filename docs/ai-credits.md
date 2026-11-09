# AI credits and cost control

All AI usage is metered by Postgres functions that only the server (service role) can call.
Code: `frontend/src/lib/ai/`. Schema: `supabase/migrations/20261109120000_ai_usage_credits.sql`.

## How a request flows

1. The server action authenticates the user from the session cookie.
2. `runAiOperation` loads limits and prices from the database. If that fails, it fails closed (no AI call).
3. Oversize input is rejected. Models in the feature's chain whose worst-case cost fits the per-operation ceiling are candidates.
4. `ai_reserve` atomically checks the user's balance, rate limits and the platform daily budget and holds the worst-case cost. If the best model does not fit, the next cheaper one is tried.
5. The provider call runs with a hard timeout and `max_tokens` from the feature config.
6. `ai_commit` charges the **actual** token usage reported by the provider, computed in SQL from `ai_model_pricing`. The unused part of the hold is returned.
7. Failures: provider error = no charge; timeout = no user charge, worst case counted against the platform budget; interrupted stream = only known input tokens charged; unparseable output = real usage charged; settle failure = result delivered, failure logged, hold released when its 5-minute lease expires.

## Units

Money is stored in micro-USD. One credit = 1000 micro-USD ($0.001) by default, so 2,000 Pro credits = $2.00 of API cost. Balances are stored in milli-credits.

## Tuning (SQL, no deploy needed)

```sql
update ai_settings set value_num = 10000000 where key = 'platform_daily_budget_micro_usd'; -- $10/day
update ai_settings set value_num = 100 where key = 'free_intro_credits';
update ai_model_pricing set input_micro_per_mtok = 2000000 where model_id = 'claude-sonnet-5-5';
update ai_features set enabled = false where feature_key = 'protocol_review';              -- kill switch
```

## Not included yet

- **Payment provider.** No payment integration exists. `ai_apply_subscription_event(...)` is the (idempotent, stale-safe) entry point a webhook handler should call once a provider is chosen. Until then everyone is on the free introductory allowance.
- **Billable server tools** (web search etc.) are not used. Add a verified row to `ai_tool_pricing` before enabling one; unpriced tools are charged a conservative default.
- Cache prices flagged `cache_prices_verified = false` use generic multipliers; verify against Anthropic's pricing page before relying on prompt caching savings.

## Running the tests

They need an isolated scratch Postgres (never Supabase or production). Defaults to `postgres://postgres@localhost:5544`; override with `TEST_PG_URL`.

```bash
cd frontend && npm test
```
