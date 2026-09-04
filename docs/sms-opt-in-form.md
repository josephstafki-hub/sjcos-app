# SMS opt-in on the website form — what the web developer needs to change

For: whoever maintains sjcarpentryllc.com (Payload CMS).
Page: `https://www.sjcarpentryllc.com/start-a-project-conversation`
Why: Telnyx / the carriers rejected SJ Carpentry's 10DLC texting campaign
(TELNYX_FAILED, 2026-09-03) because the form's SMS consent wording is
incomplete. Carrier rules require specific elements next to the checkbox.
Reference: Telnyx "10DLC opt-in form" guide, article 10684260.

Nothing below is optional; every element is checked by a human reviewer.

## 1. The checkbox (keep it unchecked by default, keep it optional)

Replace the current label

> Send me important updates via text message

with exactly:

> **Yes, text me project updates from SJ Carpentry LLC**

The box must stay **unchecked by default** and the form must still submit
when it is left unchecked. Keep it a separate checkbox from the newsletter
checkbox and from any terms acceptance.

## 2. The disclosure text, displayed directly beside or under the checkbox

Replace

> Message and data rates may apply. You may unsubscribe at any time.

with exactly (one paragraph, the Privacy Policy as a working link):

> By checking this box and providing your phone number, you agree to receive SMS project updates, scheduling confirmations, and document requests from SJ Carpentry LLC. Message frequency may vary. Standard message and data rates may apply. Reply STOP to opt out. Reply HELP for help. We will not share mobile information with third parties for promotional or marketing purposes. See our [Privacy Policy](https://www.sjcarpentryllc.com/privacy-policy).

The phrase "Privacy Policy" must link to `https://www.sjcarpentryllc.com/privacy-policy`.

## 3. Privacy policy page

Add one line to `https://www.sjcarpentryllc.com/privacy-policy` (carriers
check for it):

> SMS consent and phone numbers collected for text messaging are not shared with third parties or affiliates for marketing purposes.

## 4. Send the submission to SJC OS (so the confirmation text goes out)

Carriers require a confirmation text the moment someone opts in. SJC OS
sends it automatically, but only if it receives the submission. Today the
form only emails Joe. Please POST each submission as JSON to:

```
POST https://os.sjcarpentryllc.com/api/leads/intake
Authorization: Bearer <intake token — Joe provides this from SJC OS Settings>
Content-Type: application/json

{
  "name": "…",
  "email": "…",
  "phone": "…",
  "address": "<city>",
  "project": "<project type>",
  "budget": "…",
  "message": "…",
  "email_subscribed": "yes" | "no",
  "text_subscribed": "yes" | "no",
  "source": "Website form"
}
```

Field names are free-form apart from `name` (required), `email`, `phone`,
`address`, `project`, `budget`, `timeline`, `message`, `source`. Anything
else, including `text_subscribed`, is stored as-is. `text_subscribed` must
be `"yes"` (or `true` / `"on"`) only when the box was actually ticked. The
endpoint answers `201 {"ok":true}`; keep the existing email notification too.

When `text_subscribed` is affirmative and a phone number is present, SJC OS
texts the new contact:

> SJ Carpentry LLC: you're opted in to project update & scheduling texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.

## 5. Tell Joe when it is live

He then takes a screenshot of the updated form (the reviewer needs one) and
resubmits the campaign. Do not change the wording above without telling him:
the campaign registration quotes it verbatim.
