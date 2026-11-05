/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Mailjet verification and welcome email sender tests
    Author review: Pending
**/
import assert from "node:assert/strict";
import test from "node:test";

import type { SendMailOptions } from "nodemailer";

import {
  createEmailUpdatedEmailSender,
  createVerificationEmailSender,
  createWelcomeEmailSender,
} from "./welcome-email";

const settings = {
  apiKey: "mailjet-api-key",
  secretKey: "mailjet-secret-key",
  from: "welcome@example.com",
};

test("welcome email sender sends a personalized message to the new user", async () => {
  let sentMessage: SendMailOptions | undefined;
  const sendWelcomeEmail = createWelcomeEmailSender(settings, {
    async sendMail(message) {
      sentMessage = message;
      return {};
    },
  });

  await sendWelcomeEmail({ email: "student@u.nus.edu", name: "Alex Tan" });
  assert.deepEqual(sentMessage, {
    from: "welcome@example.com",
    to: "student@u.nus.edu",
    subject: "Welcome to NUS FOC!",
    text: "Hi Alex Tan,\n\nWelcome to NUS Friends of Campus! Your account is ready. We’re glad to have you with us.\n",
  });
});

test("welcome email sender rejects failed delivery", async () => {
  const sendWelcomeEmail = createWelcomeEmailSender(settings, {
    async sendMail() {
      throw new Error("Mailjet unavailable");
    },
  });

  test("email-updated sender sends an account-change notice", async () => {
    let sentMessage: SendMailOptions | undefined;
    const sendEmailUpdatedEmail = createEmailUpdatedEmailSender(settings, {
      async sendMail(message) {
        sentMessage = message;
        return {};
      },
    });

    await sendEmailUpdatedEmail({ email: "student@u.nus.edu", name: "Alex Tan" });
    assert.deepEqual(sentMessage, {
      from: "welcome@example.com",
      to: "student@u.nus.edu",
      subject: "Your NUS FOC email address was updated",
      text: "Hi Alex Tan,\n\nThe email address associated with your NUS Friends of Campus account has been updated to student@u.nus.edu.\n\nIf you did not make this change, please contact support.\n",
    });
  });

  test("email-updated sender rejects failed delivery", async () => {
    const sendEmailUpdatedEmail = createEmailUpdatedEmailSender(settings, {
      async sendMail() {
        throw new Error("Mailjet unavailable");
      },
    });

    await assert.rejects(
      sendEmailUpdatedEmail({ email: "student@u.nus.edu", name: "Alex Tan" }),
      { message: "Mailjet unavailable" },
    );
  });

  await assert.rejects(
    sendWelcomeEmail({ email: "student@u.nus.edu", name: "Alex Tan" }),
    { message: "Mailjet unavailable" },
  );
});

test("verification email sender sends the code to the new user", async () => {
  let sentMessage: SendMailOptions | undefined;
  const sendVerificationEmail = createVerificationEmailSender(settings, {
    async sendMail(message) {
      sentMessage = message;
      return {};
    },
  });

  await sendVerificationEmail({
    email: "student@u.nus.edu",
    name: "Alex Tan",
    verificationCode: "012345",
  });
  assert.deepEqual(sentMessage, {
    from: "welcome@example.com",
    to: "student@u.nus.edu",
    subject: "Verify your NUS FOC account",
    text: "Hi Alex Tan,\n\nYour NUS Friends of Campus verification code is 012345. Enter this code in the app to verify your account. If you did not request this code, you can ignore this email.\n",
  });
});

test("verification email sender rejects failed delivery", async () => {
  const sendVerificationEmail = createVerificationEmailSender(settings, {
    async sendMail() {
      throw new Error("Mailjet unavailable");
    },
  });

  await assert.rejects(
    sendVerificationEmail({
      email: "student@u.nus.edu",
      name: "Alex Tan",
      verificationCode: "012345",
    }),
    { message: "Mailjet unavailable" },
  );
});
