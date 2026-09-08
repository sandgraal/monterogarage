# Privacy & How Sharing Works

**Language:** **English** · [[Español|Privacidad-y-cómo-compartir]]

Montero Garage is built around one simple promise: **your truck's history is
yours, private by default, and shared only when you choose.** This page lays out
exactly what that means.

- [Private by default](#private-by-default)
- [The three ways something can leave your garage](#the-three-ways-something-can-leave-your-garage)
- [What each sharing choice exposes](#what-each-sharing-choice-exposes)
- [Costs and receipts are handled separately](#costs-and-receipts-are-handled-separately)
- [Ending access](#ending-access)
- [How your data is kept](#how-your-data-is-kept)
- [Your data is yours](#your-data-is-yours)

---

## Private by default

When you store something in your garage, it is **visible only to you** from the
moment you save it. Your vehicles, records, receipts, photos, costs, and notes are
all private until you take a deliberate action to share or publish them.

Nothing is ever public "by accident." Publishing and sharing are always opt-in,
and always **one vehicle and one record at a time** — there is no single switch
that exposes everything.

---

## The three ways something can leave your garage

There are exactly three, and they are different in kind:

| Way                         | Who sees it                    | Scope                                         |
| --------------------------- | ------------------------------ | --------------------------------------------- |
| **Publish a showcase page** | Anyone on the web              | The truck's profile + photos                  |
| **Publish a work-log page** | Anyone on the web              | Only the records you open, one by one         |
| **Share a private link**    | Only the person you send it to | That truck's history, scoped and time-limited |

Everything else stays in your garage.

---

## What each sharing choice exposes

### Publishing a showcase page

Shows the truck's **profile and photos** (the cover photo leads). Anyone with the
address can view it. It shows no records, costs, or receipts.

### Publishing a work-log page

Shows **only the records you individually open** — never your whole history at
once. For each opened record you separately decide whether to show its cost.
**Receipts are never shown on a public work-log.**

### A private share link (typed grant)

A private link opens **one truck's history for one recipient**, and you set its
scope precisely:

- **Who it is for** — labelled _A mechanic_ or _A buyer_ (a label only; the
  switches below decide what actually opens).
- **Costs** — show what each job cost, or not (off by default).
- **Receipts** — show the receipt scans, or not (a separate switch from costs).
- **Expiry** — the link ends on its own after a number of days you pick, or you
  can set it to last "until revoked."
- **Addressed to a person (optional)** — tie the link to a specific account's
  email so it opens **only for them** once they sign in. Left blank, it is a
  bearer link that anyone you send it to can open — so treat it like a key.

A private link is **not** publishing: nothing about it puts the truck on the
public site, and shared pages are never indexed by search engines.

---

## Costs and receipts are handled separately

Across the whole site, **what a job cost** and **the receipt for it** are always
two independent decisions, kept apart from whether the record itself is visible.
You can:

- show a job but hide what it cost;
- hand a buyer the totals but not the scans;
- hand a mechanic the scans but not the totals.

When a cost was never recorded, the site says **"not recorded"** — it never
guesses, and never presents a blank as "free."

---

## Ending access

You are always in control after the fact:

- **End a shared link** (revoke it) at any time, from the list of links you have
  created. Revocation is **immediate and never delayed or gated.**
- **Unpublish** a showcase or work-log page, or close an individual record,
  whenever you like.
- **Delete** a record or a whole vehicle. Deleting is permanent, so the site
  confirms first.

When a link is revoked or expires, or a record is unpublished, it disappears for
the other person — including from a mechanic's roster — on their next visit.

For safety, the reasons a link might fail (unknown, expired, revoked) are shown as
**one identical message.** The site will not confirm to a stranger whether a
particular link ever existed.

---

## How your data is kept

- **Your data lives behind per-account security.** Records and receipts are stored
  in a database where each account can reach only its own rows; that boundary is
  enforced by the storage layer itself, not just by the pages.
- **Files are in private storage.** Photos, receipts, and attachments are served
  through temporary links that expire on their own; there is no public URL for
  them.
- **Shared links are read in your browser**, not sent to a server to be looked up.
- **No third-party ads or analytics SDKs**, and the site never sells, licenses, or
  shares your data with anyone — not even aggregated or anonymized.

---

## Your data is yours

A standing principle of the platform: **vehicle owners are free, permanently.**
No feature that stores, reads, exports, or shares your own data is ever put behind
a payment. Revoking a share, letting one expire, deleting your account, and
exporting your own data are never gated.

If future paid features arrive, they are aimed at **shops as businesses** — never
at owners, and never at your access to your own truck's history. See
[[Roadmap|Roadmap]].

---

Next: [[For Owners|For-Owners]] · [[For Mechanics|For-Mechanics]]
