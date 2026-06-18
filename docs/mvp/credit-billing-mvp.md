# Credit billing MVP

## Units

- **1 NINK = 100 credits** (display convention in extension popup)
- **1 credit = 0.01 NINK** = `10^16` wei internally (`CREDIT_WEI`)
- Balances stored as **wei** in `virtual_nink_balances.balance_wei`

## Sign-up and sign-off (context)

| Action | Credits | Entry type |
|--------|---------|------------|
| Signup bonus | **500** (5.00 NINK) | `email_verified_signup` (via signup flow) |
| Sign-off anchor | **10** | `anchor` / virtual debit on sign-off |

These are separate from evidence-package viewer fees below.

## Evidence package pricing (MVP)

| Action | Credits | API route | `entry_type` (debit) |
|--------|---------|-----------|----------------------|
| **Open package** (view conversation) | **10** | `POST /v1/packages/view` | `package_view` |
| **Verify integrity** | **5** | `POST /v1/packages/verify` | `package_verify` |
| **Download report** | **5** | `POST /v1/packages/download-report` | `package_report` |

Constants: `packages/api/src/constants.mjs` (`PACKAGE_*_FEE_WEI`).

Who pays: the **authenticated user performing the action** (owner or granted viewer). Approval does not transfer cost to Alice.

## Debit flow

1. API calls Supabase RPC `debit_virtual_nink(p_user_id, p_amount_wei, p_entry_type, p_metadata)`
2. RPC checks balance **before** debit (row lock on `virtual_nink_balances`)
3. On success:
   - Updates `balance_wei`
   - Inserts **`nink_ledger`** (append-only, negative `amount_wei`)
   - Inserts **`credit_transactions`** (positive `amount` in credits, `package_id` from metadata)

Metadata on package debits includes `package_id` and `action` (`view` / `verify` / `report`).

## Insufficient credits

- RPC raises `Insufficient NINK balance`
- API maps to **`InsufficientBalanceError`** → HTTP **402** JSON
- Extension viewer disables unlock buttons when balance is known too low; failed API call shows error message

Bob must have **≥ 10 credits** to open a package after approval.

## Refund behaviour

Credits are debited **before** decrypt/verify. On failure, API calls `credit_virtual_nink` with a refund entry type:

| Failure | Refund `entry_type` | User charged? |
|---------|---------------------|---------------|
| View — decrypt/integrity error | `package_view_refund` | No (refunded) |
| View — hash mismatch after decrypt | `package_view_refund` | No |
| Verify — invalid hash | `package_verify_refund` | No (`creditsCharged: 0`) |
| Verify — thrown error after debit | `package_verify_refund` | No |
| Report — integrity failure | `package_report_refund` | No |

Refunds append to **`nink_ledger`** (positive `amount_wei`). They do **not** delete the original debit row in `credit_transactions` — net effect is balance restored.

## Ledger and transaction records

### `nink_ledger`

- Append-only virtual NINK movements
- Fields: `user_id`, `entry_type`, `amount_wei` (signed), `balance_after`, `metadata`

### `credit_transactions`

- One row per successful **debit** via `debit_virtual_nink`
- Fields: `user_id`, `package_id`, `action` (= entry_type), `amount` (credits), `amount_wei`, `balance_after_wei`, `metadata`

Example — list Bob’s package charges:

```sql
select created_at, action, amount, package_id, balance_after_wei
from credit_transactions
where user_id = '<bob-user-uuid>'
order by created_at desc;
```

## Extension balance display

- Popup shows **Your credits** from `GET /v1/accounting/parameters`
- After cloud unlock, viewer updates `chrome.storage.local.accounting.userBalance` from API response

## Out of scope

- Stripe / paid top-ups (signup bonus only for MVP testing)
- P2P credit transfer
- Owner-pays-for-viewer
- Subscription or org billing
- On-chain fee burn for package views
