/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Mailjet SMTP verification and welcome email senders
    Author review: Pending
**/
import nodemailer, { type SendMailOptions } from "nodemailer";

export interface MailjetConfiguration {
  apiKey: string;
  secretKey: string;
  from: string;
}

export interface WelcomeEmailRecipient {
  email: string;
  name: string;
}

export interface VerificationEmailRecipient extends WelcomeEmailRecipient {
  verificationCode: string;
}

interface MailTransport {
  sendMail(message: SendMailOptions): Promise<unknown>;
}

function createTransport(settings: MailjetConfiguration): MailTransport {
  return nodemailer.createTransport({
    host: "in-v3.mailjet.com",
    port: 587,
    secure: false,
    auth: { user: settings.apiKey, pass: settings.secretKey },
  });
}

export function createWelcomeEmailSender(
  settings: MailjetConfiguration,
  transport: MailTransport = createTransport(settings),
): (recipient: WelcomeEmailRecipient) => Promise<void> {
  return async ({ email, name }) => {
    await transport.sendMail({
      from: settings.from,
      to: email,
      subject: "Welcome to NUS FOC!",
      text: `Hi ${name},\n\nWelcome to NUS Friends of Campus! Your account is ready. We’re glad to have you with us.\n`,
    });
  };
}

export function createVerificationEmailSender(
  settings: MailjetConfiguration,
  transport: MailTransport = createTransport(settings),
): (recipient: VerificationEmailRecipient) => Promise<void> {
  return async ({ email, name, verificationCode }) => {
    await transport.sendMail({
      from: settings.from,
      to: email,
      subject: "Verify your NUS FOC account",
      text: `Hi ${name},\n\nYour NUS Friends of Campus verification code is ${verificationCode}.\n\nVisit the app and enter this code on the /verify page to activate your account. If you did not create this account, you can ignore this email.\n`,
    });
  };
}
