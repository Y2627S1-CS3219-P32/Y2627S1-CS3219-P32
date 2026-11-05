<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-11-04.
Scope: Mail-service verification/welcome email behavior and Mailjet setup. Author review: Pending. -->
# Mail Service

The mail service consumes the user service's `user-events` Pub/Sub topic. It sends a
verification-code email for pending `user.created` and `user.updated` events. Verified
signup accounts receive a welcome email, while verified email changes receive an
"email updated" notice instead. Other events are acknowledged without sending mail.
Signup itself does not wait for email delivery.

## Local development

The root Compose stack starts the mail service and creates its push subscription on
the local Pub/Sub emulator. Set these variables in the root `.env` to enable sending:

```env
MAILJET_API_KEY=
MAILJET_SECRET_KEY=
MAILJET_FROM=
```

`MAILJET_FROM` must be a sender address verified in Mailjet. The service connects to
Mailjet's SMTP endpoint at `in-v3.mailjet.com:587` using Nodemailer. If the variables
are unset, verification, welcome, and email-updated emails are skipped with a warning.

## Delivery behavior

On successful delivery, the push request is acknowledged with HTTP 204. Invalid
events are logged and acknowledged so they do not retry forever. A Mailjet delivery
failure returns HTTP 500 and Pub/Sub retries the event. Pub/Sub delivery is
at-least-once, so a retry after Mailjet accepted a message but before Pub/Sub receives
the acknowledgment can result in a duplicate email.

In Cloud Run, `deploy.sh` deploys the service and creates its authenticated push
subscription when Secret Manager contains `mailjet-api-key`, `mailjet-secret-key`,
and `mailjet-from`. See the root [deployment instructions](../README.md#deploy-to-google-cloud-cloud-run).
